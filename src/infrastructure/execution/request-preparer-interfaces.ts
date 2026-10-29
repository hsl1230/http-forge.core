/**
 * Request Preparer Interface
 *
 * Defines the contract for preparing HTTP requests before execution.
 * Handles variable resolution, header merging, auth injection, body encoding.
 *
 * Used by both Request Tester (manual) and Collection Runner (batch).
 */

import { ResolvedEnvironment } from '../../types/environment-config';
import { ExecutionRequest, PreparedRequest } from '../../types/types';

/**
 * Request Preparer Service Interface
 *
 * Extracted from extension's request-execution-handler.ts prepareRequest method.
 * Shares request preparation logic between Request Tester and Collection Runner.
 */
export interface IRequestPreparer {
    /**
     * Prepare a request for execution.
     *
     * Handles:
     * - Variable resolution in params, query, headers, body, URL
     * - Header merging (environment + request headers)
     * - Authentication (Bearer, Basic, API Key, OAuth2)
     * - Body encoding based on bodyType
     * - Content-Type header auto-setting
     * - URL building with path params, query params
     *
     * @param input - Request input data (ExecutionRequest format)
     * @param environment - Environment name for variable resolution
     * @param resolvedEnv - Resolved environment configuration
     * @param extraVariables - Optional extra variables (for data files, script variables)
     * @returns Prepared request ready for HTTP execution
     */
    prepareRequest(
        input: ExecutionRequest,
        environment: string,
        resolvedEnv: ResolvedEnvironment,
        extraVariables?: Record<string, string>
    ): Promise<PreparedRequest>;
}
