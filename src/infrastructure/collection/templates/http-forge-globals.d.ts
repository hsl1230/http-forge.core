// Ambient declarations for HTTP Forge script globals.
// These globals are injected by HTTP Forge at runtime when scripts execute.

interface HttpForgeVariableScope {
    get(key: string): any;
    set(key: string, value: any): void;
    has(key: string): boolean;
    unset(key: string): void;
    clear(): void;
    toObject(): Record<string, any>;
    replaceIn(str: string): string;
    name?: string;
}

interface HttpForgeCookie {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: string;
    maxAge?: number;
    httpOnly: boolean;
    secure: boolean;
    session: boolean;
    hostOnly: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
    valueOf(): string;
    toString(): string;
}

interface HttpForgeCookieList extends Array<HttpForgeCookie> {
    get(name: string): string | undefined;
    one(name: string): HttpForgeCookie | undefined;
    has(name: string): boolean;
    toObject(): Record<string, string>;
    all(): HttpForgeCookie[];
    each(cb: (cookie: HttpForgeCookie) => void): void;
    count(): number;
    idx(index: number): HttpForgeCookie | undefined;
}

type HttpForgeHeaderList = Record<string, string | undefined> & {
    get(name: string): string | undefined;
    has(name: string): boolean;
    toObject(): Record<string, string>;
    each(cb: (header: { key: string; value: string }) => void): void;
};

interface HttpForgeResponse {
    code: number;
    status: string;
    statusText: string;
    body: any;
    headers: HttpForgeHeaderList;
    cookies: HttpForgeCookieList;
    responseTime?: number;
    responseSize?: number;
    json(): any;
    text(): string;
    reason(): string;
    to: {
        have: {
            status(code: number): void;
            header(name: string, value?: string): void;
            body(value?: any): void;
            jsonBody(value?: any): void;
            jsonSchema(schema: any): void;
        };
        be: {
            ok: void;
            success: void;
            error: void;
            clientError: void;
            serverError: void;
        };
    };
}

interface HttpForgeRequestUrl {
    toString(): string;
    valueOf(): string;
    getHost(): string;
    getPath(): string;
    getPathWithQuery(): string;
    getQueryString(): string;
    getRemote(): string;
    getOAuth1BaseUrl(): string;
    protocol: string;
    host: string[];
    port: string;
    path: string[];
    hash: string;
    query: {
        toObject(): Record<string, string>;
        has(key: string): boolean;
        get(key: string): string | undefined;
        each(cb: (param: { key: string; value: string }) => void): void;
    };
}

interface HttpForgeRequest {
    url: HttpForgeRequestUrl;
    method: string;
    headers: HttpForgeHeaderList;
    body: any;
    params: Record<string, any>;
    query: Record<string, any>;
    auth: any;
    certificate: any;
    description: string | null;
    name: string | null;
    id: string | null;
    disabled: boolean;
    messages: any[];
    methodPath: any;
    metadata: any[];
    getHeaders(options?: any): any;
}

interface HttpForgeSendRequestResponse {
    status: number;
    statusText: string;
    headers: Record<string, string | string[]>;
    cookies: Array<{ name: string; value: string; [key: string]: any }>;
    body: any;
    time: number;
    size?: number;
}

interface HttpForgeExecutionLocation {
    current: string;
    currentRequestName: string;
    eventName: string;
    toString(): string;
}

interface HttpForgeExecution {
    setNextRequest(requestName: string | null): void;
    skipRequest(): void;
    runRequest(target: string | Record<string, any>, callback?: (err: Error | null, res?: HttpForgeResponse) => void): Promise<HttpForgeResponse> | void;
    location: HttpForgeExecutionLocation;
}

interface HttpForgeVisualizer {
    set(template: string, data?: any): void;
    clear(): void;
}

interface HttpForgeTestFn {
    (name: string, fn: () => void | Promise<void>): void;
    skip(name: string, fn?: () => void | Promise<void>): void;
    fail(name?: string): void;
    index(): number;
}

interface HttpForgePostman {
    setNextRequest(requestName: string | null): void;
    setGlobalVariable(key: string, value: any): void;
    getGlobalVariable(key: string): any;
    clearGlobalVariable(key: string): void;
    setEnvironmentVariable(key: string, value: any): void;
    getEnvironmentVariable(key: string): any;
    clearEnvironmentVariable(key: string): void;
    getResponseHeader(name: string): string | null;
    getResponseCookie(name: string): Record<string, any> | null;
}

interface HttpForgeExpectChain {
    // Internal state
    _value: any;
    _negated: boolean;
    _deep: boolean;

    // Language-chain properties (no-ops for readability)
    to: HttpForgeExpectChain;
    be: HttpForgeExpectChain;
    been: HttpForgeExpectChain;
    is: HttpForgeExpectChain;
    that: HttpForgeExpectChain;
    which: HttpForgeExpectChain;
    and: HttpForgeExpectChain;
    has: HttpForgeExpectChain;
    have: HttpForgeExpectChain;
    with: HttpForgeExpectChain;
    at: HttpForgeExpectChain;
    of: HttpForgeExpectChain;
    same: HttpForgeExpectChain;
    but: HttpForgeExpectChain;
    does: HttpForgeExpectChain;
    still: HttpForgeExpectChain;
    also: HttpForgeExpectChain;

    // Chain modifiers / flags
    not: HttpForgeExpectChain;
    deep: HttpForgeExpectChain;
    nested: HttpForgeExpectChain;
    own: HttpForgeExpectChain;
    ordered: HttpForgeExpectChain;
    any: HttpForgeExpectChain;
    all: HttpForgeExpectChain;
    itself: HttpForgeExpectChain;

    // Type / existence / state getters
    ok: HttpForgeExpectChain;
    true: HttpForgeExpectChain;
    false: HttpForgeExpectChain;
    null: HttpForgeExpectChain;
    undefined: HttpForgeExpectChain;
    NaN: HttpForgeExpectChain;
    exist: HttpForgeExpectChain;
    exists: HttpForgeExpectChain;
    empty: HttpForgeExpectChain;
    arguments: HttpForgeExpectChain;
    Arguments: HttpForgeExpectChain;
    extensible: HttpForgeExpectChain;
    sealed: HttpForgeExpectChain;
    frozen: HttpForgeExpectChain;
    finite: HttpForgeExpectChain;

    // Core assertion methods — Equality
    equal(expected: any): HttpForgeExpectChain;
    eq(expected: any): HttpForgeExpectChain;
    equals(expected: any): HttpForgeExpectChain;
    eql(expected: any): HttpForgeExpectChain;
    eqls(expected: any): HttpForgeExpectChain;

    // Membership / inclusion
    include(value: any): HttpForgeExpectChain;
    includes(value: any): HttpForgeExpectChain;
    contain(value: any): HttpForgeExpectChain;
    contains(value: any): HttpForgeExpectChain;
    oneOf(values: any[]): HttpForgeExpectChain;

    // Object shape
    property(name: string, value?: any): HttpForgeExpectChain;
    ownPropertyDescriptor(name: string, descriptor?: PropertyDescriptor): HttpForgeExpectChain;
    haveOwnPropertyDescriptor(name: string, descriptor?: PropertyDescriptor): HttpForgeExpectChain;
    keys(...args: any[]): HttpForgeExpectChain;
    key(...args: any[]): HttpForgeExpectChain;
    members(arr: any[]): HttpForgeExpectChain;

    // String / pattern
    string(substr: string): HttpForgeExpectChain;
    match(pattern: RegExp): HttpForgeExpectChain;
    matches(pattern: RegExp): HttpForgeExpectChain;

    // Type check
    a(type: string): HttpForgeExpectChain;
    an(type: string): HttpForgeExpectChain;

    // Size
    length(len: number): HttpForgeExpectChain;
    lengthOf(len: number): HttpForgeExpectChain;

    // Predicate
    satisfy(matcher: (value: any) => any): HttpForgeExpectChain;
    satisfies(matcher: (value: any) => any): HttpForgeExpectChain;

    // Postman-specific
    jsonSchema(schema: any): HttpForgeExpectChain;

    // Numeric / range
    above(num: number): HttpForgeExpectChain;
    gt(num: number): HttpForgeExpectChain;
    greaterThan(num: number): HttpForgeExpectChain;
    least(num: number): HttpForgeExpectChain;
    gte(num: number): HttpForgeExpectChain;
    greaterThanOrEqual(num: number): HttpForgeExpectChain;
    below(num: number): HttpForgeExpectChain;
    lt(num: number): HttpForgeExpectChain;
    lessThan(num: number): HttpForgeExpectChain;
    most(num: number): HttpForgeExpectChain;
    lte(num: number): HttpForgeExpectChain;
    lessThanOrEqual(num: number): HttpForgeExpectChain;
    within(start: number, end: number): HttpForgeExpectChain;
    closeTo(expected: number, delta: number): HttpForgeExpectChain;
    approximately(expected: number, delta: number): HttpForgeExpectChain;

    // Instance / function behavior
    instanceOf(constructor: Function): HttpForgeExpectChain;
    instanceof(constructor: Function): HttpForgeExpectChain;
    throw(...args: any[]): HttpForgeExpectChain;
    throws(...args: any[]): HttpForgeExpectChain;
    Throw(...args: any[]): HttpForgeExpectChain;
    respondTo(method: string): HttpForgeExpectChain;
    respondsTo(method: string): HttpForgeExpectChain;

    // State-change assertions (must wrap a function)
    change(subject: any, prop?: string): HttpForgeExpectChain;
    changes(subject: any, prop?: string): HttpForgeExpectChain;
    increase(subject: any, prop?: string): HttpForgeExpectChain;
    increases(subject: any, prop?: string): HttpForgeExpectChain;
    decrease(subject: any, prop?: string): HttpForgeExpectChain;
    decreases(subject: any, prop?: string): HttpForgeExpectChain;
    by(delta: number): HttpForgeExpectChain;
}

interface HttpForgePm {
    request: HttpForgeRequest;
    response: HttpForgeResponse;
    environment: HttpForgeVariableScope;
    globals: HttpForgeVariableScope;
    collectionVariables: HttpForgeVariableScope;
    variables: HttpForgeVariableScope;
    iterationData: { get(key: string): any; has(key: string): boolean; toObject(): Record<string, any>; toJSON(): string };
    cookies: {
        get(name: string): string | undefined;
        set(name: string, value: any): void;
        has(name: string): boolean;
        list(): Array<{ name: string; value: string }>;
        toObject(): Record<string, string>;
        jar(): {
            getAll(domain: any, callback: (error: any, cookies: any[]) => void): void;
            get(domain: any, name: string, callback: (error: any, cookie: any) => void): void;
            set(domain: any, nameOrCookie: string | Record<string, any>, valueOrCallback?: any, callback?: (error: any) => void): void;
            unset(domain: any, name: string, callback?: (error: any) => void): void;
            clear(domainOrCallback?: any, callback?: (error: any) => void): void;
        };
    };
    test: HttpForgeTestFn;
    expect: ((value: any) => HttpForgeExpectChain) & { fail(message?: string, ...args: any[]): never };
    info: {
        eventName: string;
        requestName: string;
        requestId: string;
        iteration: number;
        iterationCount: number;
    };
    sendRequest(urlOrOptions: string | Record<string, any>, callback?: (err: Error | null, res?: HttpForgeSendRequestResponse) => void): Promise<HttpForgeSendRequestResponse> | void;
    execution: HttpForgeExecution;
    visualizer: HttpForgeVisualizer;
    setNextRequest(requestName: string | null): void;
}

declare const pm: HttpForgePm;
declare const ctx: HttpForgePm;
declare const hf: HttpForgePm;
declare const postman: HttpForgePostman;
declare const request: HttpForgeRequest;
declare const response: HttpForgeResponse;
declare const responseBody: any;
declare const responseCode: { code: number; name: string; detail: string };
declare const responseHeaders: Record<string, string>;
declare const responseTime: number;
declare const responseCookies: Array<Record<string, any>>;
declare const tests: Record<string, boolean>;
declare const environment: Record<string, any>;
declare const globals: Record<string, any>;
declare const data: Record<string, any>;
declare const iteration: number;
declare const jsonStringify: (value: any, replacer?: any, space?: any) => string;
declare const jsonParse: (text: string) => any;
declare const xml2Json: (xmlStr: string) => any;
/** CryptoJS library (crypto-js). Available via HTTP Forge's module loader. */
declare const CryptoJS: {
    MD5(message: string): { toString(): string };
    SHA1(message: string): { toString(): string };
    SHA256(message: string): { toString(): string };
    SHA512(message: string): { toString(): string };
    AES: { encrypt(message: string, key: string): { toString(): string }; decrypt(ciphertext: string, key: string): { toString(enc: any): string } };
    enc: { Utf8: any; Hex: any; Base64: any };
    [key: string]: any;
};

/** Lodash utility library (_). Available via HTTP Forge's module loader. */
declare const _: {
    // Collection
    forEach(collection: any, iteratee?: any): any;
    map(collection: any, iteratee?: any): any[];
    filter(collection: any, predicate?: any): any[];
    reduce(collection: any, iteratee?: any, accumulator?: any): any;
    reduceRight(collection: any, iteratee?: any, accumulator?: any): any;
    find(collection: any, predicate?: any, fromIndex?: number): any;
    findLast(collection: any, predicate?: any, fromIndex?: number): any;
    reject(collection: any, predicate?: any): any[];
    every(collection: any, predicate?: any): boolean;
    some(collection: any, predicate?: any): boolean;
    includes(collection: any, value: any, fromIndex?: number): boolean;
    invoke(collection: any, path: any, ...args: any[]): any;
    invokeMap(collection: any, path: any, ...args: any[]): any[];
    // Array
    chunk(array: any, size?: number): any[];
    compact(array: any): any[];
    concat(...arrays: any[]): any[];
    difference(array: any, ...values: any[]): any[];
    differenceBy(array: any, ...values: any[]): any[];
    differenceWith(array: any, ...values: any[]): any[];
    drop(array: any, n?: number): any[];
    dropRight(array: any, n?: number): any[];
    dropRightWhile(array: any, predicate?: any): any[];
    dropWhile(array: any, predicate?: any): any[];
    fill(array: any, value: any, start?: number, end?: number): any[];
    findIndex(array: any, predicate?: any, fromIndex?: number): number;
    findLastIndex(array: any, predicate?: any, fromIndex?: number): number;
    first(array: any): any;
    head(array: any): any;
    flatten(array: any): any[];
    flattenDeep(array: any): any[];
    flattenDepth(array: any, depth?: number): any[];
    fromPairs(pairs: any): Record<string, any>;
    indexOf(array: any, value: any, fromIndex?: number): number;
    initial(array: any): any[];
    intersection(...arrays: any[]): any[];
    intersectionBy(...arrays: any[]): any[];
    intersectionWith(...arrays: any[]): any[];
    join(array: any, separator?: string): string;
    last(array: any): any;
    lastIndexOf(array: any, value: any, fromIndex?: number): number;
    nth(array: any, n?: number): any;
    pull(array: any, ...values: any[]): any[];
    pullAll(array: any, values: any): any[];
    pullAllBy(array: any, values: any, iteratee?: any): any[];
    pullAllWith(array: any, values: any, comparator?: any): any[];
    pullAt(array: any, ...indexes: any[]): any[];
    remove(array: any, predicate?: any): any[];
    reverse(array: any): any[];
    slice(array: any, start?: number, end?: number): any[];
    sortedIndex(array: any, value: any): number;
    sortedIndexBy(array: any, value: any, iteratee?: any): number;
    sortedIndexOf(array: any, value: any): number;
    sortedLastIndex(array: any, value: any): number;
    sortedLastIndexBy(array: any, value: any, iteratee?: any): number;
    sortedLastIndexOf(array: any, value: any): number;
    sortedUniq(array: any): any[];
    sortedUniqBy(array: any, iteratee?: any): any[];
    tail(array: any): any[];
    take(array: any, n?: number): any[];
    takeRight(array: any, n?: number): any[];
    takeRightWhile(array: any, predicate?: any): any[];
    takeWhile(array: any, predicate?: any): any[];
    union(...arrays: any[]): any[];
    unionBy(...arrays: any[]): any[];
    unionWith(...arrays: any[]): any[];
    uniq(array: any): any[];
    uniqBy(array: any, iteratee?: any): any[];
    uniqWith(array: any, comparator?: any): any[];
    unzip(array: any): any[];
    unzipWith(array: any, iteratee?: any): any[];
    without(array: any, ...values: any[]): any[];
    xor(...arrays: any[]): any[];
    xorBy(...arrays: any[]): any[];
    xorWith(...arrays: any[]): any[];
    zip(...arrays: any[]): any[];
    zipObject(props: any, values?: any): Record<string, any>;
    zipObjectDeep(props: any, values?: any): Record<string, any>;
    zipWith(...arrays: any[]): any[];
    // Object
    assign(object: any, ...sources: any[]): any;
    assignIn(object: any, ...sources: any[]): any;
    assignInWith(object: any, ...sources: any[]): any;
    assignWith(object: any, ...sources: any[]): any;
    at(object: any, ...paths: any[]): any[];
    create(proto: any, properties?: any): any;
    defaults(object: any, ...sources: any[]): any;
    defaultsDeep(object: any, ...sources: any[]): any;
    entries(object: any): Array<[string, any]>;
    entriesIn(object: any): Array<[string, any]>;
    extend(object: any, ...sources: any[]): any;
    extendWith(object: any, ...sources: any[]): any;
    findKey(object: any, predicate?: any): string | undefined;
    findLastKey(object: any, predicate?: any): string | undefined;
    forIn(object: any, iteratee?: any): any;
    forInRight(object: any, iteratee?: any): any;
    forOwn(object: any, iteratee?: any): any;
    forOwnRight(object: any, iteratee?: any): any;
    functions(object: any): string[];
    functionsIn(object: any): string[];
    get(object: any, path: any, defaultValue?: any): any;
    has(object: any, path: any): boolean;
    hasIn(object: any, path: any): boolean;
    invert(object: any): Record<string, string>;
    invertBy(object: any, iteratee?: any): Record<string, string[]>;
    invoke(object: any, path: any, ...args: any[]): any;
    invokePath(object: any, path: any, ...args: any[]): any;
    keys(object: any): string[];
    keysIn(object: any): string[];
    mapKeys(object: any, iteratee?: any): Record<string, any>;
    mapValues(object: any, iteratee?: any): Record<string, any>;
    merge(object: any, ...sources: any[]): any;
    mergeWith(object: any, ...sources: any[]): any;
    omit(object: any, ...paths: any[]): any;
    omitBy(object: any, predicate?: any): any;
    pick(object: any, ...paths: any[]): any;
    pickBy(object: any, predicate?: any): any;
    result(object: any, path: any, defaultValue?: any): any;
    set(object: any, path: any, value: any): any;
    setWith(object: any, path: any, value: any, customizer?: any): any;
    toPairs(object: any): Array<[string, any]>;
    toPairsIn(object: any): Array<[string, any]>;
    transform(object: any, iteratee?: any, accumulator?: any): any;
    unset(object: any, path: any): boolean;
    update(object: any, path: any, updater: any): any;
    updateWith(object: any, path: any, updater: any, customizer?: any): any;
    values(object: any): any[];
    valuesIn(object: any): any[];
    // String
    camelCase(string?: any): string;
    capitalize(string?: any): string;
    deburr(string?: any): string;
    endsWith(string?: any, target?: any, position?: number): boolean;
    escape(string?: any): string;
    escapeRegExp(string?: any): string;
    kebabCase(string?: any): string;
    lowerCase(string?: any): string;
    lowerFirst(string?: any): string;
    pad(string?: any, length?: number, chars?: string): string;
    padEnd(string?: any, length?: number, chars?: string): string;
    padStart(string?: any, length?: number, chars?: string): string;
    parseInt(string?: any, radix?: number): number;
    repeat(string?: any, n?: number): string;
    replace(string?: any, pattern?: any, replacement?: any): string;
    snakeCase(string?: any): string;
    split(string?: any, separator?: any, limit?: number): string[];
    startCase(string?: any): string;
    startsWith(string?: any, target?: any, position?: number): boolean;
    template(string?: any, options?: any): any;
    toLower(string?: any): string;
    toUpper(string?: any): string;
    trim(string?: any, chars?: string): string;
    trimEnd(string?: any, chars?: string): string;
    trimStart(string?: any, chars?: string): string;
    truncate(string?: any, options?: any): string;
    unescape(string?: any): string;
    upperCase(string?: any): string;
    upperFirst(string?: any): string;
    words(string?: any, pattern?: any): string[];
    // Lang
    clone(value: any): any;
    cloneDeep(value: any): any;
    cloneDeepWith(value: any, customizer?: any): any;
    cloneWith(value: any, customizer?: any): any;
    conformsTo(object: any, source: any): boolean;
    eq(value: any, other: any): boolean;
    gt(value: any, other: any): boolean;
    gte(value: any, other: any): boolean;
    isArguments(value: any): boolean;
    isArray(value: any): boolean;
    isArrayBuffer(value: any): boolean;
    isArrayLike(value: any): boolean;
    isArrayLikeObject(value: any): boolean;
    isBoolean(value: any): boolean;
    isBuffer(value: any): boolean;
    isDate(value: any): boolean;
    isElement(value: any): boolean;
    isEmpty(value: any): boolean;
    isEqual(value: any, other: any): boolean;
    isEqualWith(value: any, other: any, customizer?: any): boolean;
    isError(value: any): boolean;
    isFinite(value: any): boolean;
    isFunction(value: any): boolean;
    isInteger(value: any): boolean;
    isLength(value: any): boolean;
    isMap(value: any): boolean;
    isMatch(object: any, source: any): boolean;
    isMatchWith(object: any, source: any, customizer?: any): boolean;
    isNaN(value: any): boolean;
    isNative(value: any): boolean;
    isNil(value: any): boolean;
    isNull(value: any): boolean;
    isNumber(value: any): boolean;
    isObject(value: any): boolean;
    isObjectLike(value: any): boolean;
    isPlainObject(value: any): boolean;
    isRegExp(value: any): boolean;
    isSafeInteger(value: any): boolean;
    isSet(value: any): boolean;
    isString(value: any): boolean;
    isSymbol(value: any): boolean;
    isTypedArray(value: any): boolean;
    isUndefined(value: any): boolean;
    isWeakMap(value: any): boolean;
    isWeakSet(value: any): boolean;
    lt(value: any, other: any): boolean;
    lte(value: any, other: any): boolean;
    toArray(value: any): any[];
    toFinite(value: any): number;
    toInteger(value: any): number;
    toLength(value: any): number;
    toNumber(value: any): number;
    toPlainObject(value: any): Record<string, any>;
    toSafeInteger(value: any): number;
    toString(value: any): string;
    // Math
    add(augend: any, addend: any): number;
    ceil(number: any, precision?: number): number;
    divide(dividend: any, divisor: any): number;
    floor(number: any, precision?: number): number;
    max(array: any): any;
    maxBy(array: any, iteratee?: any): any;
    mean(array: any): number;
    meanBy(array: any, iteratee?: any): number;
    min(array: any): any;
    minBy(array: any, iteratee?: any): any;
    multiply(multiplier: any, multiplicand: any): number;
    round(number: any, precision?: number): number;
    subtract(minuend: any, subtrahend: any): number;
    sum(array: any): number;
    sumBy(array: any, iteratee?: any): number;
    // Number
    clamp(number: any, lower: any, upper: any): number;
    inRange(number: any, start: any, end?: any): boolean;
    random(lower?: any, upper?: any, floating?: boolean): number;
    // Object (already above)
    // Seq
    chain(value: any): any;
    tap(value: any, interceptor: any): any;
    thru(value: any, interceptor: any): any;
    // Util
    attempt(func: any, ...args: any[]): any;
    bindAll(object: any, ...methodNames: any[]): any;
    cond(pairs: any): any;
    conforms(source: any): any;
    constant(value: any): () => any;
    defaultTo(value: any, defaultValue: any): any;
    flow(...funcs: any[]): any;
    flowRight(...funcs: any[]): any;
    identity(value: any): any;
    iteratee(value?: any): any;
    matches(source: any): any;
    matchesProperty(path: any, srcValue: any): any;
    method(path: any, ...args: any[]): any;
    methodOf(object: any, ...args: any[]): any;
    mixin(object?: any, source?: any, options?: any): any;
    noConflict(): any;
    noop(): void;
    nthArg(n?: number): any;
    over(...iteratees: any[]): any;
    overEvery(...predicates: any[]): any;
    overSome(...predicates: any[]): any;
    property(path: any): any;
    propertyOf(object: any): any;
    range(start?: any, end?: any, step?: any): number[];
    rangeRight(start?: any, end?: any, step?: any): number[];
    runInContext(context?: any): any;
    stubArray(): any[];
    stubFalse(): boolean;
    stubObject(): Record<string, any>;
    stubString(): string;
    stubTrue(): boolean;
    times(n: number, iteratee?: any): any[];
    toPath(value: any): string[];
    uniqueId(prefix?: string): string;
    version: string;
    // Template
    template(string?: any, options?: any): any;
    // Date (defer to moment)
    [key: string]: any;
};

/** Moment.js-compatible shim (always available). For full moment.js, use pm.require('moment'). */
declare const moment: ((input?: any, format?: string) => {
    format(fmt?: string): string;
    toISOString(): string;
    unix(): number;
    [key: string]: any;
}) & {
    utc(input?: any, format?: string): { format(fmt?: string): string; toISOString(): string };
    __isShim: true;
    __warning: string;
    [key: string]: any;
};

/** Node.js querystring module. Available via HTTP Forge's module loader. */
declare const querystring: {
    parse(str: string, sep?: string, eq?: string, options?: { maxKeys?: number }): Record<string, string | string[]>;
    stringify(obj: Record<string, any>, sep?: string, eq?: string, options?: { encodeURIComponent?: (str: string) => string }): string;
    escape(str: string): string;
    unescape(str: string): string;
};

// crypto, Buffer, URL, URLSearchParams, TextEncoder, TextDecoder, console,
// setTimeout, etc. are provided by @types/node (referenced via jsconfig.json
// "types": ["node"]). Installed in .http-forge/assets/lib by default.
/** tv4 JSON Schema validator (optional — undefined if not installed). */
declare const tv4: { validate: (data: any, schema: any) => boolean; [key: string]: any } | undefined;
