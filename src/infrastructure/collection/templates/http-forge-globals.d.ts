// Ambient declarations for HTTP Forge script globals.
// These globals are injected by HTTP Forge at runtime when scripts execute.

interface HttpForgeVariableScope {
    get(key: string): any;
    set(key: string, value: any): void;
    unset(key: string): void;
    toObject(): Record<string, any>;
    name?: string;
}

interface HttpForgeResponse {
    code: number;
    status: number;
    statusText: string;
    body: any;
    headers: { get(name: string): string | undefined; [key: string]: any };
    responseTime: number;
    responseSize: number;
    json(): any;
    text(): string;
    reason(): string;
    getHeader(name: string): string | undefined;
    getCookie(name: string): any;
    cookie(name: string): any;
    hasCookie(name: string): boolean;
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

interface HttpForgeRequest {
    method: string;
    url: string;
    body: any;
    headers: Record<string, any>;
}

interface HttpForgePm {
    request: HttpForgeRequest;
    response: HttpForgeResponse;
    environment: HttpForgeVariableScope;
    globals: HttpForgeVariableScope;
    collectionVariables: HttpForgeVariableScope;
    variables: HttpForgeVariableScope;
    cookies: {
        get(name: string): any;
        set(name: string, value: any): void;
        has(name: string): boolean;
        list(): Array<{ name: string; value: any }>;
        jar(): Record<string, any>;
        remove(name: string): void;
        clear(): void;
        toString(): string;
    };
    test(name: string, fn: () => void | Promise<void>): void;
    expect(value: any): {
        to: {
            equal(expected: any): any;
            eql(expected: any): any;
            have: {
                property(name: string, value?: any): any;
                jsonSchema(schema: any): any;
            };
            be: { ok: any; true: any; false: any; null: any; empty: any };
            not: any;
        };
    };
    info: {
        eventName: string;
        requestName: string;
        requestId: string;
        iteration: number;
        iterationCount: number;
    };
}

declare const pm: HttpForgePm;
declare const ctx: HttpForgePm;
declare const hf: HttpForgePm;
declare const request: HttpForgeRequest;
declare const response: HttpForgeResponse;
declare const responseBody: any;
declare const tests: Record<string, boolean>;
declare const outputExceptionError: (error: any) => void;
declare const CryptoJS: any;
declare const agl: any;