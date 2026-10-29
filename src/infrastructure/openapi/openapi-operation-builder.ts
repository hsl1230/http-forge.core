/**
 * OpenAPI export — request → operation mapping.
 *
 * Maps a single collection request (params, query, headers, body, responses,
 * auth) into an OpenAPI operation object. Pure with respect to the returned
 * operation; mutation of shared export state (tags, securitySchemes) is
 * performed through the explicitly-passed collections.
 */

import { Collection, CollectionRequestItem } from '../../types/collection';
import { JSONSchema7, RequestAuth } from '../../types/types';
import { SchemaInferrer } from './schema-inferrer';
import {
    buildParameters,
    buildFormDataSchemaFromBody,
    cleanSummary,
    getContentType,
    hasDeprecatedPrefix,
    OpenApiExportOptions,
    parseScopes,
    toCamelCase,
    tryParseBodyContent
} from './openapi-utils';

export class OpenApiOperationBuilder {
    constructor(private inferrer: SchemaInferrer) {}

    /**
     * Build a single OpenAPI operation from a collection request.
     * Registers any discovered security schemes / tags into the shared maps.
     */
    async buildOperation(
        request: CollectionRequestItem,
        method: string,
        path: string,
        spec: any,
        securitySchemes: Map<string, any>,
        tags: Set<string>,
        parentTag: string | undefined,
        collection: Collection,
        options: OpenApiExportOptions
    ): Promise<any> {
        const operation: any = {};

        // Operation ID — use explicit operationId if provided, otherwise generate
        operation.operationId = (request as any).operationId || this.generateOperationId(request, method, path, spec);

        // Summary & description — use explicit summary if provided, otherwise derive from name
        operation.summary = (request as any).summary || cleanSummary(request.name);
        if (request.description) {
            operation.description = request.description;
        }

        // Deprecated flag
        if (request.deprecated || hasDeprecatedPrefix(request.name)) {
            operation.deprecated = true;
            if (hasDeprecatedPrefix(request.name)) {
                operation.summary = request.name.replace(/^\[DEPRECATED\]\s*/i, '');
            }
        }

        // Tags — use explicit tags if provided, otherwise inherit from folder
        const explicitTags = (request as any).tags;
        if (explicitTags && explicitTags.length > 0) {
            operation.tags = explicitTags;
            // Also register these as new top-level tags
            for (const tag of explicitTags) { tags.add(tag); }
        } else if (parentTag) {
            operation.tags = [parentTag];
        }

        // Parameters
        const parameters = buildParameters(request);
        if (parameters.length > 0) {
            operation.parameters = parameters;
        }

        // Request body
        const requestBody = await this.buildRequestBody(request, options);
        if (requestBody) {
            operation.requestBody = requestBody;
        }

        // Responses — use explicit responses if provided, otherwise build from schema
        const explicitResponses = (request as any).responses;
        if (explicitResponses && Object.keys(explicitResponses).length > 0) {
            operation.responses = this.mapResponseDefinitions(explicitResponses);
        } else {
            operation.responses = await this.buildResponses(request, collection.id, options);
        }

        // Security — use operation-level security if provided
        const operationSecurity = (request as any).security;
        if (operationSecurity && operationSecurity.length > 0) {
            operation.security = operationSecurity;
        } else {
            const security = this.buildOperationSecurity(request, collection, securitySchemes);
            if (security !== undefined) {
                operation.security = security;
            }
        }

        return operation;
    }

    // ================================================
    // Operation ID Generation
    // ================================================

    private generateOperationId(
        request: CollectionRequestItem,
        method: string,
        path: string,
        spec: any
    ): string {
        // Primary: camelCase request name
        let operationId = toCamelCase(request.name);

        // Check for uniqueness
        const existingIds = this.collectOperationIds(spec);
        if (existingIds.has(operationId)) {
            operationId = `${operationId}${method.charAt(0).toUpperCase()}${method.slice(1)}`;
        }

        // Fallback: method + camelCase path segments
        if (!operationId || existingIds.has(operationId)) {
            const pathParts = path.split('/').filter(p => p && !p.startsWith('{'));
            operationId = method + pathParts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
        }

        return operationId;
    }

    private collectOperationIds(spec: any): Set<string> {
        const ids = new Set<string>();
        if (spec.paths) {
            for (const pathItem of Object.values(spec.paths) as any[]) {
                for (const op of Object.values(pathItem) as any[]) {
                    if (op.operationId) {
                        ids.add(op.operationId);
                    }
                }
            }
        }
        return ids;
    }

    // ================================================
    // Request Body
    // ================================================

    private async buildRequestBody(
        request: CollectionRequestItem,
        options: OpenApiExportOptions
    ): Promise<any | null> {
        if (!request.body || request.body.type === 'none') {
            return null;
        }

        const body = request.body;
        const requestBody: any = { required: true, content: {} };

        // Determine content type and schema
        let contentType: string;
        let schema: JSONSchema7 | undefined;
        let example: any;
        let encoding: any;

        // Priority 1: body.schema.json
        if (request.bodySchema) {
            // If bodySchema has a full content map, use it
            if (request.bodySchema.content) {
                for (const [ct, contentDef] of Object.entries(request.bodySchema.content)) {
                    const mediaObj: any = {};
                    if (contentDef.schema) { mediaObj.schema = contentDef.schema; }
                    if (contentDef.examples) { mediaObj.examples = contentDef.examples; }
                    if (contentDef.encoding) { mediaObj.encoding = contentDef.encoding; }
                    requestBody.content[ct] = mediaObj;
                }

                // Also add example from body.json for the primary content type
                const primaryCt = request.bodySchema.contentType || Object.keys(request.bodySchema.content)[0];
                if (primaryCt && body.content) {
                    const bodyExample = tryParseBodyContent(body);
                    if (bodyExample !== undefined && requestBody.content[primaryCt]) {
                        requestBody.content[primaryCt].example = bodyExample;
                    }
                }

                return requestBody;
            }

            // Shorthand: single content type
            contentType = request.bodySchema.contentType || getContentType(body);
            schema = request.bodySchema.schema;

            // Use body.json as example
            example = tryParseBodyContent(body);

            // Encoding from bodySchema
            if (request.bodySchema.encoding) {
                encoding = request.bodySchema.encoding;
            }
        } else {
            // Priority 2: infer from body.json content
            contentType = getContentType(body);

            switch (body.type) {
                case 'raw': {
                    if (body.format === 'json' && body.content) {
                        const parsed = tryParseBodyContent(body);
                        if (parsed !== undefined) {
                            schema = this.inferrer.inferFromValue(parsed);
                            example = parsed;
                        } else {
                            schema = { type: 'string' };
                        }
                    } else {
                        schema = { type: 'string' };
                        example = typeof body.content === 'string' ? body.content : undefined;
                    }
                    break;
                }
                case 'form-data': {
                    schema = buildFormDataSchemaFromBody(body);
                    break;
                }
                case 'x-www-form-urlencoded': {
                    schema = buildFormDataSchemaFromBody(body);
                    break;
                }
                case 'binary': {
                    schema = { type: 'string', format: 'binary' };
                    break;
                }
                case 'graphql': {
                    schema = {
                        type: 'object',
                        properties: {
                            query: { type: 'string' },
                            variables: { type: 'object' }
                        }
                    };
                    example = tryParseBodyContent(body);
                    break;
                }
                default:
                    return null;
            }
        }

        const mediaObj: any = {};
        if (schema) { mediaObj.schema = schema; }
        if (example !== undefined) { mediaObj.example = example; }
        if (encoding) { mediaObj.encoding = encoding; }
        requestBody.content[contentType] = mediaObj;

        return requestBody;
    }

    // ================================================
    // Responses
    // ================================================

    private async buildResponses(
        request: CollectionRequestItem,
        collectionId: string,
        options: OpenApiExportOptions
    ): Promise<any> {
        const responses: any = {};

        // Priority 1: response.schema.json
        if (request.responseSchema) {
            for (const [status, def] of Object.entries(request.responseSchema.responses)) {
                const responseDef: any = {
                    description: def.description || `Status ${status}`
                };

                // Handle full content map
                if (def.content) {
                    responseDef.content = {};
                    for (const [ct, contentDef] of Object.entries(def.content)) {
                        const mediaObj: any = {};
                        if (contentDef.schema) { mediaObj.schema = contentDef.schema; }
                        if (contentDef.examples) { mediaObj.examples = contentDef.examples; }
                        responseDef.content[ct] = mediaObj;
                    }
                } else if (def.schema) {
                    // Shorthand content type
                    const ct = def.contentType || 'application/json';
                    const mediaObj: any = { schema: def.schema };
                    if (def.examples) { mediaObj.examples = def.examples; }
                    responseDef.content = { [ct]: mediaObj };
                }

                // Response headers
                if (def.headers) {
                    responseDef.headers = {};
                    for (const [headerName, headerDef] of Object.entries(def.headers)) {
                        responseDef.headers[headerName] = {
                            ...(headerDef.description && { description: headerDef.description }),
                            schema: headerDef.schema
                        };
                    }
                }

                responses[status] = responseDef;
            }
        }

        // If no responses defined from schema, provide a stub
        if (Object.keys(responses).length === 0) {
            responses['200'] = { description: 'Successful response' };
        }

        return responses;
    }

    /**
     * Map operation-level response definitions (from metadata) to OpenAPI format.
     * Converts OperationResponse[] indexed by status code into OpenAPI responses object.
     */
    private mapResponseDefinitions(responses: Record<string, any>): Record<string, any> {
        const mapped: Record<string, any> = {};

        for (const [statusCode, resp] of Object.entries(responses)) {
            const responseDef: any = {
                description: resp.description || `Status ${statusCode}`
            };

            // Add schema and examples as content
            if (resp.schema || resp.examples) {
                const contentType = resp.contentType || 'application/json';
                const mediaObj: any = {};

                if (resp.schema) {
                    mediaObj.schema = resp.schema;
                }
                if (resp.examples && Object.keys(resp.examples).length > 0) {
                    mediaObj.examples = resp.examples;
                }

                responseDef.content = { [contentType]: mediaObj };
            }

            // Add response headers
            if (resp.headers && Object.keys(resp.headers).length > 0) {
                responseDef.headers = {};
                for (const [headerName, headerEntry] of Object.entries(resp.headers)) {
                    const he = headerEntry as any;
                    responseDef.headers[headerName] = {
                        ...(he.description && { description: he.description }),
                        ...(he.schema && { schema: he.schema })
                    };
                }
            }

            mapped[statusCode] = responseDef;
        }

        // Ensure at least 200 response exists
        if (Object.keys(mapped).length === 0) {
            mapped['200'] = { description: 'Successful response' };
        }

        return mapped;
    }

    // ================================================
    // Security
    // ================================================

    private buildOperationSecurity(
        request: CollectionRequestItem,
        collection: Collection,
        securitySchemes: Map<string, any>
    ): any[] | undefined {
        if (!request.auth) {
            return undefined; // inherit from collection
        }

        if (request.auth.type === 'inherit') {
            return undefined; // inherit from collection
        }

        if (request.auth.type === 'none') {
            return []; // explicitly no auth
        }

        const result = this.mapAuthToSecurityScheme(request.auth);
        if (!result) {
            return undefined;
        }
        const { schemeName, scheme, requirement } = result;
        securitySchemes.set(schemeName, scheme);
        return [requirement];
    }

    mapAuthToSecurityScheme(auth: RequestAuth): {
        schemeName: string;
        scheme: any;
        requirement: any;
    } | undefined {
        switch (auth.type) {
            case 'bearer':
                return {
                    schemeName: 'BearerAuth',
                    scheme: { type: 'http', scheme: 'bearer' },
                    requirement: { BearerAuth: [] }
                };
            case 'basic':
                return {
                    schemeName: 'BasicAuth',
                    scheme: { type: 'http', scheme: 'basic' },
                    requirement: { BasicAuth: [] }
                };
            case 'apikey': {
                const apikey = auth.apikey || { key: 'X-Api-Key', value: '', in: 'header' };
                const schemeName = `ApiKey_${apikey.key || 'key'}`;
                return {
                    schemeName,
                    scheme: {
                        type: 'apiKey',
                        in: apikey.in || 'header',
                        name: apikey.key || 'X-Api-Key'
                    },
                    requirement: { [schemeName]: [] }
                };
            }
            case 'oauth2': {
                const oauth2 = auth.oauth2;
                if (!oauth2) {
                    return undefined;
                }
                const flows: any = {};

                switch (oauth2.grantType) {
                    case 'client_credentials':
                        flows.clientCredentials = {
                            tokenUrl: oauth2.tokenUrl || '',
                            scopes: oauth2.scope ? parseScopes(oauth2.scope) : {}
                        };
                        break;
                    case 'authorization_code':
                        flows.authorizationCode = {
                            authorizationUrl: oauth2.authUrl || '',
                            tokenUrl: oauth2.tokenUrl || '',
                            scopes: oauth2.scope ? parseScopes(oauth2.scope) : {}
                        };
                        break;
                    case 'password':
                        flows.password = {
                            tokenUrl: oauth2.tokenUrl || '',
                            scopes: oauth2.scope ? parseScopes(oauth2.scope) : {}
                        };
                        break;
                    case 'implicit':
                        flows.implicit = {
                            authorizationUrl: oauth2.authUrl || '',
                            scopes: oauth2.scope ? parseScopes(oauth2.scope) : {}
                        };
                        break;
                    default:
                        flows.clientCredentials = {
                            tokenUrl: oauth2.tokenUrl || '',
                            scopes: {}
                        };
                }

                return {
                    schemeName: 'OAuth2',
                    scheme: { type: 'oauth2', flows },
                    requirement: { OAuth2: [] }
                };
            }
            default:
                return {
                    schemeName: 'BearerAuth',
                    scheme: { type: 'http', scheme: 'bearer' },
                    requirement: { BearerAuth: [] }
                };
        }
    }
}
