/**
 * OpenAPI export — spec finalization and serialization.
 *
 * Post-processes a fully-populated OpenAPI document:
 * - promotes structurally-identical inline schemas into components/schemas
 * - installs collected security schemes and tags
 * - removes empty component sections
 * - serializes to JSON or YAML
 *
 * Stateless and pure with respect to its inputs (mutating only the `spec`
 * object it is given to finalize).
 */

import * as yaml from 'yaml';
import { OpenApiExportOptions } from './openapi-utils';

export class OpenApiSpecWriter {
    /**
     * Finalize the collected spec state into a serialized document string.
     */
    finalize(
        spec: any,
        securitySchemes: Map<string, any>,
        tags: Set<string>,
        options: OpenApiExportOptions
    ): string {
        // Finalize security schemes
        if (securitySchemes.size > 0) {
            for (const [name, scheme] of securitySchemes) {
                spec.components.securitySchemes[name] = scheme;
            }
        } else {
            delete spec.components.securitySchemes;
        }

        // Finalize tags
        spec.tags = [...tags].map(t => ({ name: t }));
        if (spec.tags.length === 0) {
            delete spec.tags;
        }

        // Component deduplication
        this.deduplicateComponents(spec);

        // Clean up empty components
        if (Object.keys(spec.components.schemas).length === 0) {
            delete spec.components.schemas;
        }
        if (Object.keys(spec.components).length === 0) {
            delete spec.components;
        }

        // Serialize
        if (options.format === 'yaml') {
            return yaml.stringify(spec, { indent: 2 });
        }
        return JSON.stringify(spec, null, 2);
    }

    // ================================================
    // Component Deduplication
    // ================================================

    /**
     * When multiple operations share structurally identical schemas,
     * promote them to components/schemas and replace with $ref.
     */
    private deduplicateComponents(spec: any): void {
        const schemaMap = new Map<string, { name: string; schema: any }>();
        const usages = new Map<string, number>();

        // First pass: collect all inline schemas
        if (spec.paths) {
            for (const [pathStr, pathItem] of Object.entries(spec.paths)) {
                for (const [method, operation] of Object.entries(pathItem as any)) {
                    const op = operation as any;

                    // Response schemas
                    if (op.responses) {
                        for (const [status, respDef] of Object.entries(op.responses as any)) {
                            if ((respDef as any).content) {
                                for (const mediaObj of Object.values((respDef as any).content) as any[]) {
                                    if (mediaObj.schema) {
                                        this.trackSchema(mediaObj.schema, `${method}${pathStr}Response${status}`, schemaMap, usages);
                                    }
                                }
                            }
                        }
                    }

                    // Request body schemas
                    if (op.requestBody?.content) {
                        for (const mediaObj of Object.values(op.requestBody.content) as any[]) {
                            if (mediaObj.schema) {
                                this.trackSchema(mediaObj.schema, `${method}${pathStr}Request`, schemaMap, usages);
                            }
                        }
                    }
                }
            }
        }

        // Second pass: promote schemas referenced 2+ times
        for (const [hash, entry] of schemaMap) {
            const count = usages.get(hash) || 0;
            if (count >= 2) {
                const componentName = this.sanitizeComponentName(entry.name);
                spec.components.schemas[componentName] = entry.schema;

                // Replace inline occurrences with $ref
                this.replaceInlineSchema(spec, entry.schema, `#/components/schemas/${componentName}`);
            }
        }
    }

    private trackSchema(
        schema: any,
        contextName: string,
        schemaMap: Map<string, { name: string; schema: any }>,
        usages: Map<string, number>
    ): void {
        // Only deduplicate object schemas with properties
        if (!schema || schema.type !== 'object' || !schema.properties) {
            return;
        }

        const hash = JSON.stringify(schema);
        if (!schemaMap.has(hash)) {
            schemaMap.set(hash, { name: contextName, schema });
        }
        usages.set(hash, (usages.get(hash) || 0) + 1);
    }

    private replaceInlineSchema(spec: any, target: any, ref: string): void {
        const targetHash = JSON.stringify(target);

        if (spec.paths) {
            for (const pathItem of Object.values(spec.paths) as any[]) {
                for (const op of Object.values(pathItem) as any[]) {
                    // Replace in responses
                    if (op.responses) {
                        for (const respDef of Object.values(op.responses) as any[]) {
                            if (respDef.content) {
                                for (const mediaObj of Object.values(respDef.content) as any[]) {
                                    if (mediaObj.schema && JSON.stringify(mediaObj.schema) === targetHash) {
                                        mediaObj.schema = { $ref: ref };
                                    }
                                }
                            }
                        }
                    }
                    // Replace in request body
                    if (op.requestBody?.content) {
                        for (const mediaObj of Object.values(op.requestBody.content) as any[]) {
                            if (mediaObj.schema && JSON.stringify(mediaObj.schema) === targetHash) {
                                mediaObj.schema = { $ref: ref };
                            }
                        }
                    }
                }
            }
        }
    }

    private sanitizeComponentName(name: string): string {
        return name
            .replace(/[^a-zA-Z0-9._-]/g, '')
            .replace(/^[^a-zA-Z]/, 'Schema');
    }
}
