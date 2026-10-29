/**
 * GraphQL Schema Service
 * 
 * Single Responsibility: Fetch, parse, and cache GraphQL schemas via introspection.
 * 
 * Features:
 * - Execute standard introspection query against any GraphQL endpoint
 * - Parse introspection result into typed schema representation
 * - Cache schemas per-endpoint with timestamp
 * - Extract operation names from GraphQL documents
 * - Resolve variable types for operations
 * 
 * Zero Dependencies: Uses only the project's IHttpClient abstraction.
 */

import { IHttpClient } from '../../types/platform';
import { HttpRequest, HttpResponse } from '../../types/types';

// ─── Types ─────────────────────────────────────────────

export interface GraphQLField {
    name: string;
    type: string;
    args: GraphQLArg[];
    description?: string;
    isDeprecated: boolean;
    deprecationReason?: string;
}

export interface GraphQLArg {
    name: string;
    type: string;
    defaultValue?: string;
    description?: string;
}

export interface GraphQLEnumValue {
    name: string;
    description?: string;
    isDeprecated: boolean;
    deprecationReason?: string;
}

export interface GraphQLType {
    name: string;
    kind: 'OBJECT' | 'INPUT_OBJECT' | 'ENUM' | 'SCALAR' | 'INTERFACE' | 'UNION' | 'LIST' | 'NON_NULL';
    fields: GraphQLField[];
    inputFields: GraphQLArg[];
    enumValues: GraphQLEnumValue[];
    interfaces: string[];
    possibleTypes: string[];
    description?: string;
}

export interface GraphQLDirective {
    name: string;
    description?: string;
    locations: string[];
    args: GraphQLArg[];
}

export interface GraphQLSchema {
    queryType: string;
    mutationType?: string;
    subscriptionType?: string;
    types: Map<string, GraphQLType>;
    directives: GraphQLDirective[];
    fetchedAt: number;
    endpointUrl: string;
}

export interface GraphQLOperation {
    name: string;
    type: 'query' | 'mutation' | 'subscription';
    line: number;
}

export interface IGraphQLSchemaService {
    fetchSchema(endpointUrl: string, headers?: Record<string, string>): Promise<GraphQLSchema>;
    getCachedSchema(endpointUrl: string): GraphQLSchema | undefined;
    extractOperations(document: string): GraphQLOperation[];
    clearCache(endpointUrl?: string): void;
    schemaToSerializable(schema: GraphQLSchema): any;
}

// ─── Introspection Query ───────────────────────────────

const INTROSPECTION_QUERY = `
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind name description
      fields(includeDeprecated: true) {
        name description isDeprecated deprecationReason
        args { name description type { ...TypeRef } defaultValue }
        type { ...TypeRef }
      }
      inputFields { name description type { ...TypeRef } defaultValue }
      interfaces { ...TypeRef }
      enumValues(includeDeprecated: true) { name description isDeprecated deprecationReason }
      possibleTypes { ...TypeRef }
    }
    directives {
      name description locations
      args { name description type { ...TypeRef } defaultValue }
    }
  }
}
fragment TypeRef on __Type {
  kind name
  ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } }
}
`.trim();

// ─── Implementation ────────────────────────────────────

export class GraphQLSchemaService implements IGraphQLSchemaService {
    private schemaCache = new Map<string, GraphQLSchema>();

    constructor(private readonly httpClient: IHttpClient) {}

    /**
     * Execute introspection query and return parsed schema
     */
    async fetchSchema(endpointUrl: string, headers?: Record<string, string>): Promise<GraphQLSchema> {
        const request: HttpRequest = {
            method: 'POST',
            url: endpointUrl,
            headers: {
                ...(headers || {}),
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                query: INTROSPECTION_QUERY,
                operationName: 'IntrospectionQuery'
            })
        };

        const response: HttpResponse = await this.httpClient.send(request);

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Introspection query failed with status ${response.status}: ${response.statusText}`);
        }

        const data = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;

        if (data.errors && data.errors.length > 0) {
            const errorMessages = data.errors.map((e: any) => e.message).join('; ');
            throw new Error(`Introspection query returned errors: ${errorMessages}`);
        }

        if (!data.data?.__schema) {
            throw new Error('Invalid introspection response: missing __schema');
        }

        const schema = this.parseSchema(data.data.__schema, endpointUrl);
        this.schemaCache.set(endpointUrl, schema);
        return schema;
    }

    getCachedSchema(endpointUrl: string): GraphQLSchema | undefined {
        return this.schemaCache.get(endpointUrl);
    }

    extractOperations(document: string): GraphQLOperation[] {
        const operations: GraphQLOperation[] = [];
        const lines = document.split('\n');

        const operationRegex = /^\s*(query|mutation|subscription)\s+(\w+)/;

        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(operationRegex);
            if (match) {
                operations.push({
                    type: match[1] as 'query' | 'mutation' | 'subscription',
                    name: match[2],
                    line: i + 1
                });
            }
        }

        if (operations.length === 0) {
            const trimmed = document.trim();
            if (trimmed.startsWith('{')) {
                operations.push({ type: 'query', name: '(anonymous)', line: 1 });
            }
        }

        return operations;
    }

    clearCache(endpointUrl?: string): void {
        if (endpointUrl) {
            this.schemaCache.delete(endpointUrl);
        } else {
            this.schemaCache.clear();
        }
    }

    schemaToSerializable(schema: GraphQLSchema): any {
        const types: Record<string, any> = {};
        for (const [name, type] of schema.types) {
            types[name] = type;
        }
        return {
            queryType: schema.queryType,
            mutationType: schema.mutationType,
            subscriptionType: schema.subscriptionType,
            types,
            directives: schema.directives,
            fetchedAt: schema.fetchedAt,
            endpointUrl: schema.endpointUrl
        };
    }

    // ─── Private ───────────────────────────────────────

    private parseSchema(raw: any, endpointUrl: string): GraphQLSchema {
        const types = new Map<string, GraphQLType>();

        for (const rawType of (raw.types || [])) {
            if (rawType.name.startsWith('__')) continue;

            const type: GraphQLType = {
                name: rawType.name,
                kind: rawType.kind,
                description: rawType.description || undefined,
                fields: (rawType.fields || []).map((f: any) => this.parseField(f)),
                inputFields: (rawType.inputFields || []).map((f: any) => this.parseArg(f)),
                enumValues: (rawType.enumValues || []).map((v: any) => ({
                    name: v.name,
                    description: v.description || undefined,
                    isDeprecated: v.isDeprecated || false,
                    deprecationReason: v.deprecationReason || undefined
                })),
                interfaces: (rawType.interfaces || []).map((i: any) => this.renderTypeRef(i)),
                possibleTypes: (rawType.possibleTypes || []).map((t: any) => this.renderTypeRef(t))
            };

            types.set(type.name, type);
        }

        const directives: GraphQLDirective[] = (raw.directives || []).map((d: any) => ({
            name: d.name,
            description: d.description || undefined,
            locations: d.locations || [],
            args: (d.args || []).map((a: any) => this.parseArg(a))
        }));

        return {
            queryType: raw.queryType?.name || 'Query',
            mutationType: raw.mutationType?.name || undefined,
            subscriptionType: raw.subscriptionType?.name || undefined,
            types,
            directives,
            fetchedAt: Date.now(),
            endpointUrl
        };
    }

    private parseField(raw: any): GraphQLField {
        return {
            name: raw.name,
            type: this.renderTypeRef(raw.type),
            args: (raw.args || []).map((a: any) => this.parseArg(a)),
            description: raw.description || undefined,
            isDeprecated: raw.isDeprecated || false,
            deprecationReason: raw.deprecationReason || undefined
        };
    }

    private parseArg(raw: any): GraphQLArg {
        return {
            name: raw.name,
            type: this.renderTypeRef(raw.type),
            defaultValue: raw.defaultValue ?? undefined,
            description: raw.description || undefined
        };
    }

    private renderTypeRef(typeRef: any): string {
        if (!typeRef) return 'Unknown';
        if (typeRef.kind === 'NON_NULL') {
            return `${this.renderTypeRef(typeRef.ofType)}!`;
        }
        if (typeRef.kind === 'LIST') {
            return `[${this.renderTypeRef(typeRef.ofType)}]`;
        }
        return typeRef.name || 'Unknown';
    }
}
