# XMind Viewer & Editor for VS Code

一款在 Visual Studio Code 中直接查看和编辑 `.xmind` 文件的强大插件。

## 主要特性

- **可视化编辑**：支持直接在 VS Code 中修改节点文本、添加/删除节点。
- **多页 (Multi-sheet) 支持**：完美支持包含多个画布的 XMind 文件，底部页签轻松切换，并支持新增 Sheet。
- **布局自动识别与切换**：
    - **自动识别**：打开文件时自动匹配 XMind 原始布局（如：环绕思维导图、逻辑图、组织结构图等）。
    - **实时切换**：提供下拉菜单，可在编辑时随时切换当前画布的布局模式。
- **空白文件自动初始化**：新建空白 `.xmind` 文件后打开，插件会自动初始化为标准的 XMind 结构（含中心主题）。
- **深度兼容性**：保存的文件完全符合 XMind 官方标准（包含 `manifest.json` 和 `metadata.json`），可直接用 XMind 软件打开。
- **交互体验**：支持缩放、平移、节点收起/展开，流畅的编辑反馈。

## 使用方法

1. **直接打开**：双击 `.xmind` 文件或将其拖入 VS Code。
2. **编辑**：
    - **Enter**: 插入同级节点。
    - **Tab**: 插入子节点。
    - **Delete**: 删除节点。
    - **双击**: 编辑文本。
3. **保存**：使用 `Ctrl+S` (Windows) 或 `Cmd+S` (Mac) 即可将更改同步回原文件。

## 布局支持列表

- 思维导图 (Mind Map - Radial)
- 向右逻辑图 (Logical Structure Right)
- 向左逻辑图 (Logical Structure Left)
- 组织结构图 (Organization Chart)
- 树状图 (Tree Structure)

## 最近更新 (v0.1.2)

- 修复了空文件保存后 XMind 软件提示“文件损坏”的兼容性问题。
- 优化了 Webview 渲染的初始化时序，消除了白屏竞态。

---

**Enjoy!**
