/// <reference types="node" />

/**
 * Postman Compatibility Shim Tests
 *
 * Covers the parity additions from the compatibility matrix gap mitigation:
 * - expect `.contain()` alias
 * - response `to.have.jsonSchema(schema)` assertion + validateJsonSchema
 * - pm.test.skip / pm.test.fail / pm.test.index helpers
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { CollectionService } from '../infrastructure/collection/collection-service';
import { ConfigService } from '../infrastructure/config/config-service';
import { ForgeEnv } from '../infrastructure/environment/forge-env';
import { CollectionRequestExecutor } from '../infrastructure/execution/collection-request-executor';
import { RequestExecutor } from '../infrastructure/execution/request-executor';
import { FetchHttpClient } from '../infrastructure/http/fetch-http-client';
import { RequestPreprocessor } from '../infrastructure/http/request-preprocessor';
import { parsePostmanEnvironment } from '../infrastructure/import-export/import-postman-environment';
import type { ResponseContext } from '../infrastructure/script/interfaces';
import {
    createExpectChain,
    createResponseObject,
    validateJsonSchema,
} from '../infrastructure/script/script-factories';
import { concatenateScripts, createTestFunction } from '../infrastructure/script/script-utils';
import type { Collection } from '../types/collection';
import type { TestAssertion } from '../types/types';

const CHAI_EXPECT_LANGUAGE_CHAINS = [
    'to',
    'be',
    'been',
    'is',
    'that',
    'which',
    'and',
    'has',
    'have',
    'with',
    'at',
    'of',
    'same',
    'but',
    'does',
    'still',
    'also',
] as const;

const CHAI_EXPECT_CHAIN_MODIFIERS = [
    'not',
    'deep',
    'nested',
    'own',
    'ordered',
    'any',
    'all',
    'itself',
] as const;

const CHAI_EXPECT_GETTER_ASSERTIONS = [
    'ok',
    'true',
    'false',
    'null',
    'undefined',
    'NaN',
    'exist',
    'exists',
    'empty',
    'arguments',
    'Arguments',
    'extensible',
    'sealed',
    'frozen',
    'finite',
] as const;

const CHAI_EXPECT_METHOD_ASSERTIONS = [
    'a',
    'an',
    'equal',
    'eq',
    'equals',
    'eql',
    'eqls',
    'include',
    'includes',
    'contain',
    'contains',
    'property',
    'ownPropertyDescriptor',
    'haveOwnPropertyDescriptor',
    'length',
    'lengthOf',
    'match',
    'matches',
    'string',
    'keys',
    'key',
    'throw',
    'throws',
    'Throw',
    'respondTo',
    'respondsTo',
    'satisfy',
    'satisfies',
    'closeTo',
    'approximately',
    'members',
    'oneOf',
    'above',
    'gt',
    'greaterThan',
    'least',
    'gte',
    'greaterThanOrEqual',
    'below',
    'lt',
    'lessThan',
    'most',
    'lte',
    'lessThanOrEqual',
    'within',
    'instanceof',
    'instanceOf',
    'change',
    'changes',
    'increase',
    'increases',
    'decrease',
    'decreases',
    'by',
] as const;

const POSTMAN_EXPECT_METHOD_ASSERTIONS = [
    'jsonSchema',
] as const;

const SUPPORTED_EXPECT_LANGUAGE_CHAINS = [
    'to',
    'be',
    'been',
    'is',
    'that',
    'which',
    'and',
    'has',
    'have',
    'with',
    'at',
    'of',
    'same',
    'but',
    'does',
    'still',
    'also',
] as const;

const SUPPORTED_EXPECT_CHAIN_MODIFIERS = [
    'not',
    'deep',
    'nested',
    'own',
    'ordered',
    'any',
    'all',
    'itself',
] as const;

const SUPPORTED_EXPECT_GETTER_ASSERTIONS = [
    'ok',
    'true',
    'false',
    'null',
    'undefined',
    'NaN',
    'exist',
    'exists',
    'empty',
    'arguments',
    'Arguments',
    'extensible',
    'sealed',
    'frozen',
    'finite',
] as const;

const SUPPORTED_EXPECT_METHOD_ASSERTIONS = [
    'a',
    'an',
    'equal',
    'eq',
    'equals',
    'eql',
    'eqls',
    'include',
    'includes',
    'contain',
    'contains',
    'property',
    'ownPropertyDescriptor',
    'haveOwnPropertyDescriptor',
    'length',
    'lengthOf',
    'match',
    'matches',
    'string',
    'keys',
    'key',
    'respondTo',
    'respondsTo',
    'change',
    'changes',
    'increase',
    'increases',
    'decrease',
    'decreases',
    'by',
    'throw',
    'throws',
    'Throw',
    'satisfy',
    'satisfies',
    'closeTo',
    'approximately',
    'members',
    'oneOf',
    'above',
    'gt',
    'greaterThan',
    'least',
    'gte',
    'greaterThanOrEqual',
    'below',
    'lt',
    'lessThan',
    'most',
    'lte',
    'lessThanOrEqual',
    'within',
    'instanceof',
    'instanceOf',
] as const;

const SUPPORTED_POSTMAN_EXPECT_METHOD_ASSERTIONS = [
    'jsonSchema',
] as const;

const UNSUPPORTED_EXPECT_CHAIN_MODIFIERS = [
] as const;

const UNSUPPORTED_EXPECT_GETTER_ASSERTIONS = [
] as const;

const UNSUPPORTED_EXPECT_METHOD_ASSERTIONS = [
] as const;

function toSortedUnique(values: readonly string[]): string[] {
    return [...new Set(values)].sort();
}

describe('expect compatibility surface guard', () => {
    it('documents the full Chai expect compatibility matrix', () => {
        expect(toSortedUnique([
            ...SUPPORTED_EXPECT_LANGUAGE_CHAINS,
            ...UNSUPPORTED_EXPECT_CHAIN_MODIFIERS,
            ...SUPPORTED_EXPECT_CHAIN_MODIFIERS,
        ])).toEqual(toSortedUnique([
            ...CHAI_EXPECT_LANGUAGE_CHAINS,
            ...CHAI_EXPECT_CHAIN_MODIFIERS,
        ]));

        expect(toSortedUnique([
            ...SUPPORTED_EXPECT_GETTER_ASSERTIONS,
            ...UNSUPPORTED_EXPECT_GETTER_ASSERTIONS,
        ])).toEqual(toSortedUnique(CHAI_EXPECT_GETTER_ASSERTIONS));

        expect(toSortedUnique([
            ...SUPPORTED_EXPECT_METHOD_ASSERTIONS,
            ...UNSUPPORTED_EXPECT_METHOD_ASSERTIONS,
        ])).toEqual(toSortedUnique(CHAI_EXPECT_METHOD_ASSERTIONS));
    });

    it('exposes supported Chai language-chain properties and modifiers', () => {
        const chain: any = createExpectChain('value');

        for (const propertyName of [...SUPPORTED_EXPECT_LANGUAGE_CHAINS, ...SUPPORTED_EXPECT_CHAIN_MODIFIERS]) {
            expect(propertyName in chain).toBe(true);
            expect(() => chain[propertyName]).not.toThrow();
        }
    });

    it('defines supported Chai assertion getters', () => {
        const chain: any = createExpectChain('value');

        for (const getterName of SUPPORTED_EXPECT_GETTER_ASSERTIONS) {
            const descriptor = Object.getOwnPropertyDescriptor(chain, getterName);
            expect(descriptor).toBeDefined();
            expect(typeof descriptor?.get).toBe('function');
        }
    });

    it('exposes supported Chai and Postman assertion methods', () => {
        const chain: any = createExpectChain('value');

        for (const methodName of [...SUPPORTED_EXPECT_METHOD_ASSERTIONS, ...SUPPORTED_POSTMAN_EXPECT_METHOD_ASSERTIONS]) {
            expect(typeof chain[methodName]).toBe('function');
        }
    });

    it('keeps unsupported Chai members explicit', () => {
        const chain: any = createExpectChain('value');

        for (const propertyName of UNSUPPORTED_EXPECT_CHAIN_MODIFIERS) {
            expect(propertyName in chain).toBe(false);
        }

        for (const getterName of UNSUPPORTED_EXPECT_GETTER_ASSERTIONS) {
            expect(getterName in chain).toBe(false);
        }

        for (const methodName of UNSUPPORTED_EXPECT_METHOD_ASSERTIONS) {
            expect(methodName in chain).toBe(false);
        }
    });
});

describe('expect .contain() alias', () => {
    it('passes for substring of a string', () => {
        expect(() => createExpectChain('abc').to.contain('b')).not.toThrow();
    });

    it('passes for member of an array', () => {
        expect(() => createExpectChain([1, 2, 3]).to.contain(2)).not.toThrow();
    });

    it('passes for key of an object', () => {
        expect(() => createExpectChain({ a: 1 }).to.contain('a')).not.toThrow();
    });

    it('throws when value is not contained', () => {
        expect(() => createExpectChain('abc').to.contain('z')).toThrow();
    });
});

describe('expect shorthand aliases', () => {
    it('supports eq and equals for strict equality', () => {
        expect(() => createExpectChain('a').to.eq('a')).not.toThrow();
        expect(() => createExpectChain('a').to.equals('a')).not.toThrow();
    });

    it('supports eqls for deep equality', () => {
        expect(() => createExpectChain({ a: 1 }).to.eqls({ a: 1 })).not.toThrow();
    });

    it('supports includes and contains for membership checks', () => {
        expect(() => createExpectChain([1, 2, 3]).to.includes(2)).not.toThrow();
        expect(() => createExpectChain('abcd').to.contains('bc')).not.toThrow();
    });

    it('supports gt and lt for numeric comparisons', () => {
        expect(() => createExpectChain(6).to.gt(5)).not.toThrow();
        expect(() => createExpectChain(4).to.lt(5)).not.toThrow();
    });
});

describe('expect function and type assertions', () => {
    it('supports throw and throws with message matching', () => {
        const boom = () => { throw new Error('boom'); };
        expect(() => createExpectChain(boom).to.throw()).not.toThrow();
        expect(() => createExpectChain(boom).to.throws(/boom/)).not.toThrow();
    });

    it('supports instanceOf and instanceof aliases', () => {
        class Demo {}
        const value = new Demo();
        expect(() => createExpectChain(value).to.instanceOf(Demo)).not.toThrow();
        expect(() => createExpectChain(value).to['instanceof'](Demo)).not.toThrow();
    });

    it('supports closeTo and approximately for numeric tolerance', () => {
        expect(() => createExpectChain(5.1).to.closeTo(5, 0.2)).not.toThrow();
        expect(() => createExpectChain(5.1).to.approximately(5, 0.2)).not.toThrow();
    });

    it('supports deep.property path lookup', () => {
        const value = { a: { b: [{ c: 1 }] } };
        expect(() => createExpectChain(value).to.have.deep.property('a.b[0].c', 1)).not.toThrow();
    });
});

describe('expect common assertion families', () => {
    it('supports a and an type checks', () => {
        expect(() => createExpectChain('forge').to.be.a('string')).not.toThrow();
        expect(() => createExpectChain([1, 2, 3]).to.be.an('array')).not.toThrow();
    });

    it('supports empty for strings, arrays, and objects', () => {
        expect(() => createExpectChain('').to.be.empty).not.toThrow();
        expect(() => createExpectChain([]).to.be.empty).not.toThrow();
        expect(() => createExpectChain({}).to.be.empty).not.toThrow();
    });

    it('supports length and lengthOf aliases', () => {
        expect(() => createExpectChain('abc').to.have.length(3)).not.toThrow();
        expect(() => createExpectChain([1, 2]).to.have.lengthOf(2)).not.toThrow();
    });

    it('supports members and keys assertions', () => {
        expect(() => createExpectChain([1, 2, 3]).to.have.members([3, 1])).not.toThrow();
        expect(() => createExpectChain({ a: 1, b: 2 }).to.have.keys('a', 'b')).not.toThrow();
    });

    it('supports oneOf, match, and string assertions', () => {
        expect(() => createExpectChain('beta').to.be.oneOf(['alpha', 'beta'])).not.toThrow();
        expect(() => createExpectChain('http-forge').to.match(/forge$/)).not.toThrow();
        expect(() => createExpectChain('postman-compatible').to.have.string('compatible')).not.toThrow();
    });

    it('fails when the expected length does not match', () => {
        expect(() => createExpectChain('abc').to.have.length(2)).toThrow(/have length 2/);
    });

    it('supports deep equal via the deep chain', () => {
        expect(() => createExpectChain({ a: { b: 1 } }).to.deep.equal({ a: { b: 1 } })).not.toThrow();
    });
});

describe('expect specialized chain aliases', () => {
    it('supports members and keys with negation', () => {
        expect(() => createExpectChain([1, 2, 3]).to.not.have.members([4, 5])).not.toThrow();
        expect(() => createExpectChain({ a: 1, b: 2 }).to.not.have.keys('x', 'y')).not.toThrow();
    });

    it('supports oneOf, match, string, and include negation', () => {
        expect(() => createExpectChain('beta').to.be.oneOf(['alpha', 'beta'])).not.toThrow();
        expect(() => createExpectChain('http-forge').to.match(/forge$/)).not.toThrow();
        expect(() => createExpectChain('postman-compatible').to.have.string('compatible')).not.toThrow();
        expect(() => createExpectChain(['a', 'b']).to.not.include('z')).not.toThrow();
    });

    it('supports greaterThan and lessThan aliases', () => {
        expect(() => createExpectChain(6).to.be.greaterThan(5)).not.toThrow();
        expect(() => createExpectChain(4).to.be.lessThan(5)).not.toThrow();
    });

    it('supports property presence and value checks', () => {
        expect(() => createExpectChain({ a: 1, b: 2 }).to.have.property('a', 1)).not.toThrow();
        expect(() => createExpectChain({ a: { b: 1 } }).to.have.deep.property('a.b', 1)).not.toThrow();
    });

    it('supports negated value assertions', () => {
        expect(() => createExpectChain('forge').to.not.equal('other')).not.toThrow();
        expect(() => createExpectChain({ a: 1 }).to.not.eql({ a: 2 })).not.toThrow();
        expect(() => createExpectChain('forge').to.not.oneOf(['alpha', 'beta'])).not.toThrow();
        expect(() => createExpectChain('forge').to.not.match(/abc$/)).not.toThrow();
        expect(() => createExpectChain('forge').to.not.have.property('missing')).not.toThrow();
        expect(() => createExpectChain([1, 2, 3]).to.not.be.empty).not.toThrow();
        expect(() => createExpectChain(5).to.not.be.within(10, 20)).not.toThrow();
        expect(() => createExpectChain(5.5).to.not.be.closeTo(10, 0.1)).not.toThrow();
        expect(() => createExpectChain('forge').to.not.be.a('number')).not.toThrow();
        expect(() => createExpectChain('forge').to.not.be.an('object')).not.toThrow();
    });

    it('supports negated function assertions', () => {
        const safe = () => 'ok';
        expect(() => createExpectChain(safe).to.not.throw()).not.toThrow();
        expect(() => createExpectChain(safe).to.not.throws()).not.toThrow();
    });

    it('supports jsonSchema on the generic expect chain', () => {
        const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };
        expect(() => createExpectChain({ ok: true }).to.have.jsonSchema(schema)).not.toThrow();
        expect(() => createExpectChain(JSON.stringify({ ok: false })).to.have.jsonSchema(schema)).not.toThrow();
        expect(() => createExpectChain({ ok: 'yes' }).to.have.jsonSchema(schema)).toThrow(/JSON schema/);
    });

    it('supports negated type assertions', () => {
        class Other {}
        expect(() => createExpectChain({}).to.not.instanceOf(Other)).not.toThrow();
        expect(() => createExpectChain({}).to.not['instanceof'](Other)).not.toThrow();
    });

    it('supports no-op language chains without breaking assertions', () => {
        expect(() => {
            createExpectChain(5).to.be.that.is;
            createExpectChain('forge').to.have.with.of.same.but.does.still.also.equal('forge');
        }).not.toThrow();
    });
});

describe('expect truthiness and bounds helpers', () => {
    it('supports ok and exist getters', () => {
        expect(() => createExpectChain('forge').to.be.ok).not.toThrow();
        expect(() => createExpectChain(0).to.exist).not.toThrow();
    });

    it('supports true false null and undefined getters', () => {
        expect(() => createExpectChain(true).to.be.true).not.toThrow();
        expect(() => createExpectChain(false).to.be.false).not.toThrow();
        expect(() => createExpectChain(null).to.be.null).not.toThrow();
        expect(() => createExpectChain(undefined).to.be.undefined).not.toThrow();
    });

    it('supports within for numeric range checks', () => {
        expect(() => createExpectChain(5).to.be.within(1, 10)).not.toThrow();
    });

    it('supports not chain negation', () => {
        expect(() => createExpectChain(5).to.not.equal(4)).not.toThrow();
        expect(() => createExpectChain('forge').to.not.have.string('x')).not.toThrow();
    });

    it('fails when a truthy check is violated', () => {
        expect(() => createExpectChain(false).to.be.ok).toThrow(/truthy/);
    });

    it('supports exists and NaN getters', () => {
        expect(() => createExpectChain('forge').to.exists).not.toThrow();
        expect(() => createExpectChain(Number.NaN).to.be.NaN).not.toThrow();
    });

    it('supports arguments and Arguments getters', () => {
        const getArgs = function (...args: any[]) { return arguments; };
        const args = getArgs(1, 2, 3);
        expect(() => createExpectChain(args).to.be.arguments).not.toThrow();
        expect(() => createExpectChain(args).to.be.Arguments).not.toThrow();
    });

    it('supports extensible sealed and frozen getters', () => {
        const extensible = {};
        const sealed = Object.seal({});
        const frozen = Object.freeze({});

        expect(() => createExpectChain(extensible).to.be.extensible).not.toThrow();
        expect(() => createExpectChain(sealed).to.be.sealed).not.toThrow();
        expect(() => createExpectChain(frozen).to.be.frozen).not.toThrow();
    });

    it('supports finite getter', () => {
        expect(() => createExpectChain(42).to.be.finite).not.toThrow();
        expect(() => createExpectChain(Infinity).to.be.finite).toThrow(/finite/);
    });
});

describe('expect at.least / at.most aliases', () => {
    it('passes for at.least when the value is equal to the threshold', () => {
        expect(() => createExpectChain(5).to.be.at.least(5)).not.toThrow();
    });

    it('passes for at.least when the value is above the threshold', () => {
        expect(() => createExpectChain(6).to.be.at.least(5)).not.toThrow();
    });

    it('fails for at.least when the value is below the threshold', () => {
        expect(() => createExpectChain(4).to.be.at.least(5)).toThrow(/at least 5/);
    });

    it('passes for at.most when the value is equal to the threshold', () => {
        expect(() => createExpectChain(5).to.be.at.most(5)).not.toThrow();
    });

    it('passes for at.most when the value is below the threshold', () => {
        expect(() => createExpectChain(4).to.be.at.most(5)).not.toThrow();
    });

    it('fails for at.most when the value is above the threshold', () => {
        expect(() => createExpectChain(6).to.be.at.most(5)).toThrow(/at most 5/);
    });
});

describe('expect gte / lte aliases', () => {
    it('passes for gte when the value is equal to the threshold', () => {
        expect(() => createExpectChain(5).to.be.gte(5)).not.toThrow();
    });

    it('passes for gte when the value is above the threshold', () => {
        expect(() => createExpectChain(6).to.be.gte(5)).not.toThrow();
    });

    it('fails for gte when the value is below the threshold', () => {
        expect(() => createExpectChain(4).to.be.gte(5)).toThrow(/at least 5/);
    });

    it('passes for lte when the value is equal to the threshold', () => {
        expect(() => createExpectChain(5).to.be.lte(5)).not.toThrow();
    });

    it('passes for lte when the value is below the threshold', () => {
        expect(() => createExpectChain(4).to.be.lte(5)).not.toThrow();
    });

    it('fails for lte when the value is above the threshold', () => {
        expect(() => createExpectChain(6).to.be.lte(5)).toThrow(/at most 5/);
    });

    it('supports greaterThanOrEqual and lessThanOrEqual aliases', () => {
        expect(() => createExpectChain(5).to.be.greaterThanOrEqual(5)).not.toThrow();
        expect(() => createExpectChain(5).to.be.lessThanOrEqual(5)).not.toThrow();
    });
});

describe('expect additional alias compatibility', () => {
    it('supports matches and key aliases', () => {
        expect(() => createExpectChain('http-forge').to.matches(/forge$/)).not.toThrow();
        expect(() => createExpectChain({ a: 1, b: 2 }).to.have.key('a')).not.toThrow();
    });

    it('supports Throw alias', () => {
        const boom = () => { throw new Error('boom'); };
        expect(() => createExpectChain(boom).to.Throw(/boom/)).not.toThrow();
    });

    it('supports satisfy and satisfies aliases', () => {
        expect(() => createExpectChain(10).to.satisfy((n: number) => n > 5)).not.toThrow();
        expect(() => createExpectChain(10).to.satisfies((n: number) => n % 2 === 0)).not.toThrow();
    });

    it('supports ownPropertyDescriptor and haveOwnPropertyDescriptor', () => {
        const value = { a: 1 };
        expect(() => createExpectChain(value).to.have.ownPropertyDescriptor('a')).not.toThrow();
        expect(() => createExpectChain(value).to.have.haveOwnPropertyDescriptor('a', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: 1,
        })).not.toThrow();
    });

    it('supports respondTo and respondsTo aliases', () => {
        class Demo {
            ping() { return 'pong'; }
        }

        expect(() => createExpectChain(new Demo()).to.respondTo('ping')).not.toThrow();
        expect(() => createExpectChain(Demo).to.respondsTo('ping')).not.toThrow();
    });

    it('supports change and changes with function subjects', () => {
        let value = 1;
        const mutate = () => { value += 1; };
        const read = () => value;

        expect(() => createExpectChain(mutate).to.change(read)).not.toThrow();
        expect(() => createExpectChain(mutate).to.changes(read)).not.toThrow();
    });

    it('supports change with object property subjects', () => {
        const state = { count: 1 };
        const mutate = () => { state.count += 1; };

        expect(() => createExpectChain(mutate).to.change(state, 'count')).not.toThrow();
    });

    it('supports increase/decrease and alias forms', () => {
        const up = { value: 1 };
        const inc = () => { up.value += 2; };
        expect(() => createExpectChain(inc).to.increase(up, 'value')).not.toThrow();
        expect(() => createExpectChain(inc).to.increases(up, 'value')).not.toThrow();

        const down = { value: 5 };
        const dec = () => { down.value -= 2; };
        expect(() => createExpectChain(dec).to.decrease(down, 'value')).not.toThrow();
        expect(() => createExpectChain(dec).to.decreases(down, 'value')).not.toThrow();
    });

    it('supports by after change/increase/decrease', () => {
        const stateA = { value: 1 };
        const inc = () => { stateA.value += 2; };
        expect(() => createExpectChain(inc).to.increase(stateA, 'value').by(2)).not.toThrow();

        const stateB = { value: 5 };
        const dec = () => { stateB.value -= 3; };
        expect(() => createExpectChain(dec).to.decrease(stateB, 'value').by(3)).not.toThrow();

        let f = 10;
        const bump = () => { f += 4; };
        const read = () => f;
        expect(() => createExpectChain(bump).to.change(read).by(4)).not.toThrow();
    });

    it('supports nested and own modifiers for property assertions', () => {
        const obj = { a: { b: 1 } };
        const inherited = Object.create({ parent: 1 });
        inherited.self = 2;

        expect(() => createExpectChain(obj).to.have.nested.property('a.b', 1)).not.toThrow();
        expect(() => createExpectChain(inherited).to.have.own.property('self', 2)).not.toThrow();
        expect(() => createExpectChain(inherited).to.have.own.property('parent')).toThrow();
    });

    it('supports ordered modifier for members assertion', () => {
        expect(() => createExpectChain([1, 2, 3]).to.have.ordered.members([1, 2])).not.toThrow();
        expect(() => createExpectChain([1, 2, 3]).to.have.ordered.members([2, 1])).toThrow();
    });

    it('supports any and all modifiers for keys assertion', () => {
        const obj = { a: 1, b: 2 };
        expect(() => createExpectChain(obj).to.have.any.keys('x', 'a')).not.toThrow();
        expect(() => createExpectChain(obj).to.have.all.keys('a', 'b')).not.toThrow();
        expect(() => createExpectChain(obj).to.have.any.keys('x', 'y')).toThrow();
    });

    it('supports itself modifier with respondTo on functions', () => {
        class Demo {
            ping() { return 'pong'; }
            static hiss() { return 'hiss'; }
        }

        expect(() => createExpectChain(Demo).to.respondTo('ping')).not.toThrow();
        expect(() => createExpectChain(Demo).itself.to.respondTo('hiss')).not.toThrow();
    });
});

describe('validateJsonSchema', () => {
    const schema = {
        type: 'object',
        required: ['id', 'name'],
        properties: {
            id: { type: 'integer' },
            name: { type: 'string', minLength: 1 },
            tags: { type: 'array', items: { type: 'string' } },
        },
    };

    it('returns no errors for valid data', () => {
        const errors = validateJsonSchema({ id: 1, name: 'forge', tags: ['a', 'b'] }, schema);
        expect(errors).toHaveLength(0);
    });

    it('reports missing required property', () => {
        const errors = validateJsonSchema({ id: 1 }, schema);
        expect(errors.some(e => e.includes('name'))).toBe(true);
    });

    it('reports type mismatch', () => {
        const errors = validateJsonSchema({ id: 'x', name: 'forge' }, schema);
        expect(errors.some(e => e.includes('expected type'))).toBe(true);
    });

    it('validates array item types', () => {
        const errors = validateJsonSchema({ id: 1, name: 'forge', tags: [1] }, schema);
        expect(errors.length).toBeGreaterThan(0);
    });
});

describe('response to.have.jsonSchema', () => {
    const makeResponse = (body: any): ResponseContext => ({
        executedRequest: null as any,
        status: 200,
        statusText: 'OK',
        headers: {},
        body,
    });

    const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };

    it('passes when body matches schema', () => {
        const res = createResponseObject(makeResponse({ ok: true }));
        expect(() => res.to.have.jsonSchema(schema)).not.toThrow();
    });

    it('throws with a readable error when body violates schema', () => {
        const res = createResponseObject(makeResponse({ ok: 'yes' }));
        expect(() => res.to.have.jsonSchema(schema)).toThrow(/JSON schema/);
    });

    it('parses string bodies before validating', () => {
        const res = createResponseObject(makeResponse(JSON.stringify({ ok: false })));
        expect(() => res.to.have.jsonSchema(schema)).not.toThrow();
    });
});

describe('raw string response body (Postman parity)', () => {
    const makeResponse = (body: any): ResponseContext => ({
        executedRequest: null as any,
        status: 200,
        statusText: 'OK',
        headers: {},
        body,
    });

    it('exposes a string body unchanged (Postman keeps the raw payload string)', () => {
        const raw = JSON.stringify({ id: 1, name: 'forge' });
        const res = createResponseObject(makeResponse(raw));
        expect(typeof res.body).toBe('string');
        expect(res.body).toBe(raw);
    });

    it('text() returns the raw string for a string body', () => {
        const raw = '{"id":1}';
        const res = createResponseObject(makeResponse(raw));
        expect(res.text()).toBe(raw);
    });

    it('json() parses a string body on demand', () => {
        const res = createResponseObject(makeResponse('{"id":1,"name":"forge"}'));
        expect(res.json()).toEqual({ id: 1, name: 'forge' });
    });

    it('json() returns null for a non-JSON string body', () => {
        const res = createResponseObject(makeResponse('plain text body'));
        expect(res.json()).toBeNull();
    });

    it('classic JSON.parse(responseBody) idiom works on a string body', () => {
        const raw = '{"token":"abc"}';
        // Mirrors the legacy Postman global, which is always a raw string.
        expect(JSON.parse(raw)).toEqual({ token: 'abc' });
    });

    it('still tolerates an already-parsed object body via json()/text()', () => {
        const res = createResponseObject(makeResponse({ ok: true }));
        expect(res.json()).toEqual({ ok: true });
        expect(res.text()).toBe('{"ok":true}');
    });
});

describe('pm.test helpers', () => {
    it('pm.test.skip records a skipped, non-failing result', () => {
        const assertions: TestAssertion[] = [];
        const test = createTestFunction(assertions);
        test.skip('skipped check', () => { throw new Error('should not run'); });
        expect(assertions).toHaveLength(1);
        expect(assertions[0]).toMatchObject({ name: 'skipped check', passed: true, skipped: true });
    });

    it('pm.test.fail records an immediate failure', () => {
        const assertions: TestAssertion[] = [];
        const test = createTestFunction(assertions);
        test.fail('forced failure');
        expect(assertions).toHaveLength(1);
        expect(assertions[0].passed).toBe(false);
        expect(assertions[0].message).toContain('forced failure');
    });

    it('pm.test.index reflects the current ordering', () => {
        const assertions: TestAssertion[] = [];
        const test = createTestFunction(assertions);
        expect(test.index()).toBe(0);
        test('first', () => { /* pass */ });
        expect(test.index()).toBe(1);
    });
});

describe('Script scope collisions', () => {
    it('shared scope throws when two script units redeclare the same const', () => {
        const program = concatenateScripts([
            'const helper = 1; helper;',
            'const helper = 2; helper;'
        ]);

        expect(() => vm.runInNewContext(program, {}, { timeout: 1000 })).toThrow(/already been declared|Identifier 'helper'/);
    });

    it('isolated scope allows the same const name in separate script units', () => {
        const program = concatenateScripts([
            'const helper = 1; helper;',
            'const helper = 2; helper;'
        ], true);

        expect(() => vm.runInNewContext(program, {}, { timeout: 1000 })).not.toThrow();
    });
});

describe('Postman collection import', () => {
    it('preserves collection variables from info.variable', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'http-forge-postman-'));
        const configService = new ConfigService(workspaceRoot, undefined, undefined as any);
        await configService.createDefaultConfig();

        const collectionService = new CollectionService(configService, undefined);
        const collectionFile = path.join(workspaceRoot, 'postman-collection.json');
        fs.writeFileSync(collectionFile, JSON.stringify({
            info: {
                name: 'Imported Postman Collection',
                _postman_id: 'abc123',
                schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
            },
            variable: [
                { key: 'baseUrl', value: 'https://api.example.com' },
                { key: 'tenant', value: 'corp' }
            ],
            item: []
        }), 'utf-8');

        const collection = await collectionService.importCollection(collectionFile);

        expect(collection.variables).toEqual({
            baseUrl: 'https://api.example.com',
            tenant: 'corp'
        });
    });

    it('preserves item order from a Postman collection import', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'http-forge-postman-'));
        const configService = new ConfigService(workspaceRoot, undefined, undefined as any);
        await configService.createDefaultConfig();

        const collectionService = new CollectionService(configService, undefined);
        const collectionFile = path.join(workspaceRoot, 'ordered-postman-collection.json');
        fs.writeFileSync(collectionFile, JSON.stringify({
            info: {
                name: 'Ordered Postman Collection',
                _postman_id: 'ordered-postman-collection',
                schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
            },
            item: [
                { name: 'Second Request', request: { method: 'GET', url: 'https://api.example.com/second' } },
                { name: 'First Request', request: { method: 'GET', url: 'https://api.example.com/first' } },
                { name: 'Third Request', request: { method: 'GET', url: 'https://api.example.com/third' } }
            ]
        }), 'utf-8');

        const imported = await collectionService.importCollection(collectionFile);

        expect(imported.items.map(item => item.name)).toEqual(['Second Request', 'First Request', 'Third Request']);
    });

    it('writes imported item order into collection metadata on disk', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'http-forge-postman-'));
        const configService = new ConfigService(workspaceRoot, undefined, undefined as any);
        await configService.createDefaultConfig();

        const collectionService = new CollectionService(configService, undefined);
        const collectionFile = path.join(workspaceRoot, 'ordered-postman-collection.json');
        fs.writeFileSync(collectionFile, JSON.stringify({
            info: {
                name: 'Ordered Postman Collection',
                _postman_id: 'ordered-postman-collection',
                schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
            },
            item: [
                { name: 'Second Request', request: { method: 'GET', url: 'https://api.example.com/second' } },
                { name: 'First Request', request: { method: 'GET', url: 'https://api.example.com/first' } },
                { name: 'Third Request', request: { method: 'GET', url: 'https://api.example.com/third' } }
            ]
        }), 'utf-8');

        await collectionService.importCollection(collectionFile);

        const collectionsDir = path.join(workspaceRoot, '.http-forge', 'assets', 'collections');
        const collectionDir = fs.readdirSync(collectionsDir, { withFileTypes: true })
            .find(entry => entry.isDirectory())?.name;

        expect(collectionDir).toBeDefined();

        const metadataPath = path.join(collectionsDir, collectionDir!, 'collection.json');
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        const importedNames = ['Second Request', 'First Request', 'Third Request'];
        const expectedOrder = importedNames
            .map(name => fs.readdirSync(path.join(collectionsDir, collectionDir!), { withFileTypes: true })
                .filter(entry => entry.isDirectory())
                .map(entry => entry.name)
                .find(slug => slug.includes(name.toLowerCase().replace(/\s+/g, '-'))));

        expect(metadata.order).toEqual(expectedOrder.filter((value): value is string => Boolean(value)));
    });

    it('round-trips nested folders through Postman export and import', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'http-forge-postman-'));
        const configService = new ConfigService(workspaceRoot, undefined, undefined as any);
        await configService.createDefaultConfig();

        const collectionService = new CollectionService(configService, undefined);
        const collection: Collection = {
            id: 'nested-collection',
            name: 'Nested Collection',
            items: [
                {
                    type: 'folder',
                    id: 'folder-root',
                    name: 'Root Folder',
                    items: [
                        {
                            type: 'folder',
                            id: 'folder-child',
                            name: 'Child Folder',
                            items: [
                                {
                                    type: 'request',
                                    id: 'request-leaf',
                                    name: 'Leaf Request',
                                    method: 'GET',
                                    url: 'https://api.example.com/leaf',
                                    headers: [],
                                    query: [],
                                    params: {},
                                    body: { type: 'none', content: null }
                                } as any
                            ]
                        }
                    ]
                }
            ]
        };

        await collectionService.saveCollection(collection);

        const exportFile = path.join(workspaceRoot, 'nested-collection.postman.json');
        await collectionService.exportCollection(collection.id, exportFile);

        const roundTripped = await collectionService.importCollection(exportFile);
        const rootFolder = roundTripped.items[0] as any;
        const childFolder = rootFolder.items[0] as any;
        const request = childFolder.items[0] as any;

        expect(rootFolder.type).toBe('folder');
        expect(rootFolder.name).toBe('Root Folder');
        expect(childFolder.type).toBe('folder');
        expect(childFolder.name).toBe('Child Folder');
        expect(request.type).toBe('request');
        expect(request.name).toBe('Leaf Request');
        expect(request.method).toBe('GET');
    });

    it('round-trips form-data bodies with enabled and disabled entries', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'http-forge-postman-'));
        const configService = new ConfigService(workspaceRoot, undefined, undefined as any);
        await configService.createDefaultConfig();

        const collectionService = new CollectionService(configService, undefined);
        const collection: Collection = {
            id: 'formdata-collection',
            name: 'FormData Collection',
            items: [
                {
                    type: 'request',
                    id: 'request-formdata',
                    name: 'Upload File',
                    method: 'POST',
                    url: 'https://api.example.com/upload',
                    headers: [],
                    query: [],
                    params: {},
                    body: {
                        type: 'form-data',
                        content: [
                            { key: 'title', value: 'demo', type: 'text', enabled: true },
                            { key: 'attachment', value: '', type: 'file', enabled: false }
                        ]
                    }
                } as any
            ]
        };

        await collectionService.saveCollection(collection);

        const exportFile = path.join(workspaceRoot, 'formdata-collection.postman.json');
        await collectionService.exportCollection(collection.id, exportFile);

        const roundTripped = await collectionService.importCollection(exportFile);
        const request = roundTripped.items[0] as any;

        expect(request.body.type).toBe('form-data');
        expect(request.body.content).toEqual([
            { key: 'title', value: 'demo', type: 'text', enabled: true },
            { key: 'attachment', value: '', type: 'file', enabled: false }
        ]);
    });

    it('round-trips binary bodies as Postman binary mode', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'http-forge-postman-'));
        const configService = new ConfigService(workspaceRoot, undefined, undefined as any);
        await configService.createDefaultConfig();

        const collectionService = new CollectionService(configService, undefined);
        const collection: Collection = {
            id: 'binary-collection',
            name: 'Binary Collection',
            items: [
                {
                    type: 'request',
                    id: 'request-binary',
                    name: 'Download File',
                    method: 'POST',
                    url: 'https://api.example.com/upload',
                    headers: [],
                    query: [],
                    params: {},
                    body: {
                        type: 'binary',
                        content: ''
                    }
                } as any
            ]
        };

        await collectionService.saveCollection(collection);

        const exportFile = path.join(workspaceRoot, 'binary-collection.postman.json');
        await collectionService.exportCollection(collection.id, exportFile);

        const exported = JSON.parse(fs.readFileSync(exportFile, 'utf-8'));
        expect(exported.item[0].request.body).toEqual({ mode: 'binary', file: {} });

        const roundTripped = await collectionService.importCollection(exportFile);
        const request = roundTripped.items[0] as any;

        expect(request.body.type).toBe('binary');
        expect(request.body.content).toBe('');
    });

    it('executes multipart form-data from a Postman export as a real multipart request', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'http-forge-postman-'));
        const configService = new ConfigService(workspaceRoot, undefined, undefined as any);
        await configService.createDefaultConfig();

        const collectionService = new CollectionService(configService, undefined);
        const collectionFile = path.join(workspaceRoot, 'multipart-postman.json');
        fs.writeFileSync(collectionFile, JSON.stringify({
            info: {
                name: 'Multipart Export',
                _postman_id: 'postman-multipart',
                schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
            },
            item: [
                {
                    name: 'Upload',
                    request: {
                        method: 'POST',
                        header: [],
                        body: {
                            mode: 'formdata',
                            formdata: [
                                { key: 'title', value: 'hello', type: 'text', disabled: false },
                                { key: 'skipMe', value: 'nope', type: 'text', disabled: true }
                            ]
                        },
                        url: 'http://127.0.0.1/upload'
                    }
                }
            ]
        }), 'utf-8');

        const collection = await collectionService.importCollection(collectionFile);
        const request = collection.items[0] as any;

        const received = await new Promise<{ headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
            const server = http.createServer((req, res) => {
                const chunks: Buffer[] = [];
                req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                req.on('end', () => {
                    res.statusCode = 200;
                    res.end('ok');
                    server.close();
                    resolve({ headers: req.headers, body: Buffer.concat(chunks).toString('utf-8') });
                });
                req.on('error', error => {
                    server.close();
                    reject(error);
                });
            });

            server.listen(0, '127.0.0.1', async () => {
                const address = server.address();
                const port = typeof address === 'object' && address ? address.port : 0;
                const env = ForgeEnv.create({});
                const executor = new RequestExecutor(
                    new FetchHttpClient(),
                    env,
                    undefined,
                    new RequestPreprocessor(),
                    { scriptExecutor: undefined, scriptScope: 'isolated' }
                );

                try {
                    await executor.execute(
                        {
                            ...request,
                            url: `http://127.0.0.1:${port}/upload`
                        },
                        { id: 'collection', name: 'Multipart Export', items: [] } as any,
                        { skipPreRequest: true, skipPostResponse: true }
                    );
                } catch (error) {
                    server.close();
                    reject(error);
                }
            });
        });

        expect(received.headers['content-type']).toMatch(/multipart\/form-data; boundary=/i);
        expect(received.body).toContain('name="title"');
        expect(received.body).toContain('hello');
        expect(received.body).not.toContain('skipMe');
    });
});

describe('Collection metadata preservation', () => {
    it('preserves request metadata through save/load round-trip', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'http-forge-metadata-'));
        const configService = new ConfigService(workspaceRoot, undefined, undefined as any);
        await configService.createDefaultConfig();

        const collectionService = new CollectionService(configService, undefined);
        const requestDefinition = {
            type: 'request',
            id: 'request-metadata',
            name: 'Metadata Request',
            method: 'POST',
            url: 'https://api.example.com/items',
            headers: [
                { key: 'X-Enabled', value: 'yes', enabled: true },
                { key: 'X-Disabled', value: 'no', enabled: false }
            ],
            query: [
                { key: 'active', value: '1', enabled: true },
                { key: 'inactive', value: '0', enabled: false }
            ],
            params: { itemId: '123' },
            body: {
                type: 'raw',
                format: 'json',
                content: '{"ok":true}'
            },
            bodyContentType: 'application/vnd.api+json',
            disabled: true,
            deprecated: true,
            responseSchema: {
                responses: {
                    '200': {
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: { ok: { type: 'boolean' } }
                                }
                            }
                        }
                    }
                }
            },
            bodySchema: {
                contentType: 'application/json',
                schema: {
                    type: 'object',
                    properties: { ok: { type: 'boolean' } }
                }
            }
        } as const;

        const collection: Collection = {
            id: 'metadata-collection',
            name: 'Metadata Collection',
            items: [
                requestDefinition as any
            ]
        };

        await collectionService.saveCollection(collection);

        const reloadedService = new CollectionService(configService, undefined);
        const reloaded = reloadedService.getCollection('metadata-collection');
        const treeItem = reloaded?.items[0] as any;

        expect(reloaded).toBeDefined();
        expect(treeItem.headers).toEqual([
            { key: 'X-Enabled', value: 'yes', enabled: true },
            { key: 'X-Disabled', value: 'no', enabled: false }
        ]);
        expect(treeItem.query).toEqual([
            { key: 'active', value: '1', enabled: true },
            { key: 'inactive', value: '0', enabled: false }
        ]);
        expect(treeItem.bodyContentType).toBe('application/vnd.api+json');
        expect(treeItem.disabled).toBe(true);
        expect(treeItem.deprecated).toBe(true);
        // Heavy fields (schemas) load on demand now that collections start light.
        const request = reloadedService.findRequest('metadata-collection', 'request-metadata') as any;
        expect(request.responseSchema).toEqual(requestDefinition.responseSchema);
        expect(request.bodySchema).toEqual(requestDefinition.bodySchema);
    });

    it('preserves richer header and query metadata through Postman import/export round-trip', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'http-forge-postman-meta-'));
        const configService = new ConfigService(workspaceRoot, undefined, undefined as any);
        await configService.createDefaultConfig();

        const collectionService = new CollectionService(configService, undefined);
        const inputFile = path.join(workspaceRoot, 'metadata-import.json');
        const exportFile = path.join(workspaceRoot, 'metadata-export.json');

        const postmanCollection = {
            info: {
                name: 'Postman Metadata Collection',
                _postman_id: 'postman-metadata-collection',
                schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
            },
            item: [
                {
                    name: 'Metadata Request',
                    request: {
                        method: 'GET',
                        header: [
                            {
                                key: 'X-Trace-Id',
                                value: 'trace-123',
                                disabled: false,
                                description: 'Trace identifier',
                                type: 'string',
                                required: true,
                                deprecated: false,
                                format: 'uuid',
                                enum: ['trace-123']
                            }
                        ],
                        url: {
                            raw: 'https://api.example.com/items?active=1&inactive=0',
                            protocol: 'https',
                            host: ['api', 'example', 'com'],
                            path: ['items'],
                            query: [
                                {
                                    key: 'active',
                                    value: '1',
                                    disabled: false,
                                    description: 'Only active records',
                                    type: 'integer',
                                    required: true,
                                    deprecated: false,
                                    format: 'int32',
                                    pattern: '^\\d+$'
                                },
                                {
                                    key: 'inactive',
                                    value: '0',
                                    disabled: true,
                                    description: 'Inactive flag',
                                    type: 'integer',
                                    required: false,
                                    deprecated: true,
                                    minimum: 0,
                                    maximum: 1
                                }
                            ]
                        }
                    }
                }
            ]
        };

        fs.writeFileSync(inputFile, JSON.stringify(postmanCollection, null, 2), 'utf-8');

        const imported = await collectionService.importCollection(inputFile);
        await collectionService.exportCollection(imported.id, exportFile);

        const reimportService = new CollectionService(configService, undefined);
        const reimported = await reimportService.importCollection(exportFile);
        const request = reimported.items[0] as any;

        expect(request.headers).toEqual([
            {
                key: 'X-Trace-Id',
                value: 'trace-123',
                enabled: true,
                description: 'Trace identifier',
                type: 'string',
                required: true,
                deprecated: false,
                format: 'uuid',
                enum: ['trace-123']
            }
        ]);
        expect(request.query).toEqual([
            {
                key: 'active',
                value: '1',
                enabled: true,
                description: 'Only active records',
                type: 'integer',
                required: true,
                deprecated: false,
                format: 'int32',
                pattern: '^\\d+$'
            },
            {
                key: 'inactive',
                value: '0',
                enabled: false,
                description: 'Inactive flag',
                type: 'integer',
                required: false,
                deprecated: true,
                minimum: 0,
                maximum: 1
            }
        ]);
    });

    it('preserves richer header and query metadata through request updates', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'http-forge-metadata-update-'));
        const configService = new ConfigService(workspaceRoot, undefined, undefined as any);
        await configService.createDefaultConfig();

        const collectionService = new CollectionService(configService, undefined);
        const collection: Collection = {
            id: 'metadata-update-collection',
            name: 'Metadata Update Collection',
            items: [
                {
                    type: 'request',
                    id: 'request-metadata-update',
                    name: 'Original Request',
                    method: 'GET',
                    url: 'https://api.example.com/items',
                    headers: [
                        {
                            key: 'X-Trace-Id',
                            value: 'trace-123',
                            enabled: true,
                            description: 'Trace identifier',
                            type: 'string',
                            required: true,
                            deprecated: false,
                            format: 'uuid',
                            enum: ['trace-123']
                        }
                    ],
                    query: [
                        {
                            key: 'active',
                            value: '1',
                            enabled: true,
                            description: 'Only active records',
                            type: 'integer',
                            required: true,
                            deprecated: false,
                            format: 'int32',
                            pattern: '^\\d+$'
                        }
                    ],
                    params: {},
                    body: { type: 'none', content: null }
                } as any
            ]
        };

        await collectionService.saveCollection(collection);

        const renamed = await collectionService.updateRequest('metadata-update-collection', 'request-metadata-update', {
            name: 'Renamed Request'
        });
        expect(renamed).toBe(true);

        const reloadedService = new CollectionService(configService, undefined);
        const reloaded = reloadedService.getCollection('metadata-update-collection');
        const request = reloaded?.items[0] as any;

        expect(request.name).toBe('Renamed Request');
        expect(request.headers).toEqual([
            {
                key: 'X-Trace-Id',
                value: 'trace-123',
                enabled: true,
                description: 'Trace identifier',
                type: 'string',
                required: true,
                deprecated: false,
                format: 'uuid',
                enum: ['trace-123']
            }
        ]);
        expect(request.query).toEqual([
            {
                key: 'active',
                value: '1',
                enabled: true,
                description: 'Only active records',
                type: 'integer',
                required: true,
                deprecated: false,
                format: 'int32',
                pattern: '^\\d+$'
            }
        ]);
    });

    it('preserves richer header and query metadata through created folder/request round-trip', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'http-forge-metadata-create-'));
        const configService = new ConfigService(workspaceRoot, undefined, undefined as any);
        await configService.createDefaultConfig();

        const collectionService = new CollectionService(configService, undefined);
        const collection: Collection = {
            id: 'metadata-create-collection',
            name: 'Metadata Create Collection',
            items: []
        };

        await collectionService.saveCollection(collection);

        const folder = await collectionService.createFolder({
            name: 'Created Folder',
            collectionId: 'metadata-create-collection'
        });

        const createdRequest = await collectionService.createRequest({
            collectionId: 'metadata-create-collection',
            parentId: folder.id,
            name: 'Created Request',
            method: 'POST',
            url: 'https://api.example.com/items',
            headers: [
                {
                    key: 'X-Trace-Id',
                    value: 'trace-123',
                    enabled: true,
                    description: 'Trace identifier',
                    type: 'string',
                    required: true,
                    deprecated: false,
                    format: 'uuid',
                    enum: ['trace-123']
                }
            ],
            query: [
                {
                    key: 'active',
                    value: '1',
                    enabled: true,
                    description: 'Only active records',
                    type: 'integer',
                    required: true,
                    deprecated: false,
                    format: 'int32',
                    pattern: '^\\d+$'
                },
                {
                    key: 'inactive',
                    value: '0',
                    enabled: false,
                    description: 'Inactive flag',
                    type: 'integer',
                    required: false,
                    deprecated: true,
                    minimum: 0,
                    maximum: 1
                }
            ],
            params: {},
            body: { type: 'none', content: null },
            auth: { type: 'inherit' },
            description: 'Created through the service layer',
            deprecated: true
        } as any);

        expect(createdRequest.name).toBe('Created Request');
        expect(createdRequest.id).toBeDefined();

        const reloadedService = new CollectionService(configService, undefined);
        const reloaded = reloadedService.getCollection('metadata-create-collection');
        const reloadedFolder = reloaded?.items[0] as any;
        const reloadedRequest = reloadedFolder?.items?.[0] as any;

        expect(reloadedFolder?.type).toBe('folder');
        expect(reloadedFolder?.name).toBe('Created Folder');
        expect(reloadedRequest?.name).toBe('Created Request');
        expect(reloadedRequest?.headers).toEqual([
            {
                key: 'X-Trace-Id',
                value: 'trace-123',
                enabled: true,
                description: 'Trace identifier',
                type: 'string',
                required: true,
                deprecated: false,
                format: 'uuid',
                enum: ['trace-123']
            }
        ]);
        expect(reloadedRequest?.query).toEqual([
            {
                key: 'active',
                value: '1',
                enabled: true,
                description: 'Only active records',
                type: 'integer',
                required: true,
                deprecated: false,
                format: 'int32',
                pattern: '^\\d+$'
            },
            {
                key: 'inactive',
                value: '0',
                enabled: false,
                description: 'Inactive flag',
                type: 'integer',
                required: false,
                deprecated: true,
                minimum: 0,
                maximum: 1
            }
        ]);
    });

    it('preserves richer header and query metadata through request rename and move', async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'http-forge-metadata-move-'));
        const configService = new ConfigService(workspaceRoot, undefined, undefined as any);
        await configService.createDefaultConfig();

        const collectionService = new CollectionService(configService, undefined);
        const collection: Collection = {
            id: 'metadata-move-collection',
            name: 'Metadata Move Collection',
            items: []
        };

        await collectionService.saveCollection(collection);

        const sourceFolder = await collectionService.createFolder({
            name: 'Source Folder',
            collectionId: 'metadata-move-collection'
        });

        const targetFolder = await collectionService.createFolder({
            name: 'Target Folder',
            collectionId: 'metadata-move-collection'
        });

        const request = await collectionService.createRequest({
            collectionId: 'metadata-move-collection',
            parentId: sourceFolder.id,
            name: 'Move Me',
            method: 'GET',
            url: 'https://api.example.com/items',
            headers: [
                {
                    key: 'X-Trace-Id',
                    value: 'trace-123',
                    enabled: true,
                    description: 'Trace identifier',
                    type: 'string',
                    required: true,
                    deprecated: false,
                    format: 'uuid',
                    enum: ['trace-123']
                }
            ],
            query: [
                {
                    key: 'active',
                    value: '1',
                    enabled: true,
                    description: 'Only active records',
                    type: 'integer',
                    required: true,
                    deprecated: false,
                    format: 'int32',
                    pattern: '^\\d+$'
                }
            ],
            params: {},
            body: { type: 'none', content: null }
        } as any);

        const renamed = await collectionService.renameRequest(
            'metadata-move-collection',
            request.id,
            'Moved Request'
        );
        expect(renamed).toBe(true);

        const moved = await collectionService.moveItem(
            'metadata-move-collection',
            request.id,
            targetFolder.id
        );
        expect(moved).toBe(true);

        const reloadedService = new CollectionService(configService, undefined);
        const reloaded = reloadedService.getCollection('metadata-move-collection');
        const reloadedSource = reloaded?.items.find((item: any) => item.id === sourceFolder.id) as any;
        const reloadedTarget = reloaded?.items.find((item: any) => item.id === targetFolder.id) as any;
        const movedRequest = reloadedTarget?.items?.find((item: any) => item.id === request.id) as any;

        expect(reloadedSource?.items ?? []).toHaveLength(0);
        expect(reloadedTarget?.type).toBe('folder');
        expect(movedRequest?.name).toBe('Moved Request');
        expect(movedRequest?.headers).toEqual([
            {
                key: 'X-Trace-Id',
                value: 'trace-123',
                enabled: true,
                description: 'Trace identifier',
                type: 'string',
                required: true,
                deprecated: false,
                format: 'uuid',
                enum: ['trace-123']
            }
        ]);
        expect(movedRequest?.query).toEqual([
            {
                key: 'active',
                value: '1',
                enabled: true,
                description: 'Only active records',
                type: 'integer',
                required: true,
                deprecated: false,
                format: 'int32',
                pattern: '^\\d+$'
            }
        ]);
    });
});

describe('Collection auth inheritance', () => {
    function createExecutor(collectionAuth?: any) {
        const captured: { auth?: any } = {};

        const httpService = {
            buildUrl: (url: string) => url,
            execute: async () => ({
                status: 200,
                statusText: 'OK',
                headers: {},
                body: 'ok',
                time: 1,
                cookies: []
            })
        };

        const envConfigService = {
            getResolvedEnvironment: () => ({ name: 'dev', headers: {}, variables: {} }),
            getGlobalVariables: () => ({}),
            resolveVariablesInObject: <T>(value: T) => value,
            resolveVariablesInObjectWithExtra: <T>(value: T) => value,
            resolveVariables: (value: string) => value,
            resolveVariablesWithExtra: (value: string) => value
        };

        const requestPreparer = {
            prepareRequest: async (input: any) => {
                captured.auth = input.auth;
                return {
                    url: input.url,
                    method: input.method,
                    headers: {},
                    body: { type: 'none', content: null },
                    params: {},
                    query: {}
                };
            }
        };

        const scriptExecutor = {
            createRequestSession: () => ({
                executePreRequest: async () => ({ success: true, testResults: [] }),
                executePostResponse: async () => ({ testResults: [] })
            })
        };

        const executor = new CollectionRequestExecutor(
            httpService as any,
            scriptExecutor as any,
            envConfigService as any,
            requestPreparer as any,
            'dev',
            undefined,
            undefined,
            undefined,
            undefined,
            'Imported Collection',
            collectionAuth
        );

        return { executor, captured };
    }

    it('applies collection auth when the request auth is inherit', async () => {
        const { executor, captured } = createExecutor({ type: 'bearer', bearerToken: 'collection-token' });

        await executor.execute({
            id: 'req-1',
            name: 'Request',
            method: 'GET',
            url: 'https://api.example.com',
            auth: { type: 'inherit' }
        } as any, {});

        expect(captured.auth).toEqual({ type: 'bearer', bearerToken: 'collection-token' });
    });

    it('keeps explicit request auth when it is set', async () => {
        const { executor, captured } = createExecutor({ type: 'bearer', bearerToken: 'collection-token' });

        await executor.execute({
            id: 'req-2',
            name: 'Request',
            method: 'GET',
            url: 'https://api.example.com',
            auth: { type: 'bearer', bearerToken: 'request-token' }
        } as any, {});

        expect(captured.auth).toEqual({ type: 'bearer', bearerToken: 'request-token' });
    });
});

describe('Postman environment import', () => {
    it('parses nested environment exports with enabled variables only', () => {
        const imported = parsePostmanEnvironment(JSON.stringify({
            environment: {
                name: 'dev',
                description: 'Development environment',
                values: [
                    { key: 'baseUrl', value: 'https://dev.example.com', enabled: true },
                    { key: 'secret', value: 'should-not-import', enabled: false }
                ],
                _postman_exported_at: '2026-07-03T00:00:00Z'
            }
        }));

        expect(imported).toEqual({
            name: 'dev',
            variables: {
                baseUrl: 'https://dev.example.com'
            },
            description: 'Imported from Postman export'
        });
    });
});
