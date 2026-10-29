/**
 * GraphQL Completion Provider
 * 
 * Single Responsibility: Parse GraphQL document context and produce completion items
 * from a given schema. Pure logic — no VS Code or editor dependencies.
 * 
 * This is a lightweight context parser using regex + brace counting — no graphql-js dependency.
 * 
 * Completion Scenarios:
 * - Root level: query, mutation, subscription, fragment keywords
 * - Selection set: fields of the current parent type + __typename
 * - Arguments: field argument names
 * - Argument values: enum values for enum-typed arguments
 * - Fragment spread: on TypeName, defined fragment names
 * - Directives: @skip, @include, custom directives
 * - Variable types: input types + scalars
 */

import { GraphQLField, GraphQLSchema, GraphQLType } from './graphql-schema-service';

// ─── Types ──────────────────────────────────────────

export type ContextType =
    | 'root'
    | 'operation_name'
    | 'selection_set'
    | 'argument'
    | 'argument_value'
    | 'directive'
    | 'fragment_type'
    | 'variable_def';

export interface QueryContext {
    contextType: ContextType;
    fieldPath: string[];
    parentType?: string;
    inFragment?: boolean;
    prefix: string;
    currentField?: string;
    currentArg?: string;
}

export interface CompletionItem {
    label: string;
    kind: 'field' | 'keyword' | 'argument' | 'enum' | 'type' | 'directive' | 'fragment' | 'snippet';
    detail?: string;
    description?: string;
    insertText?: string;
    deprecated?: boolean;
    sortOrder?: number;
}

// ─── Context Parser ─────────────────────────────────

export function parseQueryContext(document: string, offset: number, schema?: GraphQLSchema): QueryContext {
    const textBefore = document.slice(0, offset);

    const prefixMatch = textBefore.match(/([a-zA-Z_]\w*)$/);
    const prefix = prefixMatch ? prefixMatch[1] : '';

    const cleaned = stripCommentsAndStrings(textBefore);

    if (cleaned.trimEnd().endsWith('@') || (prefix && cleaned.trimEnd().endsWith('@' + prefix))) {
        return { contextType: 'directive', fieldPath: [], prefix };
    }

    if (isInVariableDefinition(cleaned)) {
        return { contextType: 'variable_def', fieldPath: [], prefix };
    }

    const onMatch = cleaned.match(/\.\.\.\s+on\s+(\w*)$/);
    if (onMatch) {
        return { contextType: 'fragment_type', fieldPath: [], prefix: onMatch[1] || '' };
    }

    const argValueMatch = cleaned.match(/\(\s*(?:[\w]+\s*:\s*(?:"[^"]*"|[^,)]+)\s*,\s*)*(\w+)\s*:\s*(\w*)$/);
    if (argValueMatch && isInsideParentheses(cleaned)) {
        const fieldPath = resolveFieldPath(cleaned, schema);
        const parentType = fieldPath.length > 0 ? fieldPath[fieldPath.length - 1] : undefined;
        const fieldBeforeParen = findFieldBeforeParenthesis(cleaned);
        return {
            contextType: 'argument_value',
            fieldPath,
            parentType,
            prefix: argValueMatch[2] || '',
            currentArg: argValueMatch[1],
            currentField: fieldBeforeParen || undefined
        };
    }

    if (isInsideParentheses(cleaned)) {
        const fieldPath = resolveFieldPath(cleaned, schema);
        const parentType = fieldPath.length > 0 ? fieldPath[fieldPath.length - 1] : undefined;
        const fieldBeforeParen = findFieldBeforeParenthesis(cleaned);
        return {
            contextType: 'argument',
            fieldPath,
            parentType,
            prefix,
            currentField: fieldBeforeParen || undefined
        };
    }

    const braceDepth = countUnmatched(cleaned, '{', '}');

    if (braceDepth === 0) {
        return { contextType: 'root', fieldPath: [], prefix };
    }

    const fieldPath = resolveFieldPath(cleaned, schema);

    return {
        contextType: 'selection_set',
        fieldPath,
        parentType: fieldPath.length > 0 ? fieldPath[fieldPath.length - 1] : undefined,
        prefix
    };
}

// ─── Completion Generator ───────────────────────────

export function getCompletions(schema: GraphQLSchema, context: QueryContext): CompletionItem[] {
    switch (context.contextType) {
        case 'root':
            return getRootCompletions(schema, context.prefix);
        case 'selection_set':
            return getSelectionSetCompletions(schema, context);
        case 'argument':
            return getArgumentCompletions(schema, context);
        case 'argument_value':
            return getArgumentValueCompletions(schema, context);
        case 'directive':
            return getDirectiveCompletions(schema, context.prefix);
        case 'fragment_type':
            return getFragmentTypeCompletions(schema, context.prefix);
        case 'variable_def':
            return getVariableTypeCompletions(schema, context.prefix);
        default:
            return [];
    }
}

// ─── Completion Generators ──────────────────────────

function getRootCompletions(schema: GraphQLSchema, prefix: string): CompletionItem[] {
    const items: CompletionItem[] = [];

    const keywords = [
        { label: 'query', detail: 'Query operation', insertText: 'query ${1:OperationName} {\n  $0\n}' },
        { label: 'mutation', detail: 'Mutation operation', insertText: 'mutation ${1:OperationName} {\n  $0\n}' },
        { label: 'subscription', detail: 'Subscription operation', insertText: 'subscription ${1:OperationName} {\n  $0\n}' },
        { label: 'fragment', detail: 'Fragment definition', insertText: 'fragment ${1:FragmentName} on ${2:TypeName} {\n  $0\n}' },
    ];

    for (const kw of keywords) {
        if (kw.label === 'mutation' && !schema.mutationType) continue;
        if (kw.label === 'subscription' && !schema.subscriptionType) continue;

        if (!prefix || kw.label.startsWith(prefix.toLowerCase())) {
            items.push({
                label: kw.label,
                kind: 'keyword',
                detail: kw.detail,
                insertText: kw.insertText,
                sortOrder: 0
            });
        }
    }

    const queryType = schema.types.get(schema.queryType);
    if (queryType) {
        for (const field of queryType.fields) {
            if (!prefix || field.name.toLowerCase().startsWith(prefix.toLowerCase())) {
                items.push(fieldToCompletionItem(field, 1, schema));
            }
        }
    }

    return items;
}

function getSelectionSetCompletions(schema: GraphQLSchema, context: QueryContext): CompletionItem[] {
    const items: CompletionItem[] = [];
    const parentTypeName = context.parentType;

    if (!parentTypeName) return items;

    const parentType = schema.types.get(parentTypeName);
    if (!parentType) return items;

    if (parentType.kind === 'OBJECT' || parentType.kind === 'INTERFACE') {
        for (const field of parentType.fields) {
            if (!context.prefix || field.name.toLowerCase().startsWith(context.prefix.toLowerCase())) {
                items.push(fieldToCompletionItem(field, 0, schema));
            }
        }

        if (!context.prefix || '__typename'.startsWith(context.prefix.toLowerCase())) {
            items.push({
                label: '__typename',
                kind: 'field',
                detail: 'String!',
                description: 'The name of the current object type',
                sortOrder: 10
            });
        }
    }

    if (parentType.kind === 'UNION' || parentType.kind === 'INTERFACE') {
        for (const possibleType of parentType.possibleTypes) {
            const typeName = possibleType.replace(/[!\[\]]/g, '');
            if (!context.prefix || typeName.toLowerCase().startsWith(context.prefix.toLowerCase())) {
                items.push({
                    label: `... on ${typeName}`,
                    kind: 'snippet',
                    detail: `Inline fragment on ${typeName}`,
                    insertText: `... on ${typeName} {\n  $0\n}`,
                    sortOrder: 5
                });
            }
        }
    }

    if (!context.prefix || '...'.startsWith(context.prefix)) {
        items.push({
            label: '...',
            kind: 'snippet',
            detail: 'Fragment spread',
            insertText: '...${1:FragmentName}',
            sortOrder: 8
        });
    }

    return items;
}

function getArgumentCompletions(schema: GraphQLSchema, context: QueryContext): CompletionItem[] {
    if (!context.currentField || !context.parentType) return [];

    const parentType = schema.types.get(context.parentType);
    if (!parentType) return [];

    const field = parentType.fields.find(f => f.name === context.currentField);
    if (!field) return [];

    const items: CompletionItem[] = [];

    for (const arg of field.args) {
        if (!context.prefix || arg.name.toLowerCase().startsWith(context.prefix.toLowerCase())) {
            items.push({
                label: arg.name,
                kind: 'argument',
                detail: arg.type,
                description: arg.description,
                insertText: `${arg.name}: `,
                sortOrder: 0
            });
        }
    }

    return items;
}

function getArgumentValueCompletions(schema: GraphQLSchema, context: QueryContext): CompletionItem[] {
    if (!context.currentArg || !context.currentField || !context.parentType) return [];

    const items: CompletionItem[] = [];

    const parentType = schema.types.get(context.parentType);
    if (!parentType) return items;

    const field = parentType.fields.find(f => f.name === context.currentField);
    if (!field) return items;

    const arg = field.args.find(a => a.name === context.currentArg);
    if (!arg) return items;

    const baseArgType = arg.type.replace(/[!\[\]]/g, '');
    const argType = schema.types.get(baseArgType);

    if (argType && argType.kind === 'ENUM') {
        for (const ev of argType.enumValues) {
            if (!context.prefix || ev.name.toLowerCase().startsWith(context.prefix.toLowerCase())) {
                items.push({
                    label: ev.name,
                    kind: 'enum',
                    detail: argType.name,
                    description: ev.description,
                    deprecated: ev.isDeprecated,
                    sortOrder: 0
                });
            }
        }
    } else if (baseArgType === 'Boolean') {
        for (const v of ['true', 'false']) {
            if (!context.prefix || v.startsWith(context.prefix.toLowerCase())) {
                items.push({ label: v, kind: 'keyword', detail: 'Boolean', sortOrder: 0 });
            }
        }
    }

    return items;
}

function getDirectiveCompletions(schema: GraphQLSchema, prefix: string): CompletionItem[] {
    const items: CompletionItem[] = [];

    for (const directive of schema.directives) {
        if (!prefix || directive.name.toLowerCase().startsWith(prefix.toLowerCase())) {
            const argsStr = directive.args.length > 0
                ? `(${directive.args.map(a => `${a.name}: ${a.type}`).join(', ')})`
                : '';
            items.push({
                label: `@${directive.name}`,
                kind: 'directive',
                detail: argsStr || undefined,
                description: directive.description,
                insertText: directive.args.length > 0
                    ? `@${directive.name}($1)`
                    : `@${directive.name}`,
                sortOrder: 0
            });
        }
    }

    return items;
}

function getFragmentTypeCompletions(schema: GraphQLSchema, prefix: string): CompletionItem[] {
    const items: CompletionItem[] = [];

    for (const [name, type] of schema.types) {
        if (type.kind === 'OBJECT' || type.kind === 'INTERFACE' || type.kind === 'UNION') {
            if (!prefix || name.toLowerCase().startsWith(prefix.toLowerCase())) {
                items.push({
                    label: name,
                    kind: 'type',
                    detail: type.kind,
                    description: type.description,
                    sortOrder: 0
                });
            }
        }
    }

    return items;
}

function getVariableTypeCompletions(schema: GraphQLSchema, prefix: string): CompletionItem[] {
    const items: CompletionItem[] = [];

    for (const [name, type] of schema.types) {
        if (type.kind === 'SCALAR' || type.kind === 'INPUT_OBJECT' || type.kind === 'ENUM') {
            if (!prefix || name.toLowerCase().startsWith(prefix.toLowerCase())) {
                items.push({
                    label: name,
                    kind: 'type',
                    detail: type.kind,
                    description: type.description,
                    sortOrder: 0
                });
            }
        }
    }

    return items;
}

// ─── Helpers ────────────────────────────────────────

function fieldToCompletionItem(field: GraphQLField, sortOrder: number, schema?: GraphQLSchema): CompletionItem {
    const baseType = field.type.replace(/[!\[\]]/g, '');
    let hasSubFields = false;
    if (schema) {
        const resolvedType = schema.types.get(baseType);
        hasSubFields = !!resolvedType && (resolvedType.kind === 'OBJECT' || resolvedType.kind === 'INTERFACE' || resolvedType.kind === 'UNION');
    } else {
        const builtInScalars = new Set(['String', 'Int', 'Float', 'Boolean', 'ID']);
        hasSubFields = !builtInScalars.has(baseType);
    }

    let insertText = field.name;
    if (field.args.length > 0) {
        const requiredArgs = field.args.filter(a => a.type.endsWith('!'));
        if (requiredArgs.length > 0) {
            const argSnippets = requiredArgs.map((a, i) => `${a.name}: \${${i + 1}}`).join(', ');
            insertText = `${field.name}(${argSnippets})`;
        }
    }
    if (hasSubFields) {
        insertText += ' {\n  $0\n}';
    }

    return {
        label: field.name,
        kind: 'field',
        detail: field.type,
        description: field.description,
        insertText,
        deprecated: field.isDeprecated,
        sortOrder
    };
}

function stripCommentsAndStrings(text: string): string {
    return text
        .replace(/"""[\s\S]*?"""/g, '""')
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/#[^\n]*/g, '');
}

function countUnmatched(text: string, open: string, close: string): number {
    let count = 0;
    for (const ch of text) {
        if (ch === open) count++;
        else if (ch === close) count--;
    }
    return count;
}

function isInsideParentheses(text: string): boolean {
    return countUnmatched(text, '(', ')') > 0;
}

function isInVariableDefinition(text: string): boolean {
    const openParens = countUnmatched(text, '(', ')');
    if (openParens <= 0) return false;
    const firstBrace = text.indexOf('{');
    const relevantText = firstBrace >= 0 ? text.slice(0, firstBrace) : text;
    return /\$\w+\s*:\s*\w*$/.test(relevantText);
}

function findFieldBeforeParenthesis(text: string): string | null {
    let depth = 0;
    for (let i = text.length - 1; i >= 0; i--) {
        if (text[i] === ')') depth++;
        else if (text[i] === '(') {
            if (depth === 0) {
                const before = text.slice(0, i).trimEnd();
                const match = before.match(/(\w+)$/);
                return match ? match[1] : null;
            }
            depth--;
        }
    }
    return null;
}

function resolveFieldPath(text: string, schema?: GraphQLSchema): string[] {
    if (!schema) return [];

    const path: string[] = [];

    let rootTypeName = schema.queryType;
    const operationMatch = text.match(/\b(query|mutation|subscription)\b/);
    if (operationMatch) {
        if (operationMatch[1] === 'mutation' && schema.mutationType) {
            rootTypeName = schema.mutationType;
        } else if (operationMatch[1] === 'subscription' && schema.subscriptionType) {
            rootTypeName = schema.subscriptionType;
        }
    }

    path.push(rootTypeName);

    const tokens = tokenize(text);
    let currentType: GraphQLType | undefined = schema.types.get(rootTypeName);

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (token === '{') {
            continue;
        }

        if (token === '}') {
            path.pop();
            currentType = path.length > 0 ? schema.types.get(path[path.length - 1]) : undefined;
            continue;
        }

        if (i + 1 < tokens.length && (tokens[i + 1] === '{' || tokens[i + 1] === '(')) {
            let nextIdx = i + 1;
            if (tokens[nextIdx] === '(') {
                let parenDepth = 1;
                nextIdx++;
                while (nextIdx < tokens.length && parenDepth > 0) {
                    if (tokens[nextIdx] === '(') parenDepth++;
                    else if (tokens[nextIdx] === ')') parenDepth--;
                    nextIdx++;
                }
            }

            if (nextIdx < tokens.length && tokens[nextIdx] === '{') {
                if (currentType) {
                    const field = currentType.fields.find(f => f.name === token);
                    if (field) {
                        const resolvedTypeName = field.type.replace(/[!\[\]]/g, '');
                        path.push(resolvedTypeName);
                        currentType = schema.types.get(resolvedTypeName);
                    }
                }
            }
        }
    }

    return path;
}

function tokenize(text: string): string[] {
    const tokens: string[] = [];
    const regex = /([a-zA-Z_]\w*|[{}(),:=@!$\[\].]|\.\.\.|"[^"]*"|\d+)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        tokens.push(match[1]);
    }
    return tokens;
}
