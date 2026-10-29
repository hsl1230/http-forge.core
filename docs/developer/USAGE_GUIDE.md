# 🚀 @http-forge/core 使用指南 - 完整实现

## 架构现状

已完成 **70% 的架构实现**，包括：

✅ **域层** - 100% 完成
✅ **应用层** - 80% 完成（3 个用例 + 1 个查询）
✅ **端口层** - 100% 完成（所有接口）
✅ **基础设施层** - 80% 完成（仓库、历史、解析器、适配器）

---

## 🔧 快速开始

### 1. 基本启动

```typescript
import { ServiceContainer } from '@http-forge/core/di';
import { bootstrapComplete } from '@http-forge/core/infrastructure/di';

// 创建容器和启动
const container = new ServiceContainer();
bootstrapComplete(container, {
    useFileSystem: true,
    basePath: '/path/to/projects'
});

// 获取用例
const executeUseCase = container.resolve('ExecuteRequestUseCase');
```

### 2. 执行请求

```typescript
// 核心业务流程
const result = await executeUseCase.execute({
    collectionId: 'my-api-collection',
    requestId: 'get-users',
    overrides: {
        variables: { page: 2 }
    }
});

// 结果包含
console.log({
    status: result.response.status,        // HTTP 状态码
    duration: result.duration,              // 执行时间（ms）
    assertions: result.postScriptResult,   // 断言结果
    variables: result.variableChanges      // 变更的变量
});
```

### 3. 加载/保存集合

```typescript
// 加载集合
const loadUseCase = container.resolve('LoadCollectionUseCase');
const collection = await loadUseCase.execute('./api-collection.json');

// 修改集合...

// 保存集合
const saveUseCase = container.resolve('SaveCollectionUseCase');
await saveUseCase.execute('./api-collection.json', collection);
```

### 4. 获取请求模式

```typescript
// 获取响应模式（合并多个来源）
const schemaQuery = container.resolve('GetRequestSchemaQuery');
const schema = await schemaQuery.execute('my-api-collection', 'get-users');

console.log(schema);
// {
//   type: 'object',
//   properties: { ... },
//   required: ['id', 'name', ...]
// }
```

---

## 📚 实现的组件

### 应用层用例 ✅

#### 1. ExecuteRequestUseCase - 执行请求
```typescript
export class ExecuteRequestUseCase {
    async execute(options: ExecuteRequestOptions): Promise<IExecutionResult>
}

// 完整流程：
// 1. 装载请求和环境
// 2. 验证请求有效性  
// 3. 创建执行计划
// 4. 执行前置脚本
// 5. 准备和执行 HTTP 请求
// 6. 执行后置脚本
// 7. 发布事件
```

#### 2. LoadCollectionUseCase - 加载集合
```typescript
export class LoadCollectionUseCase {
    async execute(filePath: string): Promise<UnifiedCollection>
}
```

#### 3. SaveCollectionUseCase - 保存集合
```typescript
export class SaveCollectionUseCase {
    async execute(filePath: string, collection: UnifiedCollection): Promise<void>
}
```

### 应用层查询 ✅

#### 1. GetRequestSchemaQuery - 获取响应模式
```typescript
export class GetRequestSchemaQuery {
    async execute(collectionId: string, requestId: string): Promise<ResponseSchema>
}

// 合并信息来源：
// - 用户定义的模式
// - 历史推断的模式
// - 脚本提示的属性
```

### 基础设施实现 ✅

#### 存储库实现

**现有可用**：
- `InMemoryRequestRepository` - 内存中请求存储
- `InMemoryEnvironmentRepository` - 内存中环境存储

**新增**：
- `FileSystemRequestRepository` - 文件系统请求存储
- `FileSystemEnvironmentRepository` - 文件系统环境存储
- `FileSystemHistoryLoader` - 文件系统历史加载

#### 适配器实现

**HTTP 执行**：
- `NodeHttpExecutorAdapter` - 包装现有 HttpRequestService

**脚本执行**：
- `VmScriptExecutorAdapter` - 包装现有 ScriptExecutor

**集合解析**：
- `HttpForgeCollectionParserAdapter` - HTTP Forge 格式
- `CollectionParserRegistry` - 多格式解析器注册表

**外部适配器**：
- `NodeFileSystemAdapter` - Node.js 文件系统
- `ConsoleLoggerAdapter` - 控制台日志

### 域层（纯业务逻辑）✅

#### 域服务 - 零依赖

**ExecutionPlannerDomainService**：
- 请求验证 - 检查 HTTP 方法、URL 有效性
- 执行计划创建 - 组织脚本和请求
- 上下文构建 - 准备执行环境

**SchemaInferenceDomainService**：
- 多源模式合并 - 用户定义 + 历史推断 + 脚本提示
- 模式验证 - 检查模式完整性
- 属性提示 - 从脚本提取属性

#### 域错误 - 业务异常
```typescript
- DomainError          // 基础
- CollectionNotFoundError
- RequestNotFoundError
- InvalidRequestError
- ExecutionError
- ScriptExecutionError
- VariableResolutionError
```

#### 域事件 - 事件驱动
```typescript
- RequestExecutedEvent          // 请求执行完毕
- RequestExecutionFailedEvent   // 请求执行失败
- VariableUpdatedEvent          // 变量更新
- CookieUpdatedEvent            // Cookie 更新
```

---

## 📊 完整的目录结构

```
src/
├── domain/                      # ✅ 100% - 纯业务逻辑
│   ├── models/
│   │   └── execution.ts         # ✅ 执行模型
│   ├── services/
│   │   ├── execution-planner.domain-service.ts    # ✅
│   │   ├── schema-inference.domain-service.ts     # ✅
│   │   └── domain-events.ts                        # ✅
│   └── errors/
│       └── domain-errors.ts     # ✅
│
├── application/                 # ✅ 80% - 用例和查询
│   ├── use-cases/
│   │   ├── execute-request.use-case.ts        # ✅
│   │   ├── load-collection.use-case.ts        # ✅
│   │   ├── save-collection.use-case.ts        # ✅
│   │   └── index.ts                           # ✅
│   ├── queries/
│   │   ├── get-request-schema.query.ts        # ✅
│   │   └── index.ts                           # ✅
│   └── index.ts                               # ✅
│
├── ports/                       # ✅ 100% - 抽象接口
│   ├── external/                # ✅ Logger, FileSystem, HttpClient
│   ├── repositories/            # ✅ Request, Collection, Environment
│   ├── executors/               # ✅ Http, Script
│   ├── storage/                 # ✅ History, Cache
│   ├── parsers/                 # ✅ Collection
│   └── index.ts                 # ✅
│
├── infrastructure/              # ✅ 80% - 实现
│   ├── adapters/                # ✅ 完成
│   │   ├── node-file-system.adapter.ts
│   │   ├── logger.adapter.ts
│   │   └── index.ts
│   ├── repositories/
│   │   ├── in-memory/           # ✅ 完成
│   │   ├── file-system/         # ✅ 完成
│   │   └── cloud/               # 📋 计划中
│   ├── http/
│   │   ├── node-http-executor.adapter.ts  # ✅
│   │   └── index.ts
│   ├── script/
│   │   ├── vm-script-executor.adapter.ts  # ✅
│   │   └── index.ts
│   ├── persistence/
│   │   ├── file-system-history-loader.ts  # ✅
│   │   └── index.ts
│   ├── parsers/
│   │   ├── collection-parser.adapter.ts   # ✅
│   │   └── index.ts
│   ├── di/
│   │   ├── infrastructure-di-config.ts    # ✅
│   │   ├── complete-bootstrap.ts          # ✅ 新增
│   │   ├── simple-event-publisher.ts      # ✅
│   │   └── index.ts
│   └── index.ts                           # ✅
│
└── index.ts                     # 公共 API
```

---

## 🎯 关键配置和启动选项

### 启动配置选项

```typescript
bootstrapComplete(container, {
    // 是否使用文件系统（默认生产环境 true，测试环境 false）
    useFileSystem: true,
    
    // 文件系统基础路径
    basePath: '/projects/my-api',
    
    // 平台适配器（可覆盖默认实现）
    adapters: {
        fileSystem: myCustomFileSystem,
        logger: myCustomLogger,
        httpClient: myCustomHttpClient,
        httpExecutor: myCustomHttpExecutor,
        scriptExecutor: myCustomScriptExecutor
    },
    
    // 文件监视工厂（用于自动监听集合/环境文件变化）
    fileWatcherFactory: myFileWatcherFactory
});
```

### 文件变化通知

当提供 `fileWatcherFactory` 时，`CollectionService` 和 `EnvironmentConfigService` 会自动监听文件变化并重新加载数据。
可通过回调接收变化通知：

```typescript
// 集合文件变化通知
(collectionService as CollectionService).onCollectionsChanged = () => {
    console.log('Collections reloaded from disk');
};

// 环境文件变化通知
(envConfigService as EnvironmentConfigService).onEnvironmentsChanged = () => {
    console.log('Environments reloaded from disk');
};
```

### 环境变量支持

```bash
# 使用文件系统存储库
NODE_ENV=production

# HTTP 超时设置
HTTP_TIMEOUT=30000

# 脚本执行超时
SCRIPT_TIMEOUT=5000
```

---

## 📝 典型工作流程

### 场景 1：执行单个请求

```typescript
const container = new ServiceContainer();
bootstrapComplete(container, { useFileSystem: true });

const executeUseCase = container.resolve('ExecuteRequestUseCase');
const result = await executeUseCase.execute({
    collectionId: 'api-v1',
    requestId: 'list-users',
    overrides: { variables: { limit: 10 } }
});

if (result.status === 'success') {
    console.log(`✅ ${result.response.status} ${result.response.statusText}`);
    console.log(`   Duration: ${result.duration}ms`);
} else {
    console.error(`❌ Execution failed: ${result.error}`);
}
```

### 场景 2：加载、编辑、保存集合

```typescript
const loadUseCase = container.resolve('LoadCollectionUseCase');
const saveUseCase = container.resolve('SaveCollectionUseCase');

// 加载
const collection = await loadUseCase.execute('./my-api.json');

// 编辑
collection.items[0].headers['X-API-Key'] = 'new-key';

// 保存
await saveUseCase.execute('./my-api.json', collection);
```

### 场景 3：获取和分析请求模式

```typescript
const schemaQuery = container.resolve('GetRequestSchemaQuery');

// 获取合并后的模式（用户定义 + 历史推断 + 脚本提示）
const schema = await schemaQuery.execute('api-v1', 'get-user');

// 使用模式进行验证/完成等
console.log('Required properties:', schema.required);
console.log('Available properties:', Object.keys(schema.properties || {}));
```

---

## 🧪 测试支持

### 使用内存存储库进行测试

```typescript
import { ServiceContainer } from '@http-forge/core/di';
import { bootstrapComplete } from '@http-forge/core/infrastructure/di';
import { InMemoryRequestRepository } from '@http-forge/core/infrastructure';

const container = new ServiceContainer();
bootstrapComplete(container, {
    useFileSystem: false  // 使用内存实现
});

// 或手动设置测试数据
const repo = container.resolve<InMemoryRequestRepository>('IRequestRepository');
repo.addRequests(testRequest);
```

### 模拟 HTTP 响应

```typescript
import { IHttpExecutor } from '@http-forge/core/ports';

class MockHttpExecutor implements IHttpExecutor {
    async prepare(plan) { /* ... */ }
    async execute(prepared) {
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            body: JSON.stringify({ id: 1, name: 'Test' })
        };
    }
}

container.registerSingleton('IHttpExecutor', () => new MockHttpExecutor());
```

---

## 🔄 迁移现有代码

### 第一步：注册现有的 HTTP 和脚本执行器

```typescript
import { NodeHttpClient } from '@http-forge/core/http';
import { ScriptExecutor } from '@http-forge/core/script';

// 包装现有的执行器
const httpExecutor = new NodeHttpExecutorAdapter(
    new InterceptorChain(),
    cookieJar
);

const scriptExecutor = new VmScriptExecutorAdapter(
    new ScriptExecutor(moduleLoader, sandboxFactory)
);

// 注册到容器
container.registerSingleton('IHttpExecutor', () => httpExecutor);
container.registerSingleton('IScriptExecutor', () => scriptExecutor);
```

### 第二步：使用新的用例替换旧代码

```typescript
// ❌ 旧方式
const result = await oldRequestExecutor.executeRequest(request, collection);

// ✅ 新方式
const executeUseCase = container.resolve('ExecuteRequestUseCase');
const result = await executeUseCase.execute({
    collectionId: collection.id,
    requestId: request.id
});
```

---

## 📈 性能特性

- **零内存泄漏** - 所有资源通过容器管理
- **懒加载** - 服务只在需要时创建
- **缓存友好** - 单例注册大多数服务
- **可测试** - 所有依赖可注入

---

## 🚨 常见问题

### Q: 如何添加自己的实现？
A: 实现对应的接口并注册到容器：
```typescript
export class MyCustomRepository implements IRequestRepository { /*...*/ }
container.registerSingleton('IRequestRepository', () => new MyCustomRepository());
```

### Q: 如何处理执行错误？
A: 捕获异常或检查结果状态：
```typescript
try {
    const result = await executeUseCase.execute(options);
    if (result.status === 'failed') {
        console.error(result.error);
    }
} catch (error) {
    console.error('Execution error:', error);
}
```

### Q: 如何监听执行事件？
A: 订阅事件发布器：
```typescript
const eventPublisher = container.resolve<IDomainEventPublisher>('IDomainEventPublisher');
eventPublisher.subscribe('REQUEST_EXECUTED', async (event) => {
    console.log('Request executed:', event.aggregateId);
});
```

---

## 📚 下一步计划

- [ ] 运行测试套件用例
- [ ] 导出 OpenAPI 用例
- [ ] GraphQL 查询支持
- [ ] 云存储存储库
- [ ] 完整的错误恢复

---

**版本**: 1.0.0 Beta  
**最后更新**: 2026-03-16
