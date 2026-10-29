/**
 * Test Suite Service
 * 
 * Manages CRUD operations for Test Suites.
 * Platform-agnostic version (no VS Code dependency).
 */

import * as fs from 'fs';
import * as path from 'path';
import { decodeFolderPath, encodeFolderName } from '../../runtime/mcp-collection-utils';
import {
    ICollectionService
} from '../../types/collection';
import { generateId } from '../../utils/helpers';
import { IConfigService } from '../config';
import {
    DEFAULT_SUITE_CONFIG,
    ITestSuiteService,
    LegacySuiteFileData,
    SuiteForNode,
    SuiteRequest,
    SuiteRequestNode,
    TestSuite
} from './interfaces';

/**
 * Callback invoked when the suites on disk change.
 */
export type SuitesChangedCallback = () => void;

/**
 * Service for managing Test Suites
 */
export class TestSuiteService implements ITestSuiteService {
    public readonly suitesDir: string;
    protected suites: Map<string, TestSuite> = new Map();

    /** Native file watcher (if watching is enabled) */
    private fileWatcher: fs.FSWatcher | null = null;

    /** Debounce timer for coalescing rapid change events */
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;

    /** External listener notified after suites are reloaded */
    public onSuitesChanged?: SuitesChangedCallback;

    constructor(
        private collectionService: ICollectionService,
        private configService: IConfigService,
        options?: { watch?: boolean; onSuitesChanged?: SuitesChangedCallback }
    ) {
        this.suitesDir = configService.getSuitesPath();
        this.onSuitesChanged = options?.onSuitesChanged;
        // Do not create suites directory eagerly — only when first suite is saved.
        this.loadSuites();

        if (options?.watch !== false) {
            this.setupFileWatcher();
        }
    }

    /**
     * Ensure suites directory exists (lazy — only when saving).
     */
    private ensureSuitesDir(): void {
        if (!fs.existsSync(this.suitesDir)) {
            fs.mkdirSync(this.suitesDir, { recursive: true });
        }
    }

    /**
     * Set up a file-system watcher on the suites directory.
     * Uses Node.js `fs.watch` — no VS Code dependency.
     * Changes are debounced so rapid edits trigger a single reload.
     */
    private setupFileWatcher(): void {
        try {
            this.fileWatcher = fs.watch(this.suitesDir, (_eventType, filename) => {
                // Only react to *.suite.json files
                if (filename && !filename.endsWith('.suite.json')) {
                    return;
                }

                // Debounce: coalesce multiple events within 200 ms
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                }
                this.debounceTimer = setTimeout(() => {
                    this.debounceTimer = null;
                    this.loadSuites();
                    this.onSuitesChanged?.();
                }, 200);
            });

            // Silently ignore watcher errors (directory deleted, etc.)
            this.fileWatcher.on('error', () => {});
        } catch {
            // fs.watch may throw on some platforms — degrade gracefully
        }
    }

    /**
     * Stop watching and release resources.
     */
    public dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.fileWatcher?.close();
        this.fileWatcher = null;
    }

    /**
     * Load all suites from disk
     */
    public loadSuites(): void {
        this.suites.clear();

        if (!fs.existsSync(this.suitesDir)) {
            return;
        }

        const files = fs.readdirSync(this.suitesDir);

        for (const file of files) {
            if (file.endsWith('.suite.json')) {
                try {
                    const filePath = path.join(this.suitesDir, file);
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const raw = JSON.parse(content) as LegacySuiteFileData;

                    // Migrate legacy requests -> nodes at load time (never written back)
                    const nodes = Array.isArray(raw.nodes) && raw.nodes.length > 0
                        ? raw.nodes
                        : (Array.isArray(raw.requests) ? raw.requests : []).map((req: SuiteRequest): SuiteRequestNode => ({
                            type: 'request',
                            name: req.description || req.name,
                            request: req,
                            enabled: req.enabled !== false
                        }));

                    const suite: TestSuite = {
                        id: raw.id,
                        name: raw.name,
                        description: raw.description,
                        scripts: raw.scripts,
                        nodes,
                        config: raw.config ?? { ...DEFAULT_SUITE_CONFIG },
                        isTemporary: raw.isTemporary,
                        ai_generated: raw.ai_generated === true,
                        derived_from: Array.isArray(raw.derived_from) ? raw.derived_from as string[] : undefined,
                        createdAt: raw.createdAt ?? Date.now(),
                        updatedAt: raw.updatedAt ?? Date.now(),
                    };
                    
                    if (suite.id && suite.name) {
                        this.suites.set(suite.id, suite);
                    }
                } catch (error) {
                    console.error(`[TestSuiteService] Failed to load ${file}:`, error);
                }
            }
        }
    }

    /**
     * Get all suites
     */
    public async getAllSuites(): Promise<TestSuite[]> {
        return Array.from(this.suites.values());
    }

    /**
     * Get a suite by ID
     */
    public async getSuite(id: string): Promise<TestSuite | undefined> {
        return this.suites.get(id);
    }

    /**
     * Create a new suite
     */
    public async createSuite(name: string): Promise<TestSuite> {
        const now = Date.now();
        const suite: TestSuite = {
            id: generateId(name),
            name,
            nodes: [],
            config: { ...DEFAULT_SUITE_CONFIG },
            createdAt: now,
            updatedAt: now
        };

        await this.saveSuiteToDisk(suite);
        this.suites.set(suite.id, suite);

        return suite;
    }

    /**
     * Update an existing suite
     */
    public async updateSuite(suite: TestSuite): Promise<void> {
        suite.updatedAt = Date.now();
        await this.saveSuiteToDisk(suite);
        this.suites.set(suite.id, suite);
    }

    /**
     * Duplicate a suite including its request folders
     */
    public async duplicateSuite(sourceId: string, newName: string): Promise<TestSuite> {
        const source = this.suites.get(sourceId);
        if (!source) {
            throw new Error(`Suite not found: ${sourceId}`);
        }

        // Create new suite with copied nodes
        const sourceNodes = source.nodes || [];
        const newSuite = await this.createSuite(newName);
        newSuite.nodes = sourceNodes.map(n => ({ ...n } as any));
        newSuite.config = { ...source.config };
        newSuite.description = source.description;

        // Copy request folders from source suite dir to new suite dir
        const sourceSuiteDir = path.join(this.suitesDir, sourceId);
        const targetSuiteDir = path.join(this.suitesDir, newSuite.id);

        if (fs.existsSync(sourceSuiteDir)) {
            this.copyDirRecursive(sourceSuiteDir, targetSuiteDir);
        }

        await this.saveSuiteToDisk(newSuite);
        this.suites.set(newSuite.id, newSuite);

        return newSuite;
    }

    /**
     * Recursively copy a directory
     */
    private copyDirRecursive(src: string, dest: string): void {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                this.copyDirRecursive(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    /**
     * Delete a suite
     */
    public async deleteSuite(id: string): Promise<boolean> {
        const suite = this.suites.get(id);
        if (!suite) {
            return false;
        }

        const filename = `${suite.id}.suite.json`;
        const filePath = path.join(this.suitesDir, filename);
        const suiteDirPath = path.join(this.suitesDir, suite.id);

        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            if (fs.existsSync(suiteDirPath)) {
                fs.rmSync(suiteDirPath, { recursive: true, force: true });
            }
            this.suites.delete(id);
            return true;
        } catch (error) {
            console.error(`[TestSuiteService] Failed to delete suite:`, error);
            return false;
        }
    }

    /**
     * Create a temporary suite from a collection
     */
    public async createTempSuiteFromCollection(collectionId: string): Promise<TestSuite | undefined> {
        const collection = this.collectionService.getCollection(collectionId);
        if (!collection) {
            console.error(`[TestSuiteService] Collection not found: ${collectionId}`);
            return undefined;
        }

        const requests: SuiteRequest[] = [];
        
        this.extractRequestsFromCollection(
            collection,
            collectionId,
            collection.name,
            '',
            requests
        );

        const nodes: SuiteRequestNode[] = requests.map(req => ({
            type: 'request',
            name: req.description || req.name,
            request: req,
            enabled: req.enabled !== false
        }));

        const now = Date.now();
        const suite: TestSuite = {
            id: `temp-${collectionId}`,
            name: collection.name,
            nodes,
            config: { ...DEFAULT_SUITE_CONFIG },
            isTemporary: true,
            createdAt: now,
            updatedAt: now
        };

        return suite;
    }

    /**
     * Create a temporary suite from a single folder within a collection.
     *
     * @param collectionId - the owning collection
     * @param folderPath - slash-separated folder names (e.g. "Auth/Login")
     * @param recursive - include requests in nested subfolders (default: true)
     */
    public async createTempSuiteFromFolder(
        collectionId: string,
        folderPath: string,
        recursive: boolean = true
    ): Promise<TestSuite | undefined> {
        const collection = this.collectionService.getCollection(collectionId);
        if (!collection) {
            console.error(`[TestSuiteService] Collection not found: ${collectionId}`);
            return undefined;
        }

        const all: SuiteRequest[] = [];
        this.extractRequestsFromCollection(
            collection,
            collectionId,
            collection.name,
            '',
            all
        );

        const target = folderPath.replace(/\/+$/, '');
        const requests = all.filter(r =>
            recursive
                ? r.folderPath === target || r.folderPath.startsWith(`${target}/`)
                : r.folderPath === target
        );

        if (requests.length === 0) {
            console.error(
                `[TestSuiteService] No requests under folder "${folderPath}" in collection: ${collectionId}`
            );
            return undefined;
        }

        const nodes: SuiteRequestNode[] = requests.map(req => ({
            type: 'request',
            name: req.description || req.name,
            request: req,
            enabled: req.enabled !== false
        }));

        const now = Date.now();
        const suite: TestSuite = {
            id: `temp-${collectionId}-${this.slugifyFolderPath(target)}`,
            name: `${collection.name} / ${decodeFolderPath(target)}`,
            nodes,
            config: { ...DEFAULT_SUITE_CONFIG },
            isTemporary: true,
            createdAt: now,
            updatedAt: now
        };

        return suite;
    }

    /**
     * Create a temporary performance-test suite for a single request.
     * The request is wrapped in a `for` loop node (100 iterations) so users
     * can prepend login/auth steps before the loop if needed.
     * The suite itself runs with iterations = 1.
     */
    public async createTempSuiteFromRequest(
        collectionId: string,
        requestId: string
    ): Promise<TestSuite | undefined> {
        const collection = this.collectionService.getCollection(collectionId);
        if (!collection) {
            console.error(`[TestSuiteService] Collection not found: ${collectionId}`);
            return undefined;
        }

        const all: SuiteRequest[] = [];
        this.extractRequestsFromCollection(collection, collectionId, collection.name, '', all);

        const entry = all.find(r => r.requestId === requestId);
        if (!entry) {
            console.error(`[TestSuiteService] Request not found: ${requestId} in collection: ${collectionId}`);
            return undefined;
        }

        const requestNode: SuiteRequestNode = {
            type: 'request',
            name: entry.description || entry.name,
            request: entry,
            enabled: true
        };

        const loopNode: SuiteForNode = {
            type: 'for',
            name: 'Performance Loop (100 iterations)',
            init: 'hf.variables.set("__i", 0)',
            loopCondition: 'hf.variables.get("__i") < 100',
            update: 'hf.variables.set("__i", hf.variables.get("__i") + 1)',
            maxIterations: 100,
            nodes: [requestNode],
            enabled: true
        };

        const now = Date.now();
        const suite: TestSuite = {
            id: `temp-perf-${collectionId}-${requestId}`,
            name: `${entry.name} — Performance Test`,
            nodes: [loopNode],
            config: { ...DEFAULT_SUITE_CONFIG },
            isTemporary: true,
            createdAt: now,
            updatedAt: now
        };

        return suite;
    }

    /** Convert a folder path into an id-safe slug. */
    private slugifyFolderPath(folderPath: string): string {
        return folderPath
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    /**
     * Save a temporary suite as a permanent one
     */
    public async saveTempSuite(suite: TestSuite, name: string): Promise<TestSuite> {
        const now = Date.now();
        const sourceTempDir = path.join(this.suitesDir, suite.id);
        const savedSuite: TestSuite = {
            ...suite,
            id: generateId(name),
            name,
            isTemporary: false,
            createdAt: now,
            updatedAt: now
        };

        const targetDir = path.join(this.suitesDir, savedSuite.id);
        if (fs.existsSync(sourceTempDir)) {
            if (fs.existsSync(targetDir)) {
                fs.rmSync(targetDir, { recursive: true, force: true });
            }
            fs.renameSync(sourceTempDir, targetDir);
        }

        await this.saveSuiteToDisk(savedSuite);
        this.suites.set(savedSuite.id, savedSuite);

        return savedSuite;
    }

    /**
     * Get all requests from all collections for the Add Request modal
     */
    public getAllAvailableRequests(): Array<{
        collectionId: string;
        collectionName: string;
        requestId: string;
        name: string;
        method: string;
        folderPath: string;
    }> {
        const results: Array<{
            collectionId: string;
            collectionName: string;
            requestId: string;
            name: string;
            method: string;
            folderPath: string;
        }> = [];

        const collections = this.collectionService.getAllCollections();
        for (const collection of collections) {
            this.extractRequestsFromCollection(
                collection,
                collection.id,
                collection.name,
                '',
                results
            );
        }

        return results;
    }

    /**
     * Recursively extract requests from collection items
     */
    private extractRequestsFromCollection(
        item: any,
        collectionId: string,
        collectionName: string,
        currentPath: string,
        results: SuiteRequest[]
    ): void {
        // Process direct requests
        if (item.requests) {
            for (const request of item.requests) {
                results.push({
                    collectionId,
                    collectionName,
                    requestId: request.id,
                    name: request.name || 'Unnamed Request',
                    method: request.method || 'GET',
                    folderPath: currentPath
                });
            }
        }

        // Process items array (mixed requests and folders)
        if (item.items) {
            for (const child of item.items) {
                if (child.items || child.folders || child.requests) {
                    // It's a folder
                    const newPath = currentPath ? `${currentPath}/${encodeFolderName(child.name)}` : encodeFolderName(child.name);
                    this.extractRequestsFromCollection(
                        child,
                        collectionId,
                        collectionName,
                        newPath,
                        results
                    );
                } else {
                    // It's a request
                    results.push({
                        collectionId,
                        collectionName,
                        requestId: child.id,
                        name: child.name || 'Unnamed Request',
                        method: child.method || 'GET',
                        folderPath: currentPath
                    });
                }
            }
        }

        // Process folders array
        if (item.folders) {
            for (const folder of item.folders) {
                const newPath = currentPath ? `${currentPath}/${encodeFolderName(folder.name)}` : encodeFolderName(folder.name);
                this.extractRequestsFromCollection(
                    folder,
                    collectionId,
                    collectionName,
                    newPath,
                    results
                );
            }
        }
    }

    /**
     * Save suite to disk
     */
    private async saveSuiteToDisk(suite: TestSuite): Promise<void> {
        this.ensureSuitesDir();

        const filename = `${suite.id}.suite.json`;
        const filePath = path.join(this.suitesDir, filename);
        const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

        const normalizedSuite = {
            $schema: 'https://raw.githubusercontent.com/hsl1230/http-forge/main/resources/suite.schema.json',
            id: suite.id,
            name: suite.name,
            description: suite.description,
            scripts: suite.scripts,
            nodes: Array.isArray(suite.nodes) ? suite.nodes : [],
            config: suite.config ?? { ...DEFAULT_SUITE_CONFIG },
            isTemporary: suite.isTemporary,
            ai_generated: suite.ai_generated,
            derived_from: suite.derived_from,
            createdAt: suite.createdAt ?? Date.now(),
            updatedAt: suite.updatedAt ?? Date.now()
        };

        const content = JSON.stringify(normalizedSuite, null, 2);
        fs.writeFileSync(tempPath, content, 'utf-8');
        fs.renameSync(tempPath, filePath);
    }
}
