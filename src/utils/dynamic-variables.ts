/**
 * Dynamic Variables Utility
 * 
 * Single Responsibility: Generate Postman-compatible dynamic variable values
 * Handles: $randomInt, $timestamp, $guid, $uuid, $randomString, $randomHexadecimal, etc.
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a random integer between min and max (default 0-999)
 */
function generateRandomInt(min: number = 0, max: number = 999): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate a current Unix timestamp in milliseconds
 */
function generateTimestamp(): number {
    return Date.now();
}

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
    return uuidv4();
}

/**
 * Generate a GUID (alias for UUID v4)
 */
function generateGUID(): string {
    return uuidv4();
}

/**
 * Generate a random string of specified length (alphanumeric)
 */
function generateRandomString(length: number = 10): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Generate a random email address
 */
function generateRandomEmail(): string {
    const user = generateRandomString(8).toLowerCase();
    const domains = ['example.com', 'test.org', 'mail.dev', 'sample.net'];
    return `${user}@${domains[Math.floor(Math.random() * domains.length)]}`;
}

/**
 * Generate a random boolean
 */
function generateRandomBoolean(): boolean {
    return Math.random() < 0.5;
}

/**
 * Generate a random hexadecimal string of specified length
 */
function generateRandomHexadecimal(length: number = 10): string {
    const chars = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Generate a current Unix timestamp in seconds
 */
function generateTimestampSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

/**
 * Generate a current ISO 8601 datetime
 */
function generateDatetime(): string {
    return new Date().toISOString();
}

/**
 * Generate a current date (YYYY-MM-DD)
 */
function generateDate(): string {
    return new Date().toISOString().split('T')[0];
}

/**
 * Generate a current time (HH:mm:ss)
 */
function generateTime(): string {
    return new Date().toISOString().split('T')[1].split('.')[0];
}

/**
 * Generate a current ISO 8601 timestamp
 */
function generateTimestampISO(): string {
    return new Date().toISOString();
}

/**
 * Encode text to Base64
 */
function base64Encode(text: string = ''): string {
    return Buffer.from(String(text)).toString('base64');
}

/**
 * Decode Base64 to text
 */
function base64Decode(encoded: string = ''): string {
    return Buffer.from(String(encoded), 'base64').toString('utf-8');
}

/**
 * URL encode text
 */
function urlEncode(text: string = ''): string {
    return encodeURIComponent(String(text));
}

/**
 * URL decode text
 */
function urlDecode(encoded: string = ''): string {
    return decodeURIComponent(String(encoded));
}

/**
 * Dynamic variables supported by HTTP Forge (Postman-compatible)
 */
export const DYNAMIC_VARIABLES: Record<string, (...args: any[]) => any> = {
    randomInt: generateRandomInt,
    timestamp: generateTimestamp,
    guid: generateGUID,
    uuid: generateUUID,
    randomUUID: generateUUID,
    randomString: generateRandomString,
    randomHexadecimal: generateRandomHexadecimal,
    randomEmail: generateRandomEmail,
    randomBoolean: generateRandomBoolean,
    isoTimestamp: generateTimestampISO,
    timestamp_s: generateTimestampSeconds,
    datetime: generateDatetime,
    date: generateDate,
    time: generateTime,
    base64Encode: base64Encode,
    base64Decode: base64Decode,
    urlEncode: urlEncode,
    urlDecode: urlDecode,
};

/**
 * Check if a variable name is a dynamic variable
 * @param varName - Variable name (without $ prefix)
 * @returns True if this is a recognized dynamic variable
 */
export function isDynamicVariable(varName: string): boolean {
    return varName in DYNAMIC_VARIABLES;
}

/**
 * Parse arguments from a dynamic variable call, e.g. "1, 100" → [1, 100]
 */
function parseArgs(argsStr: string): any[] {
    if (!argsStr) { return []; }
    return argsStr.split(',').map(arg => {
        const trimmed = arg.trim();
        // Try number first
        const num = Number(trimmed);
        if (!isNaN(num) && trimmed !== '') { return num; }
        // Strip quotes for strings
        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
            return trimmed.slice(1, -1);
        }
        return trimmed;
    });
}

/**
 * Resolve a dynamic variable to its value
 * @param varName - Variable name (without $ prefix)
 * @param args - Optional arguments for parameterized variables
 * @returns The generated value for the dynamic variable, or null if not recognized
 */
export function resolveDynamicVariable(varName: string, args?: any[]): any {
    const generator = DYNAMIC_VARIABLES[varName];
    if (!generator) {
        return null;
    }
    return args && args.length > 0 ? generator(...args) : generator();
}

/**
 * Resolve all dynamic variables in a string
 * @param text - Text containing {{$variableName}} patterns
 * @returns Text with all dynamic variables replaced
 */
export function resolveDynamicVariablesInString(text: string): string {
    if (!text || typeof text !== 'string') {
        return text;
    }

    // Match {{$variableName}} and {{$variableName(args)}} patterns
    return text.replace(/\{\{\$([a-zA-Z_][a-zA-Z0-9_]*)(?:\(([^)]*)\))?\}\}/g, (match, varName, argsStr) => {
        try {
            const args = argsStr ? parseArgs(argsStr) : undefined;
            const value = resolveDynamicVariable(varName, args);
            if (value === null) { return match; }
            return String(value);
        } catch {
            // Return original match if variable is not recognized
            return match;
        }
    });
}

/**
 * Scan an expression for $varName references and pre-resolve them as dynamic variables.
 * Returns an augmented variables object so JS expressions like `$timestamp ?? 1` work
 * (the sandbox needs `$timestamp` to be a defined identifier, not a ReferenceError).
 * 
 * Only resolves simple $varName references (no parameterized args).
 * Returns the original variables object unchanged if no dynamic vars are found.
 */
export function augmentWithDynamicVars(expression: string, variables: Record<string, any>): Record<string, any> {
    const dynamicRefRegex = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
    let augmented: Record<string, any> | null = null;
    let match;

    while ((match = dynamicRefRegex.exec(expression)) !== null) {
        const fullRef = match[0]; // e.g. $timestamp
        const varName = match[1]; // e.g. timestamp
        if (!(fullRef in variables)) {
            const resolved = resolveDynamicVariable(varName);
            if (resolved !== null) {
                if (!augmented) { augmented = { ...variables }; }
                augmented[fullRef] = resolved;
            }
        }
    }

    return augmented ?? variables;
}
