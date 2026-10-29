/**
 * Filter Engine
 * 
 * Single Responsibility: Parse and apply pipe-based filters to values
 * Thunder Client-compatible filter syntax: {{variable | filter1 | filter2(args)}}
 * 
 * Supports:
 * - Chained filters: {{variable | upper | substring(0, 5)}}
 * - No-input filters using @: {{@ | filter1}}
 * - Dynamic variable input: {{$guid | upper}}
 * - Filter arguments: {{variable | replace("old", "new")}}
 * - Variable references in args: {{number | add("otherVar")}}
 */

import * as crypto from 'crypto';

/**
 * Deserialize typed values stored with the internal \x1E marker.
 * This keeps filter argument resolution consistent with script/runtime scopes.
 */
function deserializeTypedValue(raw: any): any {
    if (typeof raw === 'string' && raw.charCodeAt(0) === 0x1E) {
        try { return JSON.parse(raw.slice(1)); } catch { return raw; }
    }
    return raw;
}

/**
 * Parsed filter with name and arguments
 */
interface ParsedFilter {
    name: string;
    args: string[];
}

/**
 * Result of parsing a template expression containing pipes
 */
export interface ParsedFilterChain {
    /** The input portion (variable name, $dynamic, or @ for no-input) */
    input: string;
    /** Ordered list of filters to apply */
    filters: ParsedFilter[];
}

/**
 * Parse a filter chain from a template expression
 * e.g. "variable | upper | substring(0, 5)" → { input: "variable", filters: [...] }
 * 
 * @param expression - The content inside {{ }}, e.g. "myVar | upper | replace('a', 'b')"
 * @returns Parsed filter chain, or null if no filters present
 */
export function parseFilterChain(expression: string): ParsedFilterChain | null {
    if (!expression || !expression.includes('|')) {
        return null;
    }

    // Split by pipe, but not pipes inside parentheses or quotes
    const parts = splitByPipe(expression);
    if (parts.length < 2) {
        return null;
    }

    const input = parts[0].trim();
    const filters: ParsedFilter[] = [];

    for (let i = 1; i < parts.length; i++) {
        const filterStr = parts[i].trim();
        if (!filterStr) { continue; }

        const parsed = parseFilterExpression(filterStr);
        if (parsed) {
            filters.push(parsed);
        }
    }

    if (filters.length === 0) {
        return null;
    }

    return { input, filters };
}

/**
 * Split expression by pipe character, respecting parentheses, quotes, and || (logical OR)
 */
function splitByPipe(expression: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;

    for (let i = 0; i < expression.length; i++) {
        const char = expression[i];
        const prevChar = i > 0 ? expression[i - 1] : '';
        const nextChar = i < expression.length - 1 ? expression[i + 1] : '';

        // Handle escape sequences
        if (prevChar === '\\') {
            current += char;
            continue;
        }

        if (char === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
        } else if (char === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
        } else if (char === '(' && !inSingleQuote && !inDoubleQuote) {
            depth++;
        } else if (char === ')' && !inSingleQuote && !inDoubleQuote) {
            depth--;
        } else if (char === '|' && depth === 0 && !inSingleQuote && !inDoubleQuote) {
            // Skip || (JS logical OR) — treat as part of the expression, not a pipe
            if (nextChar === '|') {
                current += '||';
                i++; // skip next |
                continue;
            }
            parts.push(current);
            current = '';
            continue;
        }

        current += char;
    }

    if (current) {
        parts.push(current);
    }

    return parts;
}

/**
 * Parse a single filter expression like "replace('old', 'new')" or "upper"
 */
function parseFilterExpression(filterStr: string): ParsedFilter | null {
    const parenIndex = filterStr.indexOf('(');
    if (parenIndex === -1) {
        // Simple filter with no args
        return { name: filterStr.trim(), args: [] };
    }

    const name = filterStr.substring(0, parenIndex).trim();
    const argsStr = filterStr.substring(parenIndex + 1, filterStr.lastIndexOf(')'));

    return { name, args: parseFilterArgs(argsStr) };
}

/**
 * Parse filter arguments, preserving quotes for semantic distinction:
 * - Quoted args ("hello", 'world') → literal strings
 * - Unquoted args (tax, count) → variable references (with fallback to literal)
 */
function parseFilterArgs(argsStr: string): string[] {
    if (!argsStr || !argsStr.trim()) { return []; }

    const args: string[] = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;

    for (let i = 0; i < argsStr.length; i++) {
        const char = argsStr[i];
        const prevChar = i > 0 ? argsStr[i - 1] : '';

        if (prevChar === '\\') {
            current += char;
            continue;
        }

        if (char === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            current += char; // Preserve quotes for resolveFilterArg to distinguish
            continue;
        } else if (char === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            current += char; // Preserve quotes for resolveFilterArg to distinguish
            continue;
        } else if (char === ',' && !inSingleQuote && !inDoubleQuote) {
            args.push(current.trim());
            current = '';
            continue;
        }

        current += char;
    }

    if (current.trim()) {
        args.push(current.trim());
    }

    return args;
}

/**
 * Resolve a filter argument — distinguishes literals from variable references:
 * - Quoted: "hello" or 'hello' → always literal string (quotes stripped)
 * - Unquoted: tax → variable lookup first, fallback to literal string
 */
function resolveFilterArg(arg: string, variables: Record<string, any>): any {
    // Quoted string → always literal (strip quotes, never look up as variable)
    if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
        return arg.slice(1, -1);
    }

    // If it's a number, return as number
    const num = Number(arg);
    if (!isNaN(num) && arg !== '') { return num; }

    // If it's a boolean
    if (arg === 'true') { return true; }
    if (arg === 'false') { return false; }

    // Unquoted → variable lookup first, fallback to literal string
    if (variables && arg in variables) {
        const val = deserializeTypedValue(variables[arg]);
        const numVal = Number(val);
        return !isNaN(numVal) && val !== '' ? numVal : val;
    }

    return arg;
}

/**
 * Apply a chain of filters to a value
 * 
 * @param value - The input value (resolved variable value)
 * @param filters - Array of parsed filters to apply in order
 * @param variables - Available variables (for variable reference args like add("otherVar"))
 * @returns The filtered result
 */
export function applyFilterChain(
    value: any,
    filters: ParsedFilter[],
    variables: Record<string, any> = {}
): any {
    let result = value;

    for (const filter of filters) {
        result = applyFilter(result, filter.name, filter.args, variables);
    }

    return result;
}

/**
 * Apply a single filter to a value
 */
function applyFilter(
    value: any,
    filterName: string,
    args: string[],
    variables: Record<string, any>
): any {
    switch (filterName) {
        // --- String Filters ---
        case 'upper':
            return String(value).toUpperCase();

        case 'lower':
            return String(value).toLowerCase();

        case 'trim':
            return String(value).trim();

        case 'length':
            if (Array.isArray(value)) { return value.length; }
            return String(value).length;

        case 'substring': {
            const start = resolveFilterArg(args[0], variables) as number;
            const end = args[1] !== undefined ? resolveFilterArg(args[1], variables) as number : undefined;
            return String(value).substring(
                start < 0 ? String(value).length + start : start,
                end !== undefined ? (end < 0 ? String(value).length + end : end) : undefined
            );
        }

        case 'replace': {
            const search = args[0] !== undefined ? String(resolveFilterArg(args[0], variables)) : '';
            const replacement = args[1] !== undefined ? String(resolveFilterArg(args[1], variables)) : '';
            return String(value).replace(new RegExp(escapeRegExp(search), 'g'), replacement);
        }

        case 'split': {
            const separator = args[0] !== undefined ? String(resolveFilterArg(args[0], variables)) : ',';
            return String(value).split(separator);
        }

        case 'join': {
            const separator = args[0] !== undefined ? String(resolveFilterArg(args[0], variables)) : ',';
            return Array.isArray(value) ? value.join(separator) : String(value);
        }

        case 'removeQuotes':
            return String(value).replace(/["']/g, '');

        case 'removeSpaces':
            return String(value).replace(/\s/g, '');

        case 'format': {
            // format("Hello {0} {1}", "var2") — {0} = value, {1} = var2 value
            let template = args[0] !== undefined ? String(resolveFilterArg(args[0], variables)) : '{0}';
            template = template.replace('{0}', String(value));
            for (let i = 1; i < args.length; i++) {
                const argVal = resolveFilterArg(args[i], variables);
                template = template.replace(`{${i}}`, String(argVal));
            }
            return template;
        }

        // --- Math Filters ---
        case 'add': {
            const num = resolveFilterArg(args[0], variables) as number;
            return Number(value) + num;
        }

        case 'subtract': {
            const num = resolveFilterArg(args[0], variables) as number;
            return Number(value) - num;
        }

        case 'multiply': {
            const num = resolveFilterArg(args[0], variables) as number;
            return Number(value) * num;
        }

        case 'abs':
            return Math.abs(Number(value));

        // --- Encoding Filters ---
        case 'btoa':
            return Buffer.from(String(value)).toString('base64');

        case 'atob':
            return Buffer.from(String(value), 'base64').toString('utf-8');

        case 'urlEncode':
            return encodeURIComponent(String(value));

        case 'urlDecode':
            return decodeURIComponent(String(value));

        // --- Hash Filters ---
        case 'hash': {
            const algorithm = String(args[0] !== undefined ? resolveFilterArg(args[0], variables) : 'md5').toLowerCase();
            const encoding = String(args[1] !== undefined ? resolveFilterArg(args[1], variables) : 'base64') as crypto.BinaryToTextEncoding;
            const algoMap: Record<string, string> = {
                md5: 'md5', sha1: 'sha1', sha256: 'sha256', sha512: 'sha512'
            };
            const algo = algoMap[algorithm] || 'md5';
            return crypto.createHash(algo).update(String(value)).digest(encoding);
        }

        case 'hmac': {
            const secret = args[0] ? String(resolveFilterArg(args[0], variables)) : '';
            const algorithm = String(args[1] !== undefined ? resolveFilterArg(args[1], variables) : 'sha256').toLowerCase();
            const encoding = String(args[2] !== undefined ? resolveFilterArg(args[2], variables) : 'base64') as crypto.BinaryToTextEncoding;
            const algoMap: Record<string, string> = {
                md5: 'md5', sha1: 'sha1', sha256: 'sha256', sha512: 'sha512'
            };
            const algo = algoMap[algorithm] || 'sha256';
            return crypto.createHmac(algo, secret).update(String(value)).digest(encoding);
        }

        // --- Array Filters ---
        case 'first': {
            if (Array.isArray(value)) { return value[0]; }
            return value;
        }

        case 'last': {
            if (Array.isArray(value)) { return value[value.length - 1]; }
            return value;
        }

        case 'at': {
            const index = resolveFilterArg(args[0], variables) as number;
            if (Array.isArray(value)) { return value.at(index); }
            return value;
        }

        case 'slice': {
            const start = resolveFilterArg(args[0], variables) as number;
            const end = args[1] !== undefined ? resolveFilterArg(args[1], variables) as number : undefined;
            if (Array.isArray(value)) { return value.slice(start, end); }
            return String(value).slice(start, end);
        }

        case 'unique': {
            if (Array.isArray(value)) { return [...new Set(value)]; }
            return value;
        }

        case 'filter': {
            // filter(property>5) or filter(id=10) etc.
            if (!Array.isArray(value) || !args[0]) { return value; }
            return applyArrayFilter(value, args[0], variables);
        }

        case 'map': {
            // map("id") or map("a.b.c") or map("id", "name")
            if (!Array.isArray(value)) { return value; }
            const resolvedMapArgs = args.map(a => String(resolveFilterArg(a, variables)));
            if (resolvedMapArgs.length === 1) {
                return value.map(item => getNestedProperty(item, resolvedMapArgs[0]));
            }
            return value.map(item => {
                const picked: any = {};
                for (const prop of resolvedMapArgs) {
                    const val = getNestedProperty(item, prop);
                    if (val !== undefined) { picked[prop] = val; }
                }
                return picked;
            });
        }

        // --- Object Filters ---
        case 'prop': {
            const propName = args[0] !== undefined ? String(resolveFilterArg(args[0], variables)) : '';
            if (Array.isArray(value)) {
                const results = value.map(item => getNestedProperty(item, propName)).filter(v => v !== undefined);
                return results.length === 1 ? results[0] : results.join(',');
            }
            if (value && typeof value === 'object') {
                return getNestedProperty(value, propName);
            }
            return value;
        }

        case 'parseJSON': {
            try {
                return JSON.parse(String(value));
            } catch {
                return value;
            }
        }

        case 'stringify': {
            try {
                return JSON.stringify(value);
            } catch {
                return String(value);
            }
        }

        // --- Validation Filters ---
        case 'isEmail':
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));

        case 'isUrl': {
            try {
                new URL(String(value));
                return true;
            } catch {
                return false;
            }
        }

        // --- Misc Filters ---
        case 'setIfValue':
            // For tests: returns value only if truthy (used to conditionally set env var)
            return value ? value : undefined;

        case 'setNull':
            // For tests: preserves null instead of converting to empty string
            return value === null ? null : value;

        default:
            // Unknown filter — return value unchanged
            return value;
    }
}

/**
 * Apply array filter operation: filter(property>value)
 * Supports: >, >=, <, <=, =, !=, *=, ^=, $=
 */
function applyArrayFilter(arr: any[], expression: string, variables: Record<string, any>): any[] {
    // Parse expression like "id>5" or "name*=test"
    const operatorMatch = expression.match(/^([\w.]+)\s*(>=|<=|!=|\*=|\^=|\$=|>|<|=)\s*(.+)$/);
    if (!operatorMatch) { return arr; }

    const [, prop, operator, rawVal] = operatorMatch;
    const compareVal = resolveFilterArg(rawVal, variables);

    return arr.filter(item => {
        const itemVal = getNestedProperty(item, prop);
        if (itemVal === undefined) { return false; }

        switch (operator) {
            case '>': return Number(itemVal) > Number(compareVal);
            case '>=': return Number(itemVal) >= Number(compareVal);
            case '<': return Number(itemVal) < Number(compareVal);
            case '<=': return Number(itemVal) <= Number(compareVal);
            case '=': return String(itemVal) === String(compareVal);
            case '!=': return String(itemVal) !== String(compareVal);
            case '*=': return String(itemVal).includes(String(compareVal));
            case '^=': return String(itemVal).startsWith(String(compareVal));
            case '$=': return String(itemVal).endsWith(String(compareVal));
            default: return true;
        }
    });
}

/**
 * Resolve a nested property path like "a.b.c" on an object.
 * e.g. getNestedProperty({ a: { b: { c: 42 } } }, "a.b.c") → 42
 * Falls back to direct key lookup first (for keys containing dots).
 */
function getNestedProperty(obj: any, path: string): any {
    if (!obj || typeof obj !== 'object') { return undefined; }
    // Direct key lookup first (handles keys that literally contain dots)
    if (path in obj) { return obj[path]; }
    // Nested path traversal
    return path.split('.').reduce((cur, key) => cur?.[key], obj);
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
