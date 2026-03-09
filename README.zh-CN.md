# Canvas Editor DevTools

[![English](https://img.shields.io/badge/English-README-blue)](README.md)

用于调试 [Canvas Editor](https://github.com/Hufe921/canvas-editor) 的 Chrome DevTools 扩展。

## 功能特性

### 1. 元素树检查器
- 实时查看 Canvas Editor 的文档结构
- 支持主内容区、页眉、页脚分区查看
- 点击元素查看详细信息（样式、属性等）

### 2. 事件监控器
- 实时监控 Canvas Editor 事件
- 支持的事件类型：
  - 内容变化（contentChange）
  - 选区样式变化（rangeStyleChange）
  - 页面相关事件（visiblePageNoListChange, pageSizeChange 等）
  - 控件事件（controlChange, controlContentChange）
  - 图片事件（imageSizeChange, imageMousedown 等）
  - 鼠标事件（mousemove, click 等）
- 按类别筛选显示
- 事件日志自动滚动

### 3. 配置面板
- 查看和修改 Canvas Editor 配置选项
- 支持配置项：
  - 外观设置（字体、颜色、边距等）
  - 水印设置
  - 页码设置
  - 表格默认样式
  - 控件样式
  - 光标设置
  - 复选框/单选框样式

## 安装方法

### 开发模式安装

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目文件夹

## 使用方法

1. 打开使用 Canvas Editor 的网页
2. 确保页面已加载 Canvas Editor 实例（`window.__CANVAS_EDITOR_INSTANCE__`）
3. 按 F12 打开开发者工具
4. 找到「Canvas Editor」标签页
5. 开始使用：
   - 元素面板：查看文档结构，点击元素查看详情
   - 事件面板：开启需要监控的事件开关，查看实时事件
   - 配置面板：修改配置后点击保存

## 开发说明

1. 修改代码后，在 `chrome://extensions/` 页面点击刷新按钮重新加载扩展
2. 修改 injected-script.js 需要刷新目标页面才能生效

## 许可证

MIT
