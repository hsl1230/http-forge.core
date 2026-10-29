/**
 * API Discovery — FastAPI Provider
 *
 * NEW provider (no legacy engine to port). Parses FastAPI apps/routers with
 * the pure-JS line parser in `fastapi-parser.ts` (no runtime deps — python3 is
 * never spawned, matching the core "node-only" constraint).
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
    EndpointConfidence,
    FrameworkFingerprint,
} from '../types';
import {
    buildJsonSchema,
    collectPythonFiles,
    FastApiEndpoint,
    FastApiModel,
    FastApiParam,
    parseFastApiProject,
} from './fastapi-parser';

const FINGERPRINT_FILES = ['requirements.txt', 'pyproject.toml', 'poetry.lock', 'Pipfile', 'setup.py'];
const FASTAPI_IMPORT_RE = /^\s*from\s+fastapi\s+import|^\s*import\s+fastapi/m;
const DECORATOR_HINT_RE = /@[\w.]+\.(get|post|put|patch|delete|options|head|api_route)\(/;

export class FastApiDiscoveryProvider implements ApiDiscoveryProvider {
  public readonly id = 'provider.fastapi';
  public readonly framework: 'fastapi' = 'fastapi';

  public supports(fingerprint: FrameworkFingerprint): ProviderSupport {
    for (const file of FINGERPRINT_FILES) {
      if (fs.existsSync(path.join(fingerprint.projectRoot, file))) {
        return { supported: true, confidence: 0.9, reasons: [`${file} detected`] };
      }
    }

    let files = fingerprint.sourceFiles?.filter((f) => f.endsWith('.py')) ?? [];
    if (files.length === 0) {
      files = collectPythonFiles(fingerprint.projectRoot);
    }
    let scanned = 0;
    for (const filePath of files) {
      if (!filePath.endsWith('.py')) continue;
      if (scanned >= 60) break;
      scanned += 1;
      try {
        const text = fs.readFileSync(filePath, 'utf-8');
        if (FASTAPI_IMPORT_RE.test(text) && DECORATOR_HINT_RE.test(text)) {
          return { supported: true, confidence: 0.9, reasons: ['fastapi app decorator found'] };
        }
      } catch {
        continue;
      }
    }

    return { supported: false, confidence: 0, reasons: ['no FastAPI indicators found'] };
  }

  public async discover(context: DiscoveryContext, fingerprint: FrameworkFingerprint): Promise<DiscoveryResult> {
    const startedAt = Date.now();
    const warnings: DiscoveryWarning[] = [];
    const projectRoot = fingerprint.projectRoot;

    let parsed;
    try {
      parsed = parseFastApiProject(projectRoot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push({
        code: 'provider-failed',
        framework: 'fastapi',
        message: `FastAPI discovery failed for ${projectRoot}: ${message}`,
      });
      return {
        endpoints: [],
        warnings,
        stats: {
          frameworksDetected: ['fastapi'],
          providersRun: [this.id],
          endpointCount: 0,
          unresolvedEndpointCount: 0,
          scanDurationMs: Date.now() - startedAt,
        },
      };
    }

    for (const warning of parsed.warnings) {
      warnings.push({ code: 'dynamic-path-unresolved', framework: 'fastapi', message: warning });
    }

    const endpoints: DiscoveredApi[] = parsed.endpoints.map((ep) =>
      this.endpointToDiscoveredApi(ep, parsed.models),
    );

    return {
      endpoints,
      warnings,
      stats: {
        frameworksDetected: ['fastapi'],
        providersRun: [this.id],
        endpointCount: endpoints.length,
        unresolvedEndpointCount: endpoints.filter((ep) => !ep.resolvedPath).length,
        scanDurationMs: Date.now() - startedAt,
      },
    };
  }

  private endpointToDiscoveredApi(ep: FastApiEndpoint, models: Map<string, FastApiModel>): DiscoveredApi {
    const method = ep.methods[0];
    const confidence: EndpointConfidence = ep.pathUnresolved ? 'low' : 'high';

    const params = ep.params.map((p) => this.paramToDiscovered(p, models));
    const requestBody = this.buildRequestBody(ep, models);
    const responses = this.buildResponses(ep, models);

    const auth = ep.security.length > 0
      ? { required: true, type: 'jwt' as const, annotation: ep.security.join(', ') }
      : undefined;

    return {
      id: '',
      framework: 'fastapi',
      method,
      pathExpression: ep.path,
      resolvedPath: ep.path,
      confidence,
      source: {
        filePath: ep.file,
        line: ep.line,
        symbolName: `${method} ${ep.path}`,
      },
      params: params.length > 0 ? params : undefined,
      requestBody,
      responses,
      auth,
      tags: ep.tags,
      deprecated: ep.deprecated,
      description: ep.summary,
    };
  }

  private paramToDiscovered(p: FastApiParam, models: Map<string, FastApiModel>): DiscoveredApiParameter {
    const type = mapPythonType(p.type);
    const schema = buildJsonSchema(p.type, models) ?? (type ? { type } : undefined);
    const param: DiscoveredApiParameter = {
      name: p.name,
      location: p.location,
      required: p.location === 'path' ? true : p.required,
    };
    if (type) param.type = type;
    if (schema) param.schema = schema;
    return param;
  }

  private buildRequestBody(ep: FastApiEndpoint, models: Map<string, FastApiModel>): DiscoveredApiBody | undefined {
    const bodyParams = ep.params.filter((p) => p.location === 'body');
    if (bodyParams.length === 0) {
      const formParams = ep.params.filter((p) => p.location === 'form');
      if (formParams.length > 0) {
        return {
          type: 'multipart',
          required: formParams.some((p) => p.required),
        };
      }
      return undefined;
    }

    const schema = buildJsonSchema(bodyParams[0].type, models);
    return {
      type: 'json',
      required: bodyParams.some((p) => p.required),
      schema: schema ?? { type: 'object' },
    };
  }

  private buildResponses(ep: FastApiEndpoint, models: Map<string, FastApiModel>): DiscoveredApiResponse[] {
    const statusCode = ep.statusCode ?? 200;
    const response: DiscoveredApiResponse = { statusCode };

    if (ep.responseModel) {
      const isList = /^(?:List|list|Sequence)\[/.test(ep.responseModel);
      const inner = isList
        ? /^(?:List|list|Sequence)\[(.+)\]$/.exec(ep.responseModel)![1]
        : ep.responseModel;
      const schema = buildJsonSchema(inner, models);
      if (schema) {
        response.body = {
          type: 'json',
          schema: isList ? { type: 'array', items: schema } : schema,
        };
      }
    }

    return [response];
  }
}

function mapPythonType(type: string): string | undefined {
  const scalar: Record<string, string> = {
    int: 'integer',
    float: 'number',
    Decimal: 'number',
    bool: 'boolean',
    str: 'string',
    datetime: 'string',
    date: 'string',
    time: 'string',
    UUID: 'string',
    bytes: 'string',
    UploadFile: 'string',
  };
  return scalar[type];
}
