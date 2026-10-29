/**
 * OpenAPI 3.0 Exporter
 *
 * Generates a valid OpenAPI 3.0.3 document from an HTTP Forge collection.
 * Implements all mapping rules per the solution document §4.3.2.
 *
 * Orchestrates the export pipeline across focused collaborators:
 * - OpenApiOperationBuilder: request → operation mapping
 * - OpenApiSchemaMerger: reconciliation of colliding path+method variants
 * - OpenApiSpecWriter: component deduplication, finalization, serialization
 * - openapi-utils: pure mapping helpers
 */

import {
    Collection,
    CollectionFolderItem,
    CollectionItem,
    CollectionRequestItem,
    ICollectionService,
} from '../../types/collection';
import { IEnvironmentConfigService } from '../../types/environment-config';
import { SchemaInferenceService } from './schema-inference-service';
import { SchemaInferrer } from './schema-inferrer';
import { OpenApiOperationBuilder } from './openapi-operation-builder';
import { OpenApiSchemaMerger } from './openapi-schema-merger';
import { OpenApiSpecWriter } from './openapi-spec-writer';
import { normalizeUrl, OpenApiExportOptions } from './openapi-utils';

export type { OpenApiExportOptions } from './openapi-utils';

export class OpenApiExporter {
    private readonly merger: OpenApiSchemaMerger;
    private readonly operationBuilder: OpenApiOperationBuilder;
    private readonly specWriter: OpenApiSpecWriter;

    constructor(
        private collectionService: ICollectionService,
        private envConfigService: IEnvironmentConfigService,
        private inferenceService: SchemaInferenceService
    ) {
        const inferrer = new SchemaInferrer();
        this.merger = new OpenApiSchemaMerger();
        this.operationBuilder = new OpenApiOperationBuilder(inferrer);
        this.specWriter = new OpenApiSpecWriter();
    }

    /**
     * Export a collection as an OpenAPI 3.0.3 document.
     */
    async export(
        collectionId: string,
        options: OpenApiExportOptions
    ): Promise<string> {
        const collection = this.collectionService.getCollection(collectionId);
        if (!collection) {
            throw new Error(`Collection ${collectionId} not found`);
        }

        const spec: any = {
            openapi: '3.0.3',
            info: this.buildInfo(collection, options),
            servers: this.buildServers(options),
            paths: {},
            components: {
                schemas: {},
                securitySchemes: {}
            },
            tags: []
        };

        // Collect all security schemes from the collection
        const securitySchemes = new Map<string, any>();

        // Collection-level auth → global security
        if (collection.auth && collection.auth.type !== 'none' && collection.auth.type !== 'inherit') {
            const result = this.operationBuilder.mapAuthToSecurityScheme(collection.auth);
            if (result) {
                const { schemeName, scheme, requirement } = result;
                securitySchemes.set(schemeName, scheme);
                spec.security = [requirement];
            }
        }

        // Walk the collection tree and build paths
        const tags = new Set<string>();
        const hostVars = new Set<string>();
        await this.processItems(
            collection.items,
            spec,
            securitySchemes,
            tags,
            hostVars,
            undefined, // parentTag
            collection,
            options
        );

        // Augment servers with any host variables found in request URLs
        this.augmentServersFromHostVars(hostVars, spec.servers, options);

        // Finalize and serialize
        return this.specWriter.finalize(spec, securitySchemes, tags, options);
    }

    // ================================================
    // Info
    // ================================================

    private buildInfo(collection: Collection, options: OpenApiExportOptions): any {
        return {
            title: options.info?.title || collection.name,
            description: options.info?.description || collection.description || '',
            version: options.info?.version || collection.version || '1.0.0'
        };
    }

    // ================================================
    // Servers
    // ================================================

    private buildServers(options: OpenApiExportOptions): any[] {
        const servers: any[] = [];
        const envNames = options.environments || [];

        if (envNames.length === 0) {
            // Try to detect baseUrl from current environment
            const currentEnv = this.envConfigService.getSelectedEnvironment();
            if (currentEnv) {
                const resolved = this.envConfigService.resolveVariables('{{baseUrl}}', currentEnv);
                if (resolved && resolved !== '{{baseUrl}}') {
                    servers.push({ url: resolved, description: currentEnv });
                }
            }
        } else {
            const seenUrls = new Set<string>();
            for (const envName of envNames) {
                const resolved = this.envConfigService.resolveVariables('{{baseUrl}}', envName);
                if (resolved && resolved !== '{{baseUrl}}' && !seenUrls.has(resolved)) {
                    seenUrls.add(resolved);
                    servers.push({ url: resolved, description: envName });
                }
            }
        }

        if (servers.length === 0) {
            servers.push({ url: 'http://localhost', description: 'Default server' });
        }

        return servers;
    }

    // ================================================
    // Process Items (recursive tree walker)
    // ================================================

    private async processItems(
        items: CollectionItem[],
        spec: any,
        securitySchemes: Map<string, any>,
        tags: Set<string>,
        hostVars: Set<string>,
        parentTag: string | undefined,
        collection: Collection,
        options: OpenApiExportOptions
    ): Promise<void> {
        for (const item of items) {
            if (item.type === 'folder') {
                const folder = item as CollectionFolderItem;
                // Top-level folder name becomes a tag
                const tag = parentTag || folder.name;
                tags.add(tag);

                if (folder.items) {
                    await this.processItems(
                        folder.items, spec, securitySchemes, tags, hostVars, tag, collection, options
                    );
                }
            } else {
                const request = item as CollectionRequestItem;
                await this.processRequest(
                    request, spec, securitySchemes, tags, hostVars, parentTag, collection, options
                );
            }
        }
    }

    private async processRequest(
        request: CollectionRequestItem,
        spec: any,
        securitySchemes: Map<string, any>,
        tags: Set<string>,
        hostVars: Set<string>,
        parentTag: string | undefined,
        collection: Collection,
        options: OpenApiExportOptions
    ): Promise<void> {
        const { path: normalizedPath, hostVar } = normalizeUrl(request.url);
        if (hostVar) { hostVars.add(hostVar); }
        const method = (request.method || 'GET').toLowerCase();

        if (!spec.paths[normalizedPath]) {
            spec.paths[normalizedPath] = {};
        }

        const operation = await this.operationBuilder.buildOperation(
            request, method, normalizedPath, spec, securitySchemes, tags, parentTag, collection, options
        );

        // When the same path+method already exists, merge instead of overwriting
        // so that different parameter constraints (e.g. different enum values) are preserved.
        const existing = spec.paths[normalizedPath][method];
        if (existing) {
            this.merger.mergeOperation(existing, operation, request.name);
        } else {
            spec.paths[normalizedPath][method] = operation;
        }
    }

    // ================================================
    // Server Augmentation from Host Variables
    // ================================================

    /**
     * For each host variable found in request URLs (e.g. {{dcqHost}}),
     * attempt to resolve it from the configured environments and add it
     * to the servers list. Falls back to an OAS server-variable entry
     * if the variable cannot be resolved.
     */
    private augmentServersFromHostVars(
        hostVars: Set<string>,
        servers: any[],
        options: OpenApiExportOptions
    ): void {
        if (hostVars.size === 0) { return; }

        const existingUrls = new Set(servers.map((s: any) => s.url));
        const envNames: string[] = options.environments?.length
            ? options.environments
            : [this.envConfigService.getSelectedEnvironment()].filter((e): e is string => !!e);

        for (const varName of hostVars) {
            const placeholder = `{{${varName}}}`;
            let resolved = false;

            for (const envName of envNames) {
                const url = this.envConfigService.resolveVariables(placeholder, envName);
                if (url && url !== placeholder && !existingUrls.has(url)) {
                    servers.push({ url, description: envName });
                    existingUrls.add(url);
                    resolved = true;
                }
            }

            if (!resolved) {
                // Cannot resolve — emit an OAS server-variable entry
                const serverVarUrl = `{${varName}}`;
                if (!existingUrls.has(serverVarUrl)) {
                    servers.push({
                        url: serverVarUrl,
                        variables: { [varName]: { default: '' } }
                    });
                    existingUrls.add(serverVarUrl);
                }
            }
        }
    }
}
