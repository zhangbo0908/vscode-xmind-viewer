# CLAUDE.md

本文档为 Claude Code (claude.ai/code) 在此仓库中工作时提供指导。

## 项目概览

这是一个 VS Code 扩展，为 `.xmind` 文件提供专业级自定义编辑器。该扩展实现了 VS Code 的 `CustomTextEditorProvider` API，集成 `simple-mind-map` 库，提供高度还原 XMind 官方体验的嵌入式编辑环境。

## 常用命令

```bash
# 开发 构建
npm run compile      # 使用 webpack 进行构建 (development mode)
npm run watch        # 监听模式

# 打包发布
# 打包成 .vsix 文件 (输出到 packages/ 目录)
npx vsce package --out packages/ --allow-missing-repository

# 代码质量
npm run lint         # ESLint 检查
```

## 架构设计

### 自定义编辑器 (Custom Editor)
- **入口点**: [extension.ts](file:///src/extension.ts) 注册 `xmind.editor`。
- **提供者**: [XMindEditorProvider.ts](file:///src/XMindEditorProvider.ts) 管理 Webview 面板与生命周期。
- **文档模型**: [XMindDocument.ts](file:///src/XMindDocument.ts) 处理文件读写与备份。
- **视图层**: [src/webview/index.ts](file:///src/webview/index.ts)
    - **布局**: 采用 **Flex 垂直布局** (Canvas `flex: 1` + Toolbar `flex-shrink: 0`)，物理隔离画布与工具栏，彻底解决遮挡问题。
    - **交互**: 使用 `addEventListener` 动态绑定事件，符合 CSP 安全规范。

### Webpack 双重构建
- `dist/extension.js`: 扩展主进程代码。
- `dist/webview.js`: Webview 内部运行的脚本 (包含 `simple-mind-map` 及 UI 逻辑)。

### 数据流与存储
- **读取**: ZIP 解压 -> 读取 `content.json` -> 转换为 `simple-mind-map` 数据格式。
- **写入**: 保持 ZIP 结构 -> 仅更新 `content.json` 中的节点树 -> 重新打包 ZIP。
- **样式保留**: 采用非破坏性更新策略，保留 XMind 原生 `style` 元数据，确保在官方软件中打开样式不丢失。

### 核心依赖
- `simple-mind-map`: 核心渲染引擎。
- `jszip`: 处理 `.xmind` (ZIP) 格式。

## 主要特性状态

- **撤销/重做**: 支持 (`Cmd+Z` / `Cmd+Shift+Z`)，由 Webview 内部堆栈管理。
- **多页管理 (Multi-sheet)**: 支持增删改查，完美兼容 XMind 用于多画布的文件结构。
- **布局切换**: 支持思维导图、逻辑图、组织结构图等多种布局实时切换。
- **智能导出**:
    - 支持 PNG/SVG/Markdown。
    - 路径自动定位到 **Workspace Root**。

## 调试指南

1. 修改代码后运行 `npm run compile`。
2. 在调试侧边栏运行 "Extension"。
3. 在打开的扩展宿主窗口中打开 `.xmind` 文件测试。
4. 查看 Webview 日志: `Cmd+Shift+P` -> `Open Webview Developer Tools`。
