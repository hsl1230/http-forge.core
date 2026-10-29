/**
 * Test-suite management tool handlers, including the flow-graph path helpers
 * (parse/walk/resolve suite node graphs).
 */

import { GENERIC_TOOL_NAMES } from '../mcp-tool-schemas';
import { normalizeFolderInput } from './helpers';
import {
  badRequest,
  flattenRequests,
  resolveCollectionByLabel,
  resolveRequestByLabel,
  resolveSuiteByLabel,
} from './helpers';
import type { McpToolHandler } from './types';

// ── Suite flow-graph helpers ─────────────────────────────────────────────────

/** True when the suite is a flat list of request nodes (no flow branches). */
function isRequestOnlyRootSuite(suite: import('../../infrastructure/test-suite/interfaces').TestSuite): boolean {
  const nodes = Array.isArray(suite.nodes) ? suite.nodes : [];
  return nodes.every((n: any) => (n as any)?.type === 'request');
}

/** Collect all request nodes in a suite node graph, with their node paths. */
function collectRequestNodes(
  nodes: any[],
  pathPrefix = ''
): Array<{ node: any; path: string }> {
  const out: Array<{ node: any; path: string }> = [];
  if (!Array.isArray(nodes)) {
    return out;
  }
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const nodePath = pathPrefix ? `${pathPrefix}.${i}` : `${i}`;
    if (!node || typeof node !== 'object') {
      continue;
    }

    if ((node as any).type === 'request') {
      out.push({ node, path: nodePath });
    }

    if (Array.isArray((node as any).nodes)) {
      out.push(...collectRequestNodes((node as any).nodes, `${nodePath}.nodes`));
    }
    if (Array.isArray((node as any).then)) {
      out.push(...collectRequestNodes((node as any).then, `${nodePath}.then`));
    }
    if (Array.isArray((node as any).else)) {
      out.push(...collectRequestNodes((node as any).else, `${nodePath}.else`));
    }
    if (Array.isArray((node as any).default)) {
      out.push(...collectRequestNodes((node as any).default, `${nodePath}.default`));
    }
    if (Array.isArray((node as any).elseif)) {
      (node as any).elseif.forEach((branch: any, branchIndex: number) => {
        if (Array.isArray(branch?.nodes)) {
          out.push(...collectRequestNodes(branch.nodes, `${nodePath}.elseif.${branchIndex}.nodes`));
        }
        if (Array.isArray(branch?.then)) {
          out.push(...collectRequestNodes(branch.then, `${nodePath}.elseif.${branchIndex}.then`));
        }
      });
    }
    if (Array.isArray((node as any).cases)) {
      (node as any).cases.forEach((caseNode: any, caseIndex: number) => {
        if (Array.isArray(caseNode?.nodes)) {
          out.push(...collectRequestNodes(caseNode.nodes, `${nodePath}.cases.${caseIndex}.nodes`));
        }
        if (Array.isArray(caseNode?.then)) {
          out.push(...collectRequestNodes(caseNode.then, `${nodePath}.cases.${caseIndex}.then`));
        }
      });
    }
  }
  return out;
}

/** Parse a "1.nodes.0.then" style path into tokens. */
function parsePathTokens(pathValue: unknown, label: string): Array<string | number> {
  if (typeof pathValue !== 'string' || !pathValue.trim()) {
    throw badRequest(`"${label}" is required`);
  }
  const raw = pathValue.trim();
  const parts = raw.split('.');
  if (parts.some((p) => p === '')) {
    throw badRequest(`"${label}" is invalid: "${raw}"`);
  }
  return parts.map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

/** Resolve the node at a path, throwing when the path does not exist. */
function resolveNodeAtPath(rootNodes: any[], pathValue: unknown): any {
  const tokens = parsePathTokens(pathValue, 'path');
  let current: any = rootNodes;
  for (const token of tokens) {
    if (typeof token === 'number') {
      if (!Array.isArray(current) || token < 0 || token >= current.length) {
        throw badRequest(`node path not found: "${String(pathValue)}"`);
      }
      current = current[token];
    } else {
      if (!current || typeof current !== 'object' || !(token in current)) {
        throw badRequest(`node path not found: "${String(pathValue)}"`);
      }
      current = current[token];
    }
  }
  return current;
}

/** Resolve the containing array+index for a numeric-index terminal path. */
function resolveNodeContainerAtPath(
  rootNodes: any[],
  pathValue: unknown
): { array: any[]; index: number } {
  const tokens = parsePathTokens(pathValue, 'path');
  const last = tokens[tokens.length - 1];
  if (typeof last !== 'number') {
    throw badRequest(`"path" must end with a numeric index: "${String(pathValue)}"`);
  }

  let current: any = rootNodes;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i];
    if (typeof token === 'number') {
      if (!Array.isArray(current) || token < 0 || token >= current.length) {
        throw badRequest(`node path not found: "${String(pathValue)}"`);
      }
      current = current[token];
    } else {
      if (!current || typeof current !== 'object' || !(token in current)) {
        throw badRequest(`node path not found: "${String(pathValue)}"`);
      }
      current = current[token];
    }
  }

  if (!Array.isArray(current) || last < 0 || last >= current.length) {
    throw badRequest(`node path not found: "${String(pathValue)}"`);
  }
  return { array: current, index: last };
}

/** Resolve the target array for add/move operations (root or parent+branch). */
function resolveTargetArray(
  rootNodes: any[],
  parentPathValue: unknown,
  branchValue: unknown,
  branchLabel: string
): { array: any[]; pathPrefix: string } {
  if (parentPathValue === undefined || parentPathValue === null || parentPathValue === '') {
    if (branchValue !== undefined && branchValue !== null && branchValue !== '') {
      throw badRequest(`"${branchLabel}" is only valid when a parent path is provided`);
    }
    return { array: rootNodes, pathPrefix: '' };
  }

  if (typeof branchValue !== 'string' || !branchValue.trim()) {
    throw badRequest(`"${branchLabel}" is required when parent path is provided`);
  }

  const parentPath = String(parentPathValue).trim();
  const branch = branchValue.trim();
  const parentNode = resolveNodeAtPath(rootNodes, parentPath);
  const branchTokens = parsePathTokens(branch, branchLabel);

  let current: any = parentNode;
  for (let i = 0; i < branchTokens.length; i += 1) {
    const token = branchTokens[i];
    const isLast = i === branchTokens.length - 1;

    if (typeof token === 'number') {
      if (!Array.isArray(current) || token < 0 || token >= current.length) {
        throw badRequest(`branch path not found: "${branch}"`);
      }
      current = current[token];
    } else {
      if (!current || typeof current !== 'object') {
        throw badRequest(`branch path not found: "${branch}"`);
      }
      if (!(token in current)) {
        if (isLast) {
          (current as any)[token] = [];
        } else {
          throw badRequest(`branch path not found: "${branch}"`);
        }
      }
      current = (current as any)[token];
    }
  }

  if (!Array.isArray(current)) {
    throw badRequest(`target branch must be an array: "${branch}"`);
  }

  return { array: current, pathPrefix: `${parentPath}.${branch}` };
}

/** Enumerate every node path (and branch path) in a suite graph. */
function listNodePaths(
  nodes: any[],
  pathPrefix = ''
): { nodePaths: Array<{ path: string; type?: string; name?: string }>; branchPaths: string[] } {
  const nodePaths: Array<{ path: string; type?: string; name?: string }> = [];
  const branchPaths: string[] = [];

  const walk = (arr: any[], prefix: string): void => {
    if (!Array.isArray(arr)) return;
    if (prefix) {
      branchPaths.push(prefix);
    }

    for (let i = 0; i < arr.length; i += 1) {
      const node = arr[i];
      const nodePath = prefix ? `${prefix}.${i}` : `${i}`;
      nodePaths.push({ path: nodePath, type: (node as any)?.type, name: (node as any)?.name });

      if (!node || typeof node !== 'object') continue;
      if (Array.isArray((node as any).nodes)) walk((node as any).nodes, `${nodePath}.nodes`);
      if (Array.isArray((node as any).then)) walk((node as any).then, `${nodePath}.then`);
      if (Array.isArray((node as any).else)) walk((node as any).else, `${nodePath}.else`);
      if (Array.isArray((node as any).default)) walk((node as any).default, `${nodePath}.default`);

      if (Array.isArray((node as any).cases)) {
        (node as any).cases.forEach((caseNode: any, caseIndex: number) => {
          if (Array.isArray(caseNode?.nodes)) walk(caseNode.nodes, `${nodePath}.cases.${caseIndex}.nodes`);
          if (Array.isArray(caseNode?.then)) walk(caseNode.then, `${nodePath}.cases.${caseIndex}.then`);
        });
      }

      if (Array.isArray((node as any).elseif)) {
        (node as any).elseif.forEach((branch: any, branchIndex: number) => {
          if (Array.isArray(branch?.nodes)) walk(branch.nodes, `${nodePath}.elseif.${branchIndex}.nodes`);
          if (Array.isArray(branch?.then)) walk(branch.then, `${nodePath}.elseif.${branchIndex}.then`);
        });
      }
    }
  };

  walk(nodes, pathPrefix);
  return { nodePaths, branchPaths };
}

// ── Suite tool handlers ──────────────────────────────────────────────────────

export const suiteHandlers: McpToolHandler[] = [
  {
    toolNames: [GENERIC_TOOL_NAMES.listSuites],
    async handle({ services }) {
      const suites = await services.testSuite.getAllSuites();
      return {
        suites: suites.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description ?? '',
          requestCount: collectRequestNodes(s.nodes || []).length,
          flowNodeCount: s.nodes?.length ?? 0,
          iterations: s.config?.iterations ?? 1,
        })),
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.getSuite],
    async handle({ args, services }) {
      const suite = await resolveSuiteByLabel(args.suite, services);
      const requestRefs = collectRequestNodes(suite.nodes || []);
      return {
        id: suite.id,
        name: suite.name,
        description: suite.description ?? '',
        config: {
          iterations: suite.config?.iterations ?? 1,
          delayBetweenRequests: suite.config?.delayBetweenRequests ?? 0,
          stopOnError: suite.config?.stopOnError ?? false,
        },
        nodes: suite.nodes || [],
        requests: requestRefs.map(({ node, path }) => {
          const r = (node as any).request as import('../../infrastructure/test-suite/interfaces').SuiteRequest;
          return {
            nodePath: path,
            slug: r.slug ?? r.requestId,
            collectionId: r.collectionId,
            requestId: r.requestId,
            name: r.name,
            method: r.method,
            folderPath: r.folderPath ?? '',
            enabled: (node as any).enabled !== false,
          };
        }),
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.createSuite],
    async handle({ args, services, collections }) {
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      if (!name) throw badRequest('"name" is required');
      let suite: import('../../infrastructure/test-suite/interfaces').TestSuite;
      if (typeof args.fromCollection === 'string' && args.fromCollection.trim()) {
        const col = resolveCollectionByLabel(args.fromCollection, collections);
        const temp = await services.testSuite.createTempSuiteFromCollection(col.id);
        if (!temp) throw new Error(`Could not build suite from collection "${col.name}"`);
        if (typeof args.fromFolder === 'string' && args.fromFolder.trim()) {
          const normalizedFolder = normalizeFolderInput(args.fromFolder);
          const allNodes = temp.nodes || [];
          temp.nodes = allNodes.filter((n: any) => {
            if (n.type !== 'request') return true;
            const fp = n.request?.folderPath || '';
            return fp === normalizedFolder || fp.startsWith(`${normalizedFolder}/`);
          });
        }
        suite = await services.testSuite.saveTempSuite(temp, name);
      } else {
        suite = await services.testSuite.createSuite(name);
      }
      // Apply config/flow overrides
      if (args.iterations !== undefined || args.stopOnError !== undefined || args.delayBetweenRequests !== undefined || args.description !== undefined || args.nodes !== undefined) {
        if (args.description !== undefined) suite.description = String(args.description);
        if (args.nodes !== undefined) {
          if (!Array.isArray(args.nodes)) {
            throw badRequest('"nodes" must be an array when provided');
          }
          suite.nodes = args.nodes as any[];
        }
        suite.config = {
          ...suite.config,
          ...(typeof args.iterations === 'number' ? { iterations: args.iterations } : {}),
          ...(typeof args.stopOnError === 'boolean' ? { stopOnError: args.stopOnError } : {}),
          ...(typeof args.delayBetweenRequests === 'number' ? { delayBetweenRequests: args.delayBetweenRequests } : {}),
        };
        await services.testSuite.updateSuite(suite);
      }
      return {
        id: suite.id,
        name: suite.name,
        requestCount: suite.nodes?.filter(n => (n as any).type === 'request').length ?? 0,
        created: true,
        hint: (suite.nodes?.filter(n => (n as any).type === 'request').length ?? 0) === 0
          ? 'Suite is empty. Call add_suite_requests to populate it with requests from a collection.'
          : 'Suite created. Call run_suite to execute it.',
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.updateSuiteConfig],
    async handle({ args, services }) {
      const suite = await resolveSuiteByLabel(args.suite, services);
      if (typeof args.name === 'string' && args.name.trim()) suite.name = args.name.trim();
      if (typeof args.description === 'string') suite.description = args.description;
      if (args.nodes !== undefined) {
        if (!Array.isArray(args.nodes)) {
          throw badRequest('"nodes" must be an array when provided');
        }
        suite.nodes = args.nodes as any[];
      }
      suite.config = {
        ...suite.config,
        ...(typeof args.iterations === 'number' ? { iterations: args.iterations } : {}),
        ...(typeof args.stopOnError === 'boolean' ? { stopOnError: args.stopOnError } : {}),
        ...(typeof args.delayBetweenRequests === 'number' ? { delayBetweenRequests: args.delayBetweenRequests } : {}),
      };
      await services.testSuite.updateSuite(suite);
      return { updated: true, suite: suite.name };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.getSuiteNode],
    async handle({ args, services }) {
      const suite = await resolveSuiteByLabel(args.suite, services);
      if (!Array.isArray(suite.nodes)) suite.nodes = [];
      const node = resolveNodeAtPath(suite.nodes, args.path);
      return {
        suite: suite.name,
        path: String(args.path),
        node,
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.listSuiteNodePaths],
    async handle({ args, services }) {
      const suite = await resolveSuiteByLabel(args.suite, services);
      if (!Array.isArray(suite.nodes)) suite.nodes = [];
      const includeBranches = args.includeBranches !== false;
      const listed = listNodePaths(suite.nodes);
      return {
        suite: suite.name,
        nodeCount: listed.nodePaths.length,
        nodePaths: listed.nodePaths,
        branchPaths: includeBranches ? listed.branchPaths : undefined,
        rootBranchPath: '',
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.addSuiteNode],
    async handle({ args, services }) {
      const suite = await resolveSuiteByLabel(args.suite, services);
      if (!Array.isArray(suite.nodes)) suite.nodes = [];
      if (!args.node || typeof args.node !== 'object' || Array.isArray(args.node)) {
        throw badRequest('"node" must be an object');
      }

      const { array: targetArray, pathPrefix } = resolveTargetArray(suite.nodes, args.parentPath, args.branch, 'branch');
      const index = typeof args.index === 'number' ? Math.max(0, Math.min(args.index, targetArray.length)) : targetArray.length;
      targetArray.splice(index, 0, args.node as any);
      await services.testSuite.updateSuite(suite);

      const path = pathPrefix ? `${pathPrefix}.${index}` : `${index}`;
      return { added: true, suite: suite.name, path };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.updateSuiteNode],
    async handle({ args, services }) {
      const suite = await resolveSuiteByLabel(args.suite, services);
      if (!Array.isArray(suite.nodes)) suite.nodes = [];
      if (!args.node || typeof args.node !== 'object' || Array.isArray(args.node)) {
        throw badRequest('"node" must be an object');
      }

      const container = resolveNodeContainerAtPath(suite.nodes, args.path);
      container.array[container.index] = args.node as any;
      await services.testSuite.updateSuite(suite);
      return { updated: true, suite: suite.name, path: String(args.path) };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.removeSuiteNode],
    async handle({ args, services }) {
      const suite = await resolveSuiteByLabel(args.suite, services);
      if (!Array.isArray(suite.nodes)) suite.nodes = [];
      const container = resolveNodeContainerAtPath(suite.nodes, args.path);
      const [removedNode] = container.array.splice(container.index, 1);
      await services.testSuite.updateSuite(suite);
      return { removed: true, suite: suite.name, path: String(args.path), removedType: (removedNode as any)?.type };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.moveSuiteNode],
    async handle({ args, services }) {
      const suite = await resolveSuiteByLabel(args.suite, services);
      if (!Array.isArray(suite.nodes)) suite.nodes = [];

      const from = resolveNodeContainerAtPath(suite.nodes, args.fromPath);
      const movingNode = from.array[from.index];
      from.array.splice(from.index, 1);

      const { array: targetArray, pathPrefix } = resolveTargetArray(suite.nodes, args.toParentPath, args.toBranch, 'toBranch');
      let targetIndex = typeof args.toIndex === 'number' ? Math.max(0, Math.min(args.toIndex, targetArray.length)) : targetArray.length;
      if (from.array === targetArray && from.index < targetIndex) {
        targetIndex -= 1;
      }
      targetArray.splice(targetIndex, 0, movingNode);

      await services.testSuite.updateSuite(suite);
      const toPath = pathPrefix ? `${pathPrefix}.${targetIndex}` : `${targetIndex}`;
      return { moved: true, suite: suite.name, fromPath: String(args.fromPath), toPath };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.addSuiteRequests],
    async handle({ args, services, collections }) {
      const suite = await resolveSuiteByLabel(args.suite, services);
      const requestsToAdd = Array.isArray(args.requests) ? args.requests as Array<{ collection: string; request: string }> : [];
      if (requestsToAdd.length === 0) throw badRequest('"requests" array is required and must not be empty');
      const newEntries: import('../../infrastructure/test-suite/interfaces').SuiteRequest[] = [];
      for (const entry of requestsToAdd) {
        const col = resolveCollectionByLabel(entry.collection, collections);
        const req = resolveRequestByLabel(entry.request, col);
        const folderPath = flattenRequests(col).find((r) => r.request.id === req.id)?.folderPath ?? '';
        newEntries.push({
          slug: req.id,
          collectionId: col.id,
          requestId: req.id,
          name: req.name,
          method: req.method,
          collectionName: col.name,
          folderPath,
          enabled: true,
        });
      }
      if (!suite.nodes) suite.nodes = [];
      const newNodes = newEntries.map(r => ({
        type: 'request' as const,
        name: r.name,
        request: r,
        enabled: true
      }));

      // Compatibility wrapper over add_suite_node(type=request) semantics:
      // insertAt is interpreted as root nodes array index (not request-only index).
      const insertAt = typeof args.insertAt === 'number'
        ? Math.max(0, Math.min(args.insertAt, suite.nodes.length))
        : suite.nodes.length;
      suite.nodes.splice(insertAt, 0, ...newNodes);

      await services.testSuite.updateSuite(suite);
      return {
        added: newEntries.length,
        suite: suite.name,
        insertAt,
        addedPaths: newNodes.map((_, i) => `${insertAt + i}`),
        newRequestCount: collectRequestNodes(suite.nodes || []).length,
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.removeSuiteRequest],
    async handle({ args, services }) {
      const suite = await resolveSuiteByLabel(args.suite, services);
      if (!isRequestOnlyRootSuite(suite)) {
        throw badRequest('remove_suite_request currently supports request-only root suites. For flow suites, use get_suite/update_suite_config with the full "nodes" graph.');
      }
      if (!suite.nodes) suite.nodes = [];
      const requestNodes = suite.nodes.filter(n => (n as any).type === 'request');
      let removed: string;
      if (typeof args.index === 'number') {
        if (args.index < 0 || args.index >= requestNodes.length) throw badRequest(`index ${args.index} is out of range`);
        const nodeToRemove = requestNodes[args.index];
        removed = (nodeToRemove as any).name || (nodeToRemove as any).request?.name;
        suite.nodes = suite.nodes.filter(n => n !== nodeToRemove);
      } else if (typeof args.request === 'string') {
        const q = args.request.toLowerCase();
        const nodeToRemove = requestNodes.find(n => {
          const name = (n as any).request?.name || (n as any).name || '';
          return name === args.request || name.toLowerCase() === q;
        });
        if (!nodeToRemove) throw badRequest(`request "${args.request}" not found in suite "${suite.name}"`);
        removed = (nodeToRemove as any).name || (nodeToRemove as any).request?.name;
        suite.nodes = suite.nodes.filter(n => n !== nodeToRemove);
      } else {
        throw badRequest('either "index" or "request" is required');
      }
      await services.testSuite.updateSuite(suite);
      return { removed: true, request: removed, newRequestCount: suite.nodes.filter(n => (n as any).type === 'request').length };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.reorderSuiteRequests],
    async handle({ args, services }) {
      const suite = await resolveSuiteByLabel(args.suite, services);
      if (!isRequestOnlyRootSuite(suite)) {
        throw badRequest('reorder_suite_requests currently supports request-only root suites. For flow suites, use get_suite/update_suite_config with the full "nodes" graph.');
      }
      if (!Array.isArray(args.order)) throw badRequest('"order" must be an array of request names');
      const orderList = args.order as string[];
      const requestNodes = (suite.nodes || []).filter(n => (n as any).type === 'request');
      const nonRequestNodes = (suite.nodes || []).filter(n => (n as any).type !== 'request');
      const sorted = [...requestNodes].sort((a, b) => {
        const aName = (a as any).request?.name || (a as any).name || '';
        const bName = (b as any).request?.name || (b as any).name || '';
        const ai = orderList.findIndex((n) => n === aName || n.toLowerCase() === aName.toLowerCase());
        const bi = orderList.findIndex((n) => n === bName || n.toLowerCase() === bName.toLowerCase());
        const ar = ai === -1 ? Infinity : ai;
        const br = bi === -1 ? Infinity : bi;
        return ar - br;
      });
      suite.nodes = [...sorted, ...nonRequestNodes];
      await services.testSuite.updateSuite(suite);
      return { reordered: true, suite: suite.name, newOrder: sorted.map((n) => (n as any).request?.name || (n as any).name) };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.duplicateSuite],
    async handle({ args, services }) {
      const suite = await resolveSuiteByLabel(args.suite, services);
      const newName = typeof args.newName === 'string' ? args.newName.trim() : '';
      if (!newName) throw badRequest('"newName" is required');
      const dup = await services.testSuite.duplicateSuite(suite.id, newName);
      return { id: dup.id, name: dup.name, duplicatedFrom: suite.name, requestCount: (dup.nodes?.filter(n => (n as any).type === 'request').length ?? 0) };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.deleteSuite],
    async handle({ args, services }) {
      if (args.confirm !== true) throw badRequest('"confirm" must be true to delete a suite');
      const suite = await resolveSuiteByLabel(args.suite, services);
      await services.testSuite.deleteSuite(suite.id);
      return { deleted: true, suite: suite.name };
    },
  },
];
