# TodoTree

> 暗金半透明 · 桌面锁死底层 · 4 分区自动化待办管理

一款基于 Electron 的 Windows 桌面待办工具。读取 Markdown 文件（默认 `~/Desktop/TODOTREE.md`），以半透明暗金窗口锁死在桌面底层，提供四分区（目标/待完成/已完成/放弃）任务管理、无限层级子任务、状态循环流转、拖拽排序、DDL 截止日期等功能。

## 核心特性

- **桌面即工具** — 窗口锁死在桌面底层，全屏应用不遮挡，不在任务栏显示
- **点击循环** — 点方框循环：待办 → 完成 → 加急 → 放弃 → 待办，一分钟后自动流转
- **分区拖拽** — 四个分区可拖拽标题调顺序，拖拽分隔线调大小，持久化记忆
- **父子联动** — 父任务操作级联所有子任务；子任务跨区自动复制父任务副本
- **拖拽排序** — 拖任务行随意调序；父任务中文编号（一、二、三），子任务阿拉伯数字
- **右键菜单** — 右键添加子任务、修改 DDL、删除
- **撤回/自启/图标** — 支持撤销 20 步、开机自启、一键创建桌面快捷方式

## 快速开始

### 下载安装包（推荐）

从 [Releases](https://github.com/yunyancuo/todotree/releases) 下载最新 `TodoTree-x.x.x.exe`，双击即用，无需安装 Node.js。

### 从源码运行

```bash
git clone https://github.com/yunyancuo/todotree.git
cd todotree-app
npm install
npm start
```

Windows 用户可直接双击 `start.bat`。

## Markdown 数据格式

```markdown
# TodoTree

## 目标
- [>] 长期目标 | ddl:2026-12-31
  - [>] 子目标

## 待完成
- [ ] 一级任务
  - [ ] 子任务 A
  - [ ] 子任务 B

## 已完成
- [x] 已完成任务

## 放弃
- [~] 废弃任务
```

## 技术栈

Electron · Vanilla JS · Node.js fs · Markdown

## 许可

MIT
