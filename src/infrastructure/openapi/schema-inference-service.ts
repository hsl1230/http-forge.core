/**
 * Schema Inference Service
 * 
 * Orchestrates all inference sources (history, scripts, user edits)
 * to produce unified response and body schemas.
 * 
 * Merge priority (highest → lowest):
 * 1. User-edited schema — never overwritten, only augmented
 * 2. History data — real response bodies provide the most accurate schemas
 * 3. Script hints — field paths and types from post-response scripts
 */

import {
    BodySchemaDefinition,
    JSONSchema7,
    KeyValueEntry,
    ResponseDefinition,
    ResponseSchemaDefinition
} from '../../types/types';
import { HistoryAnalyzer } from './history-analyzer';
import { SchemaInferrer } from './schema-inferrer';
import { ScriptAnalysisResult, ScriptAnalyzer } from './script-analyzer';

export class SchemaInferenceService {
    constructor(
        private historyAnalyzer: HistoryAnalyzer,
        private scriptAnalyzer: ScriptAnalyzer,
        private inferrer: SchemaInferrer
    ) {}

    /**
     * Infer a complete response schema for a request by combining
     * history data, script analysis, and any existing schema.
     */
    async infer(
        collectionId: string,
        requestId: string,
        existingSchema?: ResponseSchemaDefinition,
        options?: { environment?: string; postResponseScript?: string }
    ): Promise<ResponseSchemaDefinition> {
        const historySchema = await this.historyAnalyzer.analyze(
            collectionId,
            requestId,
            { environment: options?.environment }
        );

        let scriptResult: ScriptAnalysisResult | undefined;
        if (options?.postResponseScript) {
            scriptResult = this.scriptAnalyzer.analyze(options.postResponseScript);
        }

        return this.mergeResponseSchemas(existingSchema, historySchema, scriptResult);
    }

    /**
     * Infer a body schema from the request's body content.
     */
    async inferBodySchema(
        bodyContent: any,
        bodyType?: string,
        bodyFormat?: string,
        formDataEntries?: KeyValueEntry[],
        existingSchema?: BodySchemaDefinition
    ): Promise<BodySchemaDefinition | undefined> {
        let inferredSchema: JSONSchema7 | undefined;
        let contentType: string | undefined;

        if (bodyType === 'raw' && bodyFormat === 'json' && bodyContent) {
            let parsed = bodyContent;
            if (typeof bodyContent === 'string') {
                try {
                    parsed = JSON.parse(bodyContent);
                } catch {
                    return undefined;
                }
            }
            inferredSchema = this.inferrer.inferFromValue(parsed);
            contentType = 'application/json';
        } else if (bodyType === 'form-data' && formDataEntries) {
            inferredSchema = this.buildFormDataSchema(formDataEntries);
            contentType = 'multipart/form-data';
        } else if (bodyType === 'x-www-form-urlencoded' && formDataEntries) {
            inferredSchema = this.buildFormDataSchema(formDataEntries);
            contentType = 'application/x-www-form-urlencoded';
        } else if (bodyType === 'raw' && bodyFormat === 'xml') {
            inferredSchema = { type: 'string' };
            contentType = 'application/xml';
        } else if (bodyType === 'raw' && (bodyFormat === 'text' || bodyFormat === 'html')) {
            inferredSchema = { type: 'string' };
            contentType = bodyFormat === 'html' ? 'text/html' : 'text/plain';
        } else if (bodyType === 'binary') {
            inferredSchema = { type: 'string', format: 'binary' };
            contentType = 'application/octet-stream';
        } else if (bodyType === 'graphql') {
            inferredSchema = {
                type: 'object',
                properties: {
                    query: { type: 'string' },
                    variables: { type: 'object' }
                }
            };
            contentType = 'application/json';
        }

        if (!inferredSchema) {
            return undefined;
        }

        if (existingSchema) {
            const mergedSchema = this.mergeBodySchemaWithExisting(inferredSchema, existingSchema);
            return mergedSchema;
        }

        return {
            contentType,
            schema: inferredSchema
        };
    }

    private buildFormDataSchema(entries: KeyValueEntry[]): JSONSchema7 {
        const schema: JSONSchema7 = {
            type: 'object',
            properties: {}
        };

        const requiredFields: string[] = [];

        for (const entry of entries) {
            if (!entry.enabled && entry.enabled !== undefined) {
                continue;
            }

            const propSchema: JSONSchema7 = {};

            if (entry.type) {
                propSchema.type = entry.type;
            } else {
                propSchema.type = 'string';
            }

            if (entry.description) {
                propSchema.description = entry.description;
            }
            if (entry.format) {
                propSchema.format = entry.format;
            }
            if (entry.enum) {
                propSchema.enum = entry.enum;
            }

            if ((entry as any).type === 'file') {
                propSchema.type = 'string';
                propSchema.format = 'binary';
            }

            schema.properties[entry.key] = propSchema;

            if (entry.required) {
                requiredFields.push(entry.key);
            }
        }

        if (requiredFields.length > 0) {
            schema.required = requiredFields;
        }

        return schema;
    }

    private mergeResponseSchemas(
        existing: ResponseSchemaDefinition | undefined,
        history: ResponseSchemaDefinition,
        scriptResult: ScriptAnalysisResult | undefined
    ): ResponseSchemaDefinition {
        const merged: ResponseSchemaDefinition = { responses: {} };

        for (const [status, def] of Object.entries(history.responses)) {
            merged.responses[status] = { ...def };
        }

        if (scriptResult) {
            this.applyScriptHints(merged, scriptResult);
        }

        if (existing) {
            for (const [status, existingDef] of Object.entries(existing.responses)) {
                if (merged.responses[status]) {
                    merged.responses[status] = this.mergeResponseDefinitions(
                        merged.responses[status],
                        existingDef
                    );
                } else {
                    merged.responses[status] = { ...existingDef };
                }
            }

            if (existing.components) {
                merged.components = { ...existing.components };
            }
        }

        return merged;
    }

    private applyScriptHints(
        schema: ResponseSchemaDefinition,
        scriptResult: ScriptAnalysisResult
    ): void {
        for (const status of scriptResult.expectedStatuses) {
            const statusKey = String(status);
            if (!schema.responses[statusKey]) {
                schema.responses[statusKey] = {
                    description: `Status ${status}`
                };
            }
        }

        for (const [, responseDef] of Object.entries(schema.responses)) {
            if (responseDef.schema) {
                this.augmentSchemaWithHints(responseDef.schema, scriptResult);
            }
        }
    }

    private augmentSchemaWithHints(schema: JSONSchema7, hints: ScriptAnalysisResult): void {
        if (schema.type !== 'object' || !schema.properties) {
            return;
        }

        for (const fieldPath of hints.fieldPaths) {
            const parts = fieldPath.split('.');
            this.ensureFieldPath(schema, parts, hints);
        }
    }

    private ensureFieldPath(
        schema: JSONSchema7,
        parts: string[],
        hints: ScriptAnalysisResult,
        currentPath: string = ''
    ): void {
        if (parts.length === 0 || schema.type !== 'object') {
            return;
        }

        if (!schema.properties) {
            schema.properties = {};
        }

        const part = parts[0];
        const isArray = part.endsWith('[]');
        const fieldName = isArray ? part.slice(0, -2) : part;
        const fullPath = currentPath ? `${currentPath}.${part}` : part;
        const remaining = parts.slice(1);

        if (!schema.properties[fieldName]) {
            if (isArray) {
                schema.properties[fieldName] = { type: 'array', items: { type: 'object' } };
            } else if (remaining.length > 0) {
                schema.properties[fieldName] = { type: 'object', properties: {} };
            } else {
                const typeHint = hints.typeHints[fullPath];
                schema.properties[fieldName] = { type: typeHint || 'string' };
                return;
            }
        }

        if (remaining.length > 0) {
            const nextSchema = isArray
                ? schema.properties[fieldName].items
                : schema.properties[fieldName];

            if (nextSchema) {
                this.ensureFieldPath(nextSchema, remaining, hints, fullPath);
            }
        }
    }

    private mergeResponseDefinitions(
        base: ResponseDefinition,
        override: ResponseDefinition
    ): ResponseDefinition {
        const merged: ResponseDefinition = { ...base };

        if (override.description) { merged.description = override.description; }
        if (override.contentType) { merged.contentType = override.contentType; }

        if (override.schema && base.schema) {
            merged.schema = this.inferrer.mergeSchemas(base.schema, override.schema);
        } else if (override.schema) {
            merged.schema = override.schema;
        }

        if (override.examples) {
            merged.examples = { ...(base.examples || {}), ...override.examples };
        }

        if (override.content) {
            merged.content = { ...(base.content || {}), ...override.content };
        }

        if (override.headers) {
            merged.headers = { ...(base.headers || {}), ...override.headers };
        }

        return merged;
    }

    private mergeBodySchemaWithExisting(
        inferred: JSONSchema7,
        existing: BodySchemaDefinition
    ): BodySchemaDefinition {
        const merged: BodySchemaDefinition = { ...existing };

        if (existing.schema) {
            merged.schema = this.inferrer.mergeSchemas(inferred, existing.schema);
        } else {
            merged.schema = inferred;
        }

        return merged;
    }
}
