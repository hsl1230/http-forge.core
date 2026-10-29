# 架构实现进度报告

> ## ⚠️ 状态 / Status（历史进度报告 · Historical）
>
> 本文档记录 **2026-03** 三层架构迁移的过程，以及 **2026-08** 的 SOLID 重构与去重清理。
> 其中 2026-03 部分描述的 `src/application/`、`src/domain/`、`src/ports/*`、`bootstrapComplete`、
> `src/infrastructure/di/` 等路径与 API **已被删除**（见 `docs/archive/PHASE3_DELETION_LOG.md`），
> 但 2026-08 的「SOLID 重构与去重清理」一节仍然反映当前代码结构。
>
> **当前测试规模：** `~706` 个 vitest 测试，覆盖 **58** 个测试文件（含 `src/__tests__/api-discovery/`
> 的 6 框架 golden-fixture 套件）——文首与文末的「332/332、16 个文件」数字已过时。版本为
> **@http-forge/core `0.7.0`**。
>
> 当前平台说明见 `README.md`、`docs/api/core-reference.md` 与 `../api/RUNTIME-API.md`。

> **Last updated:** 2026-08-04  
> **TypeScript errors:** 0  
> **Tests:** ~706 passing (58 test files) — 文首数字已更新，见上方状态说明

---

## ✅ 已完成工作

### 第一阶段：概念设计 ✅
- 📘 创建架构分析与设计文档 (`../archive/../archive/ARCHITECTURE_REFACTORING.md`)
- 明确三层架构（Domain、Application、Infrastructure）
- 确定反模式与解耦策略

### 第二阶段：端口层（Ports） ✅
创建完整的端口接口，实现六边形架构的第一步：

#### 外部适配器接口 (`src/ports/external/`)
- `IFileSystem` - 文件系统抽象
- `IHttpClient` - HTTP 客户端抽象
- `ILogger` - 日志接口

#### 数据访问接口 (`src/ports/repositories/`)
- `IRequestRepository` - 请求存储库
- `ICollectionRepository` - 集合存储库
- `IEnvironmentRepository` - 环境存储库

#### 执行接口 (`src/ports/executors/`)
- `IHttpExecutor` - HTTP 执行器（请求准备和执行）
- `IScriptExecutor` - 脚本执行器（前置和后置脚本）

#### 存储接口 (`src/ports/storage/`)
- `IHistoryLoader` - 历史加载器
- `ICacheStore<T>` - 通用缓存存储

#### 解析接口 (`src/ports/parsers/`)
- `ICollectionParser` - 集合格式解析器

### 第三阶段：领域层（Domain） ✅
创建纯业务逻辑，零外部依赖：

#### 域模型 (`src/domain/models/`)
- `IExecutionContext` - 执行上下文
- `IExecutionPlan` - 执行计划
- `IExecutionResult` - 执行结果
- `IExecutionMetrics` - 执行指标

#### 域服务 (`src/domain/services/`)
- `ExecutionPlannerDomainService` - 执行规划
- `SchemaInferenceDomainService` - 模式推断

#### 域错误 (`src/domain/errors/`)
- `DomainError` - 基础错误（支持 code/message/details）
- `CollectionNotFoundError` - 集合未找到
- `RequestNotFoundError` - 请求未找到
- `InvalidRequestError` - 无效请求（支持 1 参数或 2 参数调用）
- `ExecutionError` - 执行错误
- `ScriptExecutionError` - 脚本错误
- `VariableResolutionError` - 变量解析错误

#### 域事件 (`src/domain/services/domain-events.ts`)
- `RequestExecutedEvent` / `RequestExecutionFailedEvent`
- `VariableUpdatedEvent` / `CookieUpdatedEvent`
- `IDomainEventPublisher` - 事件发布接口

### 第四阶段：基础设施层（Infrastructure） ✅

所有实现代码已迁移至 `src/infrastructure/` 下，共 19 个子目录：

#### 外部适配器 (`src/infrastructure/adapters/`)
- `NodeFileSystemAdapter` - Node.js 文件系统实现
- `ConsoleLoggerAdapter` - 控制台日志实现
- `SilentLoggerAdapter` - 静默日志实现

#### 存储库实现 (`src/infrastructure/repositories/`)
- **In-Memory:**
  - `InMemoryRequestRepository` - 内存请求存储库
  - `InMemoryEnvironmentRepository` - 内存环境存储库
  - `InMemoryCollectionRepository` - 内存集合存储库
- **File System:**
  - `FileSystemRequestRepository` - 文件系统请求存储库
  - `FileSystemEnvironmentRepository` - 文件系统环境存储库
  - `FileSystemCollectionRepository` - 文件系统集合存储库
  - `FileSystemEnvironmentFileLoaderAdapter` - 环境文件加载适配器

#### HTTP 执行器 (`src/infrastructure/http/`) ✅
- `HttpRequestService` - HTTP 请求服务
- `InterceptorChain` - 拦截器链（请求/响应/错误拦截器）
- `NodeHttpClient` - 原生 HTTP 客户端
- `FetchHttpClient` - Fetch HTTP 客户端
- `RequestPreprocessor` - 请求预处理器
- `UrlBuilder` - URL 构建器
- `NodeHttpExecutorAdapter` - 适配 `IHttpExecutor` 端口接口

#### 脚本执行器 (`src/infrastructure/script/`) ✅
- `ScriptExecutor` - VM 脚本执行器（environment 架构）
- `RequestScriptSession` - 请求脚本共享 VM 会话
- `VmScriptExecutorAdapter` - 适配 `IScriptExecutor` 端口接口

#### 解析器 (`src/infrastructure/parsers/`) ✅
- `HttpForgeParser` - HTTP Forge 格式解析器
- `HttpForgeCollectionParserAdapter` - 适配 `ICollectionParser` 端口接口
- `CollectionParserRegistry` - 多格式解析器注册表

#### 历史存储 (`src/infrastructure/persistence/`) ✅
- `FileSystemHistoryLoader` - 文件系统历史加载器

#### 集合管理 (`src/infrastructure/collection/`)
- `CollectionLoader` - 单文件格式加载器
- `FolderCollectionLoader` - 文件夹格式加载器
- `FolderCollectionStore` - 文件夹集合存储
- `CollectionService` - 集合服务
- `ParserRegistry` - 解析器注册表

#### 环境管理 (`src/infrastructure/environment/`)
- `EnvironmentResolver` - 环境变量解析
- `ForgeEnv` - 统一环境服务（IForgeEnv）
- `VariableInterpolator` - 变量插值器
- `EnvironmentConfigService` - 环境配置服务

#### 其他基础设施模块
- `src/infrastructure/auth/` - OAuth2 令牌管理
- `src/infrastructure/config/` - 配置服务
- `src/infrastructure/cookie/` - Cookie 管理（CookieJar, PersistentCookieJar）
- `src/infrastructure/execution/` - 请求执行编排（RequestExecutor facade）
- `src/infrastructure/graphql/` - GraphQL 模式服务
- `src/infrastructure/history/` - 请求历史服务
- `src/infrastructure/import-export/` - Postman/REST Client 导入导出
- `src/infrastructure/openapi/` - OpenAPI 导入/导出/推断
- `src/infrastructure/platform/` - 平台工具（DataFileParser, NodeFileSystem）
- `src/infrastructure/test-suite/` - 测试套件服务

#### DI 配置 (`src/infrastructure/di/`) ✅
- `registerInfrastructureServices()` - 基础设施注册
- `registerDomainServices()` - 域服务注册
- `registerApplicationServices()` - 应用层注册
- `bootstrapAllServices()` - 便捷启动
- `bootstrapComplete()` - 完整启动（含文件系统/内存选择）
- `SimpleEventPublisher` - 简单事件发布器

### 第五阶段：应用层（Application） ✅

#### 用例 (`src/application/use-cases/`) - 9 个用例
- `ExecuteRequestUseCase` - 执行请求（完整管道）
- `CreateRequestUseCase` - 创建请求
- `UpdateRequestUseCase` - 更新请求
- `DeleteRequestUseCase` - 删除请求
- `ListRequestsUseCase` - 列出请求（含递归文件夹）
- `GetCollectionUseCase` - 获取集合详情
- `LoadCollectionUseCase` - 从文件加载集合
- `SaveCollectionUseCase` - 保存集合
- `ExportCollectionUseCase` - 导出集合（Postman/OpenAPI）

#### 查询 (`src/application/queries/`)
- `GetRequestSchemaQuery` - 获取请求模式推断

### 第六阶段：目录结构迁移 ✅

所有旧的顶级目录已迁入 `src/infrastructure/`：
- `src/auth/` → `src/infrastructure/auth/`
- `src/config/` → `src/infrastructure/config/`
- `src/cookie/` → `src/infrastructure/cookie/`
- `src/execution/` → `src/infrastructure/execution/`
- `src/graphql/` → `src/infrastructure/graphql/`
- `src/history/` → `src/infrastructure/history/`
- `src/http/` → `src/infrastructure/http/`
- `src/import-export/` → `src/infrastructure/import-export/`
- `src/openapi/` → `src/infrastructure/openapi/`
- `src/parsers/` → `src/infrastructure/parsers/`
- `src/platform/` → `src/infrastructure/platform/`
- `src/script/` → `src/infrastructure/script/`
- `src/test-suite/` → `src/infrastructure/test-suite/`
- `src/collection/` → `src/infrastructure/collection/`
- `src/environment/` → `src/infrastructure/environment/`

所有导入路径已更新，包括：
- 内部基础设施文件的相互引用
- `container.ts`、`index.ts`、`di/core-bootstrap.ts`、`di/service-container.ts` 的外部引用
- `src/__tests__/` 测试文件的引用

### 第七阶段：类型对齐与错误修复 ✅

- `InvalidRequestError` 支持单参数和双参数构造
- `ICollectionRepository.save(id, collection)` 签名对齐
- `IForgeEnv` 类型统一（从 `forge-env.ts` 规范导出）
- `PlatformAdapters` 扩展添加 `fileSystem`、`logger`、`httpClient`、`httpExecutor`、`scriptExecutor`
- `ICollectionLoader` / `ICollectionParser` 添加到 `types/collection.ts`
- `UnifiedCollection` 添加 `meta` 字段
- `ServiceIdentifier` 类型扩展支持 `string | symbol`
- `NodeHttpExecutorAdapter` 使用正确的 `IInterceptorChain` API
- `VmScriptExecutorAdapter` 使用 `ScriptExecutor.createRequestSession()` API
- `HttpForgeParser` 从 `infrastructure/parsers/index.ts` 正确导出

### 第八阶段：应用层标准化 ✅

#### 域值对象 (`src/domain/value-objects/`)
- `HttpMethod` — 经验证的 HTTP 方法值对象（GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS/TRACE/CONNECT），含 `hasBody`、`isSafe`、`isIdempotent` 语义属性
- `RequestUrl` — 请求 URL 值对象，支持模板变量（`{{baseUrl}}`），含变量名提取和协议检测
- `EntityId` — 基础实体 ID 抽象类，防止跨类型混用
  - `RequestId` — 请求 ID 值对象（含 `generate()` 方法）
  - `CollectionId` — 集合 ID 值对象（含 `generate()` 方法）

#### 应用层 DTO (`src/application/dto/`)
- **输入 DTO（`request-dtos.ts`）：** `CreateRequestInput`、`UpdateRequestInput`、`DeleteRequestInput`、`ListRequestsInput`、`GetCollectionInput`、`ExecuteRequestInput`、`LoadCollectionInput`、`SaveCollectionInput`、`ExportCollectionInput`、`GetRequestSchemaInput`
- **输出 DTO（`response-dtos.ts`）：** `RequestSummaryDto`、`RequestDetailDto`、`CollectionSummaryDto`、`CollectionDetailDto`、`ExecuteRequestOutput`、`CreateRequestOutput`、`UpdateRequestOutput`、`DeleteRequestOutput`、`SaveCollectionOutput`、`ExportCollectionOutput`、`LoadCollectionOutput`、`ListRequestsOutput`、`GetCollectionOutput`、`RequestSchemaOutput`

#### 应用层事件 (`src/application/events/`)
- `RequestCreatedEvent` — 请求创建事件（name, method, url）
- `RequestUpdatedEvent` — 请求更新事件（changes: string[]）
- `RequestDeletedEvent` — 请求删除事件
- `CollectionLoadedEvent` — 集合加载事件（source, requestCount）
- `CollectionSavedEvent` — 集合保存事件（filePath）
- `CollectionExportedEvent` — 集合导出事件（format, outputPath）
- `ApplicationEventTypes` — 事件类型常量枚举

#### 应用层映射器 (`src/application/mappers/`)
- `RequestMapper` — `UnifiedRequest` ↔ `RequestDetailDto` / `RequestSummaryDto`
- `CollectionMapper` — `UnifiedCollection` ↔ `CollectionDetailDto` / `CollectionSummaryDto`（含递归 requestCount/folderCount 计算）
- `ExecutionResultMapper` — `IExecutionResult` → `ExecuteRequestOutput`（含脚本结果和断言映射）

#### 用例更新
- 所有 9 个用例已标准化为 DTO 输入/输出模式
- 7 个用例现在发布应用层事件（Create/Update/Delete/Load/Save/Export + Execute 继续发布域事件）
- 去除 use-case 内部的 inline 类型定义，统一引用 `dto/` 目录

---

## 📊 架构现状

### 目录结构
```
src/
├── container.ts                         # ✅ ForgeContainer（向后兼容入口）
├── index.ts                             # ✅ 公共导出（精简后的 API 面）
│
├── di/                                  # ✅ 核心 DI 容器
│   ├── service-container.ts             # ✅ ServiceContainer
│   ├── service-identifiers.ts           # ✅ Symbol-based identifiers
│   ├── platform-adapters.ts             # ✅ PlatformAdapters 接口
│   └── core-bootstrap.ts                # ✅ 核心服务启动
│
├── runtime/                             # ✅ MCP / 直执行运行时
│   ├── mcp-dispatcher.ts                # ✅ 工具调度器（注册表式）
│   ├── mcp-handlers/                    # ✅ 每个工具的独立模块（原先 god-function）
│   ├── mcp-runtime.ts / mcp-run-store.ts / mcp-prompts.ts
│   ├── mcp-tool-builder.ts / mcp-tool-name.ts / mcp-tool-schemas.ts
│   ├── mcp-collection-utils.ts          # ✅ 集合/MCP 通用工具
│   ├── ref-resolver.ts / result-grouping.ts
│   ├── node-adapters.ts / node-bootstrap.ts
│   ├── runtime-contracts.ts / direct-execution.ts
│
├── infrastructure/                      # ✅ 基础设施层（19+ 子目录）
│   ├── ai/                              # ✅ IAiProvider
│   ├── analysis/                        # ✅ env-suggester, ai-env-suggester, collection-enhancer
│   ├── auth/                            # ✅ OAuth2TokenManager
│   ├── collection/                      # ✅ CollectionLoader, FolderCollectionStore, folder-io
│   ├── config/                          # ✅ ConfigService
│   ├── cookie/                          # ✅ CookieJar, CookieService, CookieUtils, PersistentCookieJar
│   ├── environment/                     # ✅ ForgeEnv, EnvironmentResolver, VariableResolver/Interpolator
│   ├── execution/                       # ✅ RequestExecutor (facade)
│   ├── graphql/                         # ✅ GraphQLSchemaService
│   ├── history/                         # ✅ RequestHistoryService
│   ├── http/                            # ✅ NodeHttpClient, FetchHttpClient, InterceptorChain, header-utils, RequestPreprocessor
│   ├── import-export/                   # ✅ Postman/REST Client 导入导出
│   ├── openapi/                         # ✅ 导入/导出/推断（openapi-exporter, openapi-utils, openapi-schema-merger, openapi-operation-builder, openapi-spec-writer）
│   ├── parsers/                         # ✅ HttpForgeParser, curl-parser
│   ├── platform/                        # ✅ DataFileParser, NodeFileSystem
│   ├── script/                          # ✅ ScriptExecutor, module-loader
│   ├── secrets/                         # ✅ cloud secret resolvers
│   ├── security/                        # ✅ sensitive-data-redactor
│   └── test-suite/                      # ✅ TestSuiteService, ResultStorage
│
├── ports/                               # ✅ 端口（抽象接口）
├── types/                               # ✅ 共享类型
│   ├── types.ts                         # ✅ 核心类型
│   ├── collection.ts / environment-config.ts / platform.ts / console-service.ts
│
├── utils/                               # ✅ 共享工具
│   ├── env-hints.ts                     # ✅ 敏感头/密钥检测单一来源
│   ├── dynamic-variables.ts / expression-evaluator.ts / filter-engine.ts / typed-value.ts / helpers.ts
│
└── __tests__/                           # ✅ 332 个测试（16 个文件）
```

---

## 🧹 SOLID 重构与去重清理（2026-08）

在保持 `src/index.ts` 公共 API 面不变的前提下，完成以下重构与清理（全部验证通过：`tsc --noEmit` 0 错误、332/332 测试通过、构建 + 声明文件成功、扩展与 CLI 类型检查通过）：

### 单一职责重构
- **MCP 调度器** — `runtime/mcp-dispatcher.ts` 的 ~2,270 行 `dispatchGenericTool` god-function 拆分为 `runtime/mcp-handlers/` 注册表 + 每工具独立模块；`dispatchGenericTool(tool, args, services, runStore, callbacks)` 签名保持不变。
- **OpenAPI 导出器** — ~1,460 行 god-class 拆分为 `openapi-utils.ts`、`openapi-schema-merger.ts`、`openapi-operation-builder.ts`、`openapi-spec-writer.ts` 与薄壳 `openapi-exporter.ts`；DI 构造函数与 `OpenApiExportOptions` 不变。

### 接口隔离（ISP）
- `IInterceptorChain` 拆分为 `IInterceptorRegistry` + `IInterceptorExecutor`；组合类型保留为 DI token，`HttpRequestService` 依赖 `IInterceptorExecutor`。
- `IAsyncCookieServiceFull` 与 `IAsyncCookieService` 结构相同，已合并为一个接口。

### 死代码清理
- 从 `index.ts` 移除 35 个死公共导出（32 个值 + 3 个类型）；`CollectionService.updateItemRecursive`、`CollectionService.workspaceRoot`、`EnvironmentConfigService.loadJsonFile` 等死私有成员；重复的 `generateSlug` 导出与过时的 `Environment` 类型碰撞。

### 重复代码收敛
| 重复簇 | 单一来源 |
|--------|----------|
| 变量提示（`toVarName`/`isForgeVar`/`looksLikeSecret`/`SENSITIVE_*`）×3 | `utils/env-hints.ts` |
| 请求头净化（`sanitizeHeaderValue`/`sanitizeHeaders`）×2 | `infrastructure/http/header-utils.ts` |
| 集合树 CRUD（`findItemById`/`deleteItemFromTree`）×3 | `collection/folder-io.ts` |
| Cookie 存储键（`getCookieKey`）×3 | `CookieUtils.cookieKey` |
| 动态变量参数解析（`parseDynamicArgs`）×2 | `variable-interpolator.ts` |
| OpenAPI 数值类型拓宽（integer/number → number）×2 | `openapi-utils.widenNumericType` |

> **有意的近重复保留：** Set-Cookie 解析（`ParsedCookie` vs `Cookie`）与 `script-executor` 的 `deserializeValueStatic`/`resolveScriptFilterInput` 因存在行为差异（`=` 处理、domain 点前缀、`undefined` 特判、属性访问支持）而未强行合并。

---

## 🔄 待完成工作

### 第八阶段：应用层扩展
- [ ] `RunTestSuiteUseCase` - 运行测试套件
- [ ] `ExportOpenAPIUseCase` - 导出 OpenAPI
- [x] DTO 定义（请求/响应数据传输对象）
- [x] 应用层事件定义
- [x] 域-应用层映射器

### 第九阶段：更新主容器
- [ ] 更新 `ForgeContainer` 使用新的 DI 配置（最终迁移）
- [ ] 确保向后兼容性
- [ ] 创建迁移指南

### 第十阶段：测试覆盖
- [ ] 为所有域服务添加单元测试
- [ ] 为所有用例添加集成测试
- [x] 验证现有测试仍然通过（332/332）

### 第十一阶段：清理
- [ ] 合并重复的 `IFileSystem` / `IHttpClient` 接口定义
- [x] 域层 `value-objects/` 实现
- [x] 死代码与重复代码清理（2026-08，详见上文「SOLID 重构与去重清理」）
- [ ] 删除遗留文档中过时的条目

---

## 💡 主要改进

### 对比改进
| 方面 | 之前 | 之后 |
|------|------|------|
| **循环依赖** | Collection ↔ OpenAPI | Collection ⊗ OpenAPI（独立） |
| **基础设施泄漏** | 9 个服务混入 fs/path | 0 个业务服务知道文件路径 |
| **测试成本** | 需要 mock 30+ 项 | 只需 mock 接口（2-3 项） |
| **接口大小** | ICollectionService：25+ 方法 | IRequestRepository：5 方法 |
| **变更影响范围** | 修改 HTTP 影响 5+ 服务 | 修改 HttpExecutor 只影响实现 |
| **目录结构** | 15+ 顶级目录混杂 | 7 个职责清晰的顶级目录 |
| **TypeScript 编译** | 88+ 错误 | 0 错误 |

---

## 📚 关键文件

### 文档
- `../archive/../archive/ARCHITECTURE_REFACTORING.md` - 完整的架构分析和设计文档
- `../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md` - 实现指南和使用示例

### 核心文件
- `src/domain/index.ts` - 域层入口
- `src/application/index.ts` - 应用层入口  
- `src/infrastructure/index.ts` - 基础设施层入口
- `src/ports/index.ts` - 端口层入口

### 关键实现
- `src/domain/services/execution-planner.domain-service.ts` - 执行规划业务逻辑
- `src/application/use-cases/execute-request.use-case.ts` - 核心业务工作流
- `src/infrastructure/di/complete-bootstrap.ts` - 完整 DI 配置
- `src/infrastructure/http/node-http-executor.adapter.ts` - HTTP 执行适配器
- `src/infrastructure/script/vm-script-executor.adapter.ts` - 脚本执行适配器
- `src/container.ts` - 向后兼容的 ForgeContainer

---

## 📖 使用示例

### 新架构（推荐）
```typescript
import { ServiceContainer } from '@http-forge/core/di';
import { bootstrapComplete } from '@http-forge/core/infrastructure/di';

const container = new ServiceContainer();
bootstrapComplete(container, {
    useFileSystem: true,
    basePath: '/path/to/workspace',
    adapters: { httpClient: myHttpClient }
});

const executeUseCase = container.resolve<ExecuteRequestUseCase>('ExecuteRequestUseCase');
const result = await executeUseCase.execute({
    collectionId: 'my-collection',
    requestId: 'req-123'
});
```

### 向后兼容
```typescript
import { ForgeContainer } from '@http-forge/core';

const forge = ForgeContainer.fromForgeRoot('./http-forge');
const collection = await forge.loadAllCollections();
const result = await forge.execute(collection[0].items[0], collection[0]);
```

---

## ✨ 完成情况

- ✅ 154 个源文件
- ✅ 完整的三层六边形架构（Domain → Application → Infrastructure）
- ✅ 所有端口接口已定义（5 个子模块）
- ✅ 所有基础设施代码迁入 `infrastructure/`（19 个子目录）
- ✅ 9 个应用层用例 + 1 个查询
- ✅ DI 容器与完整启动配置
- ✅ TypeScript 编译零错误
- ✅ 161 个测试全部通过
- ✅ 向后兼容的 ForgeContainer 保留
- 📋 应用层扩展（RunTestSuiteUseCase, ExportOpenAPIUseCase）待计划
- 📋 合并重复接口定义待清理

---

Generated: 2026-03-19
