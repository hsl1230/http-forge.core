import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '../infrastructure/config/config-service';
import { ScriptExecutor } from '../infrastructure/script/script-executor';

vi.mock('../runtime/node-bootstrap', () => ({
    createNodeContainer: vi.fn(),
}));

import { runSuite } from '../runtime/direct-execution';
import { createNodeContainer } from '../runtime/node-bootstrap';

function createSuite(overrides: Record<string, unknown> = {}) {
    return {
        id: 'suite-script-node',
        name: 'Suite Script Node Test',
        requests: [],
        config: {
            iterations: 1,
            delayBetweenRequests: 0,
            stopOnError: false,
            readFromSharedSession: false,
            writeToSharedSession: false,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...overrides,
    };
}

describe('suite flow script nodes', () => {
    const workspaces: string[] = [];
    const suitesByWorkspace = new Map<string, any>();

    afterEach(() => {
        for (const workspace of workspaces) {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
        workspaces.length = 0;
        suitesByWorkspace.clear();
        vi.clearAllMocks();
    });

    beforeEach(() => {
        (createNodeContainer as any).mockImplementation((workspaceFolder: string) => {
            const globals: Record<string, string> = {};
            const envVars: Record<string, string> = {};

            return {
                testSuite: {
                    getSuite: async (id: string) => {
                        const suite = suitesByWorkspace.get(workspaceFolder);
                        if (suite?.id === id) return suite;
                        return undefined;
                    },
                    dispose: () => {},
                },
                collection: {
                    getCollection: () => undefined,
                    dispose: () => {},
                },
                environmentConfig: {
                    getSelectedEnvironment: () => 'dev',
                    getResolvedEnvironment: () => ({ variables: { ...envVars } }),
                    setEnvironmentVariable: (key: string, value: string) => { envVars[key] = value; },
                    deleteEnvironmentVariable: (key: string) => { delete envVars[key]; },
                    clearEnvironmentVariables: () => {
                        for (const key of Object.keys(envVars)) delete envVars[key];
                    },
                    getGlobalVariables: () => ({ ...globals }),
                    setGlobalVariable: (key: string, value: string) => { globals[key] = value; },
                    deleteGlobalVariable: (key: string) => { delete globals[key]; },
                    clearGlobalVariables: () => {
                        for (const key of Object.keys(globals)) delete globals[key];
                    },
                    dispose: () => {},
                },
                scriptExecutor: new ScriptExecutor(),
                httpRequest: {},
                requestPreparer: {},
                config: new ConfigService(workspaceFolder),
                console: { dispose: () => {} },
            };
        });
    });

    it('executes inline script nodes that drive subsequent conditions', async () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-suite-script-'));
        workspaces.push(workspace);

        const suite = createSuite({
            nodes: [
                { type: 'script', script: `pm.variables.set('flag', 'yes');` },
                {
                    type: 'if',
                    if: `pm.variables.get('flag') === 'yes'`,
                    then: [{ type: 'script', script: `throw new Error('INLINE_SCRIPT_BRANCH_HIT');` }],
                },
            ],
        });
        suitesByWorkspace.set(workspace, suite);

        await expect(
            runSuite({ workspaceFolder: workspace, suiteId: suite.id })
        ).rejects.toThrow(/INLINE_SCRIPT_BRANCH_HIT/);
    });

    it('resolves scriptRef from suite script library for reuse', async () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-suite-script-'));
        workspaces.push(workspace);

        const suite = createSuite({
            scripts: {
                setRole: `pm.variables.set('role', 'admin');`,
            },
            nodes: [
                { type: 'script', scriptRef: 'setRole' },
                {
                    type: 'switch',
                    expression: `pm.variables.get('role')`,
                    cases: [
                        {
                            equals: 'admin',
                            nodes: [{ type: 'script', script: `throw new Error('SCRIPT_REF_HIT');` }],
                        },
                    ],
                },
            ],
        });
        suitesByWorkspace.set(workspace, suite);

        await expect(
            runSuite({ workspaceFolder: workspace, suiteId: suite.id })
        ).rejects.toThrow(/SCRIPT_REF_HIT/);
    });
});
