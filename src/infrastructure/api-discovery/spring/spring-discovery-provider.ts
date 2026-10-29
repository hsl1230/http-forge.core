/**
 * API Discovery — Spring Provider
 *
 * Parses Spring Boot (Spring MVC) controllers from Java sources.
 * Ported from `spring-api-tester` (controllerVisitor / endpointParser /
 * schemaGenerator), with all vscode fs/workspace glue swapped onto node
 * `fs`/`path` over concrete project roots (DECISIONS D2).
 *
 * `java-parser` is a heavy external dependency (~1 MB). It is loaded LAZILY:
 * `supports()` stays cheap (build-file + controller-hint scan, no parser), and
 * the AST parser module is `import()`'d only when `discover()` runs (D10).
 */

import * as fs from 'fs';
import * as path from 'path';
import { ApiDiscoveryProvider, ProviderSupport } from '../provider';
import type {
  DiscoveredApi,
  DiscoveredApiBody,
  DiscoveredApiParameter,
  DiscoveredApiResponse,
  DiscoveryContext,
  DiscoveryResult,
  DiscoveryWarning,
  FrameworkFingerprint,
  JsonSchema,
} from '../types';
import { collectJavaFiles } from './file-utils';
import type { Controller, Endpoint, ParameterMeta } from './model';
import { SchemaGenerator } from './schema-generator';

type EndpointParserModule = typeof import('./endpoint-parser');

const BUILD_FILE_HINTS = ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle'];
const CONTROLLER_HINT_RE = /@(?:RestController|Controller)\b/;

export class SpringDiscoveryProvider implements ApiDiscoveryProvider {
  public readonly id = 'provider.spring';
  public readonly framework: 'spring' = 'spring';
  private parserModule?: EndpointParserModule;

  public supports(fingerprint: FrameworkFingerprint): ProviderSupport {
    for (const hint of BUILD_FILE_HINTS) {
      if (fs.existsSync(path.join(fingerprint.projectRoot, hint))) {
        return {
          supported: true,
          confidence: 0.95,
          reasons: [`${hint} detected`],
        };
      }
    }

    let files = fingerprint.sourceFiles?.filter((f) => f.endsWith('.java')) ?? [];
    if (files.length === 0) {
      files = collectJavaFiles(fingerprint.projectRoot);
    }
    let scanned = 0;
    for (const filePath of files) {
      if (!filePath.endsWith('.java')) continue;
      if (scanned >= 40) break;
      scanned += 1;
      try {
        const text = fs.readFileSync(filePath, 'utf-8');
        if (CONTROLLER_HINT_RE.test(text)) {
          return {
            supported: true,
            confidence: 0.8,
            reasons: ['Spring controller annotation found'],
          };
        }
      } catch {
        continue;
      }
    }

    return { supported: false, confidence: 0, reasons: ['no Spring indicators found'] };
  }

  public async discover(context: DiscoveryContext, fingerprint: FrameworkFingerprint): Promise<DiscoveryResult> {
    const startedAt = Date.now();
    const warnings: DiscoveryWarning[] = [];
    const projectRoot = fingerprint.projectRoot;

    const parserModule = await this.loadParser();
    const parser = new parserModule.EndpointParser();
    let controllers: Controller[] = [];
    try {
      controllers = await parser.parseControllers(projectRoot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push({
        code: 'provider-failed',
        framework: 'spring',
        message: `Spring discovery failed for ${projectRoot}: ${message}`,
      });
    }

    const schemaGen = new SchemaGenerator(projectRoot);
    const endpoints: DiscoveredApi[] = [];
    for (const controller of controllers) {
      for (const endpoint of controller.endpoints) {
        endpoints.push(await this.endpointToDiscoveredApi(endpoint, schemaGen));
      }
    }

    return {
      endpoints,
      warnings,
      stats: {
        frameworksDetected: ['spring'],
        providersRun: [this.id],
        endpointCount: endpoints.length,
        unresolvedEndpointCount: endpoints.filter((ep) => !ep.resolvedPath).length,
        scanDurationMs: Date.now() - startedAt,
      },
    };
  }

  public clearCache(): void {
    this.parserModule = undefined;
  }

  private async loadParser(): Promise<EndpointParserModule> {
    if (!this.parserModule) {
      this.parserModule = await import('./endpoint-parser');
    }
    return this.parserModule;
  }

  private async endpointToDiscoveredApi(
    ep: Endpoint,
    schemaGen: SchemaGenerator,
  ): Promise<DiscoveredApi> {
    const params = await this.buildParams(ep, schemaGen);
    const requestBody = await this.buildRequestBody(ep, schemaGen);
    const responses = await this.buildResponses(ep, schemaGen);

    const auth = ep.security && ep.security.length > 0
      ? { required: true, type: 'oauth2' as const, annotation: ep.security.join(', ') }
      : undefined;

    const sourceLine = ep.line > 0 ? ep.line : 1;

    return {
      id: '',
      framework: 'spring',
      method: ep.method || 'GET',
      pathExpression: ep.path || '/',
      resolvedPath: ep.path || '/',
      confidence: 'high',
      source: {
        filePath: ep.file,
        line: sourceLine,
        symbolName: `${ep.method || 'GET'} ${ep.path || '/'}`,
      },
      params: params.length > 0 ? params : undefined,
      requestBody,
      responses,
      validation: buildValidationSummary(ep),
      auth,
      tags: ep.tags,
      deprecated: ep.deprecated,
      description: ep.summary || ep.description,
    };
  }

  private async buildParams(ep: Endpoint, schemaGen: SchemaGenerator): Promise<DiscoveredApiParameter[]> {
    const params: DiscoveredApiParameter[] = [];
    const consumes = (ep.consumes ?? []).join(' ');
    const isForm = consumes.includes('x-www-form-urlencoded');
    const isMultipart = consumes.includes('multipart');

    for (const headerName of ep.headers ?? []) {
      params.push(this.paramFromMeta(headerName, 'header', ep.parameterMeta, true));
    }

    for (const queryName of ep.queryParams ?? []) {
      // Under form-encoding consumes, @RequestParam binds to form fields, not
      // the query string. Multipart keeps non-file parts as form fields too.
      const location: 'query' | 'form' = isForm || isMultipart ? 'form' : 'query';
      const meta = ep.parameterMeta?.find((p) => p.name === queryName && p.in === 'query');
      params.push(this.paramFromMeta(queryName, location, ep.parameterMeta, meta?.required));
    }

    for (const part of ep.formParts ?? []) {
      params.push({
        name: part.name,
        location: 'form',
        type: part.isFile ? 'file' : 'string',
        required: true,
      });
    }

    return params;
  }

  private paramFromMeta(
    name: string,
    location: 'path' | 'query' | 'header' | 'form',
    parameterMeta: ParameterMeta[] | undefined,
    required: boolean | undefined,
  ): DiscoveredApiParameter {
    const meta = parameterMeta?.find(
      (p) => p.name === name && ((p.in as string) === location || (location === 'form' && p.in === 'query')),
    );
    const param: DiscoveredApiParameter = { name, location };
    if (meta) {
      param.description = meta.description;
      param.required = meta.required ?? required;
      param.example = meta.example;
      if (meta.schemaType) {
        param.type = SchemaGenerator.javaTypeToParamType(meta.schemaType);
      }
      param.schema = this.constraintsToSchema(meta);
    }

    param.required = location === 'path' ? true : param.required;
    param.type = param.type ?? 'string';
    return param;
  }

  private constraintsToSchema(meta: ParameterMeta): JsonSchema | undefined {
    const schema: JsonSchema = {};

    if (meta.schemaType) {
      schema.type = SchemaGenerator.javaTypeToParamType(meta.schemaType);
      const format = SchemaGenerator.javaTypeToFormat(meta.schemaType);
      if (format) schema.format = format;
    }
    if (meta.pattern) schema.pattern = meta.pattern;
    if (meta.format) schema.format = meta.format;
    if (meta.enum && meta.enum.length > 0) schema.enum = meta.enum;
    if (meta.minimum !== undefined) schema.minimum = meta.minimum;
    if (meta.maximum !== undefined) schema.maximum = meta.maximum;
    if (meta.exclusiveMinimum !== undefined) schema.exclusiveMinimum = meta.exclusiveMinimum;
    if (meta.exclusiveMaximum !== undefined) schema.exclusiveMaximum = meta.exclusiveMaximum;
    if (meta.minLength !== undefined) schema.minLength = meta.minLength;
    if (meta.maxLength !== undefined) schema.maxLength = meta.maxLength;

    return Object.keys(schema).length > 0 ? schema : undefined;
  }

  private async buildRequestBody(ep: Endpoint, schemaGen: SchemaGenerator): Promise<DiscoveredApiBody | undefined> {
    const consumes = ep.consumes ?? [];

    if (ep.formParts && ep.formParts.length > 0) {
      return {
        type: 'multipart',
        required: ep.method === 'POST' || ep.method === 'PUT' || ep.method === 'PATCH',
      };
    }

    if (ep.modelAttributeType) {
      const schema = await this.maybeSchema(schemaGen, ep.modelAttributeType);
      return {
        type: 'form',
        required: true,
        schema,
      };
    }

    // Form-urlencoded: @RequestParam fields bind to the body, not the query
    // string, so emit a form body even though hasBody is false.
    if (consumes.some((c) => c.includes('x-www-form-urlencoded')) && (ep.queryParams?.length ?? 0) > 0) {
      return {
        type: 'form',
        required: ep.method === 'POST' || ep.method === 'PUT' || ep.method === 'PATCH',
      };
    }

    if (!ep.hasBody) {
      return undefined;
    }

    const typeName = ep.bodyType ?? ep.modelAttributeType;
    if (!typeName) {
      return { type: 'json', required: true };
    }

    const bodyType = consumes.some((c) => c.includes('x-www-form-urlencoded'))
      ? 'form'
      : consumes.some((c) => c.includes('multipart'))
        ? 'multipart'
        : 'json';

    const schema = await this.maybeSchema(schemaGen, typeName);
    return {
      type: bodyType,
      required: true,
      schema,
    };
  }

  private async buildResponses(ep: Endpoint, schemaGen: SchemaGenerator): Promise<DiscoveredApiResponse[]> {
    const responses: DiscoveredApiResponse[] = [];

    for (const resp of ep.responses ?? []) {
      const response: DiscoveredApiResponse = {
        statusCode: parseInt(resp.statusCode, 10) || 200,
      };
      const schema = resp.schemaType
        ? await this.maybeSchema(schemaGen, resp.schemaType)
        : undefined;
      response.body = { type: resp.contentType ?? 'json' };
      if (schema) response.body.schema = schema;
      responses.push(response);
    }

    if (responses.length === 0) {
      const returnType = ep.returnType;
      if (returnType && returnType !== 'void') {
        const schema = await schemaGen.generateResponseSchema(returnType);
        responses.push({
          statusCode: 200,
          body: { type: 'json', schema: schema ?? { type: 'object' } },
        });
      } else {
        responses.push({ statusCode: 200 });
      }
    }

    return responses;
  }

  private async maybeSchema(schemaGen: SchemaGenerator, typeName: string): Promise<JsonSchema | undefined> {
    const schema = await schemaGen.generate(typeName);
    return schema ?? { type: 'object' };
  }
}

/**
 * Summarize the endpoint's parameter validation constraints (from @Pattern,
 * @Size, @Min/@Max, @Schema(pattern/minimum/...), etc.) as human-readable
 * strings — the `DiscoveredApi.validation` "best-effort" field.
 */
function buildValidationSummary(ep: Endpoint): string[] | undefined {
  const rules: string[] = [];

  for (const meta of ep.parameterMeta ?? []) {
    const constraints: string[] = [];
    if (meta.required) constraints.push('required');
    if (meta.pattern) constraints.push(`pattern=${meta.pattern}`);
    if (meta.format) constraints.push(`format=${meta.format}`);
    if (meta.enum && meta.enum.length > 0) constraints.push(`enum=[${meta.enum.join(', ')}]`);
    if (meta.minimum !== undefined) constraints.push(`min=${meta.minimum}`);
    if (meta.maximum !== undefined) constraints.push(`max=${meta.maximum}`);
    if (meta.exclusiveMinimum !== undefined) constraints.push(`exclusiveMin=${meta.exclusiveMinimum}`);
    if (meta.exclusiveMaximum !== undefined) constraints.push(`exclusiveMax=${meta.exclusiveMaximum}`);
    if (meta.minLength !== undefined) constraints.push(`minLength=${meta.minLength}`);
    if (meta.maxLength !== undefined) constraints.push(`maxLength=${meta.maxLength}`);

    if (constraints.length > 0) {
      rules.push(`${meta.in === 'header' ? 'header' : meta.in} ${meta.name}: ${constraints.join(', ')}`);
    }
  }

  return rules.length > 0 ? rules : undefined;
}
