# 开发与发布环境

> 给接手的 agent / 开发者：这份文档说明环境在哪、怎么跑、怎么出图、怎么打包发布。

## 1. 位置

| 内容 | 路径 |
|---|---|
| 项目仓库（git） | `D:\AI coding project\Claude Make\bluefish-desktop` |
| 可分享产物（安装包等） | `D:\AI coding project\Claude Make\release` |
| 旧版手工备份（历史） | `D:\AI coding project\Claude Make\bluefish-desktop.bak-20261103` |
| 应用安装位置（用户机器） | `%LOCALAPPDATA%\BluefishDesktop`（由安装包创建） |

仓库内关键位置：

```
desktop/        Electron 主进程（窗口、贴边、拖拽、菜单、控制台、单实例锁、托盘）
src/            renderer（WebGL 分层网格）· motion · peek（小手/情绪）· hands · overlay · menu · app（控制台）
overlay.html    桌面宠物（透明窗口）
menu.html       右键菜单
index.html      控制台
tools/docs/     README 素材生成（抓帧 + 合成，见该目录 README）
tools/installer/ 单文件安装包生成（C# 自解压 + 打包脚本）
tools/build-release.ps1  一键构建全部 Windows 发布产物
docs/           README 图片 + 发版说明
test/           node --test 单测（当前 38 项）
```

## 2. 环境要求

- Windows 10/11 x64
- Node 22+（本机 v24.22.1），`node_modules` 已安装（Electron 45.2.1）
- Python 3.10+（本机可用 DSH 自带运行时），需要 `pillow`、`numpy`（仅出图用）
- .NET Framework 4.x 的 `csc.exe`（Windows 自带，用于编译启动器/安装器）
- git（`tools/package_portable.py` 用 `git ls-files` 决定打包内容）
- 首次准备：`npm ci`，然后 `npm test` 确认环境正常

## 3. 常用命令

```powershell
npm start          # 启动桌面宠物（Electron）
npm run preview    # 浏览器预览控制台 http://127.0.0.1:8766
npm test           # node --test，38 项逻辑测试
```

调试快捷键：`Ctrl+Shift+F10` 显示/隐藏　`Ctrl+Shift+F11` 回到原位。

## 4. 重新生成 README 素材

见 [`tools/docs/README.md`](tools/docs/README.md)。简版：

```powershell
node node_modules/electron/cli.js tools/docs/capture.cjs   # 抓帧
python tools/docs/compose.py                               # 合成
python tools/docs/compose.py --install                     # 写入 docs/
```

## 5. 构建发布产物

```powershell
# 全量：测试 → 启动器 → 便携 zip → 图层次包 → 预览图 → SHA256 → 安装包 → 复制到 release/
pwsh -File tools/build-release.ps1

# 常用参数
#   -SkipTests     跳过测试
#   -NoInstaller   不编译安装包（只出便携 zip）
#   -Python PATH   指定 python
#   -ReleaseDir    复制安装包/校验和的目标目录
```

产物（`dist/`，已被 gitignore）：

| 文件 | 说明 |
|---|---|
| `bluefish-desktop-v<ver>-windows-x64.zip` | 便携包（含 Electron 运行时，~167MB） |
| `bluefish-png-layers.zip` | PNG 分层素材 + rig.json |
| `bluefish-preview.gif` | 发布页预览图（取自 docs/hero.gif） |
| `bluefish-setup-v<ver>.exe` | 单文件安装包（~167MB，自解压安装到 `%LOCALAPPDATA%\BluefishDesktop`，建桌面快捷方式并启动） |
| `bluefish-v<ver>-SHA256SUMS.txt` | 上面几项的校验和 |

安装包生成逻辑：`tools/installer/setup-stub.cs`（自解压 C# 程序）编译为 `dist/setup-stub.exe`，
再由 `tools/installer/make_installer.py` 把便携 zip 追加到 exe 尾部（尾部 24 字节为长度 + magic `BLUEFISH-PAYLOAD`）。

## 6. 发布到 GitHub

正常流程（需要 token 带 `workflow` 权限，用于推 `.github/workflows/`）：

```powershell
git tag v<ver>
git push origin v<ver>        # 触发 GitHub Actions 构建并发布 Release
```

或手动发布：建 tag → 在网页上建 Release → 上传上面 5 个文件
（安装包资产名用 `bluefish-setup-v<ver>.exe`，与 SHA256SUMS 对齐）。

**当前状态**：`.github/workflows/portable-release.yml` 的「打 tag 自动发布」改动还留在本地分支
`pending/ci-workflow-scope`（提交 `7c8ed9e`），因为本机 GitHub token 缺 `workflow` scope 推不上去。
拿到权限后：

```powershell
git cherry-pick 7c8ed9e     # 或 git merge pending/ci-workflow-scope
git push origin main
```

## 7. 已知坑

1. **未签名的 exe**：便携包/安装包没有代码签名，通过微信/浏览器下载后首次运行会弹
   “Windows 已保护你的电脑” → 点「更多信息 → 仍要运行」。安装器内部用 `CreateProcess` 启动
   宠物，所以装好后从桌面快捷方式启动不会再弹。
2. **DSH 会话工作区不能直接运行大 exe**：从 `D:\AI coding project\日常任务` 里启动 167MB 自解压
   安装包会被静默拦截；从 `release/`、Downloads 等普通目录运行正常。
3. **`ELECTRON_RUN_AS_NODE=1`**：某些 agent shell 会带这个变量，导致 `electron.exe` 变成 node；
   跑抓帧脚本前先清掉。
4. **隐藏窗口截图**：纯 DOM 动画/WebGL 更新在隐藏窗口里可能截到旧帧，`capture.cjs` 已用
   「加载期注入 CSS + 禁用动画 + 2D 镜像」处理，改抓取逻辑时注意别退化。
5. **`dist/`、`tools/docs/.work/` 都不入库**；`*.exe`、`*.zip` 在 `.gitignore` 里。
6. **出图依赖 Windows 字体**（微软雅黑 / Segoe UI），在别的系统上跑 `compose.py` 会缺字体。

## 8. 已发布版本

| 版本 | 提交 | 资产 |
|---|---|---|
| v0.4.0 | `bf0ad6b` | 便携 zip / 图层次包 / 预览 gif / 安装包 / SHA256SUMS |
| v0.2.1 | `52e080d` | 旧版（CI 构建，2026-11-03） |

Release 页：<https://github.com/fupangzhu/bluefish-desktop/releases>
