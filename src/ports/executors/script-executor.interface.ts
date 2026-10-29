/**
 * Script Executor Port - Abstract script execution
 * Hides VM and runtime details
 * 
 * Implementations: VmScriptExecutor, NodeScriptExecutor
 */

import { HttpResponse } from '../../types/types';

/**
 * Script execution session - tracks state during execution
 */
export interface IScriptSession {
    variables: Record<string, any>;
    environment: Record<string, any>;
    cookies: Record<string, string>;
    [key: string]: any;
}

/**
 * Result of script execution
 */
export interface IScriptResult {
    success: boolean;
    output: any;
    errors: string[];
    logs: string[];
    variableChanges: Record<string, any>;
}

/**
 * Script Executor - Handles pre-request and post-response scripts
 */
export interface IScriptExecutor {
    /**
     * Execute pre-request script
     * - Modifies request before sending
     * - Can set variables, headers, etc.
     */
    executePreRequest(
        session: IScriptSession,
        script: string
    ): Promise<IScriptResult>;

    /**
     * Execute post-response script
     * - Processes response after receiving
     * - Can validate, test, extract data
     */
    executePostResponse(
        session: IScriptSession,
        script: string,
        response: HttpResponse
    ): Promise<IScriptResult>;
}
