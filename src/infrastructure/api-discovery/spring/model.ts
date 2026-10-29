export interface Endpoint {
    method: string;
    path: string;
    file: string;
    line: number;
    pathParams?: string[];   // extracted path variables
    bodyType?: string;        // Java class name of request body (already unwrapped from wrappers)
    headers?: string[];
    queryParams?: string[];
    hasBody?: boolean;
    consumes?: string[];      // media types declared on mapping (resolved to actual MIME strings)
    produces?: string[];      // media types declared on mapping (produces attribute)
    formParts?: FormPart[];   // @RequestPart / @RequestParam MultipartFile parameters
    modelAttributeType?: string; // Java class name from @ModelAttribute parameter
    returnType?: string;       // Java return type of the method (unwrapped from ResponseEntity<>, Mono<>, etc.)

    // OpenAPI metadata from Swagger/OpenAPI annotations
    summary?: string;           // from @Operation(summary=...) or @ApiOperation(value=...)
    description?: string;       // from @Operation(description=...) or @ApiOperation(notes=...)
    operationId?: string;       // from @Operation(operationId=...)
    tags?: string[];            // from @Tag(name=...) or @Operation(tags=...) or @ApiOperation(tags=...)
    deprecated?: boolean;       // from @Deprecated or @Operation(deprecated=true)
    responses?: ApiResponseInfo[];  // from @ApiResponse / @ApiResponses
    parameterMeta?: ParameterMeta[];  // from @Parameter annotations on method params
    security?: string[];        // from @SecurityRequirement(name=...)
}

/** Metadata from @ApiResponse annotations on a method. */
export interface ApiResponseInfo {
    statusCode: string;         // e.g. "200", "404"
    description?: string;       // response description
    contentType?: string;       // media type of the response body
    schemaType?: string;        // Java class name for response body schema
    examples?: Record<string, any>; // from @ExampleObject(name/value)
    headers?: Record<string, ApiHeaderInfo>; // from @Header(name=..., schema=@Schema(...))
}

/** Metadata from @Header annotations nested in @ApiResponse(headers=...). */
export interface ApiHeaderInfo {
    description?: string;
    schemaType?: string;
    format?: string;
    required?: boolean;
    deprecated?: boolean;
}

/** Metadata from @Parameter annotations on method parameters. */
export interface ParameterMeta {
    name: string;               // parameter name
    in: 'path' | 'query' | 'header'; // location
    description?: string;       // from @Parameter(description=...)
    required?: boolean;         // from @Parameter(required=...)
    example?: string;           // from @Parameter(example=...)
    deprecated?: boolean;       // from @Parameter(deprecated=...)
    schemaType?: string;        // from @Parameter(schema=@Schema(type=...)) or Java type
    // Constraint fields from validation annotations
    pattern?: string;           // from @Pattern(regexp=...) or @Schema(pattern=...)
    format?: string;            // from @Schema(format=...) or @Email
    enum?: string[];            // from @Schema(allowableValues=...)
    minimum?: number;           // from @Min or @Schema(minimum=...)
    maximum?: number;           // from @Max or @Schema(maximum=...)
    exclusiveMinimum?: number;  // from @DecimalMin(inclusive=false) or @Positive
    exclusiveMaximum?: number;  // from @DecimalMax(inclusive=false) or @Negative
    minLength?: number;         // from @Size(min=...) or @Schema(minLength=...)
    maxLength?: number;         // from @Size(max=...) or @Schema(maxLength=...)
}

/** A single @RequestPart or @RequestParam MultipartFile parameter in a multipart endpoint. */
export interface FormPart {
    name: string;             // part name from annotation value or param name
    type: string;             // Java type, e.g. "MultipartFile", "String", "CreateRequest"
    isFile: boolean;          // true when type is MultipartFile
}

export interface Controller {
    name: string;
    basePath: string;
    file: string;
    line: number;
    endpoints: Endpoint[];
}

/**
 * Represents a Spring Boot application detected in the workspace.
 * Groups controllers that belong to the same project.
 */
export interface SpringApp {
    name: string;              // resolved from pom.xml / build.gradle / folder name
    rootDir: string;           // project root directory (where pom.xml / build.gradle lives)
    port?: number;             // from application.properties / application.yml
    contextPath?: string;      // server.servlet.context-path
    controllers: Controller[];
}
