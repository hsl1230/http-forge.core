/**
 * History Analyzer
 * 
 * Reads FullResponse files from history and shared-history directories
 * to build response schemas by inferring from actual response data.
 */

import { FullResponse, IRequestHistoryService } from '../history/request-history-service-interfaces';
import { ResponseDefinition, ResponseSchemaDefinition } from '../../types/types';
import { SchemaInferrer } from './schema-inferrer';

export class HistoryAnalyzer {
    constructor(
        private historyService: IRequestHistoryService,
        private inferrer: SchemaInferrer
    ) {}

    /**
     * Analyze all available history for a request.
     * Groups responses by status code, infers schema per group.
     */
    async analyze(
        collectionId: string,
        requestId: string,
        options?: { environment?: string; maxSamples?: number }
    ): Promise<ResponseSchemaDefinition> {
        const environment = options?.environment || 'default';
        const maxSamples = options?.maxSamples || 50;

        const history = this.historyService.loadHistory(environment, collectionId, requestId);
        const sharedHistory = this.historyService.loadSharedHistory(environment, collectionId, requestId);

        const entries = [
            ...(history?.requests || []),
            ...(sharedHistory?.requests || [])
        ];

        if (entries.length === 0) {
            return { responses: {} };
        }

        const limitedEntries = entries.slice(0, maxSamples);
        const responsesByStatus = new Map<number, FullResponse[]>();

        for (const entry of limitedEntries) {
            let fullResponse = this.historyService.loadFullResponse(
                environment, collectionId, requestId, entry.id
            );
            if (!fullResponse) {
                fullResponse = this.historyService.loadSharedFullResponse(
                    environment, collectionId, requestId, entry.id
                );
            }

            if (fullResponse) {
                const status = fullResponse.status;
                if (!responsesByStatus.has(status)) {
                    responsesByStatus.set(status, []);
                }
                responsesByStatus.get(status)!.push(fullResponse);
            }
        }

        const responses: Record<string, ResponseDefinition> = {};

        for (const [status, fullResponses] of responsesByStatus) {
            const responseDef = this.buildResponseDefinition(fullResponses);
            responses[String(status)] = responseDef;
        }

        return { responses };
    }

    private buildResponseDefinition(fullResponses: FullResponse[]): ResponseDefinition {
        const responseDef: ResponseDefinition = {};

        if (fullResponses.length === 0) {
            return responseDef;
        }

        const first = fullResponses[0];
        responseDef.description = first.statusText || `Status ${first.status}`;

        const contentType = this.extractContentType(first.headers);
        if (contentType) {
            responseDef.contentType = contentType;
        }

        if (contentType && this.isJsonContentType(contentType)) {
            let mergedSchema = this.inferBodySchema(first);

            for (let i = 1; i < fullResponses.length; i++) {
                const sampleSchema = this.inferBodySchema(fullResponses[i]);
                if (sampleSchema && mergedSchema) {
                    mergedSchema = this.inferrer.mergeSchemas(mergedSchema, sampleSchema);
                } else if (sampleSchema) {
                    mergedSchema = sampleSchema;
                }
            }

            if (mergedSchema) {
                responseDef.schema = mergedSchema;
            }

            if (first.body !== undefined && first.body !== null) {
                const exampleValue = typeof first.body === 'string'
                    ? this.tryParseJson(first.body)
                    : first.body;

                if (exampleValue !== undefined) {
                    responseDef.examples = {
                        default: {
                            summary: 'Captured from history',
                            value: exampleValue
                        }
                    };
                }
            }
        }

        const consistentHeaders = this.findConsistentHeaders(fullResponses);
        if (Object.keys(consistentHeaders).length > 0) {
            responseDef.headers = consistentHeaders;
        }

        return responseDef;
    }

    private inferBodySchema(response: FullResponse): any | undefined {
        if (response.body === undefined || response.body === null) {
            return undefined;
        }

        let body = response.body;
        if (typeof body === 'string') {
            body = this.tryParseJson(body);
            if (body === undefined) {
                return undefined;
            }
        }

        return this.inferrer.inferFromValue(body);
    }

    private extractContentType(headers: Record<string, string | string[]>): string | undefined {
        for (const [key, value] of Object.entries(headers)) {
            if (key.toLowerCase() === 'content-type') {
                const v = Array.isArray(value) ? value[0] : value;
                return v.split(';')[0].trim();
            }
        }
        return undefined;
    }

    private isJsonContentType(contentType: string): boolean {
        return contentType.includes('json') ||
            contentType.includes('+json') ||
            contentType === 'application/json';
    }

    private findConsistentHeaders(
        responses: FullResponse[]
    ): Record<string, { description?: string; schema: any }> {
        if (responses.length === 0) {
            return {};
        }

        const excludedHeaders = new Set([
            'content-type', 'content-length', 'content-encoding',
            'transfer-encoding', 'connection', 'date', 'server',
            'set-cookie', 'vary', 'cache-control', 'expires',
            'pragma', 'etag', 'last-modified', 'age'
        ]);

        const headerCounts = new Map<string, number>();
        const headerSamples = new Map<string, string>();

        for (const response of responses) {
            for (const [key, value] of Object.entries(response.headers)) {
                const lower = key.toLowerCase();
                if (!excludedHeaders.has(lower)) {
                    headerCounts.set(lower, (headerCounts.get(lower) || 0) + 1);
                    if (!headerSamples.has(lower)) {
                        headerSamples.set(lower, Array.isArray(value) ? value.join(', ') : value);
                    }
                }
            }
        }

        const threshold = Math.ceil(responses.length / 2);
        const result: Record<string, { description?: string; schema: any }> = {};

        for (const [headerName, count] of headerCounts) {
            if (count >= threshold) {
                const sample = headerSamples.get(headerName);
                result[headerName] = {
                    schema: this.inferHeaderSchema(sample)
                };
            }
        }

        return result;
    }

    private inferHeaderSchema(value: string | undefined): any {
        if (!value) {
            return { type: 'string' };
        }
        if (/^\d+$/.test(value)) {
            return { type: 'integer' };
        }
        return { type: 'string' };
    }

    private tryParseJson(value: string): any | undefined {
        try {
            return JSON.parse(value);
        } catch {
            return undefined;
        }
    }
}
