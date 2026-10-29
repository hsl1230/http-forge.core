/**
 * Example Generator
 * 
 * Generates example values from JSON Schema definitions.
 * Handles allOf (flatten + merge), oneOf/anyOf (first variant), 
 * discriminator injection, enum, formats, readOnly omission.
 */

import { JSONSchema7 } from '../../types/types';

export class ExampleGenerator {

    /**
     * Generate an example value from a JSON Schema.
     */
    generate(
        schema: JSONSchema7,
        options?: { omitReadOnly?: boolean; components?: Record<string, JSONSchema7> }
    ): any {
        if (!schema) { return undefined; }

        const opts = options || {};

        if (schema.$ref) {
            const resolved = this.resolveLocalRef(schema.$ref, opts.components);
            if (resolved) {
                return this.generate(resolved, opts);
            }
            return {};
        }

        if (schema.nullable && !schema.type) {
            return null;
        }

        if (schema.enum && schema.enum.length > 0) {
            return schema.enum[0];
        }

        if (schema.default !== undefined) {
            return schema.default;
        }

        if (schema.example !== undefined) {
            return schema.example;
        }

        if (schema.allOf) {
            return this.generateFromAllOf(schema.allOf, schema.discriminator, opts);
        }
        if (schema.oneOf) {
            return this.generateFromOneOfAnyOf(schema.oneOf, schema.discriminator, opts);
        }
        if (schema.anyOf) {
            return this.generateFromOneOfAnyOf(schema.anyOf, schema.discriminator, opts);
        }

        switch (schema.type) {
            case 'string':
                return this.generateString(schema);
            case 'integer':
                return this.generateInteger(schema);
            case 'number':
                return this.generateNumber(schema);
            case 'boolean':
                return false;
            case 'array':
                return this.generateArray(schema, opts);
            case 'object':
                return this.generateObject(schema, opts);
            default:
                if (schema.properties) {
                    return this.generateObject(schema, opts);
                }
                return {};
        }
    }

    private generateString(schema: JSONSchema7): string {
        switch (schema.format) {
            case 'email': return 'user@example.com';
            case 'date-time': return '2026-01-01T00:00:00Z';
            case 'date': return '2026-01-01';
            case 'time': return '00:00:00';
            case 'uri':
            case 'url': return 'https://example.com';
            case 'uuid': return '00000000-0000-0000-0000-000000000000';
            case 'ipv4': return '127.0.0.1';
            case 'ipv6': return '::1';
            case 'hostname': return 'example.com';
            case 'binary': return '';
            case 'byte': return 'c3RyaW5n';
            case 'password': return '********';
            default: return 'string';
        }
    }

    private generateInteger(schema: JSONSchema7): number {
        if (schema.minimum !== undefined) { return schema.minimum; }
        if (schema.exclusiveMinimum !== undefined) { return schema.exclusiveMinimum + 1; }
        return 0;
    }

    private generateNumber(schema: JSONSchema7): number {
        if (schema.minimum !== undefined) { return schema.minimum; }
        if (schema.exclusiveMinimum !== undefined) { return schema.exclusiveMinimum + 0.1; }
        return 0.0;
    }

    private generateArray(schema: JSONSchema7, opts: any): any[] {
        if (schema.items) {
            return [this.generate(schema.items, opts)];
        }
        return [];
    }

    private generateObject(schema: JSONSchema7, opts: any): any {
        const result: any = {};
        const properties = schema.properties || {};

        for (const [key, propSchema] of Object.entries(properties)) {
            if (opts.omitReadOnly && (propSchema as any).readOnly) {
                continue;
            }
            result[key] = this.generate(propSchema as JSONSchema7, opts);
        }

        return result;
    }

    private generateFromAllOf(
        schemas: JSONSchema7[],
        discriminator: any,
        opts: any
    ): any {
        const merged: JSONSchema7 = { type: 'object', properties: {}, required: [] };

        for (const subSchema of schemas) {
            const resolved = subSchema.$ref
                ? this.resolveLocalRef(subSchema.$ref, opts.components) || {}
                : subSchema;

            if (resolved.properties) {
                Object.assign(merged.properties, resolved.properties);
            }
            if (resolved.required) {
                merged.required = [...(merged.required || []), ...resolved.required];
            }
        }

        const result = this.generateObject(merged, opts);

        if (discriminator?.propertyName) {
            result[discriminator.propertyName] = this.guessDiscriminatorValue(schemas, opts);
        }

        return result;
    }

    private generateFromOneOfAnyOf(
        schemas: JSONSchema7[],
        discriminator: any,
        opts: any
    ): any {
        if (schemas.length === 0) { return {}; }

        const firstSchema = schemas[0].$ref
            ? this.resolveLocalRef(schemas[0].$ref, opts.components) || schemas[0]
            : schemas[0];

        const result = this.generate(firstSchema, opts);

        if (discriminator?.propertyName && typeof result === 'object' && result !== null) {
            result[discriminator.propertyName] = this.guessDiscriminatorValue(schemas, opts);
        }

        return result;
    }

    private guessDiscriminatorValue(schemas: JSONSchema7[], _opts: any): string {
        if (schemas.length === 0) { return 'unknown'; }
        const first = schemas[0];
        if (first.$ref) {
            const parts = first.$ref.split('/');
            return parts[parts.length - 1];
        }
        return 'variant1';
    }

    private resolveLocalRef(
        ref: string,
        components?: Record<string, JSONSchema7>
    ): JSONSchema7 | undefined {
        if (!ref || !components) { return undefined; }

        const match = ref.match(/^#\/components\/(?:schemas\/)?(.+)$/);
        if (match) {
            return components[match[1]];
        }

        const shortMatch = ref.match(/^#\/components\/(.+)$/);
        if (shortMatch) {
            return components[shortMatch[1]];
        }

        return undefined;
    }
}
