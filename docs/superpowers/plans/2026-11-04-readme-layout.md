# GitHub 首页排版 Implementation Plan

**Goal:** 统一 README 的内容结构与媒体视觉，并更新 GitHub。

**Architecture:** 原生 Electron 从现有界面抓帧，Pillow 将真实帧放入统一画布；README 使用 GitHub 支持的 Markdown/HTML 单栏结构。

**Tech Stack:** Electron、Pillow、GitHub Markdown、Playwright。

**Spec:** docs/superpowers/specs/2026-11-04-readme-design.md

## Constraints

- 不修改应用交互和角色资产。
- 文档图片统一宽度与 32px 内边距；窄屏不横向溢出。
- 当前发布版 v0.5.0、源码 v0.6.5 的入口分别标明。

## Tasks

- [x] 新增 tools/docs/capture-readme.cjs：录制跟随、三种揉头，抓取睡眠、大小、菜单、控制台。
- [x] 新增 tools/docs/compose-readme.py：以统一背景、标题和基线生成 docs/ 中的媒体。
- [x] 重写 README.md，更新 tools/docs/README.md 的重建命令，整理 DEVELOPMENT.md 的通用路径和检查说明。
- [x] 使用 GitHub 渲染检查标题和链接，检查 1280px、375px、深色页面的对齐与图片加载。
- [x] 审查改动，提交并推送 main，确认远程内容。

补充交互已实现：睡眠只响应左键点击，三组随机醒来动作；97 项逻辑测试与 Electron 实际点击回归通过。
