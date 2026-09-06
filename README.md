<div align="center">

<img src="icon.png" width="72" alt="TodoTree" />

# TodoTree

**暗金半透明 · 锁在桌面底层的 Markdown 待办墙**

[![Release](https://img.shields.io/github/v/release/yunyancuo/todotree?style=flat-square&color=dd4f6b)](https://github.com/yunyancuo/todotree/releases)
[![Platform](https://img.shields.io/badge/Windows-10%2B-24292F?style=flat-square&logo=windows&logoColor=white)](https://github.com/yunyancuo/todotree/releases)
[![License](https://img.shields.io/badge/License-MIT-24292F?style=flat-square)](LICENSE)

<img src="docs/demo.png" width="400" alt="TodoTree 运行截图" />

**双击即用 · 数据就是一个 Markdown 文件 · 不注册、不上传、离线可用**

</div>

---

一款基于 Electron 的 Windows 桌面待办工具。读取 Markdown 文件（默认 `~/Desktop/TODOTREE.md`），以半透明暗金窗口锁死在桌面底层，提供四分区（目标/待完成/已完成/放弃）任务管理、无限层级子任务、状态循环流转、拖拽排序、DDL 截止日期等功能。

## 核心特性

- **真·桌面层锚定** — 通过 WorkerW/Progman 把窗口挂进桌面树：永远垫在所有普通窗口之下、桌面图标之上，Win+D 显示桌面也不消失，explorer 重启自动恢复；锁定时点击输入框会临时浮到前台拿键盘焦点，失焦自动回到底层
- **点击循环** — 点方框循环：待办 → 完成 → 加急 → 放弃 → 待办，一分钟后自动流转
- **分区拖拽** — 四个分区可拖拽标题调顺序，拖拽分隔线调大小，持久化记忆
- **父子联动** — 父任务操作级联所有子任务；子任务跨区自动复制父任务副本
- **拖拽排序** — 拖任务行随意调序；父任务中文编号（一、二、三），子任务阿拉伯数字
- **右键菜单** — 右键添加子任务、修改 DDL、删除
- **撤回/自启/图标** — 支持撤销 20 步、开机自启、一键创建桌面快捷方式
- **外部修改同步** — 🔄 按钮手动同步文件；15 秒轮询自动感知外部修改（如脚本写入）并重载；检测到外部修改时覆盖前自动备份为 `TODOTREE_外部修改备份_时间戳.md`

## 快速开始

### 下载安装包（推荐）

从 [**Releases**](https://github.com/yunyancuo/todotree/releases) 下载最新 `TodoTree-Setup-x.x.x.exe`，双击安装即用，无需 Node.js。

> 数据文件默认在桌面 `TODOTREE.md`，随便什么编辑器都能改，改完 15 秒内自动刷新。

### 从源码运行

```bash
git clone https://github.com/yunyancuo/todotree.git
cd todotree
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
