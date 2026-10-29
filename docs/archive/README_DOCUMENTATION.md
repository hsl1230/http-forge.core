# 📚 @http-forge/core 架构重构 - 完整文档索引

> ## ⚠️ 状态 / Status（历史文档索引 · Historical）
>
> 本文档是 **2026-03** 旧三层架构文档集的索引（"85% 完成度"、"版本 1.0.0-rc.1"）。
> 其推荐的阅读起点 `../archive/QUICK_REFERENCE.md` 描述的旧架构（`ExecuteRequestUseCase`、`bootstrapComplete`
> 等）**已被删除**；`USAGE_GUIDE.md` 与 `ARCHITECTURE_*` 文档描述的架构同样过时。
>
> 当前（@http-forge/core `0.6.36-beta.1`）的权威文档为：
> - `README.md`（包首页）与 `RUNTIME-API.md`（运行时/MCP API）
> - `docs/api/core-reference.md`（API 参考）与 `docs/developer/MCP_MANAGEMENT_TOOLS.md`（MCP 工具参考）
> - `docs/developer/IMPLEMENTATION_STATUS.md`（当前架构状态）
>
> 本文档仅作历史参考保留。

> 🎉 **项目状态**: ✅ **生产就绪** - 85% 完成度  
> 📊 **交付**: 50+ 新文件，完整三层架构，全面文档覆盖  
> ⚠️ **运行要求**: Node.js 20+  
> 🚀 **准备**: 即刻可用的企业级架构

---

## 📖 文档导航

### 🎯 快速开始（推荐阅读顺序）

#### 1️⃣  **5 分钟快速了解** → [../archive/QUICK_REFERENCE.md](./../archive/QUICK_REFERENCE.md) ⭐
- 解答"我需要..."常见问题
- 代码速查表
- 路由表和配置参考
- **适合**: 急需上手的开发者

#### 2️⃣  **20 分钟使用入门** → [USAGE_GUIDE.md](./USAGE_GUIDE.md)
- 快速启动向导
- 所有组件清单
- 典型工作流程示例
- 测试支持说明
- **适合**: 想立即使用的开发者

#### 3️⃣  **30 分钟架构设计** → [../archive/../archive/ARCHITECTURE_REFACTORING.md](./../archive/../archive/ARCHITECTURE_REFACTORING.md)
- 问题分析和背景
- 建议架构详解
- 模块化方案
- 反模式识别
- **适合**: 想理解为什么的架构师

#### 4️⃣  **45 分钟实现细节** → [../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md](./../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md)
- 分层实现指南
- 数据流和流程
- 完整例子
- 集成步骤
- **适合**: 需要深度理解的开发者

#### 5️⃣  **完成总结** → [FINAL_REPORT.md](./FINAL_REPORT.md)
- 项目完成报告
- 成果统计
- 改进对比
- 后续计划
- **适合**: 管理和决策

#### 6️⃣  **技术清单** → [TECHNICAL_INVENTORY.md](./TECHNICAL_INVENTORY.md)
- 所有51个文件的详细清单
- 接口定义
- 实现细节
- 依赖关系
- **适合**: 需要详细参考的开发者

---

## 🗂️ 文档内容速览

### 📄 核心文档

| 文档 | 长度 | 难度 | 关键内容 |
|------|------|------|---------|
| [../archive/QUICK_REFERENCE.md](./../archive/QUICK_REFERENCE.md) | 2 页 | ⭐ 简单 | 速查表、常见问题、速成指南 |
| [USAGE_GUIDE.md](./USAGE_GUIDE.md) | 10 页 | ⭐⭐ 中等 | 快速启动、典型工作流、测试支持 |
| [../archive/../archive/ARCHITECTURE_REFACTORING.md](./../archive/../archive/ARCHITECTURE_REFACTORING.md) | 12 页 | ⭐⭐ 中等 | 架构分析、反模式、设计决策 |
| [../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md](./../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md) | 15 页 | ⭐⭐⭐ 高级 | 实现细节、代码例子、集成步骤 |
| [FINAL_REPORT.md](./FINAL_REPORT.md) | 8 页 | ⭐ 简单 | 成果总结、完成统计、改进对比 |
| [TECHNICAL_INVENTORY.md](./TECHNICAL_INVENTORY.md) | 20 页 | ⭐⭐⭐ 高级 | 所有文件清单、接口定义、依赖关系 |

**总计**: 67+ 页完整文档

---

## 🎯 按角色推荐阅读

### 👨‍💼 项目经理 / 决策者
1. [FINAL_REPORT.md](./FINAL_REPORT.md) → 理解成果和改进
2. [../archive/../archive/ARCHITECTURE_REFACTORING.md](./../archive/../archive/ARCHITECTURE_REFACTORING.md#%E9%97%AE%E9%A2%98%E5%88%86%E6%9E%90) → 理解问题和解决方案
3. [../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md](./../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md#%E9%A0%90%E6%9C%9F%E7%9A%84%E4%BA%8B%E4%B8%80%E8%A7%BD) → 了解关键改进点

### 👨‍💻 前端/全栈开发者
1. [../archive/QUICK_REFERENCE.md](./../archive/QUICK_REFERENCE.md) → 快速上手
2. [USAGE_GUIDE.md](./USAGE_GUIDE.md) → 典型工作流
3. [../archive/QUICK_REFERENCE.md](./../archive/QUICK_REFERENCE.md#-%E8%B7%AF%E7%94%B1%E8%A1%A8) → 查找功能所在位置

### 🏗️ 架构师
1. [../archive/../archive/ARCHITECTURE_REFACTORING.md](./../archive/../archive/ARCHITECTURE_REFACTORING.md) → 完整设计
2. [../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md](./../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md) → 实现细节
3. [TECHNICAL_INVENTORY.md](./TECHNICAL_INVENTORY.md) → 文件详集
4. [FINAL_REPORT.md](./FINAL_REPORT.md#-后续步骤roadmap) → 演进计划

### 🔧 后端开发者 / API 工程师
1. [../archive/QUICK_REFERENCE.md](./../archive/QUICK_REFERENCE.md) → 快速查询
2. [USAGE_GUIDE.md](./USAGE_GUIDE.md#-典型工作流程) → 深度示例
3. [TECHNICAL_INVENTORY.md](./TECHNICAL_INVENTORY.md) → 所有接口
4. [../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md](./../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md#-数据流) → 流程理解

### 📚 新入职成员
1. [../archive/../archive/ARCHITECTURE_REFACTORING.md](./../archive/../archive/ARCHITECTURE_REFACTORING.md) → 架构背景
2. [USAGE_GUIDE.md](./USAGE_GUIDE.md) → 实际操作
3. [TECHNICAL_INVENTORY.md](./TECHNICAL_INVENTORY.md) → 文件导航
4. [../archive/QUICK_REFERENCE.md](./../archive/QUICK_REFERENCE.md) → 日常参考

---

## 📑 按主题分类

### 🏗️ 架构设计
- **何时读**: 需要理解系统整体设计
- **推荐文档**: 
  - [../archive/../archive/ARCHITECTURE_REFACTORING.md](./../archive/../archive/ARCHITECTURE_REFACTORING.md) - 完整设计
  - [../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md](./../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md#-架构概览) - 实现图示

### 🚀 快速开发
- **何时读**: 想快速集成或开发新功能
- **推荐文档**:
  - [../archive/QUICK_REFERENCE.md](./../archive/QUICK_REFERENCE.md) - 速查表
  - [USAGE_GUIDE.md](./USAGE_GUIDE.md) - 工作流程

### 🔍 详细参考
- **何时读**: 需要理解特定实现
- **推荐文档**:
  - [TECHNICAL_INVENTORY.md](./TECHNICAL_INVENTORY.md) - 所有文件清单
  - [../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md](./../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md#-完整代码示例) - 代码例子

### 📊 项目总结
- **何时读**: 汇报进度或评估项目
- **推荐文档**:
  - [FINAL_REPORT.md](./FINAL_REPORT.md) - 完成总结

### 🧪 测试和调试
- **何时读**: 需要写测试或调试问题
- **推荐文档**:
  - [USAGE_GUIDE.md](./USAGE_GUIDE.md#-测试支持) - 测试指南
  - [../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md](./../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md#-完整示例代码) - 完整例子

---

## 📊 关键数字一览

| 指标 | 数值 |
|------|------|
| **总文件数** | 50+ |
| **总行代码** | 5,000+ 行 |
| **总文档页数** | 67+ 页 |
| **接口定义** | 11 个 |
| **域服务** | 2 个 |
| **应用用例** | 3 个 |
| **查询** | 1 个 |
| **存储库实现** | 4 个 |
| **执行器实现** | 2 个 |
| **完成度** | 85% ✅ |

---

## 🔗 核心实现映射

### 业务功能 → 文档位置

| 功能 | 文件位置 | 文档参考 |
|------|---------|---------|
| 执行请求 | `src/application/use-cases/execute-request.use-case.ts` | [QUICK_REFERENCE](#-执行一个请求) |
| 加载集合 | `src/application/use-cases/load-collection.use-case.ts` | [USAGE_GUIDE](./USAGE_GUIDE.md#-加载集合) |
| 保存集合 | `src/application/use-cases/save-collection.use-case.ts` | [USAGE_GUIDE](./USAGE_GUIDE.md#-保存集合) |
| 获取模式 | `src/application/queries/get-request-schema.query.ts` | [QUICK_REFERENCE](#-获取响应模式) |
| HTTP 执行 | `src/infrastructure/http/node-http-executor.adapter.ts` | [TECHNICAL_INVENTORY](./TECHNICAL_INVENTORY.md#http-执行器-2-个) |
| 脚本执行 | `src/infrastructure/script/vm-script-executor.adapter.ts` | [TECHNICAL_INVENTORY](./TECHNICAL_INVENTORY.md#脚本执行器-2-个) |
| 事件发布 | `src/infrastructure/di/simple-event-publisher.ts` | [QUICK_REFERENCE](#-监听请求执行完成) |
| 历史存储 | `src/infrastructure/persistence/file-system-history-loader.ts` | [QUICK_REFERENCE](#-访问执行历史) |

---

## 🎓 学习路径

### 初级 (1-2 小时)
```
../archive/QUICK_REFERENCE.md (15 min)
         ↓
USAGE_GUIDE.md - 快速启动 (30 min)
         ↓
尝试运行示例代码 (30 min)
```

### 中级 (3-4 小时)
```
初级学习路径
         ↓
../archive/../archive/ARCHITECTURE_REFACTORING.md (30 min)
         ↓
USAGE_GUIDE.md - 典型工作流 (30 min)
         ↓
../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md (30 min)
         ↓
开发小功能 (1 hr)
```

### 高级 (6-8 小时)
```
中级学习路径
         ↓
TECHNICAL_INVENTORY.md - 全文阅读 (1 hr)
         ↓
../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md - 代码示例 (1 hr)
         ↓
研读关键源文件 (2 hr)
         ↓
实现扩展功能 (2 hr)
```

---

## 📞 常见问题速答

### "我应该从哪个文档开始?"
→ [../archive/QUICK_REFERENCE.md](./../archive/QUICK_REFERENCE.md) (5 分钟速读)

### "如何快速上手?"
→ [USAGE_GUIDE.md](./USAGE_GUIDE.md#-快速启动) (20 分钟)

### "为什么要做这个架构?"
→ [../archive/../archive/ARCHITECTURE_REFACTORING.md](./../archive/../archive/ARCHITECTURE_REFACTORING.md#-问题分析) (问题分析)

### "具体怎么实现的?"
→ [../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md](./../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md) (完整指南)

### "所有文件在哪里?"
→ [TECHNICAL_INVENTORY.md](./TECHNICAL_INVENTORY.md#-核心文件清单) (文件清单)

### "项目完成了吗?"
→ [FINAL_REPORT.md](./FINAL_REPORT.md) (完成报告)

### "我该怎么扩展?"
→ [TECHNICAL_INVENTORY.md](./TECHNICAL_INVENTORY.md#-扩展点) (扩展指南)

### "有什么注意事项?"
→ [../archive/QUICK_REFERENCE.md](./../archive/QUICK_REFERENCE.md#-常见问题) (常见问题)

---

## 🔄 文档更新计划

| 时间 | 更新内容 |
|------|---------|
| ✅ 已完成 | 核心 6 份文档完成 (67+ 页) |
| 🔄 进行中 | 运行测试用例列表 |
| 📋 计划 | 添加 API 参考文档 |
| 📋 计划 | 添加故障排除指南 |
| 📋 计划 | 添加性能优化指南 |

---

## 🎁 额外资源

### 代码示例
- 所有主要工作流的示例代码 → [USAGE_GUIDE.md](./USAGE_GUIDE.md)
- 完整集成例子 → [../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md](./../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md)
- API 快速参考 → [../archive/QUICK_REFERENCE.md](./../archive/QUICK_REFERENCE.md)

### 参考资源
- 三层架构原理 → [../archive/../archive/ARCHITECTURE_REFACTORING.md](./../archive/../archive/ARCHITECTURE_REFACTORING.md#-建议架构)
- 接口完整定义 → [TECHNICAL_INVENTORY.md](./TECHNICAL_INVENTORY.md#端口层11-个文件)
- 所有 50+ 文件的详细描述 → [TECHNICAL_INVENTORY.md](./TECHNICAL_INVENTORY.md)

### 视觉资源
- 架构图 → [../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md](./../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md)
- 数据流图 → [../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md](./../archive/../archive/ARCHITECTURE_IMPLEMENTATION.md#-数据流)
- 依赖关系图 → [TECHNICAL_INVENTORY.md](./TECHNICAL_INVENTORY.md#-依赖关系)

---

## 📱 快速访问

### 直接链接
| 需求 | 链接 |
|------|------|
| 我是新人 | [USAGE_GUIDE.md](./USAGE_GUIDE.md) |
| 我是架构师 | [../archive/../archive/ARCHITECTURE_REFACTORING.md](./../archive/../archive/ARCHITECTURE_REFACTORING.md) |
| 我是开发者 | [../archive/QUICK_REFERENCE.md](./../archive/QUICK_REFERENCE.md) |
| 我是管理者 | [FINAL_REPORT.md](./FINAL_REPORT.md) |

### 按需求查找
- 📚 理解架构 → [../archive/../archive/ARCHITECTURE_REFACTORING.md](./../archive/../archive/ARCHITECTURE_REFACTORING.md)
- 🚀 快速开始 → [USAGE_GUIDE.md](./USAGE_GUIDE.md#-快速启动)
- 🔧 怎么用 → [../archive/QUICK_REFERENCE.md](./../archive/QUICK_REFERENCE.md)
- 📖 详细参考 → [TECHNICAL_INVENTORY.md](./TECHNICAL_INVENTORY.md)
- 📊 进度报告 → [FINAL_REPORT.md](./FINAL_REPORT.md)

---

## ✨ 文档特色

✅ **深度覆盖** - 从概念到代码的完整说明  
✅ **易于导航** - 多种查找方式和链接  
✅ **丰富示例** - 所有主流操作都有代码样例  
✅ **多个层级** - 从 5 分钟到多小时的学习路径  
✅ **持续更新** - 根据反馈不断完善  

---

## 📝 贡献和反馈

发现文档改进方向?  
💡 建议新增内容或示例  
🐛 报告文档错误  
✨ 分享最佳实践  

---

**文档主页** | **版本**: 1.0.0-rc.1  
**最后更新**: 2026-03-16  
**状态**: ✅ 生产就绪  

---

## 🎯 下一步

1. **快速开始** - 选择上面的推荐文档
2. **深入学习** - 按照学习路径阅读
3. **开始编码** - 利用快速参考和示例
4. **扩展系统** - 参考扩展指南

**让我们一起构建更好的架构！** 🚀
