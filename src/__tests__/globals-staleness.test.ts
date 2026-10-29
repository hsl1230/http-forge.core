/**
 * Globals staleness reproduction test
 *
 * Verifies that pm.globals.set() / postman.setGlobalVariable() written in
 * request A's post-response script are visible as {{key}} in request B.
 *
 * Three layers tested:
 *  1. EnvironmentConfigService alone — setGlobalVariable + resolveVariables
 *  2. ScriptExecutor session — postman.setGlobalVariable fires onGlobalsChange
 *  3. Cross-request chaining — globals written in session A visible via service in session B
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { EnvironmentConfigService } from '../infrastructure/environment/environment-config-service';
import type { PreRequestScriptContext, ResponseContext } from '../infrastructure/script/interfaces';
import { ScriptExecutor } from '../infrastructure/script/script-executor';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function createEnvService(initialGlobals: Record<string, string> = {}): EnvironmentConfigService {
    const store = new Map<string, unknown>();
    const workspaceStore: any = {
        get: (key: string, def?: unknown) => (store.has(key) ? store.get(key) : def),
        update: (key: string, value: unknown) => { store.set(key, value); return Promise.resolve(); }
    };
    const configService: any = {
        getEnvironmentsPath: () => '/tmp/hf-globals-test-envs',
        getHistoryPath: () => '/tmp/hf-globals-test-history'
    };

    const svc = new EnvironmentConfigService('/tmp/hf-globals-test', workspaceStore, configService);

    // Pre-seed configs so no disk I/O is needed
    (svc as any).sharedConfig = {
        globalVariables: { ...initialGlobals },
        defaultHeaders: {},
        environments: {
            dev: { variables: {} }
        }
    };
    (svc as any).localConfig = { credentials: {}, variables: {} };

    return svc;
}

function makeContext(
    svc: EnvironmentConfigService,
    globals: Record<string, string>
): PreRequestScriptContext {
    return {
        request: { url: 'http://example.com', method: 'GET', headers: {}, name: 'test', id: 'req1' },
        variables: {},
        environmentVariables: {},
        globals,
        environmentName: 'dev',
        onGlobalsChange: (action, key, value) => {
            if (action === 'set' && key !== undefined && value !== undefined) {
                svc.setGlobalVariable(key, value);
            } else if (action === 'unset' && key !== undefined) {
                svc.deleteGlobalVariable(key);
            } else if (action === 'clear') {
                svc.clearGlobalVariables();
            }
        }
    } as PreRequestScriptContext;
}

function makeResponseContext(): ResponseContext {
    return {
        executedRequest: { url: 'http://example.com', method: 'GET', headers: {}, body: { type: 'none', content: null }, params: {}, query: {} },
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ access_token: 'new-token-from-server' }),
        responseTime: 100
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// Layer 1: EnvironmentConfigService alone
// ──────────────────────────────────────────────────────────────────────────────

describe('Layer 1 – EnvironmentConfigService global propagation', () => {
    let svc: EnvironmentConfigService;

    beforeEach(() => {
        svc = createEnvService({ token: 'old-token' });
    });

    it('setGlobalVariable updates localGlobalValues and resolveVariables sees the new value', () => {
        expect(svc.resolveVariables('{{token}}', 'dev')).toBe('old-token');

        svc.setGlobalVariable('token', 'new-token');

        expect(svc.resolveVariables('{{token}}', 'dev')).toBe('new-token');
    });

    it('getGlobalVariables returns localGlobalValues over sharedConfig value', () => {
        svc.setGlobalVariable('token', 'runtime-value');
        const globals = svc.getGlobalVariables();
        expect(globals.token).toBe('runtime-value');
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// Layer 2: ScriptExecutor – postman.setGlobalVariable fires onGlobalsChange
// ──────────────────────────────────────────────────────────────────────────────

describe('Layer 2 – ScriptExecutor: postman.setGlobalVariable fires onGlobalsChange', () => {
    let svc: EnvironmentConfigService;
    let executor: ScriptExecutor;

    beforeEach(() => {
        svc = createEnvService({ token: 'old-token' });
        executor = new ScriptExecutor();
    });

    it('postman.setGlobalVariable in post-response script updates envService', async () => {
        const globals = svc.getGlobalVariables();
        const ctx = makeContext(svc, { ...globals });
        const session = executor.createRequestSession(ctx);

        // Simulate pre-request (no-op script)
        await session.executePreRequest('// no-op');

        // Post-response script uses the legacy postman.setGlobalVariable API
        await session.executePostResponse(
            `postman.setGlobalVariable('token', 'new-token');`,
            makeResponseContext()
        );

        // The service should now have the updated value
        expect(svc.getGlobalVariables().token).toBe('new-token');
    });

    it('pm.globals.set() in post-response script updates envService', async () => {
        const globals = svc.getGlobalVariables();
        const ctx = makeContext(svc, { ...globals });
        const session = executor.createRequestSession(ctx);

        await session.executePreRequest('// no-op');
        await session.executePostResponse(
            `pm.globals.set('token', 'pm-new-token');`,
            makeResponseContext()
        );

        expect(svc.getGlobalVariables().token).toBe('pm-new-token');
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// Layer 3: Cross-request chaining — globals written by session A visible in B
// ──────────────────────────────────────────────────────────────────────────────

describe('Layer 3 – Cross-request: globals from request A visible in request B', () => {
    let svc: EnvironmentConfigService;
    let executor: ScriptExecutor;

    beforeEach(() => {
        svc = createEnvService({ token: 'old-token' });
        executor = new ScriptExecutor();
    });

    it('resolveVariables after session A post-response returns new global', async () => {
        // ── Request A ──
        const globalsA = svc.getGlobalVariables();   // { token: 'old-token' }
        const ctxA = makeContext(svc, { ...globalsA });
        const sessionA = executor.createRequestSession(ctxA);

        await sessionA.executePreRequest('// no-op');
        await sessionA.executePostResponse(
            `postman.setGlobalVariable('token', 'new-token');`,
            makeResponseContext()
        );

        // ── Request B setup ──
        // (same service — simulates the singleton shared across suite requests)
        const globalsB = svc.getGlobalVariables();   // should be { token: 'new-token' }

        // Layer 1: the service returns the fresh value
        expect(globalsB.token).toBe('new-token');

        // Layer 2: createResolver inside the service resolves {{token}} to 'new-token'
        const resolved = svc.resolveVariables('Authorization: Bearer {{token}}', 'dev');
        expect(resolved).toBe('Authorization: Bearer new-token');
    });

    it('postman.setGlobalVariable with a value from pm.response.json() is propagated', async () => {
        // ── Request A ──
        const globalsA = svc.getGlobalVariables();
        const ctxA = makeContext(svc, { ...globalsA });
        const sessionA = executor.createRequestSession(ctxA);

        await sessionA.executePreRequest('// no-op');
        // Simulates extracting access_token from the response body
        await sessionA.executePostResponse(
            `var body = JSON.parse(responseBody);
             postman.setGlobalVariable('access_token', body.access_token);`,
            makeResponseContext()
        );

        // ── Request B ──
        const resolved = svc.resolveVariables('Bearer {{access_token}}', 'dev');
        expect(resolved).toBe('Bearer new-token-from-server');
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// Layer 4: 4-request chain — set, get, update, get again
//
// Mirrors the exact real-world suite pattern:
//   Req 1 post-response: postman.setGlobalVariable('token', 'token-1')
//   Req 2 pre-request:   reads {{token}}  →  expects 'token-1'
//   Req 3 post-response: postman.setGlobalVariable('token', 'token-3')
//   Req 4 pre-request:   reads {{token}}  →  expects 'token-3'
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Run a single simulated request through the script executor, mirroring what
 * CollectionRequestExecutor.execute() does:
 *  - snapshot fresh globals from svc  (like `initialGlobals = svc.getGlobalVariables()`)
 *  - create a session with those globals
 *  - run pre-request script
 *  - run post-response script
 * Returns { capturedToken } — the value of {{token}} as seen by the pre-request script.
 */
async function runSimulatedRequest(
    svc: EnvironmentConfigService,
    executor: ScriptExecutor,
    preScript: string,
    postScript: string
): Promise<{ capturedToken: string | undefined }> {
    // Mirror CollectionRequestExecutor: fresh snapshot at execute() time
    const globals = svc.getGlobalVariables();
    const ctx = makeContext(svc, { ...globals });
    const session = executor.createRequestSession(ctx);

    // Capture what {{token}} resolves to at pre-request time (via replaceIn)
    let capturedToken: string | undefined;
    const wrappedPre = preScript
        ? `${preScript}\n__capturedToken__ = pm.globals.get('token');`
        : `__capturedToken__ = pm.globals.get('token');`;

    // Run pre-request
    await session.executePreRequest(wrappedPre);

    // Extract captured value from the session's variable scope via globals.get
    capturedToken = (ctx as any).__capturedToken__;

    // Run post-response
    if (postScript) {
        await session.executePostResponse(postScript, makeResponseContext());
    }

    return { capturedToken };
}

describe('Layer 4 – 4-request chain: set → get → update → get', () => {
    let svc: EnvironmentConfigService;
    let executor: ScriptExecutor;

    beforeEach(() => {
        // No initial global for 'token' — purely runtime
        svc = createEnvService({});
        executor = new ScriptExecutor();
    });

    it('token set in req 1, read in req 2, updated in req 3, re-read in req 4', async () => {
        // ── Request 1: post-response sets token = 'token-1' ──
        const globals1 = svc.getGlobalVariables();
        const ctx1 = makeContext(svc, { ...globals1 });
        const session1 = executor.createRequestSession(ctx1);
        await session1.executePreRequest('// no-op');
        await session1.executePostResponse(
            `postman.setGlobalVariable('token', 'token-1');`,
            makeResponseContext()
        );

        // ── Request 2: pre-request reads token via pm.globals.get ──
        const globals2 = svc.getGlobalVariables();  // fresh snapshot
        const ctx2 = makeContext(svc, { ...globals2 });
        const session2 = executor.createRequestSession(ctx2);

        // Use pm.variables.set to smuggle the global value out of the VM
        const preResult2 = await session2.executePreRequest(`
            pm.variables.set('captured_token', pm.globals.get('token'));
        `);
        // Read the value out via the service ({{token}} in request body)
        const resolvedInReq2 = svc.resolveVariables('{{token}}', 'dev');

        expect(globals2.token).toBe('token-1');                              // service snapshot is fresh
        expect(resolvedInReq2).toBe('token-1');                              // {{token}} in body resolves correctly
        expect(preResult2.localVariables?.captured_token).toBe('token-1');  // pm.globals.get() in pre-request script sees new value

        // ── Request 3: post-response updates token = 'token-3' ──
        const globals3 = svc.getGlobalVariables();
        const ctx3 = makeContext(svc, { ...globals3 });
        const session3 = executor.createRequestSession(ctx3);
        await session3.executePreRequest('// no-op');
        await session3.executePostResponse(
            `postman.setGlobalVariable('token', 'token-3');`,
            makeResponseContext()
        );

        // ── Request 4: verify updated token is visible ──
        const globals4 = svc.getGlobalVariables();  // fresh snapshot
        const resolvedInReq4 = svc.resolveVariables('{{token}}', 'dev');

        expect(globals4.token).toBe('token-3');          // service snapshot reflects update
        expect(resolvedInReq4).toBe('token-3');          // {{token}} in body resolves to new value

        // Also verify via a new session's pm.globals.get()
        const ctx4 = makeContext(svc, { ...globals4 });
        const session4 = executor.createRequestSession(ctx4);
        const preResult4 = await session4.executePreRequest(`
            pm.variables.set('captured_token', pm.globals.get('token'));
        `);
        expect(preResult4.localVariables?.captured_token).toBe('token-3');  // pm.globals.get() in pre-request sees updated value
    });

    it('same token key updated twice — each subsequent request sees the latest value', async () => {
        const updates = ['alpha', 'beta', 'gamma'];
        for (let i = 0; i < updates.length; i++) {
            const val = updates[i];

            // Writer request: post-response sets token
            const wGlobals = svc.getGlobalVariables();
            const wCtx = makeContext(svc, { ...wGlobals });
            const wSession = executor.createRequestSession(wCtx);
            await wSession.executePreRequest('// no-op');
            await wSession.executePostResponse(
                `postman.setGlobalVariable('token', '${val}');`,
                makeResponseContext()
            );

            // Reader request: {{token}} in body must match the just-written value
            const resolved = svc.resolveVariables('{{token}}', 'dev');
            expect(resolved).toBe(val);
        }
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// Layer 5 – env-file static value does not shadow runtime postman.setGlobalVariable
//
// Real-world scenario: TELUS_SIT.json has global_client_secret: "stale" as a
// static entry.  form_submission's post-response calls
// postman.setGlobalVariable("global_client_secret", "fresh").
// {{global_client_secret}} in the next request's body must resolve to "fresh".
// ──────────────────────────────────────────────────────────────────────────────

describe('Layer 5 – static env-file value does not shadow runtime postman.setGlobalVariable', () => {
    let svc: EnvironmentConfigService;

    beforeEach(() => {
        svc = createEnvService();
        // Seed the env file with a stale global_client_secret — same as having
        // global_client_secret: "stale" in TELUS_SIT.json
        (svc as any).sharedConfig.environments.dev.variables = {
            global_client_secret: 'stale-from-env-file',
        };
    });

    it('postman.setGlobalVariable overrides a static env-file value with the same key', () => {
        // Simulate form_submission post-response: pushGlobal writes fresh OAuth code
        svc.setGlobalVariable('global_client_secret', 'fresh-oauth-code');

        // user_sessions body template must resolve to the fresh value
        const resolved = svc.resolveVariables('{{global_client_secret}}', 'dev');
        expect(resolved).toBe('fresh-oauth-code');
    });

    it('env-file value is still used when postman.setGlobalVariable was never called', () => {
        // No runtime global write → static env file value is used as-is
        const resolved = svc.resolveVariables('{{global_client_secret}}', 'dev');
        expect(resolved).toBe('stale-from-env-file');
    });

    it('pm.globals.get and {{}} template both return the same fresh value', async () => {
        const executor = new ScriptExecutor();
        const globals = svc.getGlobalVariables();
        const ctx = makeContext(svc, { ...globals });
        const session = executor.createRequestSession(ctx);

        await session.executePreRequest('// no-op');
        await session.executePostResponse(
            `postman.setGlobalVariable('global_client_secret', 'fresh-oauth-code');`,
            makeResponseContext()
        );

        // Template resolution and pm.globals.get must agree
        const viaTemplate = svc.resolveVariables('{{global_client_secret}}', 'dev');
        expect(viaTemplate).toBe('fresh-oauth-code');
    });
});

describe('Session VM behavior – shared within request, isolated across requests', () => {
    let svc: EnvironmentConfigService;
    let executor: ScriptExecutor;

    beforeEach(() => {
        svc = createEnvService({ token: 'seed' });
        executor = new ScriptExecutor();
    });

    it('pre-request JS state is visible in post-response within the same session', async () => {
        const ctx = makeContext(svc, { ...svc.getGlobalVariables() });
        const session = executor.createRequestSession(ctx);

        await session.executePreRequest('var __sharedCounter = 41;');
        const postResult = await session.executePostResponse(
            `pm.test('can read pre-request vm state', function () {
                pm.expect(__sharedCounter).to.equal(41);
            });`,
            makeResponseContext()
        );

        expect(postResult.testResults).toHaveLength(1);
        expect(postResult.testResults[0].passed).toBe(true);
    });

    it('JS globals do not leak between separate sessions', async () => {
        const sessionA = executor.createRequestSession(makeContext(svc, { ...svc.getGlobalVariables() }));
        await sessionA.executePreRequest('var __onlyInSessionA = "set";');

        const sessionB = executor.createRequestSession(makeContext(svc, { ...svc.getGlobalVariables() }));
        const preResultB = await sessionB.executePreRequest(
            'pm.variables.set("leak_check", typeof __onlyInSessionA);'
        );

        expect(preResultB.localVariables?.leak_check).toBe('undefined');
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// Postman-compatible undefined / null rendering
//
// Mirrors the real ForgeRock KIDS TRAY/SEARCH bug: a prerequest does
//   pushGlobal("query", getGlobal("kids_query"))   // kids_query is absent → undefined
// In Postman a variable set to `undefined` resolves to an EMPTY string (query=),
// whereas `null` resolves to the literal "null" (query=null). Previously HTTP Forge
// rendered the literal text "undefined" because serializeValue(undefined) produced
// "\x1Eundefined". These tests lock in the Postman-compatible behavior across both
// the in-VM replaceIn path and the service (URL/body) resolver.
// ──────────────────────────────────────────────────────────────────────────────

describe('Postman-compatible undefined / null variable rendering', () => {
    let svc: EnvironmentConfigService;
    let executor: ScriptExecutor;

    beforeEach(() => {
        svc = createEnvService({});
        executor = new ScriptExecutor();
    });

    it('a global set to undefined renders empty in {{}} and get() returns undefined', async () => {
        const ctx = makeContext(svc, { ...svc.getGlobalVariables() });
        const session = executor.createRequestSession(ctx);

        const preResult = await session.executePreRequest(`
            pm.globals.set('query', undefined);
            pm.variables.set('rendered', pm.variables.replaceIn('q={{query}}'));
            pm.variables.set('got_type', typeof pm.globals.get('query'));
        `);

        // Renders empty (q=) — NOT the literal "undefined" and NOT the raw {{query}}
        expect(preResult.localVariables?.rendered).toBe('q=');
        // pm.globals.get returns undefined, matching Postman
        expect(preResult.localVariables?.got_type).toBe('undefined');
    });

    it('a global set to null renders as the literal "null" and get() returns null', async () => {
        const ctx = makeContext(svc, { ...svc.getGlobalVariables() });
        const session = executor.createRequestSession(ctx);

        const preResult = await session.executePreRequest(`
            pm.globals.set('query', null);
            pm.variables.set('rendered', pm.variables.replaceIn('q={{query}}'));
            pm.variables.set('got_is_null', pm.globals.get('query') === null ? 'NULL' : 'NOTNULL');
        `);

        expect(preResult.localVariables?.rendered).toBe('q=null');
        expect(preResult.localVariables?.got_is_null).toBe('NULL');
    });

    it('a plain string value "undefined" is preserved (not treated as empty)', async () => {
        const ctx = makeContext(svc, { ...svc.getGlobalVariables() });
        const session = executor.createRequestSession(ctx);

        const preResult = await session.executePreRequest(`
            pm.globals.set('query', 'undefined');
            pm.variables.set('rendered', pm.variables.replaceIn('q={{query}}'));
        `);

        expect(preResult.localVariables?.rendered).toBe('q=undefined');
    });

    it('a missing variable is left as the literal {{token}} (unresolved)', async () => {
        const ctx = makeContext(svc, { ...svc.getGlobalVariables() });
        const session = executor.createRequestSession(ctx);

        const preResult = await session.executePreRequest(`
            pm.variables.set('rendered', pm.variables.replaceIn('q={{nope}}'));
        `);

        expect(preResult.localVariables?.rendered).toBe('q={{nope}}');
    });

    it('an undefined-valued global resolves empty via the service (URL/body) resolver', async () => {
        const ctx = makeContext(svc, { ...svc.getGlobalVariables() });
        const session = executor.createRequestSession(ctx);

        await session.executePreRequest(`postman.setGlobalVariable('query', undefined);`);

        // The env service (used for URL/body resolution) renders empty, not "undefined"
        expect(svc.resolveVariables('q={{query}}', 'dev')).toBe('q=');
    });

    it('a null-valued global resolves to "null" via the service (URL/body) resolver', async () => {
        const ctx = makeContext(svc, { ...svc.getGlobalVariables() });
        const session = executor.createRequestSession(ctx);

        await session.executePreRequest(`postman.setGlobalVariable('query', null);`);

        expect(svc.resolveVariables('q={{query}}', 'dev')).toBe('q=null');
    });
});
