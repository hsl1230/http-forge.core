/**
 * OpenAPI 3.0 Importer
 * 
 * Parses an OpenAPI 3.0 spec and creates a fully hydrated HTTP Forge collection.
 * Implements all mapping rules per the solution document §4.4.2.
 */

import * as fs from 'fs';
import * as yaml from 'yaml';
import {
    Collection,
    CollectionFolderItem,
    CollectionRequestItem,
    ICollectionService,
} from '../../types/collection';
import { IEnvironmentConfigService } from '../../types/environment-config';
import {
    BodySchemaDefinition,
    ContentDefinition,
    JSONSchema7,
    KeyValueEntry,
    PathParamEntry,
    RequestAuth,
    ResponseDefinition,
    ResponseSchemaDefinition
} from '../../types/types';
import { generateId } from '../../utils/helpers';
import { ExampleGenerator } from './example-generator';
import { RefResolver } from './ref-resolver';

export interface OpenApiImportOptions {
    /** Base environment name to create with server URL */
    environmentName?: string;
    /** Collection name override */
    collectionName?: string;
}

/** Content type selection priority for primary body type */
const CONTENT_TYPE_PRIORITY = [
    'application/json',
    'text/plain',
    'text/html',
    'multipart/form-data',
    'application/x-www-form-urlencoded'
];

export class OpenApiImporter {
    private exampleGenerator: ExampleGenerator;
    private refResolver: RefResolver;

    constructor(
        private collectionService: ICollectionService,
        private envConfigService: IEnvironmentConfigService
    ) {
        this.exampleGenerator = new ExampleGenerator();
        this.refResolver = new RefResolver();
    }

    /**
     * Import an OpenAPI spec file and create an HTTP Forge collection.
     */
    async import(
        filePath: string,
        options?: OpenApiImportOptions
    ): Promise<{ collection: Collection; environmentCreated?: string }> {
        // Read and parse the file
        const rawContent = await fs.promises.readFile(filePath, 'utf-8');
        const spec = this.parseSpec(rawContent, filePath);
        return this.importFromSpec(spec, options);
    }

    /**
     * Import an OpenAPI spec fetched from a URL (e.g. a public schema endpoint
     * or an OpenAPI-introspection endpoint). Uses the Node 18+ global `fetch`.
     */
    async importFromUrl(
        url: string,
        options?: OpenApiImportOptions
    ): Promise<{ collection: Collection; environmentCreated?: string }> {
        const response = await fetch(url, { headers: { Accept: 'application/json, application/yaml, text/yaml' } });
        if (!response.ok) {
            throw new Error(`Failed to fetch OpenAPI spec from ${url}: HTTP ${response.status} ${response.statusText}`);
        }
        const rawContent = await response.text();
        const spec = this.parseSpec(rawContent, url);
        return this.importFromSpec(spec, options);
    }

    /**
     * Import an OpenAPI spec from an in-memory string (JSON or YAML).
     */
    async importFromString(
        rawContent: string,
        options?: OpenApiImportOptions
    ): Promise<{ collection: Collection; environmentCreated?: string }> {
        const spec = this.parseSpec(rawContent, 'spec');
        return this.importFromSpec(spec, options);
    }

    /** Parse YAML/JSON raw content into a spec object (format-inferred). */
    private parseSpec(rawContent: string, source: string): any {
        const trimmed = rawContent.trim();
        if (!trimmed) {
            throw new Error(`OpenAPI spec is empty (${source})`);
        }
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            return JSON.parse(rawContent);
        }
        // Fall back to YAML for anything not starting with a JSON brace.
        return yaml.parse(rawContent);
    }

    /** Shared import path after the spec object has been produced. */
    private async importFromSpec(
        specInput: any,
        options?: OpenApiImportOptions
    ): Promise<{ collection: Collection; environmentCreated?: string }> {
        let spec = specInput;

        // Resolve all $ref pointers
        spec = await this.refResolver.resolve(spec);

        // Extract components for example generation and schema storage
        const components = spec.components?.schemas || {};

        // Create collection
        const collectionName = options?.collectionName || spec.info?.title || 'Imported API';
        const collectionId = generateId(collectionName);

        const collection: Collection = {
            id: collectionId,
            name: collectionName,
            description: spec.info?.description || '',
            version: spec.info?.version || '1.0.0',
            variables: {},
            items: []
        };

        // Set baseUrl from first server
        if (spec.servers && spec.servers.length > 0) {
            collection.variables!.baseUrl = spec.servers[0].url;
        }

        // Map global security to collection-level auth
        if (spec.security && spec.security.length > 0 && spec.components?.securitySchemes) {
            const globalAuth = this.mapSecurityToAuth(spec.security[0], spec.components.securitySchemes);
            if (globalAuth) {
                collection.auth = globalAuth;
            }
        }

        // Build folder structure from tags
        const folderMap = new Map<string, CollectionFolderItem>();
        if (spec.tags) {
            for (const tag of spec.tags) {
                const folder: CollectionFolderItem = {
                    type: 'folder',
                    id: generateId(tag.name),
                    name: tag.name,
                    description: tag.description,
                    items: []
                };
                folderMap.set(tag.name, folder);
                collection.items.push(folder);
            }
        }

        // Process all paths and operations
        if (spec.paths) {
            for (const [pathStr, pathItem] of Object.entries(spec.paths)) {
                for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']) {
                    const operation = (pathItem as any)[method];
                    if (!operation) { continue; }

                    const request = this.processOperation(
                        method,
                        pathStr,
                        operation,
                        pathItem as any,
                        spec,
                        components
                    );

                    // Place in the correct folder based on tags
                    const tag = operation.tags?.[0];
                    if (tag && folderMap.has(tag)) {
                        folderMap.get(tag)!.items!.push(request);
                    } else if (tag) {
                        // Create folder on the fly
                        const folder: CollectionFolderItem = {
                            type: 'folder',
                            id: generateId(tag),
                            name: tag,
                            items: [request]
                        };
                        folderMap.set(tag, folder);
                        collection.items.push(folder);
                    } else {
                        // No tag — root level
                        collection.items.push(request);
                    }
                }
            }
        }

        // Save the collection
        await this.collectionService.saveCollection(collection);

        // Optionally create environment(s) from servers
        let environmentCreated: string | undefined;
        if (options?.environmentName && spec.servers) {
            environmentCreated = await this.createEnvironmentFromServers(
                spec.servers,
                options.environmentName
            );
        }

        return { collection, environmentCreated };
    }

    // ================================================
    // Operation Processing
    // ================================================

    private processOperation(
        method: string,
        pathStr: string,
        operation: any,
        pathItem: any,
        spec: any,
        components: Record<string, JSONSchema7>
    ): CollectionRequestItem {
        const id = generateId(operation.operationId || `${method}-${pathStr}`);

        // Build URL: {{baseUrl}} + path with :param syntax
        const url = `{{baseUrl}}${this.convertPathParams(pathStr)}`;

        // Build name
        let name = operation.summary || operation.operationId || `${method.toUpperCase()} ${pathStr}`;

        // Deprecated prefix
        const deprecated = operation.deprecated === true;
        if (deprecated) {
            name = `[DEPRECATED] ${name}`;
        }

        const request: CollectionRequestItem = {
            type: 'request',
            id,
            name,
            method: method.toUpperCase(),
            url,
            description: operation.description || '',
            deprecated
        };

        // Preserve OpenAPI metadata for round-trip export.
        if (operation.operationId) { request.operationId = operation.operationId; }
        if (operation.summary) { request.summary = operation.summary; }
        if (operation.tags?.length) { request.tags = [...operation.tags]; }

        // Process parameters (path-level + operation-level)
        const allParams = [
            ...(pathItem.parameters || []),
            ...(operation.parameters || [])
        ];
        this.processParameters(request, allParams, components);

        // Process request body
        if (operation.requestBody) {
            this.processRequestBody(request, operation.requestBody, components);
        }

        // Process responses → response.schema.json
        if (operation.responses) {
            request.responseSchema = this.processResponses(operation.responses, components);
        }

        // Process operation-level security
        if (operation.security !== undefined && spec.components?.securitySchemes) {
            if (Array.isArray(operation.security) && operation.security.length === 0) {
                request.auth = { type: 'none' };
            } else if (operation.security && operation.security.length > 0) {
                const auth = this.mapSecurityToAuth(operation.security[0], spec.components.securitySchemes);
                if (auth) {
                    request.auth = auth;
                }
            }
        }

        return request;
    }

    // ================================================
    // Path Conversion
    // ================================================

    /**
     * Convert OpenAPI path parameters from {param} to :param syntax.
     */
    private convertPathParams(pathStr: string): string {
        return pathStr.replace(/\{(\w+)\}/g, ':$1');
    }

    // ================================================
    // Parameters
    // ================================================

    private processParameters(
        request: CollectionRequestItem,
        parameters: any[],
        components: Record<string, JSONSchema7>
    ): void {
        const headers: KeyValueEntry[] = [];
        const query: KeyValueEntry[] = [];
        const params: Record<string, string | PathParamEntry> = {};
        const cookiePairs: string[] = [];

        for (const param of parameters) {
            const name = param.name;
            const location = param.in;
            const schema = param.schema || {};
            const example = param.example !== undefined
                ? String(param.example)
                : this.generateExampleForParam(schema, components);
            const deprecated = param.deprecated === true;

            switch (location) {
                case 'path': {
                    // Build PathParamEntry if we have metadata beyond just the value
                    const hasMetadata = param.description || schema.type || schema.format
                        || schema.enum || deprecated || schema.pattern
                        || schema.minimum !== undefined || schema.maximum !== undefined
                        || schema.minLength !== undefined || schema.maxLength !== undefined
                        || schema.multipleOf !== undefined
                        || schema.minItems !== undefined || schema.maxItems !== undefined
                        || schema.uniqueItems || schema.nullable
                        || schema.oneOf;
                    if (hasMetadata) {
                        const entry: PathParamEntry = { value: example };
                        if (schema.oneOf) {
                            // Preserve oneOf variants (e.g. from merged exports)
                            entry.oneOf = schema.oneOf;
                            // Derive combined enum/type from variants for UI display
                            this.applyOneOfHints(entry, schema.oneOf);
                        } else {
                            if (schema.type) { entry.type = schema.type; }
                            if (schema.format) { entry.format = schema.format; }
                            if (schema.enum) { entry.enum = schema.enum.map(String); }
                            if (schema.pattern) { entry.pattern = schema.pattern; }
                            if (schema.minimum !== undefined) { entry.minimum = schema.minimum; }
                            if (schema.maximum !== undefined) { entry.maximum = schema.maximum; }
                            if (schema.exclusiveMinimum !== undefined) { entry.exclusiveMinimum = schema.exclusiveMinimum; }
                            if (schema.exclusiveMaximum !== undefined) { entry.exclusiveMaximum = schema.exclusiveMaximum; }
                            if (schema.multipleOf !== undefined) { entry.multipleOf = schema.multipleOf; }
                            if (schema.minLength !== undefined) { entry.minLength = schema.minLength; }
                            if (schema.maxLength !== undefined) { entry.maxLength = schema.maxLength; }
                            if (schema.minItems !== undefined) { entry.minItems = schema.minItems; }
                            if (schema.maxItems !== undefined) { entry.maxItems = schema.maxItems; }
                            if (schema.uniqueItems) { entry.uniqueItems = true; }
                            if (schema.nullable) { entry.nullable = true; }
                        }
                        if (param.description) { entry.description = param.description; }
                        if (deprecated) { entry.deprecated = true; }
                        params[name] = entry;
                    } else {
                        params[name] = example;
                    }
                    break;
                }
                case 'query': {
                    const entry: KeyValueEntry = { key: name, value: example };
                    this.applySchemaConstraints(entry, schema, param, deprecated);
                    query.push(entry);
                    break;
                }
                case 'header': {
                    const entry: KeyValueEntry = { key: name, value: example };
                    this.applySchemaConstraints(entry, schema, param, deprecated);
                    headers.push(entry);
                    break;
                }
                case 'cookie': {
                    // Collect cookie params → synthesize Cookie header
                    cookiePairs.push(`${name}={{${name}}}`);
                    break;
                }
            }
        }

        // Synthesize Cookie header from cookie parameters
        if (cookiePairs.length > 0) {
            headers.push({
                key: 'Cookie',
                value: cookiePairs.join('; ')
            });
        }

        if (Object.keys(params).length > 0) { request.params = params; }
        if (query.length > 0) { request.query = query; }
        if (headers.length > 0) { request.headers = headers; }
    }

    /**
     * Apply all schema constraints to a KeyValueEntry (query/header params).
     */
    private applySchemaConstraints(
        entry: KeyValueEntry,
        schema: any,
        param: any,
        deprecated: boolean
    ): void {
        if (schema.oneOf) {
            entry.oneOf = schema.oneOf;
            this.applyOneOfHints(entry as any, schema.oneOf);
        } else {
            if (schema.type) { entry.type = schema.type; }
            if (schema.format) { entry.format = schema.format; }
            if (schema.enum) { entry.enum = schema.enum.map(String); }
            if (schema.pattern) { entry.pattern = schema.pattern; }
            if (schema.minimum !== undefined) { entry.minimum = schema.minimum; }
            if (schema.maximum !== undefined) { entry.maximum = schema.maximum; }
            if (schema.exclusiveMinimum !== undefined) { entry.exclusiveMinimum = schema.exclusiveMinimum; }
            if (schema.exclusiveMaximum !== undefined) { entry.exclusiveMaximum = schema.exclusiveMaximum; }
            if (schema.multipleOf !== undefined) { entry.multipleOf = schema.multipleOf; }
            if (schema.minLength !== undefined) { entry.minLength = schema.minLength; }
            if (schema.maxLength !== undefined) { entry.maxLength = schema.maxLength; }
            if (schema.minItems !== undefined) { entry.minItems = schema.minItems; }
            if (schema.maxItems !== undefined) { entry.maxItems = schema.maxItems; }
            if (schema.uniqueItems) { entry.uniqueItems = true; }
            if (schema.nullable) { entry.nullable = true; }
        }
        if (param.required) { entry.required = true; }
        if (param.description) { entry.description = param.description; }
        if (deprecated) { entry.deprecated = true; }
    }

    /**
     * When a parameter schema uses oneOf (from merged exports), derive
     * combined enum and type hints for UI display.
     * e.g. oneOf: [{enum: ["1.5"]}, {pattern: "^T\\d+"}] → enum: ["1.5"] as a hint
     */
    private applyOneOfHints(entry: PathParamEntry | KeyValueEntry, variants: any[]): void {
        const allEnums: string[] = [];
        const types = new Set<string>();

        for (const v of variants) {
            if (v.type) { types.add(v.type); }
            if (v.enum) { allEnums.push(...v.enum.map(String)); }
        }

        // Set type if all variants agree, otherwise leave unset
        if (types.size === 1) {
            (entry as any).type = [...types][0];
        }

        // Collect all enum values across variants as a convenience hint
        if (allEnums.length > 0) {
            entry.enum = [...new Set(allEnums)];
        }
    }

    /**
     * Generate an example value string for a parameter from its schema.
     */
    private generateExampleForParam(schema: any, components: Record<string, JSONSchema7>): string {
        if (!schema) { return ''; }

        const value = this.exampleGenerator.generate(schema, { components });
        if (value === undefined || value === null) { return ''; }
        return String(value);
    }

    // ================================================
    // Request Body
    // ================================================

    private processRequestBody(
        request: CollectionRequestItem,
        requestBody: any,
        components: Record<string, JSONSchema7>
    ): void {
        if (!requestBody.content) { return; }

        const contentTypes = Object.keys(requestBody.content);
        if (contentTypes.length === 0) { return; }

        // Select primary content type
        const primaryCt = this.selectPrimaryContentType(contentTypes);
        const primaryContent = requestBody.content[primaryCt];

        // Set body type in request
        const { bodyType, bodyFormat } = this.mapContentTypeToBodyType(primaryCt);
        request.body = {
            type: bodyType as any,
            ...(bodyFormat && { format: bodyFormat as any }),
            content: ''
        };

        // Generate body.json content from example or schema
        if (primaryContent) {
            const bodyContent = this.generateBodyContent(primaryContent, primaryCt, components);
            if (bodyContent !== undefined) {
                request.body.content = typeof bodyContent === 'string'
                    ? bodyContent
                    : JSON.stringify(bodyContent, null, 2);
            }

            // Handle form-data fields
            if (bodyType === 'form-data' && primaryContent.schema?.properties) {
                request.body.content = this.buildFormDataEntries(primaryContent.schema, components);
            }
            if (bodyType === 'x-www-form-urlencoded' && primaryContent.schema?.properties) {
                request.body.content = this.buildFormDataEntries(primaryContent.schema, components);
            }
        }

        // Build body.schema.json
        const bodySchema = this.buildBodySchema(requestBody, primaryCt, components);
        if (bodySchema) {
            request.bodySchema = bodySchema;
        }
    }

    /**
     * Select the primary content type from available options.
     */
    private selectPrimaryContentType(contentTypes: string[]): string {
        for (const preferred of CONTENT_TYPE_PRIORITY) {
            if (contentTypes.includes(preferred)) {
                return preferred;
            }
        }
        // Check for JSON-like types
        const jsonLike = contentTypes.find(ct => ct.includes('json'));
        if (jsonLike) { return jsonLike; }
        // Check for text types
        const textLike = contentTypes.find(ct => ct.startsWith('text/'));
        if (textLike) { return textLike; }
        // Default to first
        return contentTypes[0];
    }

    /**
     * Map an OpenAPI content type to HTTP Forge body type/format.
     */
    private mapContentTypeToBodyType(contentType: string): { bodyType: string; bodyFormat?: string } {
        if (contentType.includes('json')) {
            return { bodyType: 'raw', bodyFormat: 'json' };
        }
        if (contentType === 'application/xml' || contentType === 'text/xml') {
            return { bodyType: 'raw', bodyFormat: 'xml' };
        }
        if (contentType === 'text/html') {
            return { bodyType: 'raw', bodyFormat: 'html' };
        }
        if (contentType.startsWith('text/')) {
            return { bodyType: 'raw', bodyFormat: 'text' };
        }
        if (contentType === 'multipart/form-data') {
            return { bodyType: 'form-data' };
        }
        if (contentType === 'application/x-www-form-urlencoded') {
            return { bodyType: 'x-www-form-urlencoded' };
        }
        if (contentType === 'application/octet-stream') {
            return { bodyType: 'binary' };
        }
        return { bodyType: 'raw', bodyFormat: 'text' };
    }

    /**
     * Generate body content from an OpenAPI media type object.
     */
    private generateBodyContent(
        content: any,
        contentType: string,
        components: Record<string, JSONSchema7>
    ): any {
        // Prefer explicit example
        if (content.example !== undefined) {
            return content.example;
        }

        // Check examples map
        if (content.examples) {
            const firstExample = Object.values(content.examples)[0] as any;
            if (firstExample?.value !== undefined) {
                return firstExample.value;
            }
        }

        // Generate from schema
        if (content.schema) {
            return this.exampleGenerator.generate(content.schema, {
                omitReadOnly: true,
                components
            });
        }

        return undefined;
    }

    /**
     * Build form data entries from an object schema.
     */
    private buildFormDataEntries(
        schema: any,
        components: Record<string, JSONSchema7>
    ): any[] {
        const entries: any[] = [];
        const properties = schema.properties || {};
        const required = new Set(schema.required || []);

        for (const [key, propSchema] of Object.entries(properties)) {
            const prop = propSchema as any;
            const isFile = prop.type === 'string' && prop.format === 'binary';

            const entry: any = {
                key,
                value: isFile ? '' : String(this.exampleGenerator.generate(prop, { components }) || ''),
                type: isFile ? 'file' : 'text',
                enabled: true
            };

            entries.push(entry);
        }

        return entries;
    }

    /**
     * Build body.schema.json from the requestBody.
     */
    private buildBodySchema(
        requestBody: any,
        primaryCt: string,
        components: Record<string, JSONSchema7>
    ): BodySchemaDefinition | undefined {
        const contentTypes = Object.keys(requestBody.content);
        const primaryContent = requestBody.content[primaryCt];

        if (!primaryContent?.schema) {
            return undefined;
        }

        const bodySchema: BodySchemaDefinition = {
            contentType: primaryCt,
            schema: primaryContent.schema
        };

        // If multiple content types, store all in the content map
        if (contentTypes.length > 1) {
            bodySchema.content = {};
            for (const ct of contentTypes) {
                const ctContent = requestBody.content[ct];
                const contentDef: ContentDefinition = {};
                if (ctContent.schema) { contentDef.schema = ctContent.schema; }
                if (ctContent.examples) { contentDef.examples = ctContent.examples; }
                if (ctContent.encoding) { contentDef.encoding = ctContent.encoding; }
                bodySchema.content[ct] = contentDef;
            }
        }

        // Store encoding for multipart
        if (primaryContent.encoding) {
            bodySchema.encoding = primaryContent.encoding;
        }

        // Extract components used in the schema
        const usedComponents = this.extractUsedComponents(primaryContent.schema, components);
        if (Object.keys(usedComponents).length > 0) {
            bodySchema.components = usedComponents;
        }

        return bodySchema;
    }

    // ================================================
    // Responses
    // ================================================

    private processResponses(
        responses: any,
        components: Record<string, JSONSchema7>
    ): ResponseSchemaDefinition {
        const responseSchemaDef: ResponseSchemaDefinition = { responses: {} };
        const allUsedComponents: Record<string, JSONSchema7> = {};

        for (const [statusCode, responseDef] of Object.entries(responses)) {
            const resp = responseDef as any;
            const responseEntry: ResponseDefinition = {
                description: resp.description || `Status ${statusCode}`
            };

            if (resp.content) {
                const contentTypes = Object.keys(resp.content);

                if (contentTypes.length === 1) {
                    // Use shorthand
                    const ct = contentTypes[0];
                    const mediaObj = resp.content[ct];
                    responseEntry.contentType = ct;
                    if (mediaObj.schema) { responseEntry.schema = mediaObj.schema; }
                    if (mediaObj.examples) { responseEntry.examples = mediaObj.examples; }

                    // Track components
                    if (mediaObj.schema) {
                        Object.assign(allUsedComponents, this.extractUsedComponents(mediaObj.schema, components));
                    }
                } else {
                    // Multiple content types → use content map
                    responseEntry.content = {};
                    for (const ct of contentTypes) {
                        const mediaObj = resp.content[ct];
                        const contentDef: ContentDefinition = {};
                        if (mediaObj.schema) { contentDef.schema = mediaObj.schema; }
                        if (mediaObj.examples) { contentDef.examples = mediaObj.examples; }
                        responseEntry.content[ct] = contentDef;

                        if (mediaObj.schema) {
                            Object.assign(allUsedComponents, this.extractUsedComponents(mediaObj.schema, components));
                        }
                    }
                }
            }

            // Response headers
            if (resp.headers) {
                responseEntry.headers = {};
                for (const [headerName, headerDef] of Object.entries(resp.headers)) {
                    const hdr = headerDef as any;
                    responseEntry.headers[headerName] = {
                        ...(hdr.description && { description: hdr.description }),
                        schema: hdr.schema || { type: 'string' }
                    };
                }
            }

            responseSchemaDef.responses[statusCode] = responseEntry;
        }

        // Store extracted components
        if (Object.keys(allUsedComponents).length > 0) {
            responseSchemaDef.components = allUsedComponents;
        }

        return responseSchemaDef;
    }

    // ================================================
    // Security → Auth
    // ================================================

    private mapSecurityToAuth(
        securityRequirement: any,
        securitySchemes: any
    ): RequestAuth | undefined {
        const schemeName = Object.keys(securityRequirement)[0];
        if (!schemeName) { return undefined; }

        const scheme = securitySchemes[schemeName];
        if (!scheme) { return undefined; }

        switch (scheme.type) {
            case 'http':
                if (scheme.scheme === 'bearer') {
                    return { type: 'bearer', bearerToken: '' };
                }
                if (scheme.scheme === 'basic') {
                    return { type: 'basic', basicAuth: { username: '', password: '' } };
                }
                break;
            case 'apiKey':
                return {
                    type: 'apikey',
                    apikey: {
                        key: scheme.name || 'X-Api-Key',
                        value: '',
                        in: scheme.in || 'header'
                    }
                };
            case 'oauth2': {
                const flows = scheme.flows || {};
                const flow = flows.authorizationCode || flows.clientCredentials ||
                    flows.password || flows.implicit || {};
                let grantType: string = 'client_credentials';
                if (flows.authorizationCode) { grantType = 'authorization_code'; }
                else if (flows.password) { grantType = 'password'; }
                else if (flows.implicit) { grantType = 'implicit'; }

                return {
                    type: 'oauth2',
                    oauth2: {
                        grantType: grantType as any,
                        tokenUrl: flow.tokenUrl || '',
                        authUrl: flow.authorizationUrl || '',
                        clientId: '',
                        clientSecret: '',
                        scope: Object.keys(flow.scopes || {}).join(' ')
                    }
                };
            }
        }

        return undefined;
    }

    // ================================================
    // Environment Creation
    // ================================================

    private async createEnvironmentFromServers(
        servers: any[],
        envName: string
    ): Promise<string> {
        // Create an environment file with the first server URL as baseUrl
        // The environment config service will handle file creation
        if (servers.length > 0) {
            const baseUrl = servers[0].url;
            // Set as a global or environment variable
            this.envConfigService.setEnvironmentVariable('baseUrl', baseUrl);
        }

        return envName;
    }

    // ================================================
    // Component Extraction
    // ================================================

    /**
     * Extract component schemas referenced by a given schema.
     * Walks $ref pointers and collects the referenced definitions.
     */
    private extractUsedComponents(
        schema: any,
        allComponents: Record<string, JSONSchema7>,
        collected?: Record<string, JSONSchema7>
    ): Record<string, JSONSchema7> {
        const result = collected || {};
        if (!schema) { return result; }

        // If this schema is a $ref, resolve and collect
        if (schema.$ref) {
            const name = this.extractRefName(schema.$ref);
            if (name && allComponents[name] && !result[name]) {
                result[name] = allComponents[name];
                // Recursively extract nested refs
                this.extractUsedComponents(allComponents[name], allComponents, result);
            }
        }

        // Walk properties
        if (schema.properties) {
            for (const prop of Object.values(schema.properties)) {
                this.extractUsedComponents(prop, allComponents, result);
            }
        }

        // Walk items
        if (schema.items) {
            this.extractUsedComponents(schema.items, allComponents, result);
        }

        // Walk composition
        for (const keyword of ['allOf', 'oneOf', 'anyOf']) {
            if (schema[keyword]) {
                for (const sub of schema[keyword]) {
                    this.extractUsedComponents(sub, allComponents, result);
                }
            }
        }

        // Walk additionalProperties
        if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
            this.extractUsedComponents(schema.additionalProperties, allComponents, result);
        }

        return result;
    }

    /**
     * Extract the component name from a $ref pointer.
     * "#/components/schemas/User" → "User"
     */
    private extractRefName(ref: string): string | undefined {
        const match = ref.match(/^#\/components\/schemas\/(.+)$/);
        return match?.[1];
    }
}
