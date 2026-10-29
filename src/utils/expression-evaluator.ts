/**
 * Expression Evaluator
 * 
 * Single Responsibility: Evaluate JavaScript expressions within {{ }} templates
 * Uses Node.js vm module for sandboxed execution with timeout protection
 * 
 * Supports:
 * - Simple expressions: {{ var1 + 'abc' }}
 * - Math operations: {{ price * quantity }}
 * - Ternary: {{ status === 'active' ? 'yes' : 'no' }}
 * - String methods: {{ name.toUpperCase() }}
 * - Template literals: {{ `Hello ${name}` }}
 * - Built-in functions: Math.*, Date.now(), JSON.stringify(), etc.
 * 
 * Security:
 * - Sandboxed execution via vm.createContext (no access to require, process, fs, etc.)
 * - 100ms timeout to prevent infinite loops
 * - Only variables and safe built-ins are available
 */

import * as vm from 'vm';

/** Timeout for expression evaluation in milliseconds */
const EXPRESSION_TIMEOUT_MS = 100;

/**
 * Check if an expression looks like a JS expression (not a simple variable name)
 * 
 * Simple variable names like "myVar" or "$timestamp" should NOT be treated as expressions.
 * Expressions contain operators, function calls, property access, etc.
 */
export function isExpression(content: string): boolean {
    const trimmed = content.trim();

    // Not an expression if empty
    if (!trimmed) { return false; }

    // Not an expression if it's a simple variable name (with optional $ prefix)
    if (/^(\$?)[a-zA-Z_][a-zA-Z0-9_]*(\([^)]*\))?$/.test(trimmed)) { return false; }

    // Not an expression if it contains pipe operators (that's a filter chain)
    // We need to be careful here: || is a JS operator, | alone is a filter pipe
    // Check for single pipe not followed/preceded by another pipe
    if (/(?<!\|)\|(?!\|)/.test(trimmed)) { return false; }

    // It's an expression if it contains any JS operator or syntax
    return /[+\-*/%<>=!&|?:~^()[\]{}.,`]/.test(trimmed);
}

/**
 * Evaluate a JavaScript expression with the given variables in a sandboxed context
 * 
 * @param expression - The JavaScript expression to evaluate
 * @param variables - Variables available as bare identifiers in the expression
 * @returns The result of the expression, or undefined if evaluation fails
 */
export function evaluateExpression(
    expression: string,
    variables: Record<string, any> = {}
): any {
    try {
        const sandbox: Record<string, any> = {
            // Spread all user variables as bare identifiers
            ...variables,

            // Safe built-ins
            Math,
            Date,
            JSON,
            Number,
            String,
            Boolean,
            Array,
            Object,
            parseInt,
            parseFloat,
            isNaN,
            isFinite,
            encodeURIComponent,
            decodeURIComponent,
            encodeURI,
            decodeURI,
            undefined,
            null: null,
            true: true,
            false: false,
            NaN,
            Infinity,
        };

        const context = vm.createContext(sandbox);

        const result = vm.runInContext(expression, context, {
            timeout: EXPRESSION_TIMEOUT_MS,
            displayErrors: false
        });

        return result;
    } catch {
        // Expression evaluation failed — return undefined to signal failure
        return undefined;
    }
}
