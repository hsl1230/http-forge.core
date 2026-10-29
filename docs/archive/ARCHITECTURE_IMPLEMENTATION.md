#!/usr/bin/env node

> ## ⚠️ 状态 / Status（历史文档 · Historical）
>
> 本文档描述的是 **2026-03 期间引入、随后被删除的旧三层架构**（Domain / Application / Ports，
> `src/application/use-cases/execute-request.use-case.ts`、`bootstrapComplete` 等路径与 API）。
> 这些路径在 2026-08 重构后**已不存在**（见 `docs/archive/PHASE3_DELETION_LOG.md` 与
> `docs/developer/IMPLEMENTATION_STATUS.md`），文中代码示例**无法运行**。
>
> 当前平台（@http-forge/core `0.6.36-beta.1`）的入口为 `ForgeContainer` / `createNodeContainer`，
> 运行时 API 见 `../api/RUNTIME-API.md`，最新参考见 `docs/api/core-reference.md`。本文档仅作历史参考保留。

/**
 * Architecture Implementation Guide
 * 
 * How to use the new three-layer architecture
 */

import { ServiceContainer } from './src/di/service-container';
import {
    registerInfrastructureServices,
    registerDomainServices,
    registerApplicationServices
} from './src/infrastructure/di/infrastructure-di-config';
import { ExecuteRequestUseCase } from './src/application/use-cases/execute-request.use-case';

/**
 * Example 1: Bootstrap the container
 */
export function exampleBootstrap() {
    const container = new ServiceContainer();

    // Phase 1: Register infrastructure (file system, logger, HTTP client, etc.)
    registerInfrastructureServices(container);

    // Phase 2: Register domain services (pure business logic)
    registerDomainServices(container);

    // Phase 3: Register application services (use cases)
    registerApplicationServices(container);

    // Now we can use the application
    return container;
}

/**
 * Example 2: Use the application to execute a request
 */
export async function exampleExecuteRequest(container: ServiceContainer) {
    const executeUseCase = container.resolve<ExecuteRequestUseCase>('ExecuteRequestUseCase');

    // Create a mock request (in real usage, this comes from repository)
    const result = await executeUseCase.execute({
        collectionId: 'my-collection',
        requestId: 'req-123'
    });

    console.log('Execution result:', result);
}

/**
 * Architecture Layers
 */

/**
 * ┌─────────────────────────────────────────────┐
 * │       Application Layer (Use Cases)         │
 * │  ┌──────────────────────────────────────┐   │
 * │  │ ExecuteRequestUseCase                │   │
 * │  │ GetRequestSchemaQuery                │   │
 * │  │ ...other use cases                   │   │
 * │  └──────────────────────────────────────┘   │
 * ├─────────────────────────────────────────────┤
 * │       Domain Layer (Business Logic)         │
 * │  ┌──────────────────────────────────────┐   │
 * │  │ ExecutionPlannerDomainService        │   │
 * │  │ SchemaInferenceDomainService         │   │
 * │  │ DomainErrors, DomainEvents           │   │
 * │  └──────────────────────────────────────┘   │
 * ├─────────────────────────────────────────────┤
 * │       Ports Layer (Abstractions)            │
 * │  ┌──────────────────────────────────────┐   │
 * │  │ IRequestRepository                   │   │
 * │  │ IHttpExecutor, IScriptExecutor       │   │
 * │  │ IFileSystem, ILogger, IHttpClient    │   │
 * │  └──────────────────────────────────────┘   │
 * ├─────────────────────────────────────────────┤
 * │    Infrastructure Layer (Implementations)   │
 * │  ┌──────────────────────────────────────┐   │
 * │  │ InMemoryRequestRepository            │   │
 * │  │ NodeFileSystemAdapter                │   │
 * │  │ ConsoleLoggerAdapter                 │   │
 * │  └──────────────────────────────────────┘   │
 * └─────────────────────────────────────────────┘
 */

// ============================================================
// Key Benefits of This Architecture
// ============================================================

/**
 * 1. SEPARATION OF CONCERNS
 *    - Domain: Pure business logic (no external dependencies)
 *    - Application: Use cases orchestrating domain & infrastructure
 *    - Infrastructure: Technical implementations
 *    - Ports: Abstract interfaces for dependency injection
 * 
 * 2. TESTABILITY
 *    - Domain services can be tested without mocks (pure logic)
 *    - Application can use mock repositories and executors
 *    - Infrastructure implementations are replaceable
 * 
 * 3. FLEXIBILITY
 *    - Swap file-based storage for cloud storage
 *    - Use mock HTTP client for testing
 *    - Replace logger implementation
 * 
 * 4. CLARITY
 *    - Each layer has single responsibility
 *    - Dependencies flow downward (Application → Domain → Ports → Infrastructure)
 *    - Business rules are not scattered across files
 * 
 * 5. MAINTAINABILITY
 *    - Adding new features doesn't impact existing layers
 *    - Bug fixes in one layer don't affect others
 *    - Easy to onboard new developers
 */

// ============================================================
// Directory Structure
// ============================================================

/*
src/
├── domain/                              # BUSINESS LOGIC
│   ├── models/                          # Data structures
│   │   └── execution.ts                 # Execution models
│   ├── services/                        # Pure business logic
│   │   ├── execution-planner.domain-service.ts
│   │   ├── schema-inference.domain-service.ts
│   │   └── domain-events.ts
│   └── errors/                          # Business exceptions
│       └── domain-errors.ts
│
├── application/                         # USE CASES & QUERIES
│   ├── use-cases/
│   │   └── execute-request.use-case.ts
│   ├── queries/
│   │   └── (to be added)
│   ├── dto/                             # Data transfer objects
│   ├── events/                          # Event handlers
│   ├── mappers/                         # DTO ↔ Entity mapping
│   └── index.ts
│
├── ports/                               # ABSTRACTIONS
│   ├── external/
│   │   ├── file-system.interface.ts
│   │   ├── http-client.interface.ts
│   │   └── logger.interface.ts
│   ├── repositories/
│   │   ├── request-repository.interface.ts
│   │   ├── collection-repository.interface.ts
│   │   └── environment-repository.interface.ts
│   ├── executors/
│   │   ├── http-executor.interface.ts
│   │   └── script-executor.interface.ts
│   ├── storage/
│   │   ├── history-loader.interface.ts
│   │   └── cache-store.interface.ts
│   └── index.ts
│
├── infrastructure/                      # IMPLEMENTATIONS
│   ├── adapters/
│   │   ├── node-file-system.adapter.ts
│   │   └── logger.adapter.ts
│   ├── repositories/
│   │   ├── file-system/
│   │   ├── in-memory/
│   │   │   ├── in-memory-request-repository.ts
│   │   │   └── in-memory-environment-repository.ts
│   │   └── cloud/
│   ├── http/
│   │   ├── node-http-executor.ts
│   │   └── interceptors/
│   ├── script/
│   │   ├── vm-script-executor.ts
│   │   └── context/
│   ├── persistence/
│   │   ├── history-storage.ts
│   │   └── cache/
│   ├── parsers/
│   │   └── http-forge-parser.ts
│   ├── di/
│   │   ├── infrastructure-di-config.ts
│   │   └── simple-event-publisher.ts
│   └── index.ts
│
└── index.ts                             # PUBLIC API
*/

console.log('✅ Architecture implementation guide loaded');
console.log('📖 See comments in this file for architecture overview');
