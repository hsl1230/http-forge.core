> **Archived / Historical.** Superseded by `docs/api/core-reference.md`.

# 🎯 快速参考 - @http-forge/core 三层架构

> ## ⚠️ 状态 / Status（历史文档 · Historical）
>
> 本文档描述的是 **已被删除的旧三层架构**（Domain / Application / Ports / `bootstrapComplete`）。
> `src/application/`、`src/domain/`、`src/infrastructure/di/complete-bootstrap.ts`、
> `ExecuteRequestUseCase`、`container.resolve('UseCase')` 等路径与 API **在当前代码库中已不存在**
> （2026-08 重构，见 `docs/archive/PHASE3_DELETION_LOG.md` 与 `docs/developer/IMPLEMENTATION_STATUS.md`）。
> 文中所有示例代码**无法运行**，本文档仅作历史参考保留。
>
> **当前平台（@http-forge/core `0.6.36-beta.1`）的真实入口：**
> - 主入口：`ForgeContainer` —— `import { ForgeContainer } from '@http-forge/core'`
> - Node 引导：`createNodeContainer(workspaceFolder)`
> - 运行时 API：`runRequest` / `runCollection` / `runSuite` / `createMcpRuntime`
> - MCP：`dispatchGenericTool` + per-tool 注册表（`src/runtime/mcp-handlers/`）、`buildGenericTools()` 60+ 工具
> - API 发现：`ApiDiscoveryService`（Express/Nest/Fastify/Lambda/Spring/FastAPI 六 provider）、
>   `discoverWorkflows`、drift engine（`computeProjectFreshness`/`proposeSuiteUpdates`）、`ApiArchitectService`
> - AI 上下文：`src/infrastructure/ai/ai-context.ts` + `.http-forge/knowledge/**/*.md` 约定
>
> 最新参考请阅读：`docs/api/core-reference.md`、`RUNTIME-API.md`、`docs/developer/MCP_MANAGEMENT_TOOLS.md`。

## 速查表

### 🔹 我需要...

#### 执行一个请求？
```typescript
const useCase = container.resolve('ExecuteRequestUseCase');
const result = await useCase.execute({ collectionId, requestId });
```
📍 文件: `src/application/use-cases/execute-request.use-case.ts`  
⏱️ 时间: 10 步流程  
📊 返回: `ExecutionResult` (响应 + 断言 + 变量)

---

#### 加载集合 (HTTP/JSON/等)?
```typescript
const useCase = container.resolve('LoadCollectionUseCase');
const collection = await useCase.execute(filePath);
```
📍 文件: `src/application/use-cases/load-collection.use-case.ts`  
📂 支持: `.http`, `.json`, `.postman`  
🔧 自动检测格式

---

#### 获取响应模式 (Schema)?
```typescript
const query = container.resolve('GetRequestSchemaQuery');
const schema = await query.execute(collectionId, requestId);
```
📍 文件: `src/application/queries/get-request-schema.query.ts`  
🔍 合并来源: 用户定义 + 历史推断 + 脚本提示  
✅ 自动验证模式

---

#### 保存集合到磁盘?
```typescript
const useCase = container.resolve('SaveCollectionUseCase');
await useCase.execute(filePath, collection);
```
📍 文件: `src/application/use-cases/save-collection.use-case.ts`  
🎯 格式: JSON  
✅ 自动创建目录

---

#### 监听请求执行完成?
```typescript
eventPublisher.subscribe('REQUEST_EXECUTED', (event) => {
    console.log('Executed:', event.aggregateId);
});
```
📍 类型: `RequestExecutedEvent`  
📍 发布者: `src/infrastructure/di/simple-event-publisher.ts`  
🎯 其他事件: `REQUEST_EXECUTION_FAILED`, `VARIABLE_UPDATED`, `COOKIE_UPDATED`

---

#### 访问执行历史?
```typescript
const loader = container.resolve('IHistoryLoader');
const entries = await loader.loadHistory(collectionId, requestId, { limit: 100 });
const response = await loader.loadFullResponse(entryId);
```
📍 接口: `src/ports/storage/history-loader.interface.ts`  
💾 实现: `src/infrastructure/persistence/file-system-history-loader.ts`  
📝 存储: JSON + manifest

---

#### 添加自定义变量?
```typescript
const context = executionContext;
context.variables['MY_VAR'] = 'value';
// 在脚本中: pm.environment.set('MY_VAR', 'value');
```
📍 类型: `IExecutionContext`  
🔗 脚本绑定: `VmScriptExecutorAdapter`  
📍 文件: `src/infrastructure/script/vm-script-executor.adapter.ts`

---

#### 使用内存存储库进行测试?
```typescript
bootstrapComplete(container, { useFileSystem: false });
// 默认使用内存实现
```
📍 内存: `src/infrastructure/repositories/in-memory/*`  
✅ 零磁盘操作  
🧪 完美用于单元测试

---

#### 使用文件系统持久化?
```typescript
bootstrapComplete(container, { 
    useFileSystem: true,
    basePath: './projects' 
});
```
📍 实现: `src/infrastructure/repositories/file-system/*`  
📂 目录: 自动创建  
💾 格式: JSON

---

#### 自定义HTTP执行器?
```typescript
class MyHttpExecutor implements IHttpExecutor {
    async prepare(plan) { /* ... */ }
    async execute(prepared) { /* ... */ }
}

bootstrapComplete(container, {
    adapters: { httpExecutor: new MyHttpExecutor() }
});
```
📍 接口: `src/ports/executors/http-executor.interface.ts`  
🔧 注入: `complete-bootstrap.ts`  
⚡ 立即生效

---

#### 自定义脚本执行器?
```typescript
class MyScriptExecutor implements IScriptExecutor {
    async executePreRequest(session, script) { /* ... */ }
    async executePostResponse(session, script, response) { /* ... */ }
}
```
📍 接口: `src/ports/executors/script-executor.interface.ts`  
💻 使用场景: 其他语言/运行时  
🎯 替换实现: `complete-bootstrap.ts`

---

#### 创建新的用例?
```typescript
// 1. 创建文件: src/application/use-cases/my-feature.use-case.ts
export class MyFeatureUseCase {
    constructor(private repo: IRepository, private service: MyService) {}
    async execute(input) {
        // pure business logic
    }
}

// 2. 在 complete-bootstrap.ts 中注册
container.register('MyFeatureUseCase', () => 
    new MyFeatureUseCase(
        container.resolve('IRepository'),
        container.resolve('MyService')
    )
);
```
📍 模式: 用例模式  
🏗️ 模板: `src/application/use-cases/execute-request.use-case.ts`  
⭐ 依赖注入: 构造函数注入

---

#### 创建新的存储库?
```typescript
export class MyStorageRepository implements IRequestRepository {
    async findById(collectionId, requestId) { /* ... */ }
    async save(collectionId, request) { /* ... */ }
    // 实现所有接口方法
}
```
📍 接口: `src/ports/repositories/request-repository.interface.ts`  
📂 位置: `src/infrastructure/repositories/{provider}/`  
🔌 注入: 通过构造函数或选项

---

#### 实现新的适配器?
```typescript
export class MyAdapter implements IExternal {
    // 实现接口方法
}

// 选项1: 通过 complete-bootstrap
bootstrapComplete(container, {
    adapters: { myAdapter: new MyAdapter() }
});

// 选项2: 直接在容器中注册
container.register('IExternal', () => new MyAdapter());
```
📍 位置: `src/infrastructure/adapters/`  
🔌 模式: 适配器模式  
🎯 隔离: 零域层耦合

---

#### 调试执行流程?
```typescript
// 启用调试日志
const logger = container.resolve('ILogger');
logger.debug('Message', { data });

// 步进执行
const plan = executionPlannerService.createExecutionPlan(request, context);
console.log('Plan:', plan);

// 查看结果
console.log('HttpResponse:', result.httpResponse);
console.log('Assertions:', result.assertions);
console.log('Variables:', result.scriptResults.variables);
```
📍 Logger: `src/infrastructure/adapters/logger.adapter.ts`  
🔍 检查点: 每个用例步骤  
📊 结果类型: `ExecutionResult`

---

## 📁 路由表

### 入口点
- 启动: `src/infrastructure/di/complete-bootstrap.ts`
- 主容器: `src/index.ts` (导出所有模块)

### 核心业务
- 执行: `src/application/use-cases/execute-request.use-case.ts`
- 规划: `src/domain/services/execution-planner.domain-service.ts`
- 模式: `src/domain/services/schema-inference.domain-service.ts`

### 数据访问
- 请求: `src/infrastructure/repositories/*/request-repository`
- 环境: `src/infrastructure/repositories/*/environment-repository`
- 历史: `src/infrastructure/persistence/file-system-history-loader.ts`

### 执行
- HTTP: `src/infrastructure/http/node-http-executor.adapter.ts`
- 脚本: `src/infrastructure/script/vm-script-executor.adapter.ts`

### 工具
- 解析: `src/infrastructure/parsers/collection-parser.adapter.ts`
- 事件: `src/infrastructure/di/simple-event-publisher.ts`
- DI: `src/infrastructure/di/`

---

## 🔧 常见问题

| 问题 | 答案 |
|------|------|
| 如何添加日志? | `const logger = container.resolve('ILogger'); logger.info(msg);` |
| 如何改变存储? | `bootstrapComplete(container, { useFileSystem: true/false })` |
| 如何测试? | 使用内存存储库 + Mock 执行器 |
| 如何扩展? | 实现接口 + 通过 DI 注册 |
| 如何调试? | 设置断点 + 查看 ExecutionResult |
| 如何监听事件? | `eventPublisher.subscribe(eventType, handler)` |
| 如何监听文件变化? | 传入 `fileWatcherFactory`，设置 `onCollectionsChanged` / `onEnvironmentsChanged` 回调 |
| 如何持久化? | `useFileSystem: true` + 使用文件系统存储库 |
| 如何并行执行? | 创建多个用例实例 (transient) |

---

## 🎛️ 配置参考

### bootstrapComplete 选项

```typescript
interface FullBootstrapOptions {
    // 使用文件系统存储库 (true) 还是内存 (false)
    useFileSystem?: boolean;
    
    // 文件系统基础路径（useFileSystem=true时）
    basePath?: string;
    
    // 自定义适配器实现
    adapters?: {
        fileSystem?: IFileSystem;
        httpClient?: IHttpClient;
        logger?: ILogger;
        httpExecutor?: IHttpExecutor;
        scriptExecutor?: IScriptExecutor;
        eventPublisher?: IDomainEventPublisher;
    };
    
    // 文件监视工厂（监听集合/环境文件变化）
    fileWatcherFactory?: IFileWatcherFactory;
}
```

### 默认值
- `useFileSystem`: `true` (生产环境)
- `basePath`: `./data` (相对路径)
- `adapters`: 使用默认实现

---

## 🏗️ 架构类型

| 组件 | 类型 | 生命周期 |
|------|------|---------|
| 用例 | Class | Transient (每次新建) |
| 域服务 | Class | Singleton (共享) |
| 存储库 | Interface → Impl | Singleton |
| 执行器 | Interface → Impl | Singleton |
| Logger | Interface → Impl | Singleton |
| EventPublisher | Interface → Impl | Singleton |

---

## 📊 执行流程

```
executeUseCase.execute(input)
    ↓
[1] Load Request from Repository
    ↓
[2] Load Environment from Repository
    ↓
[3] Prepare ExecutionContext
    ↓
[4] ExecutionPlannerDomainService.createExecutionPlan()
    ↓
[5] ScriptExecutor.executePreRequest()
    ↓
[6] Prepare HTTP (interpolate, add cookies)
    ↓
[7] HttpExecutor.execute()
    ↓
[8] ScriptExecutor.executePostResponse()
    ↓
[9] Build ExecutionResult
    ↓
[10] EventPublisher.publish(RequestExecutedEvent)
    ↓
Return ExecutionResult
```

---

## 🧪 测试模板

```typescript
describe('MyFeature', () => {
    let container: IServiceContainer;
    
    beforeEach(() => {
        container = new ServiceContainer();
        bootstrapComplete(container, { useFileSystem: false });
    });
    
    it('should execute request', async () => {
        const useCase = container.resolve('ExecuteRequestUseCase');
        const result = await useCase.execute({
            collectionId: 'test',
            requestId: 'req1'
        });
        
        expect(result.httpResponse.statusCode).toBe(200);
        expect(result.assertions).toHaveLength(2);
    });
});
```

📍 使用内存存储库  
✅ 零磁盘操作  
🧪 快速执行

---

## 📞 快速帮助

```
文件找不到?
→ 使用 semantic_search 或 grep_search

不知道如何实现?
→ 查看相同接口的其他实现

需要调试?
→ 在用例、适配器、域服务中设置正确的验证点

性能问题?
→ 检查单例/瞬态配置
→ 查看内存中的缓存

类型错误?
→ 检查接口实现是否完整
→ 验证构造函数参数类型
```

---

**快速参考 v1.0**  
**最后更新**: 2026-03-16（⚠️ 该架构已过时，见文首状态说明；当前请参考 `docs/api/core-reference.md`）
**下一步**: 查看 [USAGE_GUIDE.md](./USAGE_GUIDE.md) 获取完整示例
