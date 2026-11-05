# 开发与发布环境

> 给接手的 agent / 开发者：这份文档说明环境在哪、怎么跑、怎么出图、怎么打包发布。

## 1. 位置

以下路径均相对于克隆后的仓库：

| 内容 | 路径 |
| :--- | :--- |
| 源码与资源 | 仓库根目录 |
| Windows 发布产物 | `dist/` |
| README 原始抓帧 | `tools/docs/.work/readme-v2/` |
| 应用安装目录 | `%LOCALAPPDATA%\BluefishDesktop` |

仓库内关键位置：

```
desktop/        Electron 主进程（窗口、贴边、拖拽、菜单、独立源码编辑器、单实例锁、托盘）
src/            renderer（WebGL 分层网格）· motion · peek（小手/情绪）· hands · overlay · menu · app / preview（仅源码编辑器）
overlay.html    桌面宠物（透明窗口）
menu.html       右键菜单
index.html      源码动画编辑器
tools/docs/     README 素材生成（抓帧 + 合成，见该目录 README）
tools/installer/ 单文件安装包生成（C# 自解压 + 打包脚本）
tools/build-release.ps1  一键构建全部 Windows 发布产物
docs/           README 图片 + 发版说明
test/           node --test 单测（当前 136 项）+ Electron 交互回归
```

## 2. 环境要求

- Windows 10/11 x64
- Node 22+，`node_modules` 已安装（Electron 45.2.1）
- Python 3.10+，需要 `pillow`（出图用；历史合成脚本另需 `numpy`）
- .NET Framework 4.x 的 `csc.exe`（Windows 自带，用于编译启动器/安装器）
- git（`tools/package_portable.py` 用 `runtime-files.json` 限定发布内容，`git ls-files` 检查已跟踪文件）
- 首次准备：`npm ci`，然后 `npm test` 确认环境正常

## 3. 常用命令

```powershell
npm start          # 启动桌面宠物（Electron）
npm run editor     # 独立源码动画编辑器（不随 Windows 发布包分发）
npm run preview    # 浏览器预览编辑器 http://127.0.0.1:8766
npm test           # node --test，逻辑测试
```

在源码文件夹双击 `open-editor.cmd`（原 `启动动作工作台.cmd` 也指向此入口），或运行 `npm run editor`。本机另有桌面快捷方式“肥鱼动画编辑器”。

编辑器提供 13 个确定性动画预览，含左右侧瞥、单手揉眼、假醒和睡眠微动作，支持暂停、拖动时间轴和 0.25–4 倍速。编辑器直接使用 `Motion` 与同一 WebGL 渲染器。`desktop/editor.cjs` 为开发入口；运行时服务默认禁止编辑器路由。

日常开发直接修改源码并重启本机桌宠；只有明确要求发布时才构建 EXE/ZIP。发布清单 `desktop/runtime-files.json` 排除 index/style/app/preview/editor、测试、工具和文档，右键菜单不包含动画按钮或编辑器入口。

调试快捷键：`Ctrl+Shift+F10` 显示/隐藏　`Ctrl+Shift+F11` 回到原位。

### 呆毛与耳朵交互（当前源码）

- 捏住呆毛后拖动：按实际命中的发丝位置固定抓点，保持发根与头饰连接；沿发丝曲线先用弯曲余量拉直，再最多约 18% 弹性拉伸。抓点附近有轻微捏紧，松手阻尼回弹，疼痛眼睛随之恢复。
- 单击哪只耳朵，哪只随机快速折动 1–2 次；在耳朵上拖动仍可移动整个角色。
- 待机时每隔随机 60–120 秒触发一次较轻的单耳扑闪；关闭待机或开启减少动态效果时停用，手动交互会推迟下一次。
- 情绪耳姿态由 `Motion` 的 `earMood` 驱动：萎靡随现有 droop 信号缓慢下垂，happy 时小幅立高再回到常态。渲染角度基线为下垂约 38° / 兴奋上抬最多 8°，耳根固定，点击与待机扑闪叠加并限幅。
- 桌宠与源码编辑器共用 `src/touch.mjs`；命中检测反算实际变形网格并检查像素透明度，避开呆毛环内空白和被遮住的耳朵。
- `src/ahoge.mjs` 定义六控制点三次 B 样条和曲率连续的两侧轮廓、蓝色渐变、材质抓点、长度约束与释放回弹。WebGL 直接绘制同源的向量网格，抓点反算头部投影，超过弹性范围后产生阻力。`npm run export:ahoge` 导出匹配的 `assets/vector/ahoge.svg`、2048×2048 透明 `assets/layers/ahoge.png` 和 rig 边界。
- 上述交互从 v0.5.0 起包含在安装包与便携包中；源码运行可使用仓库中的启动脚本或 `npm start`。

```powershell
node node_modules/electron/cli.js test/touch-window.cjs
```

此回归使用隐藏 Electron 窗口，验证 150 / 240 / 460 尺寸、贴边 / 悬浮模式、左右耳随机次数、牵拉 / 拉直 / 拉伸、抓点跟随、发根固定、萎靡 / 兴奋耳姿态、待机扑耳及失焦恢复；结果与截图在 `.test-output/touch/`。

## 4. 重新生成 README 素材

见 [`tools/docs/README.md`](tools/docs/README.md)。简版：

```powershell
node node_modules/electron/cli.js tools/docs/capture-readme.cjs  # 真实界面抓帧
python tools/docs/compose-readme.py --install                   # 统一排版并写入 docs/
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

自动发布工作流合入后的流程（修改 `.github/workflows/` 需要 token 带 `workflow` 权限）：

```powershell
git tag v<ver>
git push origin v<ver>        # 触发 GitHub Actions 构建并发布 Release
```

或手动发布：建 tag → 在网页上建 Release → 上传上面 5 个文件
（安装包资产名用 `bluefish-setup-v<ver>.exe`，与 SHA256SUMS 对齐）。

当前使用本地构建 + GitHub CLI 发布：版本写入 package.json 与 package-lock.json → 提交全部源码 → 运行构建脚本 → 验证安装包 → 推送 main 与 tag → 创建并上传草稿 Release → 校验资产 SHA256 后发布为 latest。

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
| v0.6.6 | tag `v0.6.6` | 随机揉头 / 闲置睡眠 / 点击唤醒；便携 zip / 图层包 / 预览 gif / 安装包 / SHA256SUMS |
| v0.5.0 | tag `v0.5.0` | 呆毛牵拉 / 独立折耳 / 待机扑耳 / 情绪耳姿态；便携 zip / 图层次包 / 预览 gif / 安装包 / SHA256SUMS |
| v0.4.0 | `bf0ad6b` | 便携 zip / 图层次包 / 预览 gif / 安装包 / SHA256SUMS |
| v0.2.1 | `52e080d` | 旧版（CI 构建，2026-11-03） |

Release 页：<https://github.com/fupangzhu/bluefish-desktop/releases>
