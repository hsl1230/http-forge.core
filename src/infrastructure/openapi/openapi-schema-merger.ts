/**
 * OpenAPI export — colliding-schema merge strategy.
 *
 * When two collection requests share the same path+method (variants), their
 * parameter/operation schemas can conflict. This class owns that reconciliation:
 *
 * - Same constraint kind (both enum, both pattern, both numeric range, ...) → merge in place
 * - Different constraint kinds → wrap each variant in `oneOf`
 * - Types widen (integer → number), descriptions and examples accumulate
 *
 * Stateless: every method is pure with respect to its arguments (mutating only
 * the `existing` object it is asked to reconcile).
 */
import { widenNumericType } from './openapi-utils';

export class OpenApiSchemaMerger {
    /**
     * Merge a new operation into an existing one at the same path+method.
     * - Parameters: union enum values for same-name params; append new params
     * - Description: append the variant name
     * - Tags: union
     * - Responses: merge (new status codes added, existing kept)
     */
    mergeOperation(existing: any, incoming: any, incomingName: string): void {
        // Merge descriptions — append variant info
        if (incoming.summary && incoming.summary !== existing.summary) {
            existing.description = (existing.description || existing.summary || '')
                + `\n\nVariant: **${incomingName}**`
                + (incoming.description ? ` — ${incoming.description}` : '');
        }

        // Merge tags (union)
        if (incoming.tags) {
            const tagSet = new Set<string>(existing.tags || []);
            for (const t of incoming.tags) { tagSet.add(t); }
            existing.tags = [...tagSet];
        }

        // Merge parameters — union constraints for matching params, add new ones
        if (incoming.parameters) {
            if (!existing.parameters) {
                existing.parameters = [];
            }
            for (const inParam of incoming.parameters) {
                const match = existing.parameters.find(
                    (p: any) => p.name === inParam.name && p.in === inParam.in
                );
                if (match) {
                    this.mergeParameterSchema(match, inParam, incomingName);
                } else {
                    // New parameter not in existing — add it
                    existing.parameters.push(inParam);
                }
            }
        }

        // Merge responses (add status codes that don't exist yet)
        if (incoming.responses) {
            if (!existing.responses) { existing.responses = {}; }
            for (const [status, def] of Object.entries(incoming.responses)) {
                if (!existing.responses[status]) {
                    existing.responses[status] = def;
                }
            }
        }

        // Merge request body (keep existing; add content types from incoming if missing)
        if (incoming.requestBody?.content && existing.requestBody?.content) {
            for (const [ct, mediaObj] of Object.entries(incoming.requestBody.content)) {
                if (!existing.requestBody.content[ct]) {
                    existing.requestBody.content[ct] = mediaObj;
                }
            }
        } else if (incoming.requestBody && !existing.requestBody) {
            existing.requestBody = incoming.requestBody;
        }
    }

    /**
     * Merge parameter schemas when the same parameter appears in colliding operations.
     *
     * Strategy: if both variants use the SAME constraint kind (both enum, both pattern,
     * both numeric range, etc.) they are merged in-place (union enum, widen range, etc.).
     * If they use DIFFERENT constraint kinds the schemas are incompatible,
     * so we wrap them in `oneOf` — each variant keeps its own self-consistent schema.
     *
     * Description and examples are always accumulated.
     */
    mergeParameterSchema(existing: any, incoming: any, variantName: string): void {
        if (!existing.schema) { existing.schema = {}; }
        const es = existing.schema;
        const is = incoming.schema || {};

        // Determine constraint "kind" for each schema
        const existingKind = this.getConstraintKind(es);
        const incomingKind = this.getConstraintKind(is);

        if (existingKind === 'none' && incomingKind === 'none') {
            // Neither has constraints — just widen type if needed
            this.widenType(es, is);
        } else if (existingKind === 'none') {
            // Existing has no constraints — adopt incoming's constraints
            Object.assign(es, this.extractConstraints(is));
            this.widenType(es, is);
        } else if (incomingKind === 'none') {
            // Incoming has no constraints — keep existing as-is, widen type
            this.widenType(es, is);
        } else if (existingKind === incomingKind) {
            // Same constraint kind — merge in place
            this.mergeSameKindConstraints(es, is, existingKind);
            this.widenType(es, is);
        } else {
            // Different constraint kinds — wrap in oneOf
            if (es.oneOf) {
                // Already using oneOf — append the incoming schema
                const incomingVariant = this.buildVariantSchema(is);
                if (!es.oneOf.some((o: any) => JSON.stringify(o) === JSON.stringify(incomingVariant))) {
                    es.oneOf.push(incomingVariant);
                }
            } else if (is.oneOf) {
                // Incoming already has oneOf — wrap existing as a variant and flatten
                const existingVariant = this.buildVariantSchema(es);
                es.oneOf = [existingVariant, ...is.oneOf];
            } else {
                // Convert both simple schemas to oneOf variants
                const existingVariant = this.buildVariantSchema(es);
                const incomingVariant = this.buildVariantSchema(is);
                es.oneOf = [existingVariant, incomingVariant];
            }
            // Always strip top-level constraints — they now live inside oneOf variants
            this.stripConstraints(es);
        }

        // --- description: append variant info ---
        if (incoming.description && incoming.description !== existing.description) {
            existing.description = (existing.description || '')
                + (existing.description ? '; ' : '')
                + incoming.description;
        }

        // --- examples: accumulate as named variants ---
        if (incoming.example !== undefined && incoming.example !== existing.example) {
            if (!existing.examples) {
                existing.examples = {};
                if (existing.example !== undefined) {
                    existing.examples['variant1'] = { value: existing.example };
                }
            }
            const safeKey = `variant_${variantName.replace(/[^a-zA-Z0-9_]/g, '_')}`;
            existing.examples[safeKey] = { value: incoming.example };
            delete existing.example;
        }
    }

    /** Identify the primary constraint kind of a schema. */
    getConstraintKind(schema: any): 'enum' | 'pattern' | 'range' | 'length' | 'format' | 'oneOf' | 'array' | 'none' {
        if (schema.oneOf) { return 'oneOf'; }
        if (schema.enum && schema.enum.length > 0) { return 'enum'; }
        if (schema.pattern) { return 'pattern'; }
        if (schema.minimum !== undefined || schema.maximum !== undefined ||
            schema.exclusiveMinimum !== undefined || schema.exclusiveMaximum !== undefined ||
            schema.multipleOf !== undefined) { return 'range'; }
        if (schema.minLength !== undefined || schema.maxLength !== undefined) { return 'length'; }
        if (schema.minItems !== undefined || schema.maxItems !== undefined || schema.uniqueItems) { return 'array'; }
        if (schema.format) { return 'format'; }
        return 'none';
    }

    /** Merge constraints when both schemas use the same kind. */
    mergeSameKindConstraints(es: any, is: any, kind: string): void {
        switch (kind) {
            case 'enum': {
                const merged = new Set(es.enum || []);
                for (const v of (is.enum || [])) { merged.add(v); }
                es.enum = [...merged];
                break;
            }
            case 'pattern': {
                if (is.pattern && is.pattern !== es.pattern) {
                    es.pattern = `(?:${es.pattern})|(?:${is.pattern})`;
                }
                break;
            }
            case 'range': {
                if (is.minimum !== undefined) {
                    es.minimum = es.minimum !== undefined ? Math.min(es.minimum, is.minimum) : is.minimum;
                }
                if (is.maximum !== undefined) {
                    es.maximum = es.maximum !== undefined ? Math.max(es.maximum, is.maximum) : is.maximum;
                }
                // OpenAPI 3.0: exclusiveMinimum/Maximum are booleans — merge with OR
                if (is.exclusiveMinimum) { es.exclusiveMinimum = true; }
                if (is.exclusiveMaximum) { es.exclusiveMaximum = true; }
                if (is.multipleOf !== undefined) {
                    es.multipleOf = es.multipleOf !== undefined
                        ? Math.min(es.multipleOf, is.multipleOf) : is.multipleOf;
                }
                break;
            }
            case 'length': {
                if (is.minLength !== undefined) {
                    es.minLength = es.minLength !== undefined ? Math.min(es.minLength, is.minLength) : is.minLength;
                }
                if (is.maxLength !== undefined) {
                    es.maxLength = es.maxLength !== undefined ? Math.max(es.maxLength, is.maxLength) : is.maxLength;
                }
                break;
            }
            case 'array': {
                if (is.minItems !== undefined) {
                    es.minItems = es.minItems !== undefined ? Math.min(es.minItems, is.minItems) : is.minItems;
                }
                if (is.maxItems !== undefined) {
                    es.maxItems = es.maxItems !== undefined ? Math.max(es.maxItems, is.maxItems) : is.maxItems;
                }
                if (is.uniqueItems) { es.uniqueItems = true; }
                break;
            }
            case 'format': {
                if (is.format && is.format !== es.format) {
                    // Different formats — convert to oneOf
                    const existingVariant = { type: es.type || 'string', format: es.format };
                    const incomingVariant = { type: is.type || 'string', format: is.format };
                    delete es.format;
                    es.oneOf = [existingVariant, incomingVariant];
                }
                break;
            }
            case 'oneOf': {
                // Append incoming oneOf entries to existing
                if (is.oneOf) {
                    for (const variant of is.oneOf) {
                        if (!es.oneOf.some((o: any) => JSON.stringify(o) === JSON.stringify(variant))) {
                            es.oneOf.push(variant);
                        }
                    }
                }
                break;
            }
        }
    }

    /** Build a self-contained variant schema from constraint properties. */
    buildVariantSchema(schema: any): any {
        const variant: any = {};
        if (schema.type) { variant.type = schema.type; }
        if (schema.enum) { variant.enum = [...schema.enum]; }
        if (schema.pattern) { variant.pattern = schema.pattern; }
        if (schema.format) { variant.format = schema.format; }
        if (schema.minimum !== undefined) { variant.minimum = schema.minimum; }
        if (schema.maximum !== undefined) { variant.maximum = schema.maximum; }
        if (schema.exclusiveMinimum !== undefined) { variant.exclusiveMinimum = schema.exclusiveMinimum; }
        if (schema.exclusiveMaximum !== undefined) { variant.exclusiveMaximum = schema.exclusiveMaximum; }
        if (schema.multipleOf !== undefined) { variant.multipleOf = schema.multipleOf; }
        if (schema.minLength !== undefined) { variant.minLength = schema.minLength; }
        if (schema.maxLength !== undefined) { variant.maxLength = schema.maxLength; }
        if (schema.minItems !== undefined) { variant.minItems = schema.minItems; }
        if (schema.maxItems !== undefined) { variant.maxItems = schema.maxItems; }
        if (schema.uniqueItems) { variant.uniqueItems = true; }
        if (schema.nullable) { variant.nullable = true; }
        return variant;
    }

    /** Remove constraint properties from a schema (keeps type, oneOf, etc.). */
    stripConstraints(schema: any): void {
        delete schema.enum;
        delete schema.pattern;
        delete schema.format;
        delete schema.minimum;
        delete schema.maximum;
        delete schema.exclusiveMinimum;
        delete schema.exclusiveMaximum;
        delete schema.multipleOf;
        delete schema.minLength;
        delete schema.maxLength;
        delete schema.minItems;
        delete schema.maxItems;
        delete schema.uniqueItems;
        delete schema.nullable;
    }

    /** Extract constraint properties from a schema into a new object. */
    extractConstraints(schema: any): any {
        const c: any = {};
        if (schema.enum) { c.enum = [...schema.enum]; }
        if (schema.pattern) { c.pattern = schema.pattern; }
        if (schema.format) { c.format = schema.format; }
        if (schema.minimum !== undefined) { c.minimum = schema.minimum; }
        if (schema.maximum !== undefined) { c.maximum = schema.maximum; }
        if (schema.exclusiveMinimum !== undefined) { c.exclusiveMinimum = schema.exclusiveMinimum; }
        if (schema.exclusiveMaximum !== undefined) { c.exclusiveMaximum = schema.exclusiveMaximum; }
        if (schema.multipleOf !== undefined) { c.multipleOf = schema.multipleOf; }
        if (schema.minLength !== undefined) { c.minLength = schema.minLength; }
        if (schema.maxLength !== undefined) { c.maxLength = schema.maxLength; }
        if (schema.minItems !== undefined) { c.minItems = schema.minItems; }
        if (schema.maxItems !== undefined) { c.maxItems = schema.maxItems; }
        if (schema.uniqueItems) { c.uniqueItems = true; }
        if (schema.nullable) { c.nullable = true; }
        return c;
    }

    /** Widen the type field if the incoming type differs. */
    widenType(es: any, is: any): void {
        if (!is.type || is.type === es.type) { return; }
        if (!es.type) {
            es.type = is.type;
        } else {
            const widened = widenNumericType(es.type, is.type);
            if (widened) { es.type = widened; }
        }
        // For other incompatible types, the oneOf handling above covers it
    }
}
