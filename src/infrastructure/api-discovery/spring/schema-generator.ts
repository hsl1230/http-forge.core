import { findJavaTypeFiles, readFileText } from './file-utils';
import { unwrapBodyType } from './spring-types';

/**
 * JSON Schema type definition (OpenAPI 3.0 compatible subset).
 */
export type JSONSchema = Record<string, any>;

/**
 * Generates JSON Schema from Java class source files.
 *
 * Extracts field types, validation annotations (@Schema, @NotNull, @Size, @Min, @Max, etc.)
 * and produces OpenAPI 3.0 compatible JSON Schema objects.
 */
export class SchemaGenerator {
    private cache = new Map<string, JSONSchema>();

    constructor(private readonly projectRoot: string) {}

    clearCache(): void {
        this.cache.clear();
    }

    /**
     * Generate a JSON Schema for a given Java class name.
     * Returns undefined if the class cannot be found.
     */
    async generate(typeName: string): Promise<JSONSchema | undefined> {
        if (!typeName) return undefined;

        // Handle primitive / built-in types directly
        const primitiveSchema = this.primitiveSchema(typeName);
        if (primitiveSchema) return primitiveSchema;

        // Extract generic type arguments (e.g. GenericResponse<BookmarkB2B>)
        let baseTypeName = typeName;
        let genericArgs: string[] = [];
        const genericMatch = /^([^<]+)<(.+)>$/.exec(typeName);
        if (genericMatch) {
            baseTypeName = genericMatch[1].trim();
            genericArgs = this.splitGenericArgs(genericMatch[2]);
        }

        const parts = baseTypeName.split('.');
        const simpleName = parts.pop()!;
        const packageHint = parts.length ? parts.join('.') : undefined;

        if (this.cache.has(typeName)) return this.cache.get(typeName);

        // Placeholder to handle circular references
        const schema: JSONSchema = { type: 'object', properties: {}, required: [] };
        this.cache.set(typeName, schema);

        let files = await findJavaTypeFiles(this.projectRoot, simpleName);

        if (files.length > 1 && packageHint) {
            const pkgRegex = /^\s*package\s+([\w.]+);/m;
            for (const f of files) {
                const text = await readFileText(f);
                const m = pkgRegex.exec(text);
                if (m && m[1] === packageHint) {
                    files = [f];
                    break;
                }
            }
        }

        if (files.length === 0) {
            // If this is a generic type and the base class file isn't in the workspace
            // (e.g. framework wrappers like GenericResponse<BookmarkB2B>),
            // fall back to generating schema from the first type argument.
            if (genericArgs.length > 0) {
                const innerSchema = await this.generate(genericArgs[0]);
                if (innerSchema && innerSchema.properties && Object.keys(innerSchema.properties).length > 0) {
                    Object.assign(schema, innerSchema);
                    return schema;
                }
            }
            return { type: 'object' };
        }

        const text = await readFileText(files[0]);

        // Build a map from type parameters (T, U, etc.) to actual types
        const typeParamMap = this.buildTypeParamMap(text, simpleName, genericArgs);

        await this.parseClassToSchema(text, simpleName, schema, typeParamMap);

        // Clean up empty required array
        if (schema.required && schema.required.length === 0) {
            delete schema.required;
        }

        return schema;
    }

    /**
     * Generate a JSON Schema for a response type, potentially wrapping in
     * response-level metadata.
     */
    async generateResponseSchema(returnType: string): Promise<JSONSchema | undefined> {
        if (!returnType || returnType === 'void') return undefined;

        // Unwrap ResponseEntity<T>, Mono<T>, etc.
        const unwrapped = unwrapBodyType(returnType);
        if (unwrapped === 'void') return undefined;

        // Handle List<T>, Set<T>, Collection<T>
        const listMatch = /(List|Set|Collection)<([^>]+)>/.exec(unwrapped);
        if (listMatch) {
            const innerType = listMatch[2].trim();
            const itemSchema = await this.generate(innerType);
            return { type: 'array', items: itemSchema || { type: 'object' } };
        }

        // Handle array types
        if (unwrapped.endsWith('[]')) {
            const inner = unwrapped.replace(/\[\]$/, '');
            const itemSchema = await this.generate(inner);
            return { type: 'array', items: itemSchema || { type: 'object' } };
        }

        return this.generate(unwrapped);
    }

    private async parseClassToSchema(text: string, className: string, schema: JSONSchema, typeParamMap?: Map<string, string>): Promise<void> {
        // Try regex-based parsing (more robust for annotation extraction)
        const fields = this.extractFieldsRegex(text, className);

        for (const field of fields) {
            // Resolve generic type parameters (e.g. T → BookmarkB2B)
            if (typeParamMap && typeParamMap.size > 0) {
                field.javaType = this.resolveTypeParams(field.javaType, typeParamMap);
            }

            const propSchema = await this.fieldToSchema(field);
            const jsonKey = field.jsonPropertyName || field.name;
            schema.properties[jsonKey] = propSchema;

            if (field.required) {
                schema.required.push(jsonKey);
            }
        }
    }

    /**
     * Build a map from declared type parameters (T, U, etc.) to actual type arguments.
     * E.g. for class GenericResponse<T> with genericArgs=['BookmarkB2B'],
     * returns Map { 'T' => 'BookmarkB2B' }
     */
    private buildTypeParamMap(text: string, className: string, genericArgs: string[]): Map<string, string> {
        const map = new Map<string, string>();
        if (genericArgs.length === 0) return map;

        // Match: class ClassName<T> or class ClassName<T, U> or class ClassName<T extends Foo>
        const classDecl = new RegExp(`class\\s+${className}\\s*<([^{]+?)>\\s*(?:extends|implements|\\{)`).exec(text);
        if (classDecl) {
            const typeParams = this.splitGenericArgs(classDecl[1])
                .map(p => p.trim().split(/\s+/)[0]); // Handle 'T extends Foo'
            typeParams.forEach((param, i) => {
                if (i < genericArgs.length) {
                    map.set(param, genericArgs[i]);
                }
            });
        }
        return map;
    }

    /**
     * Split a comma-separated generic type argument string, respecting nested angle brackets.
     * E.g. 'List<String>, BookmarkB2B' → ['List<String>', 'BookmarkB2B']
     */
    private splitGenericArgs(argsStr: string): string[] {
        const args: string[] = [];
        let depth = 0;
        let current = '';
        for (const ch of argsStr) {
            if (ch === '<') { depth++; current += ch; }
            else if (ch === '>') { depth--; current += ch; }
            else if (ch === ',' && depth === 0) {
                args.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        if (current.trim()) args.push(current.trim());
        return args;
    }

    /**
     * Replace type parameter names with their actual types in a Java type string.
     * E.g. 'T' → 'BookmarkB2B', 'List<T>' → 'List<BookmarkB2B>'
     */
    private resolveTypeParams(javaType: string, typeParamMap: Map<string, string>): string {
        let resolved = javaType;
        for (const [param, actualType] of typeParamMap) {
            resolved = resolved.replace(new RegExp(`\\b${param}\\b`, 'g'), actualType);
        }
        return resolved;
    }

    private extractFieldsRegex(text: string, className: string): FieldInfo[] {
        const fields: FieldInfo[] = [];
        const lines = text.split(/\r?\n/);
        let inClass = false;
        let braceDepth = 0;

        // Detect Lombok
        const classIdx = text.search(new RegExp(`class\\s+${className}\\b`));
        const preamble = classIdx >= 0 ? text.substring(Math.max(0, classIdx - 500), classIdx) : '';
        const hasLombok = /@(?:lombok\.)?(?:Data|Getter|Value)\b/.test(preamble);

        // Detect standard JavaBean: has public getters for private fields.
        // If so, all non-static, non-transient fields are serialisable via getters.
        const hasPublicGetters = /public\s+\S+\s+(?:get|is)[A-Z]\w*\s*\(/.test(text);

        let pendingAnnotationLines: string[] = [];

        for (const ln of lines) {
            const trimmed = ln.trim();

            if (!inClass) {
                if (new RegExp(`class\\s+${className}\\b`).test(trimmed)) {
                    inClass = true;
                    braceDepth += (ln.match(/\{/g) || []).length;
                    braceDepth -= (ln.match(/\}/g) || []).length;
                }
                continue;
            }

            const depthBeforeLine = braceDepth;
            braceDepth += (ln.match(/\{/g) || []).length;
            braceDepth -= (ln.match(/\}/g) || []).length;

            if (braceDepth <= 0) break;
            if (depthBeforeLine > 1) continue;

            // Accumulate annotations
            const annoMatch = /^@(\w+)/.exec(trimmed);
            if (annoMatch && !/(?:private|public|protected)\s/.test(trimmed) && !trimmed.includes(';')) {
                pendingAnnotationLines.push(trimmed);
                continue;
            }

            // Skip getter/setter declarations
            if (/^public\s+\S+\s+(get|is|set)[A-Z]\w*\s*\(/.test(trimmed)) {
                pendingAnnotationLines = [];
                continue;
            }

            // Field declaration
            const fieldMatch = /(?:(private|public|protected)\s+)?([A-Za-z0-9_<>,\s\[\]?]+?)\s+([A-Za-z0-9_]+)\s*(?:=.*)?;/.exec(trimmed);
            if (fieldMatch) {
                let ftype = fieldMatch[2].replace(/\b(final)\b/g, '').trim().replace(/@\w+\s*/g, '').trim();
                const fname = fieldMatch[3];
                const access = fieldMatch[1] || '';

                if (ftype && fname && !/^(class|interface|enum|return|if|for|while|void)\b/.test(ftype)) {
                    const isStatic = /\bstatic\b/.test(trimmed);
                    const isTransient = /\btransient\b/.test(trimmed);
                    const allAnnotations = [...pendingAnnotationLines, trimmed];
                    const joined = allAnnotations.join(' ');

                    // Skip static, transient, @JsonIgnore
                    if (!isStatic && !isTransient && !/@JsonIgnore\b/.test(joined)) {
                        const isPublic = access === 'public';
                        // Include field if: public, Lombok class, has @JsonProperty,
                        // or standard JavaBean with public getters
                        if (isPublic || hasLombok || hasPublicGetters || /@JsonProperty\b/.test(joined)) {
                            fields.push(this.parseFieldAnnotations(fname, ftype, allAnnotations));
                        }
                    }
                }
            }

            pendingAnnotationLines = [];
        }

        return fields;
    }

    private parseFieldAnnotations(name: string, javaType: string, annotationLines: string[]): FieldInfo {
        const joined = annotationLines.join(' ');

        const field: FieldInfo = { name, javaType };

        // @JsonProperty("altName")
        const jpMatch = /\bvalue\s*=\s*"([^"]*)"/.exec(joined.match(/@JsonProperty\([^)]*\)/)?.[0] || '')
            || /@JsonProperty\(\s*"([^"]*)"/.exec(joined);
        if (jpMatch && jpMatch[1]) field.jsonPropertyName = jpMatch[1];

        // @Schema attributes
        field.description = this.extractAttr(joined, 'Schema', 'description');
        field.example = this.extractAttr(joined, 'Schema', 'example');
        const schemaType = this.extractAttr(joined, 'Schema', 'type');
        if (schemaType) field.schemaTypeOverride = schemaType;
        const schemaFormat = this.extractAttr(joined, 'Schema', 'format');
        if (schemaFormat) field.format = schemaFormat;
        const schemaNullable = this.extractAttr(joined, 'Schema', 'nullable');
        if (schemaNullable === 'true') field.nullable = true;
        const schemaReadOnly = this.extractAttr(joined, 'Schema', 'readOnly');
        if (schemaReadOnly === 'true') field.readOnly = true;
        const schemaWriteOnly = this.extractAttr(joined, 'Schema', 'writeOnly');
        if (schemaWriteOnly === 'true') field.writeOnly = true;
        const schemaDeprecated = this.extractAttr(joined, 'Schema', 'deprecated');
        if (schemaDeprecated === 'true') field.deprecated = true;
        const schemaTitle = this.extractAttr(joined, 'Schema', 'title');
        if (schemaTitle) field.title = schemaTitle;
        const schemaDefaultValue = this.extractAttr(joined, 'Schema', 'defaultValue');
        if (schemaDefaultValue) field.defaultValue = schemaDefaultValue;

        // @Schema allowableValues / enumeration
        const enumMatch = /allowableValues\s*=\s*\{([^}]*)\}/.exec(joined);
        if (enumMatch) {
            field.enumValues = enumMatch[1].split(',').map(v => v.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
        }

        // @Schema(minimum/maximum)
        const schemaMin = this.extractAttr(joined, 'Schema', 'minimum');
        if (schemaMin) field.minimum = Number(schemaMin);
        const schemaMax = this.extractAttr(joined, 'Schema', 'maximum');
        if (schemaMax) field.maximum = Number(schemaMax);
        const schemaMinLength = this.extractAttr(joined, 'Schema', 'minLength');
        if (schemaMinLength) field.minLength = Number(schemaMinLength);
        const schemaMaxLength = this.extractAttr(joined, 'Schema', 'maxLength');
        if (schemaMaxLength) field.maxLength = Number(schemaMaxLength);
        const schemaPattern = this.extractAttr(joined, 'Schema', 'pattern');
        if (schemaPattern) field.pattern = schemaPattern;

        // Swagger 2: @ApiModelProperty
        if (!field.description) field.description = this.extractAttr(joined, 'ApiModelProperty', 'value');
        if (!field.example) field.example = this.extractAttr(joined, 'ApiModelProperty', 'example');

        // Bean Validation annotations → required
        if (/@NotNull\b/.test(joined) || /@NotBlank\b/.test(joined) || /@NotEmpty\b/.test(joined)) {
            field.required = true;
        }

        // @Size
        const sizeMin = this.extractAttr(joined, 'Size', 'min');
        if (sizeMin && !field.minLength) field.minLength = Number(sizeMin);
        const sizeMax = this.extractAttr(joined, 'Size', 'max');
        if (sizeMax && !field.maxLength) field.maxLength = Number(sizeMax);

        // @Min / @Max
        const minVal = this.extractAttr(joined, 'Min', 'value') || this.extractSingleArg(joined, 'Min');
        if (minVal && field.minimum === undefined) field.minimum = Number(minVal);
        const maxVal = this.extractAttr(joined, 'Max', 'value') || this.extractSingleArg(joined, 'Max');
        if (maxVal && field.maximum === undefined) field.maximum = Number(maxVal);

        // @DecimalMin / @DecimalMax
        const decMin = this.extractAttr(joined, 'DecimalMin', 'value') || this.extractSingleArg(joined, 'DecimalMin');
        if (decMin && field.minimum === undefined) field.minimum = Number(decMin);
        const decMax = this.extractAttr(joined, 'DecimalMax', 'value') || this.extractSingleArg(joined, 'DecimalMax');
        if (decMax && field.maximum === undefined) field.maximum = Number(decMax);

        // @Email
        if (/@Email\b/.test(joined)) field.format = field.format || 'email';

        // @Pattern
        const patternVal = this.extractAttr(joined, 'Pattern', 'regexp');
        if (patternVal && !field.pattern) field.pattern = patternVal;

        // @Positive / @Negative
        if (/@PositiveOrZero\b/.test(joined) && field.minimum === undefined) field.minimum = 0;
        if (/@Positive\b/.test(joined) && field.minimum === undefined) field.minimum = 1;
        if (/@NegativeOrZero\b/.test(joined) && field.maximum === undefined) field.maximum = 0;
        if (/@Negative\b/.test(joined) && field.maximum === undefined) field.maximum = -1;

        // @Past / @Future
        if (/@Past\b/.test(joined) || /@PastOrPresent\b/.test(joined)) {
            field.format = field.format || 'date-time';
        }
        if (/@Future\b/.test(joined) || /@FutureOrPresent\b/.test(joined)) {
            field.format = field.format || 'date-time';
        }

        return field;
    }

    private async fieldToSchema(field: FieldInfo): Promise<JSONSchema> {
        const schema: JSONSchema = {};

        // Use override type if provided by @Schema(type=...)
        if (field.schemaTypeOverride) {
            schema.type = field.schemaTypeOverride;
        } else {
            // Map Java type → JSON Schema type
            Object.assign(schema, this.javaTypeToJsonSchema(field.javaType));
        }

        // Apply metadata
        if (field.description) schema.description = field.description;
        if (field.title) schema.title = field.title;
        if (field.format) schema.format = field.format;
        if (field.example !== undefined) schema.example = this.coerceValue(field.example);
        if (field.defaultValue !== undefined) schema.default = this.coerceValue(field.defaultValue);
        if (field.nullable) schema.nullable = true;
        if (field.readOnly) schema.readOnly = true;
        if (field.writeOnly) schema.writeOnly = true;
        if (field.deprecated) schema.deprecated = true;
        if (field.enumValues) schema.enum = field.enumValues;
        if (field.minimum !== undefined) schema.minimum = field.minimum;
        if (field.maximum !== undefined) schema.maximum = field.maximum;
        if (field.minLength !== undefined) schema.minLength = field.minLength;
        if (field.maxLength !== undefined) schema.maxLength = field.maxLength;
        if (field.pattern) schema.pattern = field.pattern;

        // For nested object types, recurse to generate sub-schema
        if (schema.type === 'object' && !schema.properties) {
            const nested = await this.generate(field.javaType);
            if (nested && nested.properties) {
                schema.properties = nested.properties;
                if (nested.required) schema.required = nested.required;
            }
        }

        // For array types, resolve item schema
        if (schema.type === 'array' && !schema.items) {
            const listMatch = /(List|Set|Collection)<([^>]+)>/.exec(field.javaType);
            if (listMatch) {
                const innerType = listMatch[2].trim();
                const itemSchema = this.primitiveSchema(innerType) || await this.generate(innerType);
                schema.items = itemSchema || { type: 'object' };
            }
        }

        return schema;
    }

    /**
     * Map a Java type to a JSON Schema type/format.
     */
    private javaTypeToJsonSchema(javaType: string): JSONSchema {
        // String types
        if (/^(String|CharSequence|char|Character)$/.test(javaType)) {
            return { type: 'string' };
        }
        // Integer types
        if (/^(int|Integer|short|Short|byte|Byte)$/.test(javaType)) {
            return { type: 'integer', format: 'int32' };
        }
        if (/^(long|Long|BigInteger)$/.test(javaType)) {
            return { type: 'integer', format: 'int64' };
        }
        // Float types
        if (/^(float|Float)$/.test(javaType)) {
            return { type: 'number', format: 'float' };
        }
        if (/^(double|Double|BigDecimal)$/.test(javaType)) {
            return { type: 'number', format: 'double' };
        }
        // Boolean
        if (/^(boolean|Boolean)$/.test(javaType)) {
            return { type: 'boolean' };
        }
        // Date/Time types
        if (/^(LocalDate)$/.test(javaType)) {
            return { type: 'string', format: 'date' };
        }
        if (/^(LocalDateTime|ZonedDateTime|OffsetDateTime|Instant|Date|Timestamp)$/.test(javaType)) {
            return { type: 'string', format: 'date-time' };
        }
        if (/^(LocalTime|OffsetTime)$/.test(javaType)) {
            return { type: 'string', format: 'time' };
        }
        // UUID
        if (/^UUID$/.test(javaType)) {
            return { type: 'string', format: 'uuid' };
        }
        // URI / URL
        if (/^(URI|URL)$/.test(javaType)) {
            return { type: 'string', format: 'uri' };
        }
        // Binary
        if (/^(byte\[\]|Byte\[\])$/.test(javaType)) {
            return { type: 'string', format: 'binary' };
        }
        // Map
        if (/^Map\b/.test(javaType)) {
            return { type: 'object', additionalProperties: true };
        }
        // List / Set / Collection
        if (/(List|Set|Collection)</.test(javaType)) {
            return { type: 'array' };
        }
        // Array
        if (javaType.endsWith('[]')) {
            const inner = javaType.replace(/\[\]$/, '');
            return { type: 'array', items: this.primitiveSchema(inner) || { type: 'object' } };
        }
        // Object / enum - return as object, will be resolved later
        return { type: 'object' };
    }

    /**
     * Return a JSON Schema for a primitive/built-in type, or undefined if it's a complex type.
     */
    private primitiveSchema(typeName: string): JSONSchema | undefined {
        const schema = this.javaTypeToJsonSchema(typeName);
        if (schema.type !== 'object' || /^Map\b/.test(typeName)) return schema;
        return undefined;
    }

    /**
     * Map a Java type to an OpenAPI parameter type string.
     */
    static javaTypeToParamType(javaType: string): 'string' | 'integer' | 'number' | 'boolean' | 'array' {
        if (/^(int|Integer|long|Long|short|Short|byte|Byte|BigInteger)$/.test(javaType)) return 'integer';
        if (/^(float|Float|double|Double|BigDecimal)$/.test(javaType)) return 'number';
        if (/^(boolean|Boolean)$/.test(javaType)) return 'boolean';
        if (/(List|Set|Collection)</.test(javaType) || javaType.endsWith('[]')) return 'array';
        return 'string';
    }

    /**
     * Map a Java type to an OpenAPI format string (or undefined).
     */
    static javaTypeToFormat(javaType: string): string | undefined {
        if (/^(int|Integer|short|Short|byte|Byte)$/.test(javaType)) return 'int32';
        if (/^(long|Long|BigInteger)$/.test(javaType)) return 'int64';
        if (/^(float|Float)$/.test(javaType)) return 'float';
        if (/^(double|Double|BigDecimal)$/.test(javaType)) return 'double';
        if (/^(LocalDate)$/.test(javaType)) return 'date';
        if (/^(LocalDateTime|ZonedDateTime|OffsetDateTime|Instant|Date|Timestamp)$/.test(javaType)) return 'date-time';
        if (/^(LocalTime|OffsetTime)$/.test(javaType)) return 'time';
        if (/^UUID$/.test(javaType)) return 'uuid';
        if (/^(URI|URL)$/.test(javaType)) return 'uri';
        return undefined;
    }

    private extractAttr(text: string, annotationName: string, attrName: string): string | undefined {
        const re = new RegExp(`@${annotationName}\\b[^)]*\\b${attrName}\\s*=\\s*"([^"]*)"`, 's');
        const m = re.exec(text);
        return m ? m[1] : undefined;
    }

    private extractSingleArg(text: string, annotationName: string): string | undefined {
        const re = new RegExp(`@${annotationName}\\(\\s*([^")]+?)\\s*\\)`);
        const m = re.exec(text);
        if (m && !/=/.test(m[1])) return m[1].trim();
        return undefined;
    }

    private coerceValue(val: string): any {
        if (/^-?\d+$/.test(val)) return parseInt(val, 10);
        if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
        if (val === 'true') return true;
        if (val === 'false') return false;
        return val;
    }
}

interface FieldInfo {
    name: string;
    javaType: string;
    jsonPropertyName?: string;
    description?: string;
    example?: string;
    title?: string;
    format?: string;
    nullable?: boolean;
    readOnly?: boolean;
    writeOnly?: boolean;
    deprecated?: boolean;
    required?: boolean;
    enumValues?: string[];
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    defaultValue?: string;
    schemaTypeOverride?: string;
}
