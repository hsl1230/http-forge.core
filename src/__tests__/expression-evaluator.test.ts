import { describe, expect, it } from 'vitest';
import { evaluateExpression, isExpression } from '../utils/expression-evaluator';

describe('expression evaluator safety and behavior', () => {
    it('evaluates supported expressions', () => {
        expect(evaluateExpression('price * qty', { price: 7, qty: 6 })).toBe(42);
        expect(evaluateExpression("status === 'active' ? 'yes' : 'no'", { status: 'active' })).toBe('yes');
        expect(evaluateExpression('name.toUpperCase()', { name: 'forge' })).toBe('FORGE');
    });

    it('does not expose process or require', () => {
        expect(evaluateExpression('process.env.NODE_ENV')).toBeUndefined();
        expect(evaluateExpression('require("fs")')).toBeUndefined();
        expect(evaluateExpression('typeof require')).toBe('undefined');
    });

    it('returns undefined for invalid expressions and timeout cases', () => {
        expect(evaluateExpression('this is not valid js')).toBeUndefined();
        expect(evaluateExpression('while (true) {}')).toBeUndefined();
    });

    it('does not mutate the caller variable map', () => {
        const variables = { value: 1 };
        expect(evaluateExpression('value = 2; value', variables)).toBe(2);
        expect(variables.value).toBe(1);
    });
});

describe('isExpression classifier', () => {
    it('identifies plain variable names as non-expressions', () => {
        expect(isExpression('token')).toBe(false);
        expect(isExpression('$timestamp')).toBe(false);
    });

    it('identifies javascript expressions correctly', () => {
        expect(isExpression('a + b')).toBe(true);
        expect(isExpression('status === "ok" ? 1 : 0')).toBe(true);
        expect(isExpression('Math.max(1, 2)')).toBe(true);
    });
});