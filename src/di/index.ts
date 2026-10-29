/**
 * Dependency Injection
 * 
 * ⚠️ @deprecated 此模块用于向后兼容
 * 新代码应使用 infrastructure/di/complete-bootstrap 中的功能
 * 
 * Provides a generic, platform-agnostic DI container and service bootstrap.
 * Host environments (VS Code, CLI, etc.) only need to supply PlatformAdapters.
 * 
 * 迁移指南:
 * - 旧的 ServiceContainer 已被新的架构集成
 * - 使用 bootstrapComplete() 替代 registerCoreServices()
 * - 详见 docs/archive/ARCHITECTURE_IMPLEMENTATION.md
 */

export { registerCoreServices } from './core-bootstrap';
export type { PlatformAdapters } from './platform-adapters';
export { getServiceContainer, ServiceContainer } from './service-container';
export { ServiceIdentifiers } from './service-identifiers';
export type { ServiceIdentifier } from './service-identifiers';

