/**
 * Collection Request Executor Interface
 *
 * Defines the contract for executing a single collection request with full Postman parity:
 * - Script execution order: Collection → Folder(s) → Request (pre-request)
 * - Script execution order: Request → Folder(s) → Collection (post-response)
 * - Supports nested folder scripts (multiple levels)
 * - JavaScript variables declared in pre-request are accessible in post-response (shared VM session)
 */

import { ExecutionRequest, ExecutionResult } from '../../types/types';

/**
 * Identifies the origin of a console output batch.
 */
export interface ConsoleOutputSource {
    /** Name of the request that produced the output. */
    requestName: string;
    /** Script phase that produced the output. */
    phase: 'pre-request' | 'post-response' | 'error';
}

/**
 * Console output streaming callback.
 * @param output - The log lines produced by the script.
 * @param source - Where the output came from (request name + phase).
 */
export type ConsoleOutputCallback = (output: string[], source: ConsoleOutputSource) => void;

/**
 * Collection Request Executor Interface
 *
 * Executes a single request within a collection context, with full
 * pre-request/post-response script chain support.
 */
export interface ICollectionRequestExecutor {
    /**
     * Execute a request with full Postman parity.
     *
     * Flow:
     *   Collection pre-request → Folder(s) pre-request → Request pre-request
     *   → HTTP call →
     *   Request post-response → Folder(s) post-response → Collection post-response
     *
     * @param request - The request to execute
     * @param variables - Current variable context (may include data file variables)
     * @param signal - Optional AbortSignal for cancellation
     * @returns ExecutionResult with response, assertions, timing, etc.
     */
    execute(
        request: ExecutionRequest,
        variables: Record<string, string>,
        signal?: AbortSignal
    ): Promise<ExecutionResult>;
}
