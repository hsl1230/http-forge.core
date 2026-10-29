/**
 * Environment management tool handlers — list/create/delete environments and
 * set/unset variables and globals.
 */

import { GENERIC_TOOL_NAMES } from '../mcp-tool-schemas';
import { badRequest } from './helpers';
import type { McpToolHandler } from './types';

export const environmentManagementHandlers: McpToolHandler[] = [
  {
    toolNames: [GENERIC_TOOL_NAMES.listEnvironments],
    handle({ services }) {
      const envs = services.environmentConfig.getAllEnvironments();
      const active = services.environmentConfig.getSelectedEnvironment();
      return {
        environments: envs.map((e) => ({
          name: e.name,
          active: e.active,
          variableKeys: Object.keys(e.variables),
        })),
        active,
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.getEnvironmentVariables],
    handle({ args, services }) {
      const envName =
        typeof args.environment === 'string' && args.environment.trim()
          ? args.environment.trim()
          : services.environmentConfig.getSelectedEnvironment();
      const resolved = services.environmentConfig.getResolvedEnvironment(envName);
      if (!resolved) throw badRequest(`environment "${envName}" not found`);
      const shared = services.environmentConfig.getSharedConfig();
      const fileVariables = shared?.environments?.[envName]?.variables ?? {};
      const sessionOverrides = services.environmentConfig.getEnvironmentVariableLocals();
      return {
        environment: envName,
        active: services.environmentConfig.getSelectedEnvironment() === envName,
        fileVariables,
        sessionOverrides,
        resolved: resolved.variables,
      };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.selectEnvironment],
    async handle({ args, services }) {
      const envName = typeof args.environment === 'string' ? args.environment.trim() : '';
      if (!envName) throw badRequest('"environment" is required');
      await services.environmentConfig.setSelectedEnvironment(envName);
      return { selected: true, environment: envName };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.createEnvironment],
    async handle({ args, services }) {
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      if (!name) throw badRequest('"name" is required');
      await services.environmentConfig.createEnvironment(name);
      // Optionally set initial variables
      if (args.variables && typeof args.variables === 'object') {
        const vars = args.variables as Record<string, string>;
        const shared = services.environmentConfig.getSharedConfig();
        if (shared) {
          shared.environments = shared.environments ?? {};
          shared.environments[name] = { ...(shared.environments[name] ?? {}), variables: { ...(shared.environments[name]?.variables ?? {}), ...vars } };
          services.environmentConfig.saveSharedConfig(shared);
        }
      }
      return { created: true, environment: name };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.deleteEnvironment],
    async handle({ args, services }) {
      if (args.confirm !== true) throw badRequest('"confirm" must be true to delete an environment');
      const envName = typeof args.environment === 'string' ? args.environment.trim() : '';
      if (!envName) throw badRequest('"environment" is required');
      const active = services.environmentConfig.getSelectedEnvironment();
      await services.environmentConfig.deleteEnvironment(envName);
      return { deleted: true, environment: envName, newActive: active === envName ? undefined : active };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.setEnvironmentVariable],
    handle({ args, services }) {
      const key = typeof args.key === 'string' ? args.key.trim() : '';
      const value = typeof args.value === 'string' ? args.value : String(args.value ?? '');
      if (!key) throw badRequest('"key" is required');
      const envName =
        typeof args.environment === 'string' && args.environment.trim()
          ? args.environment.trim()
          : services.environmentConfig.getSelectedEnvironment();
      const scope = args.scope === 'permanent' ? 'permanent' : 'session';
      if (scope === 'permanent') {
        const shared = services.environmentConfig.getSharedConfig();
        if (shared) {
          shared.environments = shared.environments ?? {};
          shared.environments[envName] = shared.environments[envName] ?? { variables: {} };
          shared.environments[envName].variables = shared.environments[envName].variables ?? {};
          shared.environments[envName].variables[key] = value;
          services.environmentConfig.saveSharedConfig(shared);
        }
      } else {
        services.environmentConfig.setEnvironmentVariable(key, value, envName);
      }
      return { set: true, key, environment: envName, scope };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.unsetEnvironmentVariable],
    handle({ args, services }) {
      const key = typeof args.key === 'string' ? args.key.trim() : '';
      if (!key) throw badRequest('"key" is required');
      const envName =
        typeof args.environment === 'string' && args.environment.trim()
          ? args.environment.trim()
          : services.environmentConfig.getSelectedEnvironment();
      services.environmentConfig.deleteEnvironmentVariable(key, envName);
      return { unset: true, key, environment: envName };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.setGlobalVariable],
    handle({ args, services }) {
      const key = typeof args.key === 'string' ? args.key.trim() : '';
      const value = typeof args.value === 'string' ? args.value : String(args.value ?? '');
      if (!key) throw badRequest('"key" is required');
      const scope = args.scope === 'permanent' ? 'permanent' : 'session';
      if (scope === 'permanent') {
        const shared = services.environmentConfig.getSharedConfig();
        if (shared) {
          shared.globalVariables = shared.globalVariables ?? {};
          shared.globalVariables[key] = value;
          services.environmentConfig.saveSharedConfig(shared);
        }
      } else {
        services.environmentConfig.setGlobalVariable(key, value);
      }
      return { set: true, key, scope };
    },
  },

  {
    toolNames: [GENERIC_TOOL_NAMES.getGlobals],
    handle({ services }) {
      return { globals: services.environmentConfig.getGlobalVariables() };
    },
  },
];
