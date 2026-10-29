/**
 * Request Preparer
 *
 * Prepares HTTP requests for execution by resolving variables,
 * merging headers, applying authentication, and encoding body.
 *
 * Extracted from extension's request-preparer.ts.
 * Platform-independent — uses IApplicationInfo instead of vscode.extensions.
 *
 * Used by both Request Tester (manual) and Collection Runner (batch).
 */

import { IEnvironmentConfigService, ResolvedEnvironment } from '../../types/environment-config';
import { IApplicationInfo } from '../../types/platform';
import {
    ExecutionRequest,
    PreparedRequest,
    ResolvedBody,
} from '../../types/types';
import { mergeHeadersCaseInsensitive } from '../../utils/helpers';
import { IOAuth2TokenManager } from '../auth/interfaces';
import { IHttpRequestService } from '../http/interfaces';
import { IRequestPreprocessor } from '../http/request-preprocessor';
import { SecretResolverRegistry } from '../secrets/secret-resolver-registry';
import {
    attachSecretValues,
    protectSecretValue,
    unprotectSecretValue,
    unprotectSecretValuesDeep,
} from '../security/secret-values';
import { IRequestPreparer } from './request-preparer-interfaces';

/**
 * RequestPreparer implementation
 *
 * Logic extracted from extension's request-execution-handler.ts prepareRequest method.
 * Shared by Request Tester (manual requests) and Collection Runner (batch requests).
 */
export class RequestPreparer implements IRequestPreparer {
    constructor(
        private readonly envConfigService: IEnvironmentConfigService,
        private readonly httpService: IHttpRequestService,
        private readonly preprocessor: IRequestPreprocessor,
        private readonly tokenManager?: IOAuth2TokenManager,
        private readonly appInfo?: IApplicationInfo,
        private readonly secretRegistry?: SecretResolverRegistry
    ) {}

    public async prepareRequest(
        input: ExecutionRequest,
        environment: string,
        resolvedEnv: ResolvedEnvironment,
        extraVariables?: Record<string, string>
    ): Promise<PreparedRequest> {
        // Pre-resolve {{secret:alias/path}} tokens before sync variable interpolation.
        // Scan the request plus the resolved environment and caller-supplied variables:
        // a secret token may be nested in an environment variable or default header,
        // and normal interpolation recursively resolves those after the value is injected.
        let resolvedSecretValues: string[] = [];
        if (this.secretRegistry?.hasProviders) {
            const secretTokens = await this.secretRegistry.resolveSecretTokens([
                input,
                resolvedEnv,
                extraVariables,
            ]);
            if (Object.keys(secretTokens).length > 0) {
                resolvedSecretValues = Object.values(secretTokens);
                // Keep resolved values opaque so a secret containing {{...}} is not
                // recursively expanded by the variable resolver.
                const protectedSecretTokens: Record<string, string> = {};
                for (const [token, value] of Object.entries(secretTokens)) {
                    protectedSecretTokens[token] = protectSecretValue(value);
                }
                extraVariables = { ...protectedSecretTokens, ...(extraVariables ?? {}) };
            }
        }

        const hasExtra = extraVariables && Object.keys(extraVariables).length > 0;
        const hasResolvedSecretValues = resolvedSecretValues.length > 0;

        // Resolve params and query (may contain environment variables)
        const resolvedParams = hasExtra
            ? this.envConfigService.resolveVariablesInObjectWithExtra(input.params || {}, extraVariables!, environment)
            : this.envConfigService.resolveVariablesInObject(input.params || {}, environment);
        const resolvedQuery = hasExtra
            ? this.envConfigService.resolveVariablesInObjectWithExtra(input.query || {}, extraVariables!, environment)
            : this.envConfigService.resolveVariablesInObject(input.query || {}, environment);

        // Merge headers (environment + request, case-insensitive)
        const mergedHeaders = mergeHeadersCaseInsensitive(
            resolvedEnv?.headers || {},
            input.headers || {}
        );
        let resolvedHeaders = hasExtra
            ? this.envConfigService.resolveVariablesInObjectWithExtra(mergedHeaders, extraVariables!, environment)
            : this.envConfigService.resolveVariablesInObject(mergedHeaders, environment);
        resolvedHeaders = this.preprocessor.sanitizeHeaders(resolvedHeaders);

        // Set default User-Agent if not present
        const hasUserAgent = Object.keys(resolvedHeaders).some(
            key => key.toLowerCase() === 'user-agent'
        );
        if (!hasUserAgent) {
            const version = this.appInfo?.version || '0.0.0';
            const name = this.appInfo?.name || 'HttpForge';
            resolvedHeaders['User-Agent'] = `${name}/${version}`;
        }

        // Apply authentication
        if (input.auth?.type === 'bearer' && input.auth.bearerToken) {
            const resolvedToken = hasExtra
                ? this.envConfigService.resolveVariablesWithExtra(input.auth.bearerToken, extraVariables!, environment)
                : this.envConfigService.resolveVariables(input.auth.bearerToken, environment);
            const tokenValue = hasResolvedSecretValues
                ? unprotectSecretValue(resolvedToken)
                : resolvedToken;
            resolvedHeaders['Authorization'] = `Bearer ${tokenValue}`;
        }

        if (input.auth?.type === 'basic' && input.auth.basicAuth) {
            const username = hasExtra
                ? this.envConfigService.resolveVariablesWithExtra(input.auth.basicAuth.username || '', extraVariables!, environment)
                : this.envConfigService.resolveVariables(input.auth.basicAuth.username || '', environment);
            const password = hasExtra
                ? this.envConfigService.resolveVariablesWithExtra(input.auth.basicAuth.password || '', extraVariables!, environment)
                : this.envConfigService.resolveVariables(input.auth.basicAuth.password || '', environment);
            const usernameValue = hasResolvedSecretValues ? unprotectSecretValue(username) : username;
            const passwordValue = hasResolvedSecretValues ? unprotectSecretValue(password) : password;
            const credentials = Buffer.from(`${usernameValue}:${passwordValue}`).toString('base64');
            resolvedHeaders['Authorization'] = `Basic ${credentials}`;
        }

        if (input.auth?.type === 'apikey' && input.auth.apikey) {
            this.applyApiKey(input.auth.apikey, resolvedHeaders, resolvedQuery, environment, extraVariables);
        }

        if (input.auth?.type === 'oauth2' && input.auth.oauth2) {
            await this.applyOAuth2(input.auth.oauth2, resolvedHeaders, environment, extraVariables);
        }

        // Resolve body variables
        let resolvedBody: any = null;
        if (input.body && input.body.type !== 'none') {
            const resolvedContentInput = extraVariables && Object.keys(extraVariables).length > 0
                ? this.envConfigService.resolveVariablesInObjectWithExtra(input.body.content, extraVariables, environment)
                : this.envConfigService.resolveVariablesInObject(input.body.content, environment);
            let resolvedContent = hasResolvedSecretValues
                ? unprotectSecretValuesDeep(resolvedContentInput)
                : resolvedContentInput;

            // Parse JSON/GraphQL string bodies after variable resolution
            if ((input.body.format === 'json' || input.body.type === 'graphql') && typeof resolvedContent === 'string') {
                try {
                    resolvedContent = JSON.parse(resolvedContent);
                } catch {
                    // For GraphQL, it's OK if it's a query string that doesn't parse as JSON
                    if (input.body.format === 'json') {
                        console.warn('[RequestPreparer] Failed to parse JSON body after variable resolution, keeping as string');
                    }
                }
            }

            const resolvedBodyObj = {
                type: input.body.type,
                format: input.body.format,
                content: resolvedContent
            };

            if (input.body.type === 'form-data') {
                resolvedBody = this.buildMultipartFormData(resolvedBodyObj.content);
            } else {
                resolvedBody = this.preprocessor.encodeBody(resolvedBodyObj);
            }
        }

        // Auto-set Content-Type based on body
        if (input.body?.type !== 'form-data') {
            this.preprocessor.setContentTypeHeader(
                resolvedHeaders,
                input.body,
                input.bodyContentType
            );
        }

        const method = input.method || 'GET';
        const endpointUri = input.url || '';

        // Resolve URL variables
        const resolvedEndpointUri = extraVariables && Object.keys(extraVariables).length > 0
            ? this.envConfigService.resolveVariablesWithExtra(endpointUri, extraVariables, environment)
            : this.envConfigService.resolveVariables(endpointUri, environment);

        const resolvedUrl = this.httpService.buildUrl(
            resolvedEndpointUri,
            resolvedParams,
            resolvedQuery
        );

        const resolvedQuerySnapshot = this.extractQueryFromUrl(resolvedUrl);

        // Build resolved body with type info
        const bodyObj: ResolvedBody = {
            type: input.body?.type || 'none',
            format: input.body?.format,
            content: resolvedBody
        };

        const prepared: PreparedRequest = {
            url: resolvedUrl,
            method,
            headers: resolvedHeaders,
            body: bodyObj,
            params: resolvedParams,
            query: resolvedQuerySnapshot
        };

        return attachSecretValues(
            hasResolvedSecretValues ? unprotectSecretValuesDeep(prepared) : prepared,
            resolvedSecretValues
        );
    }

    private extractQueryFromUrl(url: string): Record<string, string> {
        const queryIndex = url.indexOf('?');
        if (queryIndex === -1) {
            return {};
        }

        const hashIndex = url.indexOf('#', queryIndex);
        const queryString = hashIndex === -1
            ? url.slice(queryIndex + 1)
            : url.slice(queryIndex + 1, hashIndex);

        if (!queryString) {
            return {};
        }

        const snapshot: Record<string, string> = {};
        const params = new URLSearchParams(queryString);
        params.forEach((value, key) => {
            snapshot[key] = value;
        });

        return snapshot;
    }

    private async applyOAuth2(
        oauth2: any,
        headers: Record<string, string>,
        environment: string,
        extraVariables?: Record<string, string>
    ): Promise<void> {
        const hasExtra = extraVariables && Object.keys(extraVariables).length > 0;
        const hasProtectedSecretValues = extraVariables
            ? Object.keys(extraVariables).some(key => key.startsWith('secret:'))
            : false;
        // Resolve the whole config (tokenUrl, clientId, clientSecret, scope, ...)
        // so secret tokens work in every OAuth2 field, not just accessToken.
        const resolvedOauth2Input = hasExtra
            ? this.envConfigService.resolveVariablesInObjectWithExtra(oauth2, extraVariables!, environment)
            : oauth2;
        const resolvedOauth2 = hasProtectedSecretValues
            ? unprotectSecretValuesDeep(resolvedOauth2Input)
            : resolvedOauth2Input;

        // If accessToken is already provided, use it directly
        if (resolvedOauth2.accessToken) {
            const token = hasExtra
                ? resolvedOauth2.accessToken
                : this.envConfigService.resolveVariables(resolvedOauth2.accessToken, environment);
            const prefix = resolvedOauth2.tokenPrefix || 'Bearer';
            headers['Authorization'] = `${prefix} ${token}`;
            return;
        }

        if (!this.tokenManager) {
            throw new Error('OAuth2 authentication requires IOAuth2TokenManager. Ensure the service is properly registered.');
        }

        const tokenInfo = await this.tokenManager.getToken(resolvedOauth2, environment);
        headers['Authorization'] = `${tokenInfo.tokenType} ${tokenInfo.accessToken}`;
    }

    private applyApiKey(
        apikey: { key: string; value: string; in?: 'header' | 'query' },
        headers: Record<string, string>,
        query: Record<string, string>,
        environment: string,
        extraVariables?: Record<string, string>
    ): void {
        if (!apikey || !apikey.key) return;

        const hasExtra = extraVariables && Object.keys(extraVariables).length > 0;
        const keyName = hasExtra
            ? this.envConfigService.resolveVariablesWithExtra(apikey.key || '', extraVariables!, environment)
            : this.envConfigService.resolveVariables(apikey.key || '', environment);
        const keyValue = hasExtra
            ? this.envConfigService.resolveVariablesWithExtra(apikey.value || '', extraVariables!, environment)
            : this.envConfigService.resolveVariables(apikey.value || '', environment);
        const destination = (apikey.in || 'header').toLowerCase();

        if (destination === 'query') {
            query[keyName] = keyValue;
        } else {
            headers[keyName] = keyValue;
        }
    }

    private buildMultipartFormData(content: any): FormData | undefined {
        if (!Array.isArray(content)) {
            return undefined;
        }

        const formData = new FormData();
        for (const entry of content as Array<{ key?: string; value?: any; enabled?: boolean }>) {
            if (!entry?.key || entry.enabled === false) {
                continue;
            }

            formData.append(entry.key, entry.value == null ? '' : String(entry.value));
        }

        return formData;
    }
}
