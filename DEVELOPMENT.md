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
test/           node --test 单测（当前 161 项）+ Electron 交互回归
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

编辑器提供 20 个确定性动画预览，含拽呆毛护头、双击捂头下躲、拽呆毛走（虚拟指针牵着头走，画面平移代替窗口移动）、拽走后下躲、靠左墙/右墙发呆（这几个预览会画出 Windows 风格任务栏、显示器边框和屏幕边，小手搭在任务栏上）、轻拨刘海、左右侧瞥、单手揉眼、假醒和睡眠微动作，支持暂停、拖动时间轴和 0.25–4 倍速。编辑器直接使用 `Motion` 与同一 WebGL 渲染器。`desktop/editor.cjs` 为开发入口；运行时服务默认禁止编辑器路由。

日常开发直接修改源码并重启本机桌宠；只有明确要求发布时才构建 EXE/ZIP。发布清单 `desktop/runtime-files.json` 排除 index/style/app/preview/editor、测试、工具和文档，右键菜单不包含动画按钮或编辑器入口。

调试快捷键：`Ctrl+Shift+F10` 显示/隐藏　`Ctrl+Shift+F11` 回到原位。

### 呆毛、刘海与耳朵交互（当前源码）

- 刘海支持划过轻晃与按住轻拨，发根固定，仅局部末梢弯动；拖动限幅 1.8% 水平 / 0.8% 竖直，松开阻尼回弹。`src/fringe.mjs` 共用控制与变形，脸部继续用于移动窗口。
- 呆毛换边走下方弧线，始终位于角色最高图层；保持二次轮廓和固定发根。
- 贴边模式下拽呆毛沿任务栏移动（`src/tow.mjs` 的 `Tow`，形状在 `src/ahoge.mjs` 的 `TAUT`/`solveAhoge`）：分拉动、绷直、拽走三段，以“捏住点到发根沿卷曲的长度”（`ahogeReach`，发梢处约 0.32×头宽）为单位。指针离发根不到 0.70 倍时只弯卷曲（拉动）；0.70–1.0 倍时卷曲逐渐拉成一条指向指针的直线（绷直，保持锥形，捏点始终在指针下）；超过 1.04 倍头部才开始移动（拽走）。拽走时呆毛是只拉不推的弹性绳（ω=20、ζ=0.45），最多拉长到 1.10 倍，再远就刚性拖动；指针停下时头部滑过一点、呆毛略微松弛后停住；指针往回不会推头。捏点离发根太近时绳长按 0.06×头宽计。松手后顺势滑行一小段。指针高出/低于发根超过 1.06 倍绳长，或贴着屏幕边硬拉超过 1.3 倍，呆毛脱手并以更松的摆幅回弹、双耳一抖。悬浮模式拉远时同样会绷直。松手或脱手后，拉直过半的呆毛按“绕发根转动”的方式重新卷回（每个控制点按角度和距离插值，`curlBlend`），不会瞬间弹回，也不会在中途绕成圈；弹过原位的幅度限制在 35 个原画像素内，只是卷得稍紧一点再回正。牵引中不出现 >< 疼痛眼和护头，只有朝拉动方向歪头、微眯眼；接近脱手高度时才短暂出现疼痛眼。渲染进程模拟弹簧，经 `tow` IPC 请求窗口 x，主进程按贴边范围夹紧。
- 下躲（`src/tow.mjs` 的 `Dip`，双击捂头和拽走后共用）：下沉 0.3×头宽，眼睛藏到任务栏下，头顶、耳朵和呆毛留在上面；全程不透明、不淡出，小手一直扶着任务栏边。头部沿临界阻尼弹簧下沉/起身（下沉 ω=11 约 0.45 秒，起身 ω=4.2 约 1.2 秒，被再次抓呆毛时 ω=12），不会超过设定深度，也不会弹过原位；没有探头等多余动作。呆毛是由头部竖直加速度驱动的阻尼摆（约 2.3 Hz、ζ=0.12，限幅 20°）：下沉时尖端先上扬，停住时被甩下，再来回摆一两下；起身慢，几乎不再摆。双击捂头：先双手护头，0.85 秒时手回到任务栏、同时下躲，躲着时闭眼。拽走后：被牵引移动超过 0.12×头宽，松手后必定下躲，半眯眼、看向拉动的反方向、耳朵和呆毛耷拉。再次抓呆毛会提前起身。悬浮模式没有任务栏，只轻轻下蹲 0.09×头宽。
- 靠墙发呆（`src/slump.mjs`）：贴边且头部离没有相邻显示器的屏幕边足够近时视为靠墙（按发呆姿态实测的外沿：右侧耳朵 0.40、左侧耳朵与头发 0.37×头宽；贴墙时再压进 0.06，由压扁的耳朵吸收，左侧耳朵下方的头发可能略出屏幕）。拖到墙边松手后 50% 概率、在墙边待机时每 30–60 秒 30% 概率触发：头歪向墙并贴过去、身体下滑，贴墙那只耳朵向内折并被压扁（`earPressL/R`），呆毛和另一只耳朵耷拉，半睁眼呆看下方，持续 6–12 秒。点击、拖动或离开墙边立即结束；关闭待机、减少动态效果、睡眠时不触发。
- 捏住呆毛后拖动：按实际命中的网格位置固定抓点。两侧各 5 个二次样条控制点，靠近发根的 2 个固定，其余 3 个成对移动；实际轮廓出现急弯或达到 18% 长度上限时开始抵抗。松手从最后画出的形状回弹，重新抓住沿用当时的轮廓。
- 单击哪只耳朵，哪只随机快速折动 1–2 次；在耳朵上拖动仍可移动整个角色。
- 待机时每隔随机 60–120 秒触发一次较轻的单耳扑闪；关闭待机或开启减少动态效果时停用，手动交互会推迟下一次。
- 情绪耳姿态由 `Motion` 的 `earMood` 驱动：萎靡随现有 droop 信号缓慢下垂，happy 时小幅立高再回到常态。渲染角度基线为下垂约 38° / 兴奋上抬最多 8°，耳根固定，点击与待机扑闪叠加并限幅。
- 桌宠与源码编辑器共用 `src/touch.mjs`；命中检测反算实际变形网格并检查像素透明度，避开呆毛环内空白和被遮住的耳朵。
- `src/ahoge.mjs` 定义五控制点二次 B 样条和切线连续的两侧轮廓（SVG 使用 Q 段）、蓝色渐变、材质抓点、长度约束与释放回弹。WebGL 直接绘制同源的向量网格，抓点反算头部投影，超过弹性范围后产生阻力。`npm run export:ahoge` 导出匹配的 `assets/vector/ahoge.svg`、2048×2048 透明 `assets/layers/ahoge.png` 和 rig 边界。
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
| v0.7.0 | tag `v0.7.0` | 拽呆毛走（拉动/绷直/拽走）/ 下躲合并 / 靠墙发呆；便携 zip / 图层包 / 预览 gif / 呆毛 SVG / 安装包 / SHA256SUMS |
| v0.6.6 | tag `v0.6.6` | 随机揉头 / 闲置睡眠 / 点击唤醒；便携 zip / 图层包 / 预览 gif / 安装包 / SHA256SUMS |
| v0.5.0 | tag `v0.5.0` | 呆毛牵拉 / 独立折耳 / 待机扑耳 / 情绪耳姿态；便携 zip / 图层次包 / 预览 gif / 安装包 / SHA256SUMS |
| v0.4.0 | `bf0ad6b` | 便携 zip / 图层次包 / 预览 gif / 安装包 / SHA256SUMS |
| v0.2.1 | `52e080d` | 旧版（CI 构建，2026-11-03） |

Release 页：<https://github.com/fupangzhu/bluefish-desktop/releases>
