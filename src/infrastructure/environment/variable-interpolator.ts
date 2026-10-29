/**
 * Variable Interpolator / Resolver
 * 
 * Single Responsibility: Resolve template variables in strings and objects
 * 
 * Features:
 * - Regular variable substitution ({{myVar}} → value)
 * - Dynamic variables ({{$timestamp}}, {{$randomInt(1, 100)}}, etc.)
 * - Pipe-based filters (Thunder Client-compatible): {{variable | upper | replace("a", "b")}}
 * - JavaScript expression evaluation: {{price * quantity}}
 * - Context-aware escaping (avoids breaking quoted strings)
 * - Extra variables with highest precedence
 * - Recursive object traversal
 * - Generic type preservation for object interpolation
 * 
 * Resolution order (5-step pipeline):
 * 1. $dynamic variables: {{$guid}}, {{$randomInt(1, 100)}}
 * 2. Filter chains: {{myVar | upper | substring(0, 5)}}
 * 3. Simple variable lookup: {{myVar}}
 * 4. JavaScript expressions: {{price * quantity + 10}}
 * 5. Return original {{...}} if nothing matched
 */

import type { IVariableInterpolator } from '../../types/environment-config';
import { augmentWithDynamicVars, resolveDynamicVariable } from '../../utils/dynamic-variables';
import { evaluateExpression, isExpression } from '../../utils/expression-evaluator';
import { applyFilterChain, parseFilterChain } from '../../utils/filter-engine';

/**
 * Parse arguments from a dynamic variable call, e.g. "1, 100" → [1, 100]
 * Supports environment variable resolution for unquoted args:
 *   - Quoted: "hello" or 'hello' → always literal string (quotes stripped)
 *   - Unquoted: myVar → variable lookup first, fallback to literal string
 *   - Number: 100 → number
 */
function parseDynamicArgs(argsStr: string | undefined, variables?: Record<string, any>): any[] | undefined {
    if (!argsStr) { return undefined; }
    return argsStr.split(',').map(arg => {
        const trimmed = arg.trim();

        // Quoted → always literal (strip quotes, no variable lookup)
        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
            return trimmed.slice(1, -1);
        }

        // Number → return as number
        const num = Number(trimmed);
        if (!isNaN(num) && trimmed !== '') { return num; }

        // Unquoted → variable lookup first, fallback to literal
        if (variables && trimmed in variables) {
            const val = variables[trimmed];
            const numVal = Number(val);
            return !isNaN(numVal) && val !== '' ? numVal : val;
        }

        return trimmed;
    });
}

export { parseDynamicArgs };

/**
 * Configuration for variable resolution
 */
export interface VariableResolverConfig {
    globals: Record<string, string>;
    collectionVariables: Record<string, string>;
    environmentVariables: Record<string, string>;
    variables: Record<string, string>;
}

/**
 * Variable Resolver - Resolves {{varName}} patterns in strings and objects
 * Uses a 5-step pipeline: $dynamic → filter chains → simple lookup → JS expressions → passthrough
 * Variable precedence: globals > collection > environment > request > extra
 */
export class VariableResolver {
    private readonly allVariables: Record<string, string>;

    /**
     * Maximum nesting depth for recursive {{var}} resolution.
     * Postman-compatible cap that guards against reference cycles
     * (e.g. a -> {{b}}, b -> {{a}}).
     */
    private static readonly MAX_RESOLUTION_DEPTH = 20;

    constructor(config: VariableResolverConfig) {
        // Build combined variables object with proper precedence
        this.allVariables = {
            ...config.globals,
            ...config.collectionVariables,
            ...config.environmentVariables,
            ...config.variables
        };
    }

    /**
     * Resolve variables in a string ({{varName}} syntax)
     * Uses the full 5-step pipeline with optional escaping for quoted strings.
     * Nested references — a variable whose value itself contains {{...}} — are
     * resolved recursively (Postman-style) by repeating the substitution until
     * the string stabilizes or the depth cap is reached.
     */
    resolveString(str: string, escape: boolean = false): string {
        if (typeof str !== 'string') return str;
        return this.resolveUntilStable(str, this.allVariables, escape);
    }

    /**
     * Resolve variables in a string with additional extra variables
     * Extra variables take highest precedence
     */
    resolveStringWithExtra(str: string, extraVariables: Record<string, string>, escape: boolean = false): string {
        if (typeof str !== 'string') return str;
        const allVars = { ...this.allVariables, ...extraVariables };
        return this.resolveUntilStable(str, allVars, escape);
    }

    /**
     * Repeatedly apply a single substitution pass until the result stops changing
     * (fixed point) or the nesting depth cap is hit. This resolves variable values
     * that themselves contain {{...}} references. Undefined tokens are left as-is,
     * so a pass that resolves nothing produces no change and terminates the loop;
     * the depth cap guards against reference cycles (a -> {{b}}, b -> {{a}}).
     */
    private resolveUntilStable(str: string, allVars: Record<string, string>, escape: boolean): string {
        let current = str;
        for (let depth = 0; depth < VariableResolver.MAX_RESOLUTION_DEPTH; depth++) {
            const next = this.resolveSinglePass(current, allVars, escape);
            if (next === current) { break; }
            current = next;
        }
        return current;
    }

    /**
     * Single substitution pass over a string using the 5-step pipeline.
     * With escaping enabled, resolved values are escaped for their surrounding
     * quote context.
     */
    private resolveSinglePass(str: string, allVars: Record<string, string>, escape: boolean): string {
        if (!escape) {
            return str.replace(/\{\{((?:[^}]|\}(?!\}))+)\}\}/g, (match, content) => {
                return this.resolveTemplateContent(content.trim(), allVars, match);
            });
        }

        // With escaping: track position for quote context detection
        let result = '';
        let lastIndex = 0;
        const regex = /\{\{((?:[^}]|\}(?!\}))+)\}\}/g;
        let match;

        while ((match = regex.exec(str)) !== null) {
            const content = match[1].trim();
            const resolved = this.resolveTemplateContent(content, allVars, match[0]);

            if (resolved !== match[0]) {
                result += str.slice(lastIndex, match.index);
                const quoteContext = this.getStringContext(str, match.index);
                result += quoteContext
                    ? this.escapeForString(String(resolved), quoteContext)
                    : String(resolved);
            } else {
                result += str.slice(lastIndex, match.index + match[0].length);
            }

            lastIndex = match.index + match[0].length;
        }

        result += str.slice(lastIndex);
        return result;
    }

    /**
     * Resolve variables in an object recursively
     */
    resolveObject(obj: any, escape: boolean = false): any {
        if (typeof obj === 'string') {
            return this.resolveString(obj, escape);
        }
        if (Array.isArray(obj)) {
            return obj.map(item => this.resolveObject(item, escape));
        }
        if (obj !== null && typeof obj === 'object') {
            const resolved: any = {};
            for (const [key, value] of Object.entries(obj)) {
                resolved[key] = this.resolveObject(value, escape);
            }
            return resolved;
        }
        return obj;
    }

    /**
     * Resolve variables in an object with extra variables
     */
    resolveObjectWithExtra(obj: any, extraVariables: Record<string, string>, escape: boolean = false): any {
        if (typeof obj === 'string') {
            return this.resolveStringWithExtra(obj, extraVariables, escape);
        }
        if (Array.isArray(obj)) {
            return obj.map(item => this.resolveObjectWithExtra(item, extraVariables, escape));
        }
        if (obj !== null && typeof obj === 'object') {
            const resolved: any = {};
            for (const [key, value] of Object.entries(obj)) {
                resolved[key] = this.resolveObjectWithExtra(value, extraVariables, escape);
            }
            return resolved;
        }
        return obj;
    }

    /**
     * Core 5-step resolution pipeline for template content inside {{ }}
     */
    private resolveTemplateContent(content: string, variables: Record<string, any>, originalMatch: string): string {
        // Step 1: Check for dynamic variable WITHOUT filters (e.g., $guid, $randomInt(1, 100))
        const dynamicMatch = content.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)(?:\(([^)]*)\))?$/);
        if (dynamicMatch) {
            const args = parseDynamicArgs(dynamicMatch[2], variables);
            const resolved = resolveDynamicVariable(dynamicMatch[1], args);
            return resolved !== null ? String(resolved) : originalMatch;
        }

        // Step 2: Check for filter chains (contains | but not ||)
        const filterChain = parseFilterChain(content);
        if (filterChain) {
            const inputValue = this.resolveFilterInput(filterChain.input, variables);
            if (inputValue !== undefined) {
                const result = applyFilterChain(inputValue, filterChain.filters, variables);
                return result !== undefined ? String(result) : originalMatch;
            }
            return originalMatch;
        }

        // Step 3: Variable lookup (with optional property/index access)
        const propAccess = content.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(\[.+\]|\..+)$/);
        if (propAccess) {
            // Typed variable with property access: arr[0], obj.key, arr[1].name
            const varName = propAccess[1];
            if (variables[varName] !== undefined) {
                const value = this.deserializeValue(variables[varName]);
                const accessPath = propAccess[2];
                const result = this.resolvePropertyAccess(value, accessPath);
                if (result !== undefined) {
                    return typeof result === 'object' ? JSON.stringify(result) : String(result);
                }
            }
        }

        if (variables[content] !== undefined) {
            const raw = variables[content];
            // Strip type marker (\x1E) prefix for display — show the JSON representation
            if (typeof raw === 'string' && raw.charCodeAt(0) === 0x1E) {
                const json = raw.slice(1);
                // A variable explicitly set to undefined renders as empty (Postman-compatible)
                if (json === 'undefined') { return ''; }
                return json;
            }
            return String(raw);
        }

        // Step 4: JavaScript expression evaluation
        if (isExpression(content)) {
            const deserialized = this.deserializeVariables(variables);
            const augmentedVars = augmentWithDynamicVars(content, deserialized);
            const result = evaluateExpression(content, augmentedVars);
            if (result !== undefined) {
                return String(result);
            }
        }

        // Step 5: Nothing matched — return original
        return originalMatch;
    }

    /**
     * Resolve the input portion of a filter chain
     * Handles: @ (no-input), string literals, $dynamic variable, variable name, JS expression
     */
    private resolveFilterInput(input: string, variables: Record<string, any>): any {
        // @ means no input (empty string) — Thunder Client convention
        if (input === '@') { return ''; }

        // String literal: "hello" or 'hello'
        if ((input.startsWith('"') && input.endsWith('"')) || (input.startsWith("'") && input.endsWith("'"))) {
            return input.slice(1, -1);
        }

        // $dynamic variable as input (with optional args)
        const dynamicMatch = input.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)(?:\(([^)]*)\))?$/);
        if (dynamicMatch) {
            const args = parseDynamicArgs(dynamicMatch[2], variables);
            const resolved = resolveDynamicVariable(dynamicMatch[1], args);
            return resolved !== null ? resolved : undefined;
        }

        // Variable with property/index access (e.g., arr[0], obj.key)
        const propAccess = input.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(\[.+\]|\..+)$/);
        if (propAccess) {
            const varName = propAccess[1];
            if (variables[varName] !== undefined) {
                const value = this.deserializeValue(variables[varName]);
                const result = this.resolvePropertyAccess(value, propAccess[2]);
                if (result !== undefined) { return result; }
            }
        }

        // Regular variable lookup (deserialize typed values)
        if (variables[input] !== undefined) {
            return this.deserializeValue(variables[input]);
        }

        // Try as JavaScript expression
        if (isExpression(input)) {
            const deserialized = this.deserializeVariables(variables);
            const augmentedVars = augmentWithDynamicVars(input, deserialized);
            const result = evaluateExpression(input, augmentedVars);
            if (result !== undefined) { return result; }
        }

        return undefined;
    }

    /**
     * Deserialize a single value: strip \x1E type marker and JSON.parse if present.
     * Returns the native type for marked values, or the raw value as-is.
     */
    private deserializeValue(raw: any): any {
        if (typeof raw === 'string' && raw.charCodeAt(0) === 0x1E) {
            const json = raw.slice(1);
            if (json === 'undefined') { return undefined; }
            try { return JSON.parse(json); } catch { return raw; }
        }
        return raw;
    }

    /**
     * Deserialize all type-marked variables for expression evaluation.
     */
    private deserializeVariables(variables: Record<string, any>): Record<string, any> {
        const result: Record<string, any> = {};
        for (const [key, value] of Object.entries(variables)) {
            result[key] = this.deserializeValue(value);
        }
        return result;
    }

    /**
     * Resolve property/index access on a value.
     * Supports: [0], ["key"], .prop, and chained access like [0].name or .a.b
     */
    private resolvePropertyAccess(value: any, accessPath: string): any {
        let current = value;
        // Match segments: [0], ["key"], ['key'], .prop
        const segmentRegex = /\[(\d+|"[^"]*"|'[^']*')\]|\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
        let match;
        while ((match = segmentRegex.exec(accessPath)) !== null) {
            if (current == null) { return undefined; }
            if (match[1] !== undefined) {
                // Bracket access: [0] or ["key"]
                const idx = match[1];
                if (/^\d+$/.test(idx)) {
                    current = current[Number(idx)];
                } else {
                    // Strip quotes
                    current = current[idx.slice(1, -1)];
                }
            } else if (match[2] !== undefined) {
                // Dot access: .prop
                current = current[match[2]];
            }
        }
        return current;
    }

    /**
     * Escape special characters for string context
     */
    private escapeForString(value: string, quoteChar: '"' | "'"): string {
        let escaped = value.replace(/\\/g, '\\\\');
        
        if (quoteChar === '"') {
            escaped = escaped.replace(/"/g, '\\"');
        } else {
            escaped = escaped.replace(/'/g, "\\'");
        }
        
        return escaped
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
    }

    /**
     * Determine if position is inside a quoted string and which quote type
     */
    private getStringContext(input: string, position: number): '"' | "'" | null {
        let currentQuote: '"' | "'" | null = null;
        
        for (let i = 0; i < position; i++) {
            const char = input[i];
            const prevChar = i > 0 ? input[i - 1] : '';
            
            if (prevChar === '\\') {
                continue;
            }
            
            if (char === '"' || char === "'") {
                if (currentQuote === null) {
                    currentQuote = char;
                } else if (currentQuote === char) {
                    currentQuote = null;
                }
            }
        }
        
        return currentQuote;
    }
}

/**
 * VariableInterpolator — backward-compatible wrapper around VariableResolver
 * Implements IVariableInterpolator interface using the 5-step resolution pipeline
 */
export class VariableInterpolator implements IVariableInterpolator {

    /**
     * Replace {{variable}} placeholders with values using the 5-step pipeline
     * Automatically escapes values when inside quoted strings
     */
    public interpolate(input: string, variables: Record<string, string>): string {
        if (!input || typeof input !== 'string') {
            return input;
        }

        const resolver = new VariableResolver({
            globals: {},
            collectionVariables: {},
            environmentVariables: {},
            variables
        });

        return resolver.resolveString(input, true);
    }

    /**
     * Extract variable names from a string
     */
    public extractVariables(input: string): string[] {
        if (!input || typeof input !== 'string') {
            return [];
        }

        const variables: string[] = [];
        let match: RegExpExecArray | null;
        const pattern = /\{\{((?:[^}]|\}(?!\}))+)\}\}/g;
        
        while ((match = pattern.exec(input)) !== null) {
            const content = match[1].trim();
            // Skip dynamic variables, filter chains, and expressions
            if (!content.startsWith('$') && !content.includes('|') && /^[a-zA-Z_]\w*$/.test(content)) {
                if (!variables.includes(content)) {
                    variables.push(content);
                }
            }
        }

        return variables;
    }

    /**
     * Replace variables in all string values of an object (recursive)
     */
    public interpolateObject<T>(obj: T, variables: Record<string, string>): T {
        if (obj === null || obj === undefined) {
            return obj;
        }

        if (typeof obj === 'string') {
            return this.interpolate(obj, variables) as unknown as T;
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this.interpolateObject(item, variables)) as unknown as T;
        }

        if (typeof obj === 'object') {
            const result: Record<string, any> = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this.interpolateObject(value, variables);
            }
            return result as T;
        }

        return obj;
    }
}

/**
 * Create a variable resolver from configuration
 */
export function createVariableResolver(config: VariableResolverConfig): VariableResolver {
    return new VariableResolver(config);
}
