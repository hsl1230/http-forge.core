/**
 * Minimal, dependency-free JSON Schema validator.
 *
 * Supports the common subset used in API tests (draft-04 style):
 * `type`, `properties`, `required`, `items`, `enum`, `additionalProperties`
 * (boolean), `minimum`/`maximum`, `minLength`/`maxLength`, and `pattern`.
 * Returns a list of human-readable error strings (empty when valid).
 */
export function validateJsonSchema(data: any, schema: any, path = '$'): string[] {
    const errors: string[] = [];
    if (schema === null || typeof schema !== 'object') {
        return errors;
    }

    const jsonType = (value: any): string => {
        if (value === null) return 'null';
        if (Array.isArray(value)) return 'array';
        if (Number.isInteger(value)) return 'integer';
        return typeof value;
    };

    if (schema.type !== undefined) {
        const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
        const actual = jsonType(data);
        const matches = expected.some((t: string) =>
            t === actual || (t === 'number' && actual === 'integer'));
        if (!matches) {
            errors.push(`${path}: expected type ${expected.join('|')} but got ${actual}`);
            return errors;
        }
    }

    if (Array.isArray(schema.enum) && !schema.enum.some((e: any) => JSON.stringify(e) === JSON.stringify(data))) {
        errors.push(`${path}: value ${JSON.stringify(data)} is not in enum ${JSON.stringify(schema.enum)}`);
    }

    if (typeof data === 'number') {
        if (typeof schema.minimum === 'number' && data < schema.minimum) {
            errors.push(`${path}: ${data} is below minimum ${schema.minimum}`);
        }
        if (typeof schema.maximum === 'number' && data > schema.maximum) {
            errors.push(`${path}: ${data} is above maximum ${schema.maximum}`);
        }
    }

    if (typeof data === 'string') {
        if (typeof schema.minLength === 'number' && data.length < schema.minLength) {
            errors.push(`${path}: string length ${data.length} is below minLength ${schema.minLength}`);
        }
        if (typeof schema.maxLength === 'number' && data.length > schema.maxLength) {
            errors.push(`${path}: string length ${data.length} is above maxLength ${schema.maxLength}`);
        }
        if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(data)) {
            errors.push(`${path}: string does not match pattern ${schema.pattern}`);
        }
    }

    if (jsonType(data) === 'object') {
        if (Array.isArray(schema.required)) {
            for (const key of schema.required) {
                if (!(key in data)) {
                    errors.push(`${path}: missing required property "${key}"`);
                }
            }
        }
        if (schema.properties && typeof schema.properties === 'object') {
            for (const [key, propSchema] of Object.entries(schema.properties)) {
                if (key in data) {
                    errors.push(...validateJsonSchema(data[key], propSchema, `${path}.${key}`));
                }
            }
        }
        if (schema.additionalProperties === false && schema.properties) {
            const allowed = new Set(Object.keys(schema.properties));
            for (const key of Object.keys(data)) {
                if (!allowed.has(key)) {
                    errors.push(`${path}: additional property "${key}" is not allowed`);
                }
            }
        }
    }

    if (Array.isArray(data) && schema.items && typeof schema.items === 'object') {
        data.forEach((item, index) => {
            errors.push(...validateJsonSchema(item, schema.items, `${path}[${index}]`));
        });
    }

    return errors;
}
