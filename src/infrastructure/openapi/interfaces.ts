/**
 * OpenAPI Service Interfaces
 * 
 * DI abstractions for OpenAPI-related services.
 * The concrete implementations live in services/openapi/.
 */

import type { Collection } from '../../types/collection';
import type { BodySchemaDefinition, JSONSchema7, KeyValueEntry, ResponseSchemaDefinition } from '../../types/types';
import type { OpenApiExportOptions } from './openapi-exporter';
import type { OpenApiImportOptions } from './openapi-importer';

/**
 * Schema inference service interface
 */
export interface ISchemaInferenceService {
    infer(
        collectionId: string,
        requestId: string,
        existingSchema?: ResponseSchemaDefinition,
        options?: { environment?: string; postResponseScript?: string }
    ): Promise<ResponseSchemaDefinition>;

    inferBodySchema(
        bodyContent: any,
        bodyType?: string,
        bodyFormat?: string,
        formDataEntries?: KeyValueEntry[],
        existingSchema?: BodySchemaDefinition
    ): Promise<BodySchemaDefinition | undefined>;
}

/**
 * OpenAPI exporter service interface
 */
export interface IOpenApiExporter {
    export(collectionId: string, options: OpenApiExportOptions): Promise<string>;
}

/**
 * OpenAPI importer service interface
 */
export interface IOpenApiImporter {
    import(
        filePath: string,
        options?: OpenApiImportOptions
    ): Promise<{ collection: Collection; environmentCreated?: string }>;

    /**
     * Import an OpenAPI spec fetched from a URL.
     */
    importFromUrl(
        url: string,
        options?: OpenApiImportOptions
    ): Promise<{ collection: Collection; environmentCreated?: string }>;

    /**
     * Import an OpenAPI spec from an in-memory string (JSON or YAML).
     */
    importFromString(
        rawContent: string,
        options?: OpenApiImportOptions
    ): Promise<{ collection: Collection; environmentCreated?: string }>;
}

/**
 * Schema inferrer interface (low-level)
 */
export interface ISchemaInferrer {
    inferFromValue(value: any): JSONSchema7;
    mergeSchemas(a: JSONSchema7, b: JSONSchema7): JSONSchema7;
}
