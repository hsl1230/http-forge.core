/**
 * Postman Environment Import
 * 
 * Parses Postman environment JSON files into a standard format.
 * Extracted from extension's utils/import-postman-environment.ts.
 * 
 * Pure function — no platform dependencies.
 */

import { ImportedEnvironment } from '../../types/environment-config';
import { IFileSystem } from '../../types/platform';

// Re-export for direct consumers
export type { ImportedEnvironment } from '../../types/environment-config';

/**
 * Parse Postman environment JSON content.
 * Supports both standard and nested Postman export formats.
 */
export function parsePostmanEnvironment(content: string | Buffer): ImportedEnvironment | null {
    try {
        const obj = typeof content === 'string' ? JSON.parse(content) : JSON.parse(content.toString('utf-8'));

        if (!obj) return null;

        // Some Postman exports nest environments under `environment` key
        const envObj: any = obj.environment || obj;

        const name: string = envObj.name || obj.name || 'imported-environment';
        const values: any = envObj.values || envObj.variables || obj.values || obj.variables || [];

        const variables: Record<string, string> = {};
        if (Array.isArray(values)) {
            for (const item of values) {
                if (!item) continue;
                const key = item.key ?? item.name;
                const enabled = typeof item.enabled === 'boolean' ? item.enabled : true;
                if (!key) continue;
                if (enabled === false) continue;
                variables[key] = item.value ?? item.initial ?? '';
            }
        } else if (typeof values === 'object' && values !== null) {
            // Some variants export as object map
            for (const [k, v] of Object.entries(values)) {
                variables[k] = String(v ?? '');
            }
        }

        const description: string = envObj._postman_exported_at
            ? 'Imported from Postman export'
            : envObj.description || '';

        return { name, variables, description };
    } catch {
        return null;
    }
}

/**
 * Parse Postman environment from file using the IFileSystem abstraction.
 * Platform-independent — works with any IFileSystem implementation.
 */
export async function parsePostmanEnvironmentFile(
    filePath: string,
    fs: IFileSystem
): Promise<ImportedEnvironment | null> {
    try {
        const content = await fs.readFile(filePath);
        return parsePostmanEnvironment(content);
    } catch {
        return null;
    }
}
