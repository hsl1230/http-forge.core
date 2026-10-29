/**
 * Variable Scopes
 *
 * Single Responsibility: Build the Postman-compatible variable scope objects
 * used inside the script sandbox (variables, globals, environment, collection,
 * merged cascade) with typed serialization and {{...}} replaceIn resolution.
 */

import { augmentWithDynamicVars, resolveDynamicVariable } from '../../utils/dynamic-variables';
import { evaluateExpression, isExpression } from '../../utils/expression-evaluator';
import { applyFilterChain, parseFilterChain } from '../../utils/filter-engine';
import { parseDynamicArgs } from '../environment/variable-interpolator';
import { CommonScriptContext } from './interfaces';

/** Prefix marking a JSON-serialized non-string value */
const JSON_TYPE_MARKER = '\x1E';

/**
 * Deserialize a single value: strip \x1E type marker and JSON.parse if present.
 */
function deserializeValueStatic(raw: any): any {
    if (typeof raw === 'string' && raw.charCodeAt(0) === 0x1E) {
        try { return JSON.parse(raw.slice(1)); } catch { return raw; }
    }
    return raw;
}

/**
 * Resolve filter input in script execution context
 * Handles: @ (no-input), string literals, $dynamic variables, variable lookup, JS expressions
 */
function resolveScriptFilterInput(input: string, variables: Record<string, any>): any {
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

    // Regular variable lookup (deserialize typed values)
    if (variables[input] !== undefined) {
        return deserializeValueStatic(variables[input]);
    }

    // Try as JavaScript expression
    if (isExpression(input)) {
        const augmentedVars = augmentWithDynamicVars(input, variables);
        const result = evaluateExpression(input, augmentedVars);
        if (result !== undefined) { return result; }
    }

    return undefined;
}

/**
 * Factory for Postman-compatible variable scopes.
 *
 * Stateless aside from serialization helpers; instances are created once per
 * ScriptExecutor and shared across request sessions.
 */
export class VariableScopeFactory {
    /**
     * Serialize a value for storage. Non-string values are JSON-stringified with a type marker.
     * `undefined` is stored explicitly (JSON.stringify(undefined) yields JS undefined, which would
     * corrupt the marker into the literal "undefined"). It round-trips back to undefined and renders
     * empty, matching Postman (a variable set to undefined resolves to an empty string).
     */
    serializeValue(value: any): string {
        if (typeof value === 'string') return value;
        if (value === undefined) return JSON_TYPE_MARKER + 'undefined';
        return JSON_TYPE_MARKER + JSON.stringify(value);
    }

    /**
     * Deserialize a stored value. Values with the type marker are JSON-parsed back to native types.
     * Values without the marker (plain strings) are returned as-is.
     */
    deserializeValue(value: string | undefined): any {
        if (value === undefined) return undefined;
        if (typeof value === 'string' && value.charCodeAt(0) === 0x1E) {
            const json = value.slice(1);
            if (json === 'undefined') return undefined;
            try { return JSON.parse(json); } catch { /* fall through */ }
        }
        return value;
    }

    /**
     * Create a basic variable scope with get/set/has/unset/clear/toObject
     */
    createVariableScope(store: Record<string, string>) {
        return {
            get: (key: string) => this.deserializeValue(store[key]),
            set: (key: string, value: any) => { store[key] = this.serializeValue(value); },
            has(key: string) { return key in store; },
            unset(key: string) { delete store[key]; },
            clear() { Object.keys(store).forEach(key => delete store[key]); },
            toObject() { return { ...store }; }
        };
    }

    /**
     * Create the globals scope with change callbacks.
     * Globals are a special, environment-agnostic variable layer, so they are
     * persisted live through the same push-callback mechanism as environment
     * variables (see createEnvironmentScope) rather than a post-hoc diff.
     */
    createGlobalsScope(
        store: Record<string, string>,
        onChange: CommonScriptContext['onGlobalsChange']
    ) {
        const notifyChange = (action: 'set' | 'unset' | 'clear', key?: string, value?: string) => {
            if (onChange) onChange(action, key, value);
        };
        return {
            get: (key: string) => this.deserializeValue(store[key]),
            set: (key: string, value: any) => {
                const serialized = this.serializeValue(value);
                store[key] = serialized;
                notifyChange('set', key, serialized);
            },
            has(key: string) { return key in store; },
            unset(key: string) {
                delete store[key];
                notifyChange('unset', key);
            },
            clear() {
                Object.keys(store).forEach(key => delete store[key]);
                notifyChange('clear');
            },
            toObject() { return { ...store }; }
        };
    }

    /**
     * Create merged variable scope (Postman-style cascading lookup)
     */
    createMergedVariableScope(
        variables: Record<string, string>,
        environmentVariables: Record<string, string>,
        collectionVariables: Record<string, string>,
        globals: Record<string, string>,
        iterationData: Record<string, any> = {}
    ) {
        const mergedScope = {
            get: (key: string) => {
                if (key in variables) return this.deserializeValue(variables[key]);
                if (key in iterationData) return iterationData[key];
                if (key in environmentVariables) return this.deserializeValue(environmentVariables[key]);
                if (key in collectionVariables) return this.deserializeValue(collectionVariables[key]);
                return this.deserializeValue(globals[key]);
            },
            set: (key: string, value: any) => { variables[key] = this.serializeValue(value); },
            has(key: string) {
                return key in variables ||
                    key in iterationData ||
                    key in environmentVariables ||
                    key in environmentVariables ||
                    key in collectionVariables ||
                    key in globals;
            },
            unset(key: string) { delete variables[key]; },
            clear() { Object.keys(variables).forEach(key => delete variables[key]); },
            toObject() {
                return {
                    ...globals,
                    ...collectionVariables,
                    ...environmentVariables,
                    ...iterationData,
                    ...variables
                };
            },
            // Returns all scopes EXCEPT globals — i.e. the variables that should be
            // passed as extraVariables for body resolution. Globals are excluded because
            // they have a separate fresh channel (runtimeGlobals) in createResolver;
            // including the session snapshot here would risk shadowing a fresh value
            // written by a previous request's post-response script.
            toLocalObject() {
                return {
                    ...collectionVariables,
                    ...environmentVariables,
                    ...iterationData,
                    ...variables
                };
            },
            /**
             * Postman-compatible replaceIn method
             * 5-step resolution pipeline:
             * 1. $dynamic variables
             * 2. Filter chains
             * 3. Simple variable lookup
             * 4. JavaScript expressions
             * 5. Return original {{...}} if nothing matched
             *
             * Nested references (a variable whose value itself contains {{...}})
             * are resolved recursively by repeating the pass until the string
             * stabilizes or the depth cap is hit (guards against reference cycles).
             */
            replaceIn(str: string): string {
                if (!str || typeof str !== 'string') {
                    return str;
                }

                const allVars = mergedScope.toObject();
                const MAX_RESOLUTION_DEPTH = 20;

                const singlePass = (input: string): string =>
                    input.replace(/\{\{([^}]+)\}\}/g, (match, content) => {
                        const trimmed = content.trim();

                        // Step 1: Pure dynamic variable (no filters)
                        const dynMatch = trimmed.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)(?:\(([^)]*)\))?$/);
                        if (dynMatch) {
                            try {
                                const args = parseDynamicArgs(dynMatch[2], allVars);
                                const value = resolveDynamicVariable(dynMatch[1], args);
                                return value !== null ? String(value) : match;
                            } catch {
                                return match;
                            }
                        }

                        // Step 2: Filter chains (contains | but not ||)
                        const filterChain = parseFilterChain(trimmed);
                        if (filterChain) {
                            const inputValue = resolveScriptFilterInput(filterChain.input, allVars);
                            if (inputValue !== undefined) {
                                const result = applyFilterChain(inputValue, filterChain.filters, allVars);
                                return result !== undefined ? String(result) : match;
                            }
                            return match;
                        }

                        // Step 3: Simple variable lookup
                        // Use has() so a variable that exists but resolves to undefined renders
                        // empty (Postman-compatible), instead of falling through to the literal {{...}}.
                        if (mergedScope.has(trimmed)) {
                            const varValue = mergedScope.get(trimmed);
                            return varValue === undefined ? '' : String(varValue);
                        }

                        // Step 4: JavaScript expression evaluation
                        if (isExpression(trimmed)) {
                            const deserialized: Record<string, any> = {};
                            for (const [k, v] of Object.entries(allVars)) {
                                deserialized[k] = deserializeValueStatic(v);
                            }
                            const augmentedVars = augmentWithDynamicVars(trimmed, deserialized);
                            const result = evaluateExpression(trimmed, augmentedVars);
                            if (result !== undefined) { return String(result); }
                        }

                        // Step 5: Return original
                        return match;
                    });

                let current = str;
                for (let depth = 0; depth < MAX_RESOLUTION_DEPTH; depth++) {
                    const next = singlePass(current);
                    if (next === current) { break; }
                    current = next;
                }
                return current;
            }
        };

        return mergedScope;
    }

    /**
     * Create environment variable scope with change callbacks
     */
    createEnvironmentScope(
        environmentVariables: Record<string, string>,
        environmentName: string | undefined,
        onChange: CommonScriptContext['onEnvironmentChange'],
        isNewSignature: boolean
    ) {
        const notifyChange = (action: 'set' | 'unset' | 'clear', key?: string, value?: string) => {
            if (!onChange) return;
            if (isNewSignature) {
                (onChange as any)(action, key, value);
            } else {
                (onChange as any)(key || '', action === 'set' ? value : undefined);
            }
        };

        return {
            name: environmentName || '',
            get: (key: string) => this.deserializeValue(environmentVariables[key]),
            set: (key: string, value: any) => {
                const serialized = this.serializeValue(value);
                environmentVariables[key] = serialized;
                notifyChange('set', key, serialized);
            },
            has(key: string) { return key in environmentVariables; },
            unset(key: string) {
                delete environmentVariables[key];
                notifyChange('unset', key);
            },
            clear() {
                Object.keys(environmentVariables).forEach(key => delete environmentVariables[key]);
                notifyChange('clear');
            },
            toObject() { return { ...environmentVariables }; }
        };
    }
}
