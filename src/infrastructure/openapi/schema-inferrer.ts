/**
 * Schema Inferrer
 * 
 * Core utility that generates JSON Schema (OAS 3.0 compatible) from sample JSON values.
 * Supports recursive inference, format detection, schema merging, and nullable semantics.
 */

import { JSONSchema7 } from '../../types/types';
import { widenNumericType } from './openapi-utils';

// Format detection patterns
const DATE_TIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const URI_REGEX = /^https?:\/\/[^\s]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
const IPV6_REGEX = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

export class SchemaInferrer {

    /**
     * Infer a JSON Schema from a sample value.
     * Recursively walks objects and arrays.
     * Uses OAS 3.0 nullable semantics (nullable: true instead of type array).
     */
    inferFromValue(value: any): JSONSchema7 {
        if (value === null || value === undefined) {
            return { nullable: true };
        }

        if (Array.isArray(value)) {
            return this.inferArraySchema(value);
        }

        switch (typeof value) {
            case 'string':
                return this.inferStringSchema(value);
            case 'number':
                return Number.isInteger(value)
                    ? { type: 'integer' }
                    : { type: 'number' };
            case 'boolean':
                return { type: 'boolean' };
            case 'object':
                return this.inferObjectSchema(value);
            default:
                return {};
        }
    }

    /**
     * Merge two schemas — broadens types, unions properties.
     * Used when aggregating multiple response samples.
     */
    mergeSchemas(a: JSONSchema7, b: JSONSchema7): JSONSchema7 {
        if (!a || Object.keys(a).length === 0) { return { ...b }; }
        if (!b || Object.keys(b).length === 0) { return { ...a }; }

        const nullable = a.nullable || b.nullable;

        if (!a.type && a.nullable) {
            return { ...b, nullable: true };
        }
        if (!b.type && b.nullable) {
            return { ...a, nullable: true };
        }

        if (a.type !== b.type) {
            const widened = widenNumericType(a.type as string | undefined, b.type as string | undefined);
            if (widened) {
                return { type: widened, ...(nullable && { nullable: true }) };
            }
            return { ...(nullable && { nullable: true }) };
        }

        const merged: JSONSchema7 = { type: a.type };
        if (nullable) {
            merged.nullable = true;
        }

        if (a.type === 'object' && b.type === 'object') {
            return this.mergeObjectSchemas(a, b, nullable);
        }

        if (a.type === 'array' && b.type === 'array') {
            return this.mergeArraySchemas(a, b, nullable);
        }

        if (a.format && a.format === b.format) {
            merged.format = a.format;
        }

        return merged;
    }

    private inferStringFormat(value: string): string | undefined {
        if (DATE_TIME_REGEX.test(value)) { return 'date-time'; }
        if (DATE_REGEX.test(value)) { return 'date'; }
        if (EMAIL_REGEX.test(value)) { return 'email'; }
        if (UUID_REGEX.test(value)) { return 'uuid'; }
        if (URI_REGEX.test(value)) { return 'uri'; }
        if (IPV4_REGEX.test(value)) { return 'ipv4'; }
        if (IPV6_REGEX.test(value)) { return 'ipv6'; }
        return undefined;
    }

    private inferStringSchema(value: string): JSONSchema7 {
        const schema: JSONSchema7 = { type: 'string' };
        const format = this.inferStringFormat(value);
        if (format) {
            schema.format = format;
        }
        return schema;
    }

    private inferArraySchema(value: any[]): JSONSchema7 {
        const schema: JSONSchema7 = { type: 'array' };
        if (value.length === 0) {
            return schema;
        }

        let itemsSchema = this.inferFromValue(value[0]);
        for (let i = 1; i < value.length; i++) {
            itemsSchema = this.mergeSchemas(itemsSchema, this.inferFromValue(value[i]));
        }
        schema.items = itemsSchema;
        return schema;
    }

    private inferObjectSchema(value: Record<string, any>): JSONSchema7 {
        const schema: JSONSchema7 = {
            type: 'object',
            properties: {}
        };

        const keys = Object.keys(value);
        for (const key of keys) {
            schema.properties[key] = this.inferFromValue(value[key]);
        }

        return schema;
    }

    private mergeObjectSchemas(a: JSONSchema7, b: JSONSchema7, nullable: boolean | undefined): JSONSchema7 {
        const merged: JSONSchema7 = {
            type: 'object',
            properties: {},
            ...(nullable && { nullable: true })
        };

        const aProps = a.properties || {};
        const bProps = b.properties || {};
        const allKeys = new Set([...Object.keys(aProps), ...Object.keys(bProps)]);

        for (const key of allKeys) {
            if (aProps[key] && bProps[key]) {
                merged.properties[key] = this.mergeSchemas(aProps[key], bProps[key]);
            } else if (aProps[key]) {
                merged.properties[key] = { ...aProps[key] };
            } else {
                merged.properties[key] = { ...bProps[key] };
            }
        }

        const aRequired = new Set(a.required || Object.keys(aProps));
        const bRequired = new Set(b.required || Object.keys(bProps));
        const required = [...allKeys].filter(k => aRequired.has(k) && bRequired.has(k));
        if (required.length > 0) {
            merged.required = required;
        }

        return merged;
    }

    private mergeArraySchemas(a: JSONSchema7, b: JSONSchema7, nullable: boolean | undefined): JSONSchema7 {
        const merged: JSONSchema7 = {
            type: 'array',
            ...(nullable && { nullable: true })
        };

        if (a.items && b.items) {
            merged.items = this.mergeSchemas(a.items, b.items);
        } else if (a.items) {
            merged.items = { ...a.items };
        } else if (b.items) {
            merged.items = { ...b.items };
        }

        return merged;
    }
}
