/**
 * Script Analyzer
 * 
 * Static analysis of post-response scripts to extract response field expectations.
 * Uses regex-based pattern matching (not full AST) since post-response scripts
 * are typically simple assertion chains.
 */

/**
 * Result of analyzing a post-response script.
 */
export interface ScriptAnalysisResult {
    /** Dot-separated field paths: ["data.users[].id", "data.users[].name"] */
    fieldPaths: string[];
    /** Type hints from assertions: { "data.count": "number", "data.active": "boolean" } */
    typeHints: Record<string, string>;
    /** Value hints from equality assertions: { "data.status": "ok" } */
    valueHints: Record<string, any>;
    /** Expected status codes from pm.response.to.have.status(N) */
    expectedStatuses: number[];
}

// Field access: match chains like `jsonData.field.sub` or `responseJson.field`
const FIELD_ACCESS = /(?:jsonData|responseJson|data|json|body|response\.json\(\))\.([a-zA-Z_][\w.\[\]]*)/g;

// Script API is exposed under three interchangeable aliases: pm, hf, ctx.
const API = '(?:pm|hf|ctx)';

// Type assertions: <api>.expect(...).to.be.a('type') or .to.be.an('type')
const TYPE_ASSERT = new RegExp(`${API}\\.expect\\(.*?\\.([a-zA-Z_][\\w.]*)\\)\\.to\\.be\\.(?:a|an)\\(['"](\\w+)['"]\\)`, 'g');

// Equality assertions: <api>.expect(...).to.equal(value) or .to.eql(value)
const EQUAL_ASSERT = new RegExp(`${API}\\.expect\\(.*?\\.([a-zA-Z_][\\w.]*)\\)\\.to\\.(?:equal|eql)\\((.+?)\\)`, 'g');

// Status assertions
const STATUS_ASSERT = /(?:to\.have\.status|response\.code.*?equal)\((\d+)\)/g;

// Boolean truth assertions: <api>.expect(data.active).to.be.true / .to.be.false
const BOOLEAN_ASSERT = new RegExp(`${API}\\.expect\\(.*?\\.([a-zA-Z_][\\w.]*)\\)\\.to\\.be\\.(true|false)`, 'g');

// Length assertions: <api>.expect(data.items).to.have.lengthOf(N)
const LENGTH_ASSERT = new RegExp(`${API}\\.expect\\(.*?\\.([a-zA-Z_][\\w.]*)\\)\\.to\\.have\\.(?:lengthOf|length\\.above|length\\.below)`, 'g');

export class ScriptAnalyzer {

    /**
     * Parse a post-response script to discover expected response fields
     * and their types from assertion patterns.
     */
    analyze(scriptSource: string): ScriptAnalysisResult {
        const result: ScriptAnalysisResult = {
            fieldPaths: [],
            typeHints: {},
            valueHints: {},
            expectedStatuses: []
        };

        if (!scriptSource || scriptSource.trim().length === 0) {
            return result;
        }

        // Strip comments to avoid false positives
        const cleanedSource = this.stripComments(scriptSource);

        // Extract field access paths
        this.extractFieldPaths(cleanedSource, result);

        // Extract type assertions
        this.extractTypeAssertions(cleanedSource, result);

        // Extract equality assertions
        this.extractEqualityAssertions(cleanedSource, result);

        // Extract boolean assertions
        this.extractBooleanAssertions(cleanedSource, result);

        // Extract length assertions (implies array type)
        this.extractLengthAssertions(cleanedSource, result);

        // Extract status code assertions
        this.extractStatusAssertions(cleanedSource, result);

        // Deduplicate field paths
        result.fieldPaths = [...new Set(result.fieldPaths)];
        result.expectedStatuses = [...new Set(result.expectedStatuses)];

        return result;
    }

    /**
     * Strip single-line and multi-line comments from source code.
     */
    private stripComments(source: string): string {
        let result = source.replace(/\/\*[\s\S]*?\*\//g, '');
        result = result.replace(/\/\/.*$/gm, '');
        return result;
    }

    private extractFieldPaths(source: string, result: ScriptAnalysisResult): void {
        let match: RegExpExecArray | null;
        const regex = new RegExp(FIELD_ACCESS.source, FIELD_ACCESS.flags);

        while ((match = regex.exec(source)) !== null) {
            const fieldPath = this.normalizeFieldPath(match[1]);
            if (fieldPath && !this.isCommonMethodCall(fieldPath)) {
                result.fieldPaths.push(fieldPath);
            }
        }
    }

    private extractTypeAssertions(source: string, result: ScriptAnalysisResult): void {
        let match: RegExpExecArray | null;
        const regex = new RegExp(TYPE_ASSERT.source, TYPE_ASSERT.flags);

        while ((match = regex.exec(source)) !== null) {
            const fieldPath = this.normalizeFieldPath(match[1]);
            const type = match[2].toLowerCase();

            if (fieldPath) {
                result.typeHints[fieldPath] = this.mapAssertionType(type);
                if (!result.fieldPaths.includes(fieldPath)) {
                    result.fieldPaths.push(fieldPath);
                }
            }
        }
    }

    private extractEqualityAssertions(source: string, result: ScriptAnalysisResult): void {
        let match: RegExpExecArray | null;
        const regex = new RegExp(EQUAL_ASSERT.source, EQUAL_ASSERT.flags);

        while ((match = regex.exec(source)) !== null) {
            const fieldPath = this.normalizeFieldPath(match[1]);
            const rawValue = match[2].trim();

            if (fieldPath) {
                const parsedValue = this.parseAssertionValue(rawValue);
                if (parsedValue !== undefined) {
                    result.valueHints[fieldPath] = parsedValue;
                    if (typeof parsedValue === 'string') {
                        result.typeHints[fieldPath] = result.typeHints[fieldPath] || 'string';
                    } else if (typeof parsedValue === 'number') {
                        result.typeHints[fieldPath] = result.typeHints[fieldPath] || (Number.isInteger(parsedValue) ? 'integer' : 'number');
                    } else if (typeof parsedValue === 'boolean') {
                        result.typeHints[fieldPath] = result.typeHints[fieldPath] || 'boolean';
                    }
                }
                if (!result.fieldPaths.includes(fieldPath)) {
                    result.fieldPaths.push(fieldPath);
                }
            }
        }
    }

    private extractBooleanAssertions(source: string, result: ScriptAnalysisResult): void {
        let match: RegExpExecArray | null;
        const regex = new RegExp(BOOLEAN_ASSERT.source, BOOLEAN_ASSERT.flags);

        while ((match = regex.exec(source)) !== null) {
            const fieldPath = this.normalizeFieldPath(match[1]);
            if (fieldPath) {
                result.typeHints[fieldPath] = 'boolean';
                result.valueHints[fieldPath] = match[2] === 'true';
                if (!result.fieldPaths.includes(fieldPath)) {
                    result.fieldPaths.push(fieldPath);
                }
            }
        }
    }

    private extractLengthAssertions(source: string, result: ScriptAnalysisResult): void {
        let match: RegExpExecArray | null;
        const regex = new RegExp(LENGTH_ASSERT.source, LENGTH_ASSERT.flags);

        while ((match = regex.exec(source)) !== null) {
            const fieldPath = this.normalizeFieldPath(match[1]);
            if (fieldPath) {
                result.typeHints[fieldPath] = result.typeHints[fieldPath] || 'array';
                if (!result.fieldPaths.includes(fieldPath)) {
                    result.fieldPaths.push(fieldPath);
                }
            }
        }
    }

    private extractStatusAssertions(source: string, result: ScriptAnalysisResult): void {
        let match: RegExpExecArray | null;
        const regex = new RegExp(STATUS_ASSERT.source, STATUS_ASSERT.flags);

        while ((match = regex.exec(source)) !== null) {
            const status = parseInt(match[1], 10);
            if (!isNaN(status) && status >= 100 && status < 600) {
                result.expectedStatuses.push(status);
            }
        }
    }

    private normalizeFieldPath(rawPath: string): string {
        let path = rawPath.replace(/^\./, '');
        path = path.replace(/\[\d+\]/g, '[]');
        return path;
    }

    private isCommonMethodCall(fieldPath: string): boolean {
        const methodNames = new Set([
            'to', 'be', 'have', 'not', 'deep', 'any', 'all',
            'that', 'is', 'has', 'include', 'includes',
            'equal', 'eql', 'above', 'below', 'least', 'most',
            'within', 'length', 'lengthOf', 'match', 'string',
            'keys', 'key', 'property', 'ownProperty',
            'status', 'header', 'json', 'text'
        ]);
        return methodNames.has(fieldPath.split('.')[0]);
    }

    private mapAssertionType(assertionType: string): string {
        const typeMap: Record<string, string> = {
            'string': 'string', 'number': 'number', 'object': 'object',
            'array': 'array', 'boolean': 'boolean', 'null': 'null',
            'undefined': 'null', 'int': 'integer', 'integer': 'integer',
            'float': 'number', 'double': 'number'
        };
        return typeMap[assertionType] || 'string';
    }

    private parseAssertionValue(raw: string): any {
        if ((raw.startsWith("'") && raw.endsWith("'")) ||
            (raw.startsWith('"') && raw.endsWith('"'))) {
            return raw.slice(1, -1);
        }
        const num = Number(raw);
        if (!isNaN(num) && raw.trim().length > 0) { return num; }
        if (raw === 'true') { return true; }
        if (raw === 'false') { return false; }
        if (raw === 'null') { return null; }
        return raw;
    }
}
