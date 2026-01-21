# CLAUDE.md

本文档为 Claude Code (claude.ai/code) 在此仓库中工作时提供指导。

## 项目概览

这是一个 VS Code 扩展，为 `.xmind` 文件提供自定义编辑器。该扩展实现了 VS Code 的 `CustomTextEditorProvider` API，使用 `simple-mind-map` 库创建了一个基于 Webview 的嵌入式思维导图编辑器。

## 常用命令

```bash
# 开发
npm run compile      # 使用 webpack 进行构建
npm run watch        # 开发模式下的监听模式
npm run package      # 生产环境构建

# 测试
npm run pretest      # 运行测试前置编译、构建及代码检查
npm run test         # 运行 Mocha 测试
npm run compile-tests # 将测试文件编译到 out/ 目录

# 代码质量
npm run lint         # 对 src/ 目录下的 TypeScript 文件进行 ESLint 检查
```

## 架构

### 自定义编辑器提供者模式 (Custom Editor Provider Pattern)

该扩展使用 VS Code 的 `CustomTextEditorProvider` API：

1. **入口点** ([extension.ts](file:///Users/zhangbo/Documents/xmind/src/extension.ts)): 为 `*.xmind` 文件注册自定义编辑器提供者。
2. **编辑器提供者** ([XMindEditorProvider.ts](file:///Users/zhangbo/Documents/xmind/src/XMindEditorProvider.ts)): 管理 Webview 生命周期并处理文档编辑。
3. **文档** ([XMindDocument.ts](file:///Users/zhangbo/Documents/xmind/src/XMindDocument.ts)): 文档模型（注意：目前缺少撤销/重做功能）。
4. **Webview** ([src/webview/](file:///Users/zhangbo/Documents/xmind/src/webview/)): 带有思维导图 UI 的嵌入式浏览器上下文。

### Webpack 双重构建

构建过程生成两个独立的 bundle：
- `dist/extension.js` - Node.js 扩展宿主代码
- `dist/webview.js` - Webview 代码（通过 iframe 加载）

扩展与 Webview 之间的通信使用 `acquireVsCodeApi()` 进行双向消息传递。

### XMind 文件格式

XMind 文件是包含以下内容的 ZIP 归档文件：
- `content.json` - 思维导图数据（画布、主题、结构）
- `manifest.json` - 文件元数据和附件
- `metadata.json` - 额外元数据

解析器 ([parser.ts](file:///Users/zhangbo/Documents/xmind/src/webview/parser.ts)) 使用 `jszip` 处理 ZIP 的解压与打包。

### 布局类型

支持的思维导图布局（从 XMind `rootTopic` 的 `branch-type` 自动检测）：
- `MindMap` - 放射状/思维导图
- `LogicalStructureRight` - 右侧逻辑结构
- `LogicalStructureLeft` - 左侧逻辑结构
- `OrganizationStructure` - 组织结构图
- `TreeStructure` - 树状结构

### 核心依赖

- `simple-mind-map` (v0.14.0-fix.1) - 核心可视化库
- `jszip` - ZIP 文件处理
- `uuid` - 为新节点/画布生成 ID

## 已知局限性

- 文档模型中暂无撤销/重做功能
- 对格式错误的 XMind 文件仅提供基础错误处理
- 样式/主题数据未保留
- 在扩展中创建的画布可能缺少某些 XMind 原生元数据
