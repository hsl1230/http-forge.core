> **Archived / Historical.** Superseded by `docs/developer/IMPLEMENTATION_STATUS.md`.

# 技术清单 - @http-forge/core 架构重构

> ## ⚠️ 状态 / Status（历史文档 · Historical）
>
> 本文档是 **2026-03** 旧三层架构的文件清单（端口/域/应用/基础设施层、`bootstrapComplete` 等）。
> 其中绝大多数路径与 API **在 2026-08 重构中已被删除**（`src/ports/*`、`src/application/*`、
> `src/domain/*`、`src/infrastructure/di/*`、`src/infrastructure/adapters/*`、in-memory/file-system
> 存储库等，见 `docs/archive/PHASE3_DELETION_LOG.md`），仅 `src/container.ts`（`ForgeContainer`）、
> `src/di/`（`ServiceContainer`）、`src/infrastructure/`（实现层）、`src/runtime/`（MCP）、
> `src/types/`、`src/utils/` 仍存在。文中的文件统计、使用示例与版本号（1.0.0-rc.1）**均已过时**。
>
> 当前（@http-forge/core `0.6.36-beta.1`）的真实结构见 `docs/developer/IMPLEMENTATION_STATUS.md`，
> 最新 API 见 `docs/api/core-reference.md` 与 `../api/RUNTIME-API.md`。本文档仅作历史参考保留。

## 📋 核心文件清单

### 端口层（11 个文件）

#### 外部接口 (3 个)
```
src/ports/external/
├── file-system.interface.ts
│   └── IFileSystem {
│       exists(path): Promise<boolean>
│       readFile(path, encoding): Promise<string>
│       writeFile(path, data, encoding): Promise<void>
│       mkdir(path, recursive): Promise<void>
│       delete(path): Promise<void>
│       stat(path): Promise<FileStat>
│   }
├── http-client.interface.ts
│   └── IHttpClient {
│       execute(request): Promise<HttpResponse>
│   }
├── logger.interface.ts
│   └── ILogger {
│       debug, info, warn, error methods
│   }
└── index.ts
```

#### 存储库接口 (3 个)
```
src/ports/repositories/
├── request-repository.interface.ts
│   └── IRequestRepository {
│       findById(collectionId, requestId): Promise<HttpRequest>
│       findAll(collectionId, filter?): Promise<HttpRequest[]>
│       save(collectionId, request): Promise<void>
│       delete(collectionId, requestId): Promise<void>
│       exists(collectionId, requestId): Promise<boolean>
│   }
├── collection-repository.interface.ts
│   └── ICollectionRepository { /* 类似结构 */ }
├── environment-repository.interface.ts
│   └── IEnvironmentRepository {
│       ... 加上 setActive(envId) 方法
│   }
└── index.ts
```

#### 执行器接口 (2 个)
```
src/ports/executors/
├── http-executor.interface.ts
│   └── IHttpExecutor {
│       prepare(plan): Promise<PreparedRequest>
│       execute(prepared): Promise<ExecutionResult>
│   }
├── script-executor.interface.ts
│   └── IScriptExecutor {
│       executePreRequest(session, script): Promise<SessionDelta>
│       executePostResponse(session, script, response): Promise<AssertionResult>
│   }
└── index.ts
```

#### 存储接口 (2 个)
```
src/ports/storage/
├── history-loader.interface.ts
│   └── IHistoryLoader {
│       loadHistory(collectionId, requestId, options): Promise<HistoryEntry[]>
│       loadFullResponse(entryId): Promise<StoredResponse>
│       saveEntry(entry): Promise<void>
│   }
├── cache-store.interface.ts
│   └── ICacheStore<T> {
│       get(key): Promise<T | null>
│       set(key, value, ttl?): Promise<void>
│       delete(key): Promise<void>
│       clear(): Promise<void>
│   }
└── index.ts
```

#### 解析器接口 (1 个)
```
src/ports/parsers/
├── collection-parser.interface.ts
│   └── ICollectionParser {
│       canHandle(file): Promise<boolean>
│       parse(content): Promise<Collection>
│       supportedFormats: string[]
│   }
└── index.ts
```

---

### 域层（8 个文件）✨ 零外部依赖

#### 域模型 (1 个)
```
src/domain/models/
├── execution.ts
│   ├── IExecutionContext {
│       collectionId, requestId, environment, variables, cookies
│   }
│   ├── IExecutionPlan {
│       request, preScripts, postScripts, needsInterpolation
│   }
│   ├── IExecutionResult {
│       httpResponse, scriptResults, variables, cookies, metrics
│   }
│   ├── IExecutionMetrics {
│       startTime, endTime, duration, retries, cacheHits
│   }
│   └── AssertionResult {
│       name, status, message, value, expected
│   }
└── index.ts
```

#### 域服务 (2 个)
```
src/domain/services/
├── execution-planner.domain-service.ts
│   └── ExecutionPlannerDomainService {
│       validateRequest(request): boolean
│       createExecutionPlan(request, context): IExecutionPlan
│       hasScripts(request): boolean
│       needsVariableInterpolation(request): boolean
│       buildExecutionContext(...): IExecutionContext
│   }
├── schema-inference.domain-service.ts
│   └── SchemaInferenceDomainService {
│       mergeResponseSchemas(...): ResponseSchema
│       validateSchema(schema): boolean
│       extractPropertyHints(scriptOutput): PropertyHints
│   }
└── index.ts
```

#### 域事件 (1 个)
```
src/domain/services/
├── domain-events.ts
│   ├── DomainEvent {
│       aggregateId, occurredAt, version
│   }
│   ├── RequestExecutedEvent
│   ├── RequestExecutionFailedEvent
│   ├── VariableUpdatedEvent
│   ├── CookieUpdatedEvent
│   └── IDomainEventPublisher {
│       subscribe(eventType, handler)
│       publish(event)
│       unsubscribe(eventType, handler)
│   }
└── index.ts
```

#### 域错误 (1 个)
```
src/domain/errors/
├── domain-errors.ts
│   ├── DomainError (基类)
│   ├── CollectionNotFoundError
│   ├── RequestNotFoundError
│   ├── InvalidRequestError
│   ├── ExecutionError
│   ├── ScriptExecutionError
│   └── VariableResolutionError
└── index.ts
```

#### 主索引 (1 个)
```
src/domain/
└── index.ts
    ├── export * from './models'
    ├── export * from './services'
    ├── export * from './errors'
```

---

### 应用层（8 个文件）

#### 用例 (3 个)
```
src/application/use-cases/
├── execute-request.use-case.ts
│   └── ExecuteRequestUseCase {
│       async execute(input: ExecuteRequestInput): Promise<ExecutionResult>
│       
│       10-步执行流程:
│       1. 从存储库加载请求
│       2. 从存储库加载环境
│       3. 准备执行上下文
│       4. 调用域服务创建执行计划
│       5. 执行前置脚本（修改请求）
│       6. 准备HTTP请求（变量插值、添加Cookie）
│       7. 执行HTTP请求
│       8. 执行后置脚本（断言、提取变量）
│       9. 构建执行结果
│       10. 发布领域事件
│   }
├── load-collection.use-case.ts
│   └── LoadCollectionUseCase {
│       async execute(filePath): Promise<Collection>
│       
│       1. 检查文件是否存在
│       2. 读取文件内容
│       3. 检测格式（扩展名和结构）
│       4. 选择合适的解析器
│       5. 解析集合
│       6. 添加元数据（loadedFrom, loadedAt）
│       7. 返回集合
│   }
├── save-collection.use-case.ts
│   └── SaveCollectionUseCase {
│       async execute(filePath, collection): Promise<void>
│       
│       1. 验证集合有效性
│       2. 创建目录（递归）
│       3. 序列化为JSON
│       4. 写入文件
│       5. 返回结果
│   }
└── index.ts
```

#### 查询 (1 个)
```
src/application/queries/
├── get-request-schema.query.ts
│   └── GetRequestSchemaQuery {
│       async execute(collectionId, requestId): Promise<ResponseSchema>
│       
│       1. 从存储库加载请求
│       2. 获取用户定义的响应模式
│       3. 从历史推断模式
│       4. 从后置脚本提取提示
│       5. 使用域服务合并模式
│       6. 验证结果
│       7. 返回合并的模式
│   }
└── index.ts
```

#### 预留结构 (4 个目录)
```
src/application/
├── dto/                    # 数据传输对象（预留）
├── events/                 # 应用事件（预留）
├── mappers/                # DTO映射器（预留）
└── index.ts
    # 导出所有用例和查询
```

---

### 基础设施层（22 个文件）

#### 外部适配器 (3 个)
```
src/infrastructure/adapters/
├── node-file-system.adapter.ts
│   └── NodeFileSystemAdapter implements IFileSystem {
│       使用 Node.js fs.promises 实现所有方法
│   }
├── logger.adapter.ts
│   ├── ConsoleLoggerAdapter implements ILogger
│   ├── SilentLoggerAdapter implements ILogger
│   └── 支持日志级别过滤
└── index.ts
```

#### HTTP 执行器 (2 个)
```
src/infrastructure/http/
├── node-http-executor.adapter.ts
│   └── NodeHttpExecutorAdapter implements IHttpExecutor {
│       prepare(plan): PreparedRequest {
│           1. 应用请求拦截器
│           2. 从Cookie jar添加Cookie
│           3. 设置内容类型和其他头部
│           4. 返回准备好的请求
│       }
│       
│       execute(prepared): ExecutionResult {
│           1. TODO: 调用IHttpClient执行HTTP
│           2. 应用响应拦截器
│           3. 从响应提取并保存Cookie
│           4. 返回执行结果
│           5. 通过BehaviorSubject发出响应事件
│       }
│   }
└── index.ts
```

#### 脚本执行器 (2 个)
```
src/infrastructure/script/
├── vm-script-executor.adapter.ts
│   └── VmScriptExecutorAdapter implements IScriptExecutor {
│       executePreRequest(session, script): SessionDelta {
│           1. 将端口会话适配为内部会话
│           2. 运行预请求脚本
│           3. 提取变量变更（delta）
│           4. 返回变更结果
│       }
│       
│       executePostResponse(session, script, response): AssertionResult {
│           1. 将端口会话与响应适配
│           2. 运行后响应脚本
│           3. 提取断言结果
│           4. 提取自定义脚本设置的变量
│           5. 返回断言结果
│       }
│   }
└── index.ts
```

#### 存储库 - 内存 (2 个)
```
src/infrastructure/repositories/in-memory/
├── in-memory-request-repository.ts
│   └── InMemoryRequestRepository implements IRequestRepository {
│       使用Map<string, HttpRequest>存储
│       完整CRUD操作实现
│       适用于单元测试
│   }
├── in-memory-environment-repository.ts
│   └── InMemoryEnvironmentRepository implements IEnvironmentRepository {
│       使用Map<string, Environment>存储
│       支持setActive()方法
│       适用于单元测试
│   }
└── index.ts
```

#### 存储库 - 文件系统 (2 个) ⭐ 新增
```
src/infrastructure/repositories/file-system/
├── fs-request-repository.ts
│   └── FileSystemRequestRepository implements IRequestRepository {
│       目录结构: basePath/{collectionId}/requests/{id}.json
│       JSON格式: { id, name, method, url, ... }
│       实现完整CRUD与错误处理
│   }
├── fs-environment-repository.ts
│   └── FileSystemEnvironmentRepository implements IEnvironmentRepository {
│       目录结构: basePath/environments/{safeName}.json
│       支持 setActive(envId) 通过 .active 文件
│       安全命名 (特殊字符处理)
│   }
└── index.ts
```

#### 持久化 (2 个)
```
src/infrastructure/persistence/
├── file-system-history-loader.ts
│   └── FileSystemHistoryLoader implements IHistoryLoader {
│       目录: basePath/history/{collectionId}/{requestId}/
│       
│       manifest.json:
│       {
│           entries: [
│               { id, timestamp, statusCode, size, filename }
│           ]
│       }
│       
│       loadHistory: 返回分页条目
│       loadFullResponse: 返回完整HTTP响应
│       saveEntry: 保存新条目（自动轮换保持100条）
│   }
└── index.ts
```

#### 解析器 (2 个) ⭐ 新增
```
src/infrastructure/parsers/
├── collection-parser.adapter.ts
│   ├── HttpForgeCollectionParserAdapter implements ICollectionParser {
│       包装现有HttpForgeParser
│       supportedFormats: ['.http', '.httpforge']
│   }
│   
│   └── CollectionParserRegistry {
│       管理多个ICollectionParser实现
│       canHandle方法用于自动检测
│       parse方法路由到合适的解析器
│   }
└── index.ts
```

#### DI 配置 (3 个) ⭐ 新增 complete-bootstrap
```
src/infrastructure/di/
├── infrastructure-di-config.ts
│   └── 导出函数:
│       • registerInfrastructureServices(container)
│       • registerDomainServices(container)
│       • registerApplicationServices(container)
│       • bootstrapAllServices(container)
│
├── simple-event-publisher.ts
│   └── SimpleEventPublisher implements IDomainEventPublisher {
│       使用Map<string, Set<Handler>>存储订阅
│       subscribe/publish/unsubscribe 实现
│   }
│
├── complete-bootstrap.ts ⭐ 新增
│   └── bootstrapComplete(container, options) {
│       interface FullBootstrapOptions {
│           useFileSystem?: boolean      // true: 磁盘; false: 内存
│           adapters?: PlatformAdapters  // 自定义实现
│           basePath?: string            // 文件系统基路径
│           fileWatcherFactory?: IFileWatcherFactory  // 文件变化监听
│       }
│       
│       执行步骤:
│       1. 注册所有基础设施
│       2. 注册所有域服务
│       3. 选择存储库实现
│       4. 注册所有用例 (3个)
│       5. 注册所有查询 (1个)
│       6. 初始化事件发布器
│       7. 返回完全配置的容器
│   }
│
└── index.ts
    导出:
    • infrastructure-di-config
    • simple-event-publisher
    • complete-bootstrap
```

#### 根索引 (1 个)
```
src/infrastructure/
└── index.ts
    导出所有子模块
```

---

### 应用入口层（2 个文件）

```
src/
├── index.ts
│   导出:
│   • domain/*
│   • application/*
│   • ports/*
│   • infrastructure/*
│   • types/* (待添加)
│
└── container.ts
    现有遗留代码（待迁移到NewServiceContainer）
```

---

## 📊 文件统计

| 分类 | 个数 | 实现状态 |
|------|------|---------|
| **端口** | 11 | ✅ 100% |
| **域** | 8 | ✅ 100% |
| **应用** | 8 | ✅ 100% |
| **基础设施** | 22 | ✅ 100% |
| **入口** | 2 | ⚠️ 50% |
| **总计** | **51** | ✅ **95%** |

---

## 🔗 依赖关系

```
Application
    ↓ depends on
Domain + Ports
    ↓ depends on
Infrastructure
    ↓ implements
Ports
    ↑ zero dependency

Domain: 零外部依赖 ✅
Ports: 零实现逻辑 ✅
Infrastructure: 只依赖Ports ✅
Application: Depends on Domain + Ports ✅
```

---

## 🧪 测试策略

```
单元测试:
  ✅ 域服务（使用内存存储库）
  ✅ 应用用例（使用内存存储库）
  ⚠️ 适配器（模拟IHttpClient, IScriptExecutor）
  
集成测试:
  📋 库存库容器（文件系统）
  📋 完整请求执行流程
  📋 事件发布流程

端到端测试:
  📋 实际HTTP请求
  📋 文件系统持久化
  📋 脚本执行
```

---

## 📈 质量指标

```
代码标准:
  ✅ TypeScript strict mode
  ✅ Interface-based contracts
  ✅ Immutable where possible
  ✅ Async/await patterns
  ✅ Error handling with custom errors
  
性能:
  ✅ 单例式的域服务
  ✅ 延迟加载的存储库
  ✅ 内存中的缓存层（可选）
  ✅ 高效的文件I/O
  
可维护性:
  ✅ 单一职责原则
  ✅ 开放/封闭原则
  ✅ 里氏替换原则
  ✅ 接口隔离原则
  ✅ 依赖反转原则
```

---

## 🚀 使用示例

### 基本初始化
```typescript
import { ServiceContainer } from '@http-forge/core/di';
import { bootstrapComplete } from '@http-forge/core/infrastructure/di';

const container = new ServiceContainer();
bootstrapComplete(container, {
    useFileSystem: true,
    basePath: './data'
});
```

### 执行请求
```typescript
const executeUseCase = container.resolve('ExecuteRequestUseCase');

const result = await executeUseCase.execute({
    collectionId: 'my-api',
    requestId: 'get-users'
});

console.log(result.httpResponse.statusCode);
console.log(result.assertions);
```

### 获取响应模式
```typescript
const getSchemaQuery = container.resolve('GetRequestSchemaQuery');

const schema = await getSchemaQuery.execute('my-api', 'get-users');

console.log(schema.properties);
```

### 加载集合
```typescript
const loadUseCase = container.resolve('LoadCollectionUseCase');

const collection = await loadUseCase.execute('./collections/api.http');

console.log(collection.requests.length);
```

---

## 🎯 扩展点

| 扩展点 | 位置 | 难度 |
|--------|------|------|
| 新的HTTP执行器 | `src/infrastructure/http/` | ⭐ 简单 |
| 新的脚本执行器 | `src/infrastructure/script/` | ⭐ 简单 |
| 新的存储库实现 | `src/infrastructure/repositories/` | ⭐⭐ 中等 |
| 新的用例 | `src/application/use-cases/` | ⭐⭐ 中等 |
| 新的查询 | `src/application/queries/` | ⭐⭐ 中等 |
| 新的域服务 | `src/domain/services/` | ⭐⭐⭐ 难 |
| 新的端口 | `src/ports/` | ⭐⭐⭐ 难 |

---

## 📝 相关文档

- [USAGE_GUIDE.md](./USAGE_GUIDE.md) - 详细使用指南
- [../archive/ARCHITECTURE_REFACTORING.md](./../archive/ARCHITECTURE_REFACTORING.md) - 架构设计
- [../archive/ARCHITECTURE_IMPLEMENTATION.md](./../archive/ARCHITECTURE_IMPLEMENTATION.md) - 实现指南
- [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) - 实现状态

---

**最后更新**: 2026-03-16  
**作者**: @http-forge team  
**版本**: 1.0.0-rc.1
