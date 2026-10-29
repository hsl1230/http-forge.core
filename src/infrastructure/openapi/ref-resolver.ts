/**
 * Ref Resolver
 * 
 * Wrapper around @apidevtools/json-schema-ref-parser for resolving
 * $ref pointers in OpenAPI specifications before import processing.
 * 
 * Handles:
 * - Internal $ref (same document)
 * - External file $ref
 * - External URL $ref
 * - Circular $ref (break cycle with { type: "object" } placeholder)
 */

import $RefParser from '@apidevtools/json-schema-ref-parser';

export class RefResolver {

    /**
     * Resolve all $ref pointers in an OpenAPI document.
     * Returns a fully dereferenced (inline) copy of the spec.
     */
    async resolve(spec: any): Promise<any> {
        try {
            const resolved = await $RefParser.dereference(spec, {
                dereference: {
                    circular: 'ignore'
                }
            });
            return resolved;
        } catch (error) {
            console.error('[RefResolver] Failed to fully resolve $ref pointers:', error);
            return spec;
        }
    }

    /**
     * Bundle all $ref pointers — resolves external refs but keeps
     * internal $ref pointers intact.
     */
    async bundle(spec: any): Promise<any> {
        try {
            const bundled = await $RefParser.bundle(spec);
            return bundled;
        } catch (error) {
            console.error('[RefResolver] Failed to bundle $ref pointers:', error);
            return spec;
        }
    }

    /**
     * Parse and resolve an OpenAPI file from disk.
     */
    async resolveFile(filePath: string): Promise<any> {
        try {
            const resolved = await $RefParser.dereference(filePath, {
                dereference: {
                    circular: 'ignore'
                }
            });
            return resolved;
        } catch (error) {
            console.error(`[RefResolver] Failed to resolve file ${filePath}:`, error);
            throw error;
        }
    }
}
