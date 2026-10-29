/**
 * Execution tool handlers — delegate run_request / run_folder / run_collection
 * / run_suite to the caller-supplied callbacks, then apply MCP-layer truncation.
 */

import { GENERIC_TOOL_NAMES } from '../mcp-tool-schemas';
import {
  applyMcpBodyTruncation,
  badRequest,
  enumerateFolders,
  flattenRequests,
  normalizeFolderInput,
  resolveCollectionByLabel,
  resolveSuiteByLabel,
} from './helpers';
import type { McpToolHandler } from './types';

export const executionHandlers: McpToolHandler[] = [
  {
    toolNames: [GENERIC_TOOL_NAMES.runRequest],
    handle({ args, services, collections, callbacks }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const flat = flattenRequests(col);
      const requestIdArg =
        typeof args.requestId === 'string' ? args.requestId.trim() : undefined;
      const requestArg = args.request;
      let match: (typeof flat)[0] | undefined;
      if (requestIdArg) {
        match = flat.find((r) => r.request.id === requestIdArg);
        if (!match) {
          throw badRequest(
            `request with id "${requestIdArg}" not found in collection "${col.name}"`
          );
        }
      } else {
        if (typeof requestArg !== 'string' || !requestArg.trim()) {
          throw badRequest('the "request" or "requestId" argument is required');
        }
        match =
          flat.find((r) => r.request.name === requestArg) ??
          flat.find(
            (r) =>
              r.request.name.toLowerCase() ===
              (requestArg as string).toLowerCase()
          );
        if (!match) {
          throw badRequest(
            `request "${requestArg}" not found in collection "${col.name}"`
          );
        }
      }
      const include = Array.isArray(args.include) ? (args.include as string[]) : [];
      return callbacks.runRequest(col, match.request.id, args)
        .then((r) => applyMcpBodyTruncation(r, include));
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.runFolder],
    handle({ args, collections, callbacks }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      if (typeof args.folder !== 'string' || !args.folder.trim()) {
        throw badRequest('the "folder" argument is required');
      }
      const fq = args.folder.toLowerCase();
      const normalizedInput = normalizeFolderInput(args.folder);
      const normalizedFq = normalizedInput.toLowerCase();
      const folderPaths = enumerateFolders(col).map((f) => f.folderPath);
      const folderPath =
        folderPaths.find((p) => p === normalizedInput) ??
        folderPaths.find((p) => p.toLowerCase() === normalizedFq) ??
        folderPaths.find((p) => p.toLowerCase().includes(normalizedFq)) ??
        folderPaths.find((p) =>
          p.split('/').some((seg) => seg.toLowerCase().includes(normalizedFq))
        );
      if (!folderPath) {
        const hint = folderPaths.map((p) => `"${p}"`).join(', ');
        throw badRequest(
          `folder "${args.folder}" not found in collection "${col.name}". ` +
          `Available folders: ${hint || '(none)'}. Call list_folders to see all.`
        );
      }
      const folderInclude = Array.isArray(args.include) ? (args.include as string[]) : [];
      return callbacks.runFolder(col, folderPath, args)
        .then((r) => applyMcpBodyTruncation(r, folderInclude));
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.runCollection],
    handle({ args, collections, callbacks }) {
      const col = resolveCollectionByLabel(args.collection, collections);
      const colInclude = Array.isArray(args.include) ? (args.include as string[]) : [];
      return callbacks.runCollection(col, args)
        .then((r) => applyMcpBodyTruncation(r, colInclude));
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.runSuite],
    handle({ args, services, callbacks }) {
      const suiteArg = args.suite;
      if (typeof suiteArg !== 'string' || !suiteArg.trim()) {
        throw badRequest('the "suite" argument is required');
      }
      return resolveSuiteByLabel(suiteArg, services).then((suite) => {
        const suiteInclude = Array.isArray(args.include) ? (args.include as string[]) : [];
        return callbacks.runSuite(suite.id, suite.name, args)
          .then((r) => applyMcpBodyTruncation(r, suiteInclude));
      });
    },
  },
];
