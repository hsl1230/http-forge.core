> **Archived / Historical.** Superseded by `docs/developer/IMPLEMENTATION_STATUS.md`.

# 🔄 遗留代码迁移指南

> ## ⚠️ 状态 / Status（历史文档 · Historical）
>
> 本文档是 **2026-03** 旧三层架构迁移期的指南。文中描述的迁移目标
> （`ServiceContainer` + `bootstrapComplete`、`src/infrastructure/di/complete-bootstrap.ts`、
> `src/application/`、`src/domain/` 等）**在 2026-08 重构中已被删除**（见 `docs/archive/PHASE3_DELETION_LOG.md`），
> 而文中被标记为"待删除（v2.0）"的 `ForgeContainer` 反而成为**当前公共入口**。
>
> 当前平台（@http-forge/core `0.6.36-beta.1`）的正确用法：
> `import { ForgeContainer } from '@http-forge/core'`；Node 引导用 `createNodeContainer(workspaceFolder)`；
> 运行时 API 见 `../api/RUNTIME-API.md`。本文档仅作历史参考保留。

## 📋 整合完成

已为所有标记为 **"整合"** 的目录添加了向后兼容标记。以下文件已更新：

### ✅ 已完成的改动

| 文件 | 改动 | 用途 |
|------|------|------|
| `src/di/index.ts` | 添加 @deprecated 注释 | 标记旧 DI 模块已过时 |
| `src/container.ts` | 添加详细迁移指南 | 提供向后兼容迁移路径 |
| `src/http/index.ts` | 新建 + @internal 标记 | 明确为实现细节 |
| `src/script/index.ts` | 新建 + @internal 标记 | 明确为实现细节 |
| `src/parsers/index.ts` | 添加 @internal 标记 | 明确为实现细节 |

---

## 🚀 迁移步骤

### 对于使用 `ForgeContainer` 的旧代码

**旧方式**（已弃用）：
```typescript
import { ForgeContainer } from '@http-forge/core';

const container = new ForgeContainer({ /* config */ });
const service = container.resolve('SomeService');
```

**新方式**（建议）：
```typescript
import { ServiceContainer } from '@http-forge/core/di';
import { bootstrapComplete } from '@http-forge/core/infrastructure/di';

const container = new ServiceContainer();
bootstrapComplete(container, { useFileSystem: true });
const service = container.resolve('SomeService');
```

---

## 📂 各目录说明

### `src/di/` - 旧 DI 系统
- **状态**: ⚠️ 过时但保留
- **原因**: 向后兼容外部代码
- **迁移**: 使用 `infrastructure/di/complete-bootstrap.ts`
- **何时删除**: v2.0

### `src/container.ts` - 主容器配置
- **状态**: ⚠️ 包装层
- **原因**: 外部代码可能直接导入
- **迁移**: 逐步更新导入语句
- **何时删除**: v2.0

### `src/http/` - HTTP 执行实现
- **状态**: ✅ 内部实现
- **原因**: 被 `infrastructure/http/NodeHttpExecutorAdapter` 包装
- **使用**: 不直接导入，通过 adapter 使用
- **何时删除**: 替代品完全就位后

### `src/script/` - 脚本执行实现  
- **状态**: ✅ 内部实现
- **原因**: 被 `infrastructure/script/VmScriptExecutorAdapter` 包装
- **使用**: 不直接导入，通过 adapter 使用
- **何时删除**: 替代品完全就位后

### `src/parsers/` - 集合解析实现
- **状态**: ✅ 内部实现
- **原因**: 被 `infrastructure/parsers/CollectionParserRegistry` 包装
- **使用**: 不直接导入，通过 registry 使用
- **何时删除**: 替代品完全就位后

---

## 🎯 迁移计划

### 第一阶段：标记（✅ 已完成）
- [x] 添加 @deprecated 注释到旧 DI
- [x] 添加 @internal 标记到实现细节
- [x] 创建迁移指南

### 第二阶段：平稳过渡（后续进行）
- [ ] 更新文档指向新 API
- [ ] 创建迁移工具或脚本
- [ ] 更新现有测试用例

### 第三阶段：完全移除（v2.0）
- [ ] 删除旧 DI 系统
- [ ] 删除 ForgeContainer 包装层
- [ ] 清理导入路径

---

## ⚡ 常见问题

### Q: 我可以继续使用旧代码吗?
✅ **是的**。所有旧代码继续工作直到 v2.0  
推荐：逐步迁移到新架构

### Q: 为什么要保留旧目录?
📦 **向后兼容**  
- 外部代码可能直接导入这些目录
- 突然删除会导致构建失败
- 三个版本后删除（v2.0）

### Q: 何时必须迁移?
🗓️ **v2.0 发布时**  
- 目前（RC1): 可选，推荐
- 1.x: 完全支持
- 2.0: 强制迁移

### Q: 如何了解新 API?
📖 **查看文档**：
- `infrastructure/di/complete-bootstrap.ts` - 完整启动
- `USAGE_GUIDE.md` - 实际示例
- `../archive/QUICK_REFERENCE.md` - 速查表

---

## 📊 迁移影响

| 影响范围 | 程度 | 说明 |
|---------|------|------|
| **构建** | ✅ 无 | 所有旧代码继续工作 |
| **运行时** | ✅ 无 | 向后兼容完全实现 |
| **文档** | ⚠️ 更新 | 建议查看新指南 |
| **新功能** | ✅ 仅新 API | 新功能仅在新架构中可用 |
| **性能** | ✅ 相同 | 相同的底层实现 |

---

## 🔗 相关文档

- [../archive/ARCHITECTURE_IMPLEMENTATION.md](./../archive/ARCHITECTURE_IMPLEMENTATION.md) - 完整实现指南
- [USAGE_GUIDE.md](./USAGE_GUIDE.md) - 实际使用示例
- [../archive/QUICK_REFERENCE.md](./../archive/QUICK_REFERENCE.md) - API 速查表
- [TECHNICAL_INVENTORY.md](./TECHNICAL_INVENTORY.md) - 所有文件清单

---

## 📝 下一步

1. **立即可做**: 
   - 查看新的 `infrastructure/di/` 接口
   - 阅读迁移示例

2. **计划实施**:
   - 制定团队迁移时间表
   - 更新内部指南和培训

3. **持续监控**:
   - 关注 v2.0 发布计划
   - 提前准备代码迁移

---

**迁移状态**: ✅ **第一阶段完成**  
**下一步**: 按需逐步更新代码  
**支持周期**: RC1 → 1.0 → 1.x → 2.0 (移除)
