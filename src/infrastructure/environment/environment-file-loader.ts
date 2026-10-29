/**
 * Environment File Loader
 *
 * Shared logic for reading the multi-file environment folder format:
 *   _global.json           — global variables + default headers
 *   {env}.json             — per-environment variables
 *   _global.local.json     — local variable overrides (gitignored)
 *   {env}.local.json       — per-environment local overrides (gitignored)
 *
 * Used by both EnvironmentConfigService (extension) and
 * ForgeContainer.fromForgeRoot (standalone).
 */

import * as fs from 'fs';
import * as path from 'path';

// ==================== Types ====================

export interface EnvironmentFolderData {
    /** Variables available in all environments */
    globalVariables: Record<string, string>;
    /** Default headers sent with every request */
    defaultHeaders: Record<string, string>;
    /** Per-environment configs keyed by environment name */
    environments: Record<string, EnvironmentEntry>;
    /** Local global variable overrides from _global.local.json */
    localVariables: Record<string, string>;
    /** Per-environment local variable overrides from {env}.local.json */
    localCredentials: Record<string, { variables: Record<string, string> }>;
}

export interface EnvironmentEntry {
    description?: string;
    requiresConfirmation?: boolean;
    variables: Record<string, string>;
    /**
     * Names of variables whose values are stored in SecretStorage, not in the JSON file.
     * These names are persisted in the JSON; the values are never written to disk.
     */
    secretVariables?: string[];
}

// ==================== Public API ====================

/**
 * Determine whether a filename is a system/meta file (not an environment file).
 */
export function isSystemEnvironmentFile(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    return (
        lower === '_global.json' ||
        lower === '_global.local.json' ||
        lower.endsWith('.local.json')
    );
}

/**
 * Load environment configuration from a multi-file folder.
 *
 * @param envDir - Absolute path to the environments folder
 * @returns Parsed environment data (or empty defaults when the folder is missing)
 */
export function loadEnvironmentsFromFolder(envDir: string): EnvironmentFolderData {
    if (!fs.existsSync(envDir)) {
        return emptyData();
    }

    // 1. _global.json
    const globalConfig = loadJsonFile(path.join(envDir, '_global.json')) || {};
    const globalVariables: Record<string, string> =
        /*globalConfig.globalVariables || */globalConfig.variables || {};   // TODO : remove legacy "globalVariables" support
    const defaultHeaders: Record<string, string> =
        globalConfig.defaultHeaders || {};

    // 2. Per-environment files ({env}.json)
    const environmentFiles = fs.readdirSync(envDir)
        .filter((name) => name.endsWith('.json'))
        .filter((name) => !name.endsWith('.local.json'))
        .filter((name) => !isSystemEnvironmentFile(name));

    const environments: Record<string, EnvironmentEntry> = {};  //TODO: the name is confusing, rename to environmentConfigs?
    for (const file of environmentFiles) {
        const envData = loadJsonFile(path.join(envDir, file)) || {};
        const envName = path.basename(file, '.json');
        environments[envName] = {
            description: envData.description,
            requiresConfirmation: envData.requiresConfirmation,
            variables: envData.variables || {},
            secretVariables: envData.secretVariables,   //TODO : do we need this attribute?
        };
    }

    // 3. _global.local.json
    const globalLocalConfig = loadJsonFile(path.join(envDir, '_global.local.json')) || {};
    const localVariables: Record<string, string> = globalLocalConfig.variables || {};  //TODO : the name is confusing, rename to localGlobalVariables?

    // 4. Per-environment local files ({env}.local.json)
    const localCredentials: Record<string, { variables: Record<string, string> }> = {}; //TODO: the name is confusing, rename to localEnvironmentVariables?
    for (const envName of Object.keys(environments)) {      //TODO : .local.json files may exist for envs that don't have a main .json file
        const envLocalPath = path.join(envDir, `${envName}.local.json`);
        if (fs.existsSync(envLocalPath)) {
            const envLocalData = loadJsonFile(envLocalPath) || {};
            localCredentials[envName] = {
                variables: envLocalData.variables || {},
            };
        }
    }

    return {
        globalVariables,
        defaultHeaders,
        environments,
        localVariables,
        localCredentials,
    };
}

// ==================== Helpers ====================

function emptyData(): EnvironmentFolderData {
    return {
        globalVariables: {},
        defaultHeaders: {},
        environments: {},
        localVariables: {},
        localCredentials: {},
    };
}

function loadJsonFile(filePath: string): any | null {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.error(`[environment-file-loader] Failed to load JSON from ${filePath}:`, error);
        return null;
    }
}
