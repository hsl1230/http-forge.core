# @http-forge/core 架构分析与模块化重构方案

> ## ⚠️ 状态 / Status（历史规划文档 · Historical planning）
>
> 本文档是 **2026-03** 的架构分析与三层重构提案，描述的是**当时**的混合架构与目标设计。
> 文中提议的三层架构（Domain / Application / Ports 用例、`bootstrapComplete` 等）**最终未保留**：
> 2026-08 重构收敛为 `src/infrastructure/*` 单一实现层 + `src/runtime/`（MCP 运行时），并保持
> `ForgeContainer` 作为公共入口，同时按 SOLID 拆分了 MCP 调度器（~2,270 行 god-function → per-tool
> 注册表 `src/runtime/mcp-handlers/`）与 OpenAPI 导出器（见 `docs/developer/IMPLEMENTATION_STATUS.md`）。
> 文中建议的目录结构与代码示例**已不存在**，仅作历史规划参考。
>
> 当前架构的真实说明见 `docs/api/core-reference.md` 与 `../api/RUNTIME-API.md`。

## 📊 当前架构分析

### 现状：六边形架构（Hexagonal Architecture）

当前项目采用了**部分六边形架构**，但实现不完整：

```
┌─────────────────────────────────────────────┐
│           业务逻辑层（Domain）              │
│  ┌──────────────┬──────────────────────┐   │
│  │ Collection   │ Execution            │   │
│  │ TestSuite    │ Environment          │   │
│  │ OpenAPI      │ GraphQL              │   │
│  └──────────────┴──────────────────────┘   │
├─────────────────────────────────────────────┤
│         端口层（Interfaces/Ports）          │
│  ┌──────────────┬──────────────────────┐   │
│  │ Service I/F  │ Platform I/F         │   │
│  │ Repository   │ HTTP Client I/F      │   │
│  └──────────────┴──────────────────────┘   │
├─────────────────────────────────────────────┤
│      基础设施适配器层（Adapters）           │
│  ┌──────────────┬──────────────────────┐   │
│  │ NodeHttpClient│ CookieService       │   │
│  │ FileSystem   │ Collection Storage   │   │
│  └──────────────┴──────────────────────┘   │
├─────────────────────────────────────────────┤
│      依赖注入容器（DI Container）           │
│  ┌──────────────────────────────────────┐  │
│  │ ServiceContainer + registerCoreServices│ │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

---

## 🚨 识别出的反模式与耦合点

### 1. **循环依赖陷阱**

```typescript
// filepath: src/openapi/schema-inference-service.ts - 线路图
// HistoryAnalyzer → IRequestHistoryService → Collection?
// SchemaInferenceService → HistoryAnalyzer → Collection
// Collection → OpenAPI? (导出)
```

**问题**：若 Collection 服务依赖 OpenAPI 导出，而 OpenAPI 依赖 Collection 读取，形成循环。

**现象**：
- `HistoryAnalyzer` 依赖 `IRequestHistoryService`
- `IRequestHistoryService` 由 `RequestHistoryService` 实现，跨域依赖

---

### 2. **基础设施泄漏到业务逻辑**

```typescript
// ❌ 反模式例子
// filepath: src/collection/collection-service.ts
export class CollectionService implements ICollectionService {
    constructor(
        private workspaceFolder: string,  // 基础设施细节！
        private configService: IConfigService,
        private fileWatcherFactory: IFileWatcherFactory  // 平台特定
    ) {}
    
    // 直接通过 fs/path 操作
    async saveRequest(req: CollectionRequestItem): Promise<void> {
        const filePath = path.join(this.workspaceFolder, 'collections', req.id);
        // writeSync 混杂在业务逻辑中
    }
}
```

**影响**：
- 无法测试不涉及文件系统的逻辑
- 平台切换需修改多处代码
- 业务规则与持久化策略耦合

---

### 3. **多层次的服务聚合**

```typescript
// 现状：多个聚合器重复相同职责

// 1. ForgeContainer（容器）
// 2. ServiceContainer（DI）
// 3. registerCoreServices（引导）
// 4. CollectionService（聚合所有集合操作）
// 5. SchemaInferenceService（聚合多个分析器）

// 结果：职责不清
```

---

### 4. **接口粒度不一致**

```typescript
// ✅ 细粒度（好）
export interface ICookieReader { get(name): Cookie; }
export interface ICookieWriter { set(cookie): void; }

// ❌ 粗粒度（坏）
export interface ICollectionService 
    extends ICollectionReader,
            ICollectionWriter,
            IRequestManager,
            IFolderManager,
            ICollectionVariableManager,
            ICollectionImportExport {}

// 接口 God Object，25+ 个方法！
```

---

### 5. **隐含的执行边界不清**

```typescript
// 执行路径分散：
// RequestExecutor → HttpRequestService → NodeHttpClient
// CollectionRequestExecutor → RequestPreparer → ScriptExecutor
// TestSuiteService → StatisticsService → RequestExecutor???

// 无单一控制流
```

---

### 6. **数据流向不明确**

```typescript
// ScriptExecutor 中的混乱
// source: string → VM → Result
// 但中间还要处理：
// - Cookie State
// - Environment Variables  
// - Module Resolution
// - Error Context

// 没有统一的 Context 对象
```

---

## 🏗️ 推荐的三层模块化架构

### **第一层：领域层（Domain）**

清晰的业务模型，零基础设施依赖：

```typescript
// filepath: src/domain/models/collection.ts
/**
 * 核心领域模型 - 完全独立
 * 不依赖任何外层
 */

/** 集合核心模型 */
export interface ICollection {
    id: string;
    name: string;
    items: ICollectionItem[];
    variables: IVariable[];
}

/** 请求核心模型 */
export interface IRequest {
    id: string;
    name: string;
    method: HttpMethod;
    url: string;
    headers: Record<string, string>;
    body?: IRequestBody;
    scripts?: IRequestScripts;
}

/** 测试套件核心模型 */
export interface ITestSuite {
    id: string;
    name: string;
    requests: ISuiteRequest[];
    config: ISuiteConfig;
}

// filepath: src/domain/services/schema-inference-domain-service.ts
/**
 * 纯业务逻辑 - 独立于存储、HTTP、脚本执行
 */
export interface ISchemaInferenceDomainService {
    /**
     * 从多个来源合并响应模式
     * - 不调用 vs code API
     * - 不执行文件 I/O
     * - 不调用 HTTP
     */
    mergeResponseSchemas(
        userEdited: ResponseSchema,
        historyInferred: ResponseSchema,
        scriptHints: ScriptHints
    ): ResponseSchema;

    validateSchema(schema: JSONSchema7): ValidationResult;
}

// filepath: src/domain/services/execution-domain-service.ts
/**
 * 执行流程纯逻辑
 */
export interface IExecutionDomainService {
    /**
     * 编排执行流程（不执行，只编排）
     */
    planRequestExecution(
        request: IRequest,
        context: ExecutionContext
    ): ExecutionPlan;

    /**
     * 将原始结果转换为领域模型
     */
    processExecutionResult(
        rawResponse: RawHttpResponse,
        executionContext: ExecutionContext
    ): ExecutionResult;
}

// filepath: src/domain/errors/domain-errors.ts
/** 使用特定的业务异常 */
export class CollectionNotFoundError extends DomainError {
    constructor(public collectionId: string) {
        super(`Collection ${collectionId} not found`);
    }
}

export class InvalidRequestError extends DomainError {
    constructor(public requestId: string, public reason: string) {
        super(`Request ${requestId} is invalid: ${reason}`);
    }
}
```

**特性**：
- ✅ 零外部依赖（除了共享的类型）
- ✅ 纯函数或确定性方法
- ✅ 易于单元测试（无 mock）
- ✅ 团队协作清晰（业务规则集中地）

---

### **第二层：应用层（Application）**

协调业务逻辑与基础设施：

```typescript
// filepath: src/application/use-cases/execute-request.use-case.ts
/**
 * 用例：执行请求
 * 职责：
 * 1. 装载 request 从存储
 * 2. 准备执行环境
 * 3. 调用 domain 编排
 * 4. 调用 infrastructure 执行
 * 5. 处理结果 & 副作用
 */

export class ExecuteRequestUseCase {
    constructor(
        // 基础设施（存储）
        private requestRepository: IRequestRepository,
        private environmentRepository: IEnvironmentRepository,
        // 基础设施（执行）
        private httpExecutor: IHttpExecutor,
        private scriptExecutor: IScriptExecutor,
        // 领域服务
        private executionPlanner: IExecutionDomainService,
        // 应用服务
        private logger: ILogger
    ) {}

    async execute(
        collectionId: string,
        requestId: string,
        overrides?: ExecutionOverrides
    ): Promise<ExecutionResult> {
        try {
            // 1️⃣ 装载
            const request = await this.requestRepository.findById(requestId);
            if (!request) {
                throw new CollectionNotFoundError(collectionId);
            }

            const environment = await this.environmentRepository.findActive();

            // 2️⃣ 准备
            const context: ExecutionContext = {
                request,
                environment,
                overrides,
                variables: this.prepareVariables(environment)
            };

            // 3️⃣ 编排（domain 逻辑）
            const plan = this.executionPlanner.planRequestExecution(request, context);
            this.logger.debug('Execution plan', { plan });

            // 4️⃣ 执行
            const preparedRequest = await this.httpExecutor.prepare(plan);
            const rawResponse = await this.httpExecutor.execute(preparedRequest);

            // 5️⃣ 处理结果
            const result = this.executionPlanner.processExecutionResult(
                rawResponse,
                context
            );

            // 6️⃣ 副作用：更新历史、变量等
            await this.updateHistoryAfterExecution(result);
            await this.updateVariablesFromResponse(result);

            return result;

        } catch (error) {
            this.logger.error('Execution failed', { error });
            throw this.mapErrorToUserFriendly(error);
        }
    }

    // 辅助方法
    private prepareVariables(env: Environment): Record<string, any> { /*...*/ }
    private async updateHistoryAfterExecution(result: ExecutionResult): Promise<void> { /*...*/ }
    private async updateVariablesFromResponse(result: ExecutionResult): Promise<void> { /*...*/ }
    private mapErrorToUserFriendly(error: Error) { /*...*/ }
}

// filepath: src/application/queries/get-request-schema.query.ts
/**
 * 查询：获取请求模式
 */
export class GetRequestSchemaQuery {
    constructor(
        private requestRepository: IRequestRepository,
        private schemaInferenceService: ISchemaInferenceDomainService,
        private historyLoader: IHistoryLoader,
        private scriptAnalyzer: IScriptAnalyzer
    ) {}

    async execute(
        collectionId: string,
        requestId: string
    ): Promise<ResponseSchema> {
        const request = await this.requestRepository.findById(requestId);
        const history = await this.historyLoader.loadHistory(collectionId, requestId);
        const userSchema = request.responseSchema;
        const scriptHints = this.scriptAnalyzer.analyze(request.scripts?.postResponse);

        // 调用 domain 逻辑
        return this.schemaInferenceService.mergeResponseSchemas(
            userSchema,
            this.inferFromHistory(history),
            scriptHints
        );
    }

    private inferFromHistory(history: HistoryEntry[]): ResponseSchema { /*...*/ }
}

// filepath: src/application/events/domain-event.ts
/**
 * 领域事件 - 应用层可以发出，基础设施层可以监听
 * （而不是直接依赖）
 */
export class RequestExecutedEvent {
    constructor(
        public readonly aggregateId: string,  // requestId
        public readonly collectionId: string,
        public readonly result: ExecutionResult,
        public readonly timestamp: Date = new Date()
    ) {}
}

export interface IDomainEventPublisher {
    publish(event: RequestExecutedEvent): Promise<void>;
}
```

**特性**：
- ✅ 高内聚：每个用例/查询一个文件
- ✅ 依赖外向：依赖 abstract 的 Repository/Executor
- ✅ 业务驱动：从用例名字理解功能
- ✅ 事件发出：支持 event sourcing 扩展

---

### **第三层：基础设施层（Infrastructure）**

实现具体技术细节：

```typescript
// filepath: src/infrastructure/repositories/request-collection-repository.ts
/**
 * 集合 Repository 实现
 * 隐藏存储细节（文件系统、数据库、云存储）
 */

export interface IRequestRepository {
    findById(id: string): Promise<IRequest | null>;
    findAll(collectionId: string): Promise<IRequest[]>;
    save(request: IRequest): Promise<void>;
    delete(id: string): Promise<void>;
}

export class FileSystemRequestRepository implements IRequestRepository {
    constructor(
        private fileSystem: IFileSystem,
        private collectionPath: string,
        private parser: IRequestParser
    ) {}

    async findById(id: string): Promise<IRequest | null> {
        const filePath = this.buildFilePath(id);
        if (!await this.fileSystem.exists(filePath)) {
            return null;
        }
        const content = await this.fileSystem.readFile(filePath);
        return this.parser.parse(content);
    }

    async save(request: IRequest): Promise<void> {
        const filePath = this.buildFilePath(request.id);
        const content = this.parser.stringify(request);
        await this.fileSystem.writeFile(filePath, content);
    }

    private buildFilePath(id: string): string {
        // 隐藏路径构造逻辑
        return path.join(this.collectionPath, 'requests', `${id}.json`);
    }
}

// ↓ 替代实现，无需改变应用层
export class InMemoryRequestRepository implements IRequestRepository {
    constructor(private requests = new Map<string, IRequest>()) {}
    async findById(id: string): Promise<IRequest | null> { /*...*/ }
    async save(request: IRequest): Promise<void> { /*...*/ }
}

// filepath: src/infrastructure/http/node-http-executor.ts
/**
 * HTTP 执行器 - 实现 HTTP 具体细节
 */

export interface IHttpExecutor {
    prepare(plan: ExecutionPlan): Promise<PreparedRequest>;
    execute(prepared: PreparedRequest): Promise<RawHttpResponse>;
}

export class NodeHttpExecutor implements IHttpExecutor {
    constructor(
        private httpClient: IHttpClient,
        private interceptorChain: IInterceptorChain,
        private cookieJar: ICookieJar
    ) {}

    async execute(prepared: PreparedRequest): Promise<RawHttpResponse> {
        // 1. 运行 request 拦截器
        let request = prepared.request;
        request = await this.interceptorChain.executeRequestInterceptors(request);

        // 2. 添加 Cookie
        const cookieHeader = this.cookieJar.getCookieHeader(request.url);
        if (cookieHeader) {
            request.headers['Cookie'] = cookieHeader;
        }

        // 3. 执行 HTTP
        let response = await this.httpClient.execute(request);

        // 4. 运行 response 拦截器
        response = await this.interceptorChain.executeResponseInterceptors(response);

        // 5. 保存 Cookie
        this.cookieJar.setCookiesFromResponse(request.url, response.headers);

        return response;
    }
}

// filepath: src/infrastructure/script/request-script-executor.ts
/**
 * 脚本执行器 - 隐藏 VM 细节
 */

export interface IScriptExecutor {
    executePreRequest(session: IScriptSession, script: string): Promise<ScriptResult>;
    executePostResponse(session: IScriptSession, script: string, response: IHttpResponse): Promise<ScriptResult>;
}

export class VmScriptExecutor implements IScriptExecutor {
    constructor(
        private moduleLoader: IModuleLoader,
        private sandbox: ISandboxFactory
    ) {}

    async executePreRequest(session: IScriptSession, script: string): Promise<ScriptResult> {
        const context = this.sandbox.createPreRequestContext(session);
        // ... VM 执行
    }
}

// filepath: src/infrastructure/persistence/history-storage.ts
/**
 * 历史存储 - 可扩展到云存储
 */

export interface IHistoryLoader {
    loadHistory(collectionId: string, requestId: string): Promise<HistoryEntry[]>;
    loadFullResponse(collectionId: string, requestId: string, entryId: string): Promise<FullResponse | null>;
}

export class FileSystemHistoryLoader implements IHistoryLoader {
    constructor(
        private fileSystem: IFileSystem,
        private historyPath: string
    ) {}

    async loadHistory(collectionId: string, requestId: string): Promise<HistoryEntry[]> {
        const dir = path.join(
            this.historyPath,
            collectionId,
            requestId
        );
        if (!await this.fileSystem.exists(dir)) {
            return [];
        }
        // 读取目录中的 manifest, 分页加载
        // ...
    }
}

// filepath: src/infrastructure/factories/executor-factory.ts
/**
 * 工厂模式：创建执行管道
 */

export class ExecutorFactory {
    static createHttpExecutor(config: HttpConfig): IHttpExecutor {
        const client = config.useFetch 
            ? new FetchHttpClient() 
            : new NodeHttpClient();
        const chain = new InterceptorChain();
        const jar = new PersistentCookieJar(cookieStore);
        
        return new NodeHttpExecutor(client, chain, jar);
    }

    static createScriptExecutor(config: ScriptConfig): IScriptExecutor {
        const loader = new ModuleLoader(config.modulePaths);
        const sandbox = new NodeSandboxFactory(loader);
        
        return new VmScriptExecutor(loader, sandbox);
    }
}

// filepath: src/infrastructure/di/application-di-config.ts
/**
 * DI 配置：连接所有层
 */

export function registerApplicationServices(
    container: ServiceContainer,
    adapters: PlatformAdapters
): void {
    // ===== 基础设施层 =====
    
    // Repository
    container.registerSingleton<IRequestRepository>(
        'RequestRepository',
        () => new FileSystemRequestRepository(
            adapters.fileSystem,
            adapters.config.getCollectionsPath(),
            new RequestJsonParser()
        )
    );

    // Executor
    container.registerSingleton<IHttpExecutor>(
        'HttpExecutor',
        () => ExecutorFactory.createHttpExecutor(adapters.config.getRequestConfig())
    );

    // ===== 应用层 =====

    // Use Cases
    container.registerTransient<ExecuteRequestUseCase>(
        'ExecuteRequestUseCase',
        (c) => new ExecuteRequestUseCase(
            c.resolve<IRequestRepository>('RequestRepository'),
            c.resolve<IEnvironmentRepository>('EnvironmentRepository'),
            c.resolve<IHttpExecutor>('HttpExecutor'),
            c.resolve<IScriptExecutor>('ScriptExecutor'),
            c.resolve<IExecutionDomainService>('ExecutionDomainService'),
            adapters.logger
        )
    );

    // ===== 领域层 =====

    container.registerSingleton<IExecutionDomainService>(
        'ExecutionDomainService',
        () => new ExecutionDomainService()
    );

    container.registerSingleton<ISchemaInferenceDomainService>(
        'SchemaInferenceDomainService',
        () => new SchemaInferenceDomainService()
    );
}
```

---

## 📂 推荐的目录结构

```
src/
├── domain/                              # 领域层（业务规则）
│   ├── models/
│   │   ├── collection.ts               # 集合模型
│   │   ├── request.ts                  # 请求模型
│   │   ├── test-suite.ts               # 测试套件模型
│   │   └── execution.ts                # 执行模型
│   ├── services/
│   │   ├── execution-planner.ts        # 执行计划（纯函数）
│   │   ├── schema-inference.ts         # 模式推断（纯函数）
│   │   └── validation-service.ts       # 验证（纯函数）
│   ├── errors/
│   │   └── domain-errors.ts            # 业务异常
│   └── value-objects/
│       ├── http-method.ts
│       ├── url.ts
│       └── variables.ts
│
├── application/                         # 应用层（编排）
│   ├── use-cases/
│   │   ├── execute-request.use-case.ts
│   │   ├── create-request.use-case.ts
│   │   ├── run-test-suite.use-case.ts
│   │   └── export-openapi.use-case.ts
│   ├── queries/
│   │   ├── get-request-schema.query.ts
│   │   ├── list-collections.query.ts
│   │   └── get-execution-history.query.ts
│   ├── dto/                            # 数据传输对象
│   │   ├── execute-request.dto.ts
│   │   └── create-request.dto.ts
│   ├── events/
│   │   ├── domain-event.ts             # 事件基类
│   │   └── request-executed.event.ts   # 具体事件
│   └── mappers/
│       ├── request.mapper.ts           # Entity ↔ DTO 转换
│       └── execution-result.mapper.ts
│
├── infrastructure/                      # 基础设施层（实现）
│   ├── repositories/
│   │   ├── file-system/
│   │   │   ├── fs-request-repository.ts
│   │   │   ├── fs-collection-repository.ts
│   │   │   └── fs-environment-repository.ts
│   │   ├── in-memory/
│   │   │   ├── in-memory-request-repository.ts
│   │   │   └── [...in-memory implementations...]
│   │   └── cloud/                      # 可选：云存储实现
│   ├── http/
│   │   ├── node-http-executor.ts
│   │   ├── fetch-http-executor.ts
│   │   └── http-interceptors/
│   │       ├── logging-interceptor.ts
│   │       ├── retry-interceptor.ts
│   │       └── timing-interceptor.ts
│   ├── script/
│   │   ├── vm-script-executor.ts
│   │   ├── script-sandbox.ts
│   │   ├── modules/
│   │   │   ├── crypto-module.ts
│   │   │   ├── lodash-module.ts
│   │   │   └── moment-module.ts
│   │   └── context/
│   │       ├── pre-request-context.ts
│   │       └── post-response-context.ts
│   ├── persistence/
│   │   ├── history-storage.ts
│   │   ├── result-storage.ts
│   │   └── cache/
│   │       └── graphql-schema-cache.ts
│   ├── parsers/
│   │   ├── collection-parsers/
│   │   │   ├── http-forge-parser.ts
│   │   │   ├── postman-parser.ts
│   │   │   └── openapi-parser.ts
│   │   └── request-parser.ts
│   ├── di/
│   │   ├── infrastructure-di-config.ts
│   │   └── executor-factory.ts
│   └── adapters/
│       ├── console-adapter.ts
│       ├── file-system-adapter.ts
│       └── secret-store-adapter.ts
│
├── ports/                               # 端口（抽象接口）
│   ├── repositories/
│   │   ├── request-repository.interface.ts
│   │   ├── collection-repository.interface.ts
│   │   └── environment-repository.interface.ts
│   ├── executors/
│   │   ├── http-executor.interface.ts
│   │   ├── script-executor.interface.ts
│   │   └── interceptor.interface.ts
│   ├── storage/
│   │   ├── history-loader.interface.ts
│   │   └── cache-store.interface.ts
│   ├── parsers/
│   │   └── collection-parser.interface.ts
│   └── external/
│       ├── file-system.interface.ts
│       ├── http-client.interface.ts
│       └── logger.interface.ts
│
├── di/                                  # DI 容器
│   ├── service-container.ts
│   ├── core-bootstrap.ts               # 重命名：registerCoreServices
│   ├── application-bootstrap.ts        # 新增：registerApplicationServices
│   └── service-identifiers.ts
│
├── container.ts                         # 公共 API（Facade）
├── index.ts                             # 导出点
└── types/                               # 共享类型
    ├── http-types.ts
    ├── collection-types.ts
    ├── execution-types.ts
    └── common-types.ts
```

---

## 🔄 解耦关键点

### **1. 移除反向依赖**

**Before（坏）**：
```typescript
// filepath: src/collection/collection-service.ts
export class CollectionService {
    // OpenAPI 直接依赖 Collection？
    async exportToOpenAPI(collectionId: string): Promise<string> {
        const collection = this.getCollection(collectionId);
        return this.openApiExporter.export(collection);
    }
}
```

**After（好）**：
```typescript
// filepath: src/application/use-cases/export-collection-as-openapi.use-case.ts
export class ExportCollectionAsOpenAPIUseCase {
    constructor(
        private collectionRepository: ICollectionRepository,
        private openApiExporter: IOpenApiExporter
    ) {}

    async execute(collectionId: string): Promise<string> {
        const collection = await this.collectionRepository.findById(collectionId);
        return this.openApiExporter.export(collection);
    }
}

// OpenAPI 和 Collection 完全独立
```

---

### **2. 使用 Repository Pattern 解耦存储**

**Before（坏）**：
```typescript
// filepath: src/collection/collection-service.ts
export class CollectionService {
    async getRequest(id: string): Promise<IRequest> {
        const filePath = path.join(this.workspaceFolder, id);
        const content = await fs.readFile(filePath);
        return JSON.parse(content);
    }
}

// 测试需要 mock fs 模块
```

**After（好）**：
```typescript
// filepath: src/ports/repositories/request-repository.interface.ts
export interface IRequestRepository {
    findById(id: string): Promise<IRequest | null>;
}

// filepath: src/infrastructure/repositories/fs-request-repository.ts
export class FileSystemRequestRepository implements IRequestRepository {
    async findById(id: string): Promise<IRequest | null> {
        // fs 细节隐藏
    }
}

// 测试时轻易替换
class MockRequestRepository implements IRequestRepository {
    async findById(id: string): Promise<IRequest | null> {
        return { id, name: 'Test' };
    }
}
```

---

### **3. 事件发行解耦同步调用**

**Before（坏）**：
```typescript
// 直接耦合
export class ExecuteRequestUseCase {
    async execute(req: IRequest): Promise<void> {
        const result = await this.httpExecutor.execute(req);
        // 强制调用所有监听器
        await this.historyService.add(result);
        await this.environmentService.updateVariables(result);
        await this.notificationService.notify(result);
    }
}
```

**After（好）**：
```typescript
// 事件驱动
export class ExecuteRequestUseCase {
    constructor(
        private httpExecutor: IHttpExecutor,
        private eventPublisher: IDomainEventPublisher
    ) {}

    async execute(req: IRequest): Promise<void> {
        const result = await this.httpExecutor.execute(req);
        
        // 只发事件
        await this.eventPublisher.publish(
            new RequestExecutedEvent(req.id, result)
        );
    }
}

// 独立的事件处理器
export class SaveHistoryOnRequestExecutedHandler {
    handle(event: RequestExecutedEvent): Promise<void> {
        // 异步处理
    }
}

export class UpdateEnvironmentOnRequestExecutedHandler {
    handle(event: RequestExecutedEvent): Promise<void> {
        // 独立逻辑
    }
}
```

---

### **4. 依赖注入层级分离**

```typescript
// filepath: src/di/application-bootstrap.ts
/**
 * 三阶段启动
 */

// Phase 1: 基础设施
export function registerInfrastructure(
    container: ServiceContainer,
    adapters: PlatformAdapters
): void {
    container.registerSingleton<IFileSystem>(
        'FileSystem',
        () => new NodeFileSystem()
    );

    container.registerSingleton<IRequestRepository>(
        'RequestRepository',
        (c) => new FileSystemRequestRepository(
            c.resolve<IFileSystem>('FileSystem'),
            adapters.config.getCollectionsPath()
        )
    );

    container.registerSingleton<IHttpExecutor>(
        'HttpExecutor',
        () => new NodeHttpExecutor(
            new NodeHttpClient(),
            new InterceptorChain(),
            new PersistentCookieJar()
        )
    );
}

// Phase 2: 领域服务
export function registerDomainServices(
    container: ServiceContainer
): void {
    container.registerSingleton<IExecutionDomainService>(
        'ExecutionDomainService',
        () => new ExecutionDomainService()
    );
}

// Phase 3: 应用层（使用 Cases）
export function registerApplicationServices(
    container: ServiceContainer
): void {
    container.registerTransient<ExecuteRequestUseCase>(
        'ExecuteRequestUseCase',
        (c) => new ExecuteRequestUseCase(
            c.resolve<IRequestRepository>('RequestRepository'),
            c.resolve<IHttpExecutor>('HttpExecutor'),
            c.resolve<IExecutionDomainService>('ExecutionDomainService'),
            c.resolve<IDomainEventPublisher>('EventPublisher')
        )
    );
}

// 启动
const container = new ServiceContainer();
registerInfrastructure(container, adapters);
registerDomainServices(container);
registerApplicationServices(container);

export const forge = new ForgeContainer(container);
```

---

## 📊 耦合度对比

| 方面 | 现状 | 改后 |
|------|------|------|
| **循环依赖** | Collection ↔ OpenAPI | Collection ⊗ OpenAPI（独立） |
| **基础设施泄漏** | 9 个服务混入 fs/path | 0 个业务服务知道文件路径 |
| **测试成本** | 需要 mock 30+ 项 | 只需 mock 接口（2-3 项） |
| **接口大小** | ICollectionService：25+ 方法 | IRequestRepository：3 方法 |
| **变更影响范围** | 修改 HTTP 影响 5+ 服务 | 修改 HttpExecutor 只影响实现 |
| **执行流清晰度** | 分散于 10+ 文件 | 集中于 Use Case（1 文件） |

---

## 🎯 迁移步骤

1. **第一阶段**：创建 `src/ports/` 和 `src/infrastructure/`，复制现有接口
2. **第二阶段**：提取纯业务逻辑到 `src/domain/services/`
3. **第三阶段**：创建 Use Cases，将 `ForgeContainer` 逻辑迁入
4. **第四阶段**：验证所有测试通过
5. **第五阶段**：废弃旧的混合服务

**估计工作量**：2-3 周（增量迁移，无断裂）

---

## 📚 参考资源

- **Clean Architecture**（Uncle Bob）: Chapter 21 - Screaming Architecture
- **Domain-Driven Design**（Eric Evans）: Chapters 5-6 - Entities & Aggregates
- **Hexagonal Architecture**（Alistair Cockburn）
- **CQRS Pattern**：命令查询职责分离

这个方案完全符合 SOLID 原则，并支持团队在 CI/CD、浏览器、CLI 等多种平台上扩展使用。
