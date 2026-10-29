/**
 * Node.js Bootstrap
 * 
 * Initialize HTTP Forge core services for Node.js environments (CLI, third-party apps).
 * Provides a factory that creates initialized service containers with Node-specific adapters.
 */

import * as path from 'path';
import { registerCoreServices } from '../di/core-bootstrap';
import type { PlatformAdapters } from '../di/platform-adapters';
import { ServiceContainer } from '../di/service-container';
import { NodeFileWatcherFactory, NodeKeyValueStore, NodeNotificationService } from './node-adapters';

export interface NodeBootstrapOptions {
  /** Workspace root folder path */
  workspaceFolder: string;

  /** Optional application info (name, version) */
  appInfo?: { name: string; version: string };

  /**
   * Optional global store file path.
   * If relative, it is resolved against the workspace folder.
   */
  globalStorePath?: string;
}

/**
 * Bootstrap HTTP Forge core services for Node.js environment.
 * Creates and initializes a service container with Node-native platform adapters.
 * 
 * @param options Bootstrap configuration
 * @returns Initialized service container ready for use
 */
export function bootstrapNodeRuntime(options: NodeBootstrapOptions): ServiceContainer {
  const workspaceFolder = path.resolve(options.workspaceFolder);
  const { appInfo } = options;

  // Create a fresh isolated container — NOT the global singleton.
  // This ensures that MCP / CLI operations do not clear the host application's
  // service registrations (e.g. the VS Code extension's ConsoleService / output channel).
  const container = ServiceContainer.createFresh();

  // Create Node-specific platform adapters
  const defaultStorePath = path.join(workspaceFolder, '.http-forge', '.cache', 'stores', 'global-state.json');
  const globalStorePath = options.globalStorePath
    ? (path.isAbsolute(options.globalStorePath)
      ? options.globalStorePath
      : path.resolve(workspaceFolder, options.globalStorePath))
    : defaultStorePath;

  const adapters: PlatformAdapters = {
    workspaceFolder,
    fileWatcherFactory: new NodeFileWatcherFactory(),
    notificationService: new NodeNotificationService(),
    globalStore: new NodeKeyValueStore(globalStorePath),
    // Omit secretStore and browserService for now (no OAuth2 in CLI/direct mode)
    applicationInfo: appInfo || { name: 'http-forge-cli', version: '0.1.0' },
    // CLI runs are stateless — script-written overrides stay in-memory only
    persistOverrides: false,
  };

  // Register all core services
  registerCoreServices(container, adapters);

  return container;
}

/**
 * Create and initialize service container for CLI or direct API use.
 * This is a convenience wrapper that combines bootstrap and returns the container.
 */
export function createNodeContainer(workspaceFolder: string): ServiceContainer {
  return bootstrapNodeRuntime({ workspaceFolder });
}

/**
 * Create and initialize service container with optional Node bootstrap overrides.
 */
export function createNodeContainerWithOptions(
  workspaceFolder: string,
  options: Omit<NodeBootstrapOptions, 'workspaceFolder'>,
): ServiceContainer {
  return bootstrapNodeRuntime({ workspaceFolder, ...options });
}
