/**
 * Environment read/write tool handlers (get_environment, set_variable).
 */

import { GENERIC_TOOL_NAMES } from '../mcp-tool-schemas';
import { badRequest } from './helpers';
import type { McpToolHandler } from './types';

export const environmentHandlers: McpToolHandler[] = [
  {
    toolNames: [GENERIC_TOOL_NAMES.getEnvironment],
    handle({ args, services }) {
      const envName =
        typeof args.environment === 'string' && args.environment.trim()
          ? args.environment.trim()
          : services.environmentConfig.getSelectedEnvironment();
      const resolved = services.environmentConfig.getResolvedEnvironment(envName);
      if (!resolved) throw badRequest(`environment "${envName}" not found`);
      return { name: resolved.name, variables: resolved.variables };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.setVariable],
    handle({ args, services }) {
      const key = typeof args.key === 'string' ? args.key.trim() : '';
      const value =
        typeof args.value === 'string' ? args.value : String(args.value ?? '');
      if (!key) throw badRequest('"key" is required');
      const envName =
        typeof args.environment === 'string' && args.environment.trim()
          ? args.environment.trim()
          : services.environmentConfig.getSelectedEnvironment();
      services.environmentConfig.setEnvironmentVariable(key, value, envName);
      return { set: true, key, environment: envName };
    },
  },
];
