/**
 * AGENTS.md Guide Management
 *
 * Single Responsibility: own the `.http-forge/AGENTS.md` template (version +
 * content) and the read/status/refresh operations on it. `FolderCollectionStore`
 * delegates first-time creation here; the VS Code extension and the CLI reuse
 * the status/refresh helpers so every host agrees on what "stale" means.
 *
 * Versioning: `AGENTS_MD_VERSION` must be bumped on every template change.
 * Files without a marker (all guides written before versioning) read as
 * version 0 and are therefore stale. Refresh is always replace-with-backup —
 * the previous file is copied to `AGENTS.md.bak` (single deterministic
 * backup, overwritten on repeat) before the fresh template is written, so
 * user customizations are never silently lost.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_CONFIG } from '../config/default-config';

/** Current template version. Bump when `buildAgentsMdContent()` changes. */
export const AGENTS_MD_VERSION = 5;

export const AGENTS_MD_FILENAME = 'AGENTS.md';
export const AGENTS_MD_BACKUP_FILENAME = 'AGENTS.md.bak';

const VERSION_MARKER_RE = /http-forge-agents-md-version:\s*(\d+)/;

/** Absolute path of the guide inside a `.http-forge/` directory. */
export function getAgentsMdPath(forgeDir: string): string {
    return path.join(forgeDir, AGENTS_MD_FILENAME);
}

/**
 * Parse the version marker from guide content.
 * Missing or unparseable markers read as 0 (legacy guide — stale).
 */
export function readAgentsMdVersion(content: string): number {
    const match = VERSION_MARKER_RE.exec(content);
    if (!match) {
        return 0;
    }
    const parsed = Number.parseInt(match[1] ?? '', 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export interface AgentsMdStatus {
    exists: boolean;
    path: string;
    currentVersion: number;
    latestVersion: number;
    stale: boolean;
}

/** Report whether the guide exists and whether it predates the template. */
export function getAgentsMdStatus(forgeDir: string): AgentsMdStatus {
    const guidePath = getAgentsMdPath(forgeDir);
    if (!fs.existsSync(guidePath)) {
        return {
            exists: false,
            path: guidePath,
            currentVersion: 0,
            latestVersion: AGENTS_MD_VERSION,
            stale: false,
        };
    }
    let content = '';
    try {
        content = fs.readFileSync(guidePath, 'utf-8');
    } catch {
        return {
            exists: true,
            path: guidePath,
            currentVersion: 0,
            latestVersion: AGENTS_MD_VERSION,
            stale: true,
        };
    }
    const currentVersion = readAgentsMdVersion(content);
    return {
        exists: true,
        path: guidePath,
        currentVersion,
        latestVersion: AGENTS_MD_VERSION,
        stale: currentVersion < AGENTS_MD_VERSION,
    };
}

export interface AgentsMdRefreshResult {
    path: string;
    backupPath: string | null;
    previousVersion: number;
    version: number;
    /** True when no guide existed and one was created (no backup taken). */
    created: boolean;
}

/**
 * Replace the guide with the current template, backing up the previous file
 * to `AGENTS.md.bak` first. `backupPath` is null when nothing existed before.
 */
export function refreshAgentsMd(forgeDir: string): AgentsMdRefreshResult {
    const guidePath = getAgentsMdPath(forgeDir);
    fs.mkdirSync(forgeDir, { recursive: true });
    ensureForgeWorkspaceFiles(forgeDir);
    const fresh = buildAgentsMdContent();
    if (!fs.existsSync(guidePath)) {
        fs.writeFileSync(guidePath, fresh, 'utf-8');
        return {
            path: guidePath,
            backupPath: null,
            previousVersion: 0,
            version: AGENTS_MD_VERSION,
            created: true,
        };
    }
    let previous = '';
    try {
        previous = fs.readFileSync(guidePath, 'utf-8');
    } catch {
        previous = '';
    }
    const previousVersion = readAgentsMdVersion(previous);
    const backupPath = path.join(forgeDir, AGENTS_MD_BACKUP_FILENAME);
    fs.writeFileSync(backupPath, previous, 'utf-8');
    fs.writeFileSync(guidePath, fresh, 'utf-8');
    return {
        path: guidePath,
        backupPath,
        previousVersion,
        version: AGENTS_MD_VERSION,
        created: false,
    };
}

/**
 * Write-once creation used on workspace initialisation. Returns true when the
 * file was created, false when it already existed (never overwrites).
 */
export function ensureAgentsMdFile(forgeDir: string): boolean {
    const guidePath = getAgentsMdPath(forgeDir);
    const created = !fs.existsSync(guidePath);
    if (created) {
        fs.mkdirSync(forgeDir, { recursive: true });
        fs.writeFileSync(guidePath, buildAgentsMdContent(), 'utf-8');
    }
    ensureForgeWorkspaceFiles(forgeDir);
    return created;
}

/**
 * Ensure the supporting files that make a `.http-forge` workspace usable from
 * VS Code are present. This is write-once: existing files are never overwritten.
 */
export function ensureForgeWorkspaceFiles(forgeDir: string): void {
    if (path.basename(forgeDir) !== '.http-forge') {
        return;
    }

    fs.mkdirSync(forgeDir, { recursive: true });

    const assetsDir = path.join(forgeDir, 'assets');
    const libDir = path.join(assetsDir, 'lib');
    const srcDir = path.join(assetsDir, 'src');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.mkdirSync(libDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });

    // Workspace-level AI context files (write-once, never overwrite)
    const workspaceRoot = path.dirname(forgeDir);
    const githubDir = path.join(workspaceRoot, '.github');
    fs.mkdirSync(githubDir, { recursive: true });
    writeFileIfMissing(
        path.join(githubDir, 'copilot-instructions.md'),
        'See .http-forge/AGENTS.md for the full HTTP Forge AI guide (folder layout, schemas, scripts, assertions, test suites, environments, MCP tools).\\n' +
        'Script API type definitions: .http-forge/assets/http-forge-globals.d.ts (pm, ctx, hf, postman, CryptoJS, moment, _, etc.)\\n' +
        'Documentation: https://github.com/hsl1230/http-forge/tree/main/docs/user-guide\\n'
    );
    const projectName = path.basename(workspaceRoot) || 'HTTP Forge Project';
    const llmsTemplate = readTemplateFile('llms.txt', '');
    const llmsContent = llmsTemplate
        ? llmsTemplate.replace('{{PROJECT_NAME}}', projectName)
        : `# ${projectName}\\n\\n> HTTP testing workspace powered by HTTP Forge.\\n`;
    writeFileIfMissing(path.join(workspaceRoot, 'llms.txt'), llmsContent);

    const configPath = path.join(forgeDir, 'http-forge.config.json');
    if (!fs.existsSync(configPath)) {
        const defaultConfig = {
            ...DEFAULT_CONFIG,
            storage: {
                ...DEFAULT_CONFIG.storage,
                root: './assets',
                history: './.cache/histories',
                results: './.cache/results',
            },
            scripts: {
                ...DEFAULT_CONFIG.scripts,
                modulePaths: ['./assets/src', './assets/lib'],
            },
        };
        fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf-8');
    }

    writeFileIfMissing(path.join(assetsDir, 'http-forge-globals.d.ts'), readTemplateFile('http-forge-globals.d.ts', 'declare const pm: any;\ndeclare const ctx: any;\ndeclare const hf: any;\n'));
    writeFileIfMissing(path.join(assetsDir, 'jsconfig.json'), readTemplateFile('jsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'commonjs', allowJs: true, checkJs: false, types: ['node'], typeRoots: ['./lib/node_modules/@types'] }, include: ['**/*.js', '**/*.d.ts'], exclude: ['lib/**', 'node_modules/**'] }, null, 2) + '\n'));
    writeFileIfMissing(path.join(libDir, 'package.json'), readTemplateFile('lib-package.json', JSON.stringify({ name: 'lib', version: '1.0.0', main: 'index.js', scripts: { test: 'node --test' }, author: '', license: 'ISC', description: '', dependencies: { yaml: '^2.8.2', lodash: '^4.17.21', moment: '^2.30.1', 'crypto-js': '^4.2.0', xml2js: '^0.6.2', tv4: '^1.3.0', ajv: '^8.17.1', cheerio: '^1.1.2' }, devDependencies: { '@types/node': '^20.0.0', '@types/lodash': '^4.17.0', '@types/moment': '^2.13.0' } }, null, 2) + '\n'));
}

function readTemplateFile(fileName: string, fallback: string): string {
    try {
        const templatePath = path.join(__dirname, 'templates', fileName);
        if (fs.existsSync(templatePath)) {
            return fs.readFileSync(templatePath, 'utf-8');
        }
    } catch {
        // Fall through to the minimal fallback below.
    }
    return fallback;
}

function writeFileIfMissing(filePath: string, content: string): void {
    if (fs.existsSync(filePath)) {
        return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Build the current `.http-forge/AGENTS.md` template. The file teaches AI
 * assistants (GitHub Copilot, Claude, Cursor, …) the folder layout and schema
 * URLs so they can author collections by editing files directly — without
 * consuming MCP tool tokens.
 */
export function buildAgentsMdContent(): string {
    const template = readTemplateFile('AGENTS.md', '');
    if (template) {
        return template.replace('{{VERSION}}', String(AGENTS_MD_VERSION));
    }
    // Fallback (should not happen — template ships with the package)
    return `<!-- http-forge-agents-md-version: ${AGENTS_MD_VERSION} -->`;
}
