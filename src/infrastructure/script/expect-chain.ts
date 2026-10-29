/**
 * Chai/Postman-compatible expect chain.
 *
 * Implements the full Chai BDD expect surface plus Postman-specific
 * extensions (`jsonSchema`). Organized by category for easy navigation.
 */

import { validateJsonSchema } from './json-schema-validator';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolvePathValue(target: any, path: string): { exists: boolean; value: any } {
    if (target === null || target === undefined) {
        return { exists: false, value: undefined };
    }

    if (!path) {
        return { exists: true, value: target };
    }

    const normalized = path
        .replace(/\[(\d+)\]/g, '.$1')
        .replace(/\[("([^"]*)"|'([^']*)')\]/g, '.$2')
        .replace(/^\./, '');

    const parts = normalized.split('.').filter(Boolean);
    let current = target;

    for (const part of parts) {
        if (current === null || current === undefined) {
            return { exists: false, value: undefined };
        }
        const key = /^\d+$/.test(part) ? Number(part) : part;
        if (!(key in Object(current))) {
            return { exists: false, value: undefined };
        }
        current = current[key as any];
    }

    return { exists: true, value: current };
}

// ---------------------------------------------------------------------------
// ExpectChain interface – organized by category
// ---------------------------------------------------------------------------

/**
 * Chai-style expect chain with Postman-compatible extensions.
 * Mirrors the full Chai BDD `expect(...)` surface.
 */
export interface ExpectChain {
    // ----- internal state (not meant to be used directly) -----
    _value: any;
    _negated: boolean;
    _deep: boolean;

    // ----- 1. Language-chain properties -----
    // Pure readability no-ops – return `this` without side-effects.
    to: ExpectChain;
    be: ExpectChain;
    been: ExpectChain;
    is: ExpectChain;
    that: ExpectChain;
    which: ExpectChain;
    and: ExpectChain;
    has: ExpectChain;
    have: ExpectChain;
    with: ExpectChain;
    at: ExpectChain;
    of: ExpectChain;
    same: ExpectChain;
    but: ExpectChain;
    does: ExpectChain;
    still: ExpectChain;
    also: ExpectChain;

    // ----- 2. Chain modifiers / flags -----
    // These change the behaviour of the assertion that follows.
    /** Negates the next assertion. */
    not: ExpectChain;
    /** Use deep (structural) equality in equal/include/members/keys/property. */
    deep: ExpectChain;
    /** Enable dot- and bracket-notation path resolution in property/include. */
    nested: ExpectChain;
    /** Restrict property/include to own (non-inherited) properties. */
    own: ExpectChain;
    /** Require members to appear in order. */
    ordered: ExpectChain;
    /** Require *any* of the given keys to be present (use with keys). */
    any: ExpectChain;
    /** Require *all* of the given keys to be present (default; use with keys). */
    all: ExpectChain;
    /** When asserting on a function, target the function itself rather than its prototype. */
    itself: ExpectChain;

    // ----- 3. Type / existence / state getters -----
    // Accessor-style assertions – evaluated on property access.
    ok: ExpectChain;
    "true": ExpectChain;
    "false": ExpectChain;
    "null": ExpectChain;
    "undefined": ExpectChain;
    "NaN": ExpectChain;
    exist: ExpectChain;
    exists: ExpectChain;
    empty: ExpectChain;
    "arguments": ExpectChain;
    "Arguments": ExpectChain;
    extensible: ExpectChain;
    sealed: ExpectChain;
    frozen: ExpectChain;
    finite: ExpectChain;

    // ----- 4. Core assertion methods -----
    // Equality
    equal(expected: any): ExpectChain;
    eq(expected: any): ExpectChain;
    equals(expected: any): ExpectChain;
    eql(expected: any): ExpectChain;
    eqls(expected: any): ExpectChain;

    // Membership / inclusion
    include(value: any): ExpectChain;
    includes(value: any): ExpectChain;
    contain(value: any): ExpectChain;
    contains(value: any): ExpectChain;
    oneOf(values: any[]): ExpectChain;

    // Object shape
    property(name: string, value?: any): ExpectChain;
    ownPropertyDescriptor(name: string, descriptor?: PropertyDescriptor): ExpectChain;
    haveOwnPropertyDescriptor(name: string, descriptor?: PropertyDescriptor): ExpectChain;
    keys(...args: any[]): ExpectChain;
    key(...args: any[]): ExpectChain;
    members(arr: any[]): ExpectChain;

    // String / pattern
    string(substr: string): ExpectChain;
    match(pattern: RegExp): ExpectChain;
    matches(pattern: RegExp): ExpectChain;

    // Type check
    a(type: string): ExpectChain;
    an(type: string): ExpectChain;

    // Size
    length(len: number): ExpectChain;
    lengthOf(len: number): ExpectChain;

    // Predicate
    satisfy(matcher: (value: any) => any): ExpectChain;
    satisfies(matcher: (value: any) => any): ExpectChain;

    // Postman-specific
    jsonSchema(schema: any): ExpectChain;

    // ----- 5. Numeric / range assertions -----
    above(num: number): ExpectChain;
    gt(num: number): ExpectChain;
    greaterThan(num: number): ExpectChain;

    least(num: number): ExpectChain;
    gte(num: number): ExpectChain;
    greaterThanOrEqual(num: number): ExpectChain;

    below(num: number): ExpectChain;
    lt(num: number): ExpectChain;
    lessThan(num: number): ExpectChain;

    most(num: number): ExpectChain;
    lte(num: number): ExpectChain;
    lessThanOrEqual(num: number): ExpectChain;

    within(start: number, end: number): ExpectChain;
    closeTo(expected: number, delta: number): ExpectChain;
    approximately(expected: number, delta: number): ExpectChain;

    // ----- 6. Instance / function behavior -----
    instanceOf(constructor: Function): ExpectChain;
    "instanceof"(constructor: Function): ExpectChain;

    "throw"(expected?: any): ExpectChain;
    throws(expected?: any): ExpectChain;
    "Throw"(expected?: any): ExpectChain;

    respondTo(method: string): ExpectChain;
    respondsTo(method: string): ExpectChain;

    // State-change assertions (must wrap a function)
    change(subject: any, prop?: string): ExpectChain;
    changes(subject: any, prop?: string): ExpectChain;
    increase(subject: any, prop?: string): ExpectChain;
    increases(subject: any, prop?: string): ExpectChain;
    decrease(subject: any, prop?: string): ExpectChain;
    decreases(subject: any, prop?: string): ExpectChain;
    /** Assert the magnitude of the preceding change/increase/decrease. */
    by(delta: number): ExpectChain;
}

// ---------------------------------------------------------------------------
// createExpectChain implementation – organized by category
// ---------------------------------------------------------------------------

export function createExpectChain(value: any): ExpectChain {
    const chain: any = {
        // ----------------------------------------------------------------
        // Internal state
        // ----------------------------------------------------------------
        _value: value,
        _negated: false,
        _deep: false,
        _nested: false,
        _own: false,
        _ordered: false,
        _any: false,
        _all: false,
        _itself: false,
        _lastDeltaAssertion: undefined as { kind: 'change' | 'increase' | 'decrease'; delta: number } | undefined,

        // ----------------------------------------------------------------
        // 1. Language-chain properties (no-ops for readability)
        // ----------------------------------------------------------------
        get to() { return this; },
        get be() { return this; },
        get been() { return this; },
        get is() { return this; },
        get that() { return this; },
        get which() { return this; },
        get and() { return this; },
        get has() { return this; },
        get have() { return this; },
        get with() { return this; },
        get at() { return this; },
        get of() { return this; },
        get same() { return this; },
        get but() { return this; },
        get does() { return this; },
        get still() { return this; },
        get also() { return this; },

        // ----------------------------------------------------------------
        // 2. Chain modifiers / flags
        // ----------------------------------------------------------------
        get not() { this._negated = !this._negated; return this; },
        get deep() { this._deep = true; return this; },
        get nested() { this._nested = true; return this; },
        get own() { this._own = true; return this; },
        get ordered() { this._ordered = true; return this; },
        get any() { this._any = true; this._all = false; return this; },
        get all() { this._all = true; this._any = false; return this; },
        get itself() { this._itself = true; return this; },

        // ----------------------------------------------------------------
        // Internal assertion helper
        // ----------------------------------------------------------------
        _assert(condition: boolean, message: string) {
            const result = this._negated ? !condition : condition;
            if (!result) { throw new Error(message); }
        },

        _readSubjectValue(subject: any, prop?: string) {
            if (prop !== undefined) {
                if (subject === null || subject === undefined) {
                    throw new Error(`Expected subject object for property "${prop}"`);
                }
                return subject[prop];
            }
            if (typeof subject !== 'function') {
                throw new Error('Expected subject to be a function when property is not provided');
            }
            return subject();
        },

        _resetModifiers() {
            this._nested = false;
            this._own = false;
            this._ordered = false;
            this._any = false;
            this._all = false;
            this._itself = false;
        },

        // ----------------------------------------------------------------
        // 3. Type / existence / state getters
        // ----------------------------------------------------------------
        get ok() {
            this._assert(Boolean(this._value),
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}be truthy`);
            return this;
        },
        get true() {
            this._assert(this._value === true,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}be true`);
            return this;
        },
        get false() {
            this._assert(this._value === false,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}be false`);
            return this;
        },
        get null() {
            this._assert(this._value === null,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}be null`);
            return this;
        },
        get undefined() {
            this._assert(this._value === undefined,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}be undefined`);
            return this;
        },
        get NaN() {
            this._assert(Number.isNaN(this._value),
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}be NaN`);
            return this;
        },
        get exist() {
            this._assert(this._value !== null && this._value !== undefined,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}exist`);
            return this;
        },
        get exists() { return this.exist; },
        get empty() {
            let isEmpty = false;
            if (this._value === null || this._value === undefined) {
                isEmpty = true;
            } else if (typeof this._value === 'string' || Array.isArray(this._value)) {
                isEmpty = this._value.length === 0;
            } else if (typeof this._value === 'object') {
                isEmpty = Object.keys(this._value).length === 0;
            }
            this._assert(isEmpty,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}be empty`);
            return this;
        },
        get arguments() {
            const isArguments = Object.prototype.toString.call(this._value) === '[object Arguments]';
            this._assert(isArguments,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}be arguments`);
            return this;
        },
        get Arguments() { return this.arguments; },
        get extensible() {
            const isExtensible = typeof this._value === 'object' && this._value !== null
                ? Object.isExtensible(this._value) : false;
            this._assert(isExtensible,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}be extensible`);
            return this;
        },
        get sealed() {
            const isSealed = typeof this._value === 'object' && this._value !== null
                ? Object.isSealed(this._value) : true;
            this._assert(isSealed,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}be sealed`);
            return this;
        },
        get frozen() {
            const isFrozen = typeof this._value === 'object' && this._value !== null
                ? Object.isFrozen(this._value) : true;
            this._assert(isFrozen,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}be frozen`);
            return this;
        },
        get finite() {
            const isFiniteNumber = typeof this._value === 'number' && Number.isFinite(this._value);
            this._assert(isFiniteNumber,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}be finite`);
            return this;
        },

        // ----------------------------------------------------------------
        // 4. Core assertion methods
        // ----------------------------------------------------------------

        // -- Equality --
        equal(expected: any) {
            if (this._deep) { this._deep = false; return this.eql(expected); }
            this._assert(this._value === expected,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}equal ${JSON.stringify(expected)}`);
            return this;
        },
        eq(expected: any) { return this.equal(expected); },
        equals(expected: any) { return this.equal(expected); },
        eql(expected: any) {
            this._assert(JSON.stringify(this._value) === JSON.stringify(expected),
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}deeply equal ${JSON.stringify(expected)}`);
            return this;
        },
        eqls(expected: any) { return this.eql(expected); },

        // -- Membership / inclusion --
        include(value: any) {
            let includes = false;
            if (typeof this._value === 'string') {
                includes = this._value.includes(value);
            } else if (Array.isArray(this._value)) {
                includes = this._value.includes(value);
            } else if (typeof this._value === 'object' && this._value !== null) {
                includes = value in this._value;
            }
            this._assert(includes,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}include ${JSON.stringify(value)}`);
            return this;
        },
        includes(value: any) { return this.include(value); },
        contain(value: any) { return this.include(value); },
        contains(value: any) { return this.include(value); },
        oneOf(values: any[]) {
            this._assert(Array.isArray(values) && values.includes(this._value),
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}be one of ${JSON.stringify(values)}`);
            return this;
        },

        // -- Object shape --
        property(name: string, value?: any) {
            const useDeepPath = this._deep || this._nested;
            const useOwn = this._own;
            if (useDeepPath && useOwn) {
                throw new Error('Cannot combine own and nested/deep for property assertion');
            }
            this._deep = false;
            const resolved = useDeepPath
                ? resolvePathValue(this._value, name)
                : useOwn
                    ? {
                        exists: typeof this._value === 'object' && this._value !== null &&
                            Object.prototype.hasOwnProperty.call(this._value, name),
                        value: this._value?.[name]
                    }
                    : {
                        exists: typeof this._value === 'object' && this._value !== null && name in this._value,
                        value: this._value?.[name]
                    };
            if (value !== undefined) {
                this._assert(resolved.exists && resolved.value === value,
                    `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}have property "${name}" with value ${JSON.stringify(value)}`);
            } else {
                this._assert(resolved.exists,
                    `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}have property "${name}"`);
            }
            this._resetModifiers();
            return this;
        },
        ownPropertyDescriptor(name: string, descriptor?: PropertyDescriptor) {
            const valueObject = this._value === null || this._value === undefined
                ? undefined : Object(this._value);
            const actualDescriptor = valueObject
                ? Object.getOwnPropertyDescriptor(valueObject, name) : undefined;
            let isMatch = actualDescriptor !== undefined;
            if (isMatch && descriptor !== undefined) {
                isMatch = Object.entries(descriptor).every(([key, expectedValue]) =>
                    (actualDescriptor as any)[key] === expectedValue);
            }
            this._assert(isMatch,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}have own property descriptor "${name}"`);
            return this;
        },
        haveOwnPropertyDescriptor(name: string, descriptor?: PropertyDescriptor) {
            return this.ownPropertyDescriptor(name, descriptor);
        },
        keys(...args: any[]) {
            const expectedKeys: string[] = Array.isArray(args[0]) ? args[0] : args;
            const actualKeys = Object.keys(this._value || {});
            const hasAll = expectedKeys.every((k: string) => actualKeys.includes(k));
            const hasAny = expectedKeys.some((k: string) => actualKeys.includes(k));
            const shouldUseAny = this._any && !this._all;
            this._assert(shouldUseAny ? hasAny : hasAll,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}have keys ${JSON.stringify(expectedKeys)}`);
            this._resetModifiers();
            return this;
        },
        key(...args: any[]) { return this.keys(...args); },
        members(expected: any[]) {
            const arr = this._value;
            const hasAll = Array.isArray(arr) && Array.isArray(expected) &&
                expected.every((item: any) => arr.some((a: any) => JSON.stringify(a) === JSON.stringify(item)));
            const hasOrdered = Array.isArray(arr) && Array.isArray(expected) &&
                expected.every((item: any, idx: number) => JSON.stringify(arr[idx]) === JSON.stringify(item));
            this._assert(this._ordered ? hasOrdered : hasAll,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}have members ${JSON.stringify(expected)}`);
            this._resetModifiers();
            return this;
        },

        // -- String / pattern --
        string(substr: string) {
            this._assert(typeof this._value === 'string' && this._value.includes(substr),
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}contain string "${substr}"`);
            return this;
        },
        match(pattern: RegExp) {
            this._assert(pattern.test(String(this._value)),
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}match ${pattern}`);
            return this;
        },
        matches(pattern: RegExp) { return this.match(pattern); },

        // -- Type check --
        a(type: string) {
            const actualType = Array.isArray(this._value) ? 'array' : typeof this._value;
            this._assert(actualType === type.toLowerCase(),
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}be a(n) ${type} (got ${actualType})`);
            return this;
        },
        an(type: string) { return this.a(type); },

        // -- Size --
        length(len: number) {
            const actualLen = Array.isArray(this._value) || typeof this._value === 'string'
                ? this._value.length
                : Object.keys(this._value || {}).length;
            this._assert(actualLen === len,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}have length ${len}`);
            return this;
        },
        lengthOf(len: number) { return this.length(len); },

        // -- Predicate --
        satisfy(matcher: (value: any) => any) {
            this._assert(Boolean(matcher(this._value)),
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}satisfy matcher`);
            return this;
        },
        satisfies(matcher: (value: any) => any) { return this.satisfy(matcher); },

        // -- Postman-specific --
        jsonSchema(schema: any) {
            let valueToValidate = this._value;
            if (typeof valueToValidate === 'string') {
                try {
                    valueToValidate = JSON.parse(valueToValidate);
                } catch {
                    throw new Error('Expected value to be valid JSON before JSON schema validation');
                }
            }
            const schemaErrors = validateJsonSchema(valueToValidate, schema);
            this._assert(schemaErrors.length === 0,
                `Expected value to ${this._negated ? 'not ' : ''}match JSON schema:\n  - ${schemaErrors.join('\n  - ')}`);
            return this;
        },

        // ----------------------------------------------------------------
        // 5. Numeric / range assertions
        // ----------------------------------------------------------------
        above(num: number) {
            this._assert(Number(this._value) > num,
                `Expected ${this._value} to ${this._negated ? 'not ' : ''}be above ${num}`);
            return this;
        },
        gt(num: number) { return this.above(num); },
        greaterThan(num: number) { return this.above(num); },

        least(num: number) {
            this._assert(Number(this._value) >= num,
                `Expected ${this._value} to ${this._negated ? 'not ' : ''}be at least ${num}`);
            return this;
        },
        gte(num: number) { return this.least(num); },
        greaterThanOrEqual(num: number) { return this.least(num); },

        below(num: number) {
            this._assert(Number(this._value) < num,
                `Expected ${this._value} to ${this._negated ? 'not ' : ''}be below ${num}`);
            return this;
        },
        lt(num: number) { return this.below(num); },
        lessThan(num: number) { return this.below(num); },

        most(num: number) {
            this._assert(Number(this._value) <= num,
                `Expected ${this._value} to ${this._negated ? 'not ' : ''}be at most ${num}`);
            return this;
        },
        lte(num: number) { return this.most(num); },
        lessThanOrEqual(num: number) { return this.most(num); },

        within(start: number, end: number) {
            this._assert(Number(this._value) >= start && Number(this._value) <= end,
                `Expected ${this._value} to ${this._negated ? 'not ' : ''}be within ${start}..${end}`);
            return this;
        },
        closeTo(expected: number, delta: number) {
            this._assert(Math.abs(Number(this._value) - expected) <= delta,
                `Expected ${this._value} to ${this._negated ? 'not ' : ''}be within ${delta} of ${expected}`);
            return this;
        },
        approximately(expected: number, delta: number) { return this.closeTo(expected, delta); },

        // ----------------------------------------------------------------
        // 6. Instance / function behavior
        // ----------------------------------------------------------------
        instanceOf(constructor: Function) {
            this._assert(this._value instanceof constructor,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}be an instance of ${constructor?.name || 'provided constructor'}`);
            return this;
        },
        ['instanceof'](constructor: Function) { return this.instanceOf(constructor); },

        ['throw'](expected?: any) {
            if (typeof this._value !== 'function') {
                throw new Error(`Expected ${JSON.stringify(this._value)} to be a function`);
            }
            let thrown: any;
            try { this._value(); } catch (error) { thrown = error; }
            const didThrow = thrown !== undefined;
            let matches = didThrow;
            if (matches && expected !== undefined) {
                const message = thrown?.message ?? String(thrown);
                if (typeof expected === 'string') { matches = message.includes(expected); }
                else if (expected instanceof RegExp) { matches = expected.test(message); }
                else if (typeof expected === 'function') { matches = thrown instanceof expected; }
            }
            this._assert(matches,
                `Expected ${this._value} to ${this._negated ? 'not ' : ''}throw${expected !== undefined ? ` ${expected}` : ''}`);
            return this;
        },
        throws(expected?: any) { return this['throw'](expected); },
        Throw(expected?: any) { return this['throw'](expected); },

        respondTo(method: string) {
            const target = this._value;
            let hasMethod = false;
            if (typeof target === 'function') {
                hasMethod = this._itself
                    ? typeof target[method] === 'function'
                    : typeof target.prototype?.[method] === 'function';
            } else if (target !== null && target !== undefined) {
                hasMethod = typeof target[method] === 'function';
            }
            this._assert(hasMethod,
                `Expected ${JSON.stringify(this._value)} to ${this._negated ? 'not ' : ''}respond to "${method}"`);
            this._resetModifiers();
            return this;
        },
        respondsTo(method: string) { return this.respondTo(method); },

        change(subject: any, prop?: string) {
            if (typeof this._value !== 'function') {
                throw new Error(`Expected ${JSON.stringify(this._value)} to be a function`);
            }
            const before = this._readSubjectValue(subject, prop);
            this._value();
            const after = this._readSubjectValue(subject, prop);
            const beforeNumber = Number(before);
            const afterNumber = Number(after);
            const delta = Number.isFinite(beforeNumber) && Number.isFinite(afterNumber)
                ? Math.abs(afterNumber - beforeNumber) : Number.NaN;
            this._lastDeltaAssertion = { kind: 'change', delta };
            this._assert(before !== after,
                `Expected ${this._value} to ${this._negated ? 'not ' : ''}change${prop ? ` property "${prop}"` : ''}`);
            return this;
        },
        changes(subject: any, prop?: string) { return this.change(subject, prop); },

        increase(subject: any, prop?: string) {
            if (typeof this._value !== 'function') {
                throw new Error(`Expected ${JSON.stringify(this._value)} to be a function`);
            }
            const before = Number(this._readSubjectValue(subject, prop));
            this._value();
            const after = Number(this._readSubjectValue(subject, prop));
            this._lastDeltaAssertion = { kind: 'increase', delta: after - before };
            this._assert(Number.isFinite(before) && Number.isFinite(after) && after > before,
                `Expected ${this._value} to ${this._negated ? 'not ' : ''}increase${prop ? ` property "${prop}"` : ''}`);
            return this;
        },
        increases(subject: any, prop?: string) { return this.increase(subject, prop); },

        decrease(subject: any, prop?: string) {
            if (typeof this._value !== 'function') {
                throw new Error(`Expected ${JSON.stringify(this._value)} to be a function`);
            }
            const before = Number(this._readSubjectValue(subject, prop));
            this._value();
            const after = Number(this._readSubjectValue(subject, prop));
            this._lastDeltaAssertion = { kind: 'decrease', delta: before - after };
            this._assert(Number.isFinite(before) && Number.isFinite(after) && after < before,
                `Expected ${this._value} to ${this._negated ? 'not ' : ''}decrease${prop ? ` property "${prop}"` : ''}`);
            return this;
        },
        decreases(subject: any, prop?: string) { return this.decrease(subject, prop); },

        /** Assert the magnitude of the preceding change/increase/decrease. */
        by(delta: number) {
            if (!this._lastDeltaAssertion) {
                throw new Error('Expected .by() to follow .change(), .increase(), or .decrease()');
            }
            const actualDelta = this._lastDeltaAssertion.delta;
            this._assert(Number.isFinite(actualDelta) && actualDelta === delta,
                `Expected previous ${this._lastDeltaAssertion.kind} assertion to ${this._negated ? 'not ' : ''}change by ${delta} (actual ${actualDelta})`);
            return this;
        },
    };

    return chain;
}
