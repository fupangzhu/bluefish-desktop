# 小鱼的 Rust 原生版（设计稿）

状态：2026-11-11 开工，分支 `feat/rust-native`，代码在 `native/`。Electron 版继续作为发行版，直到 Rust 版功能追平。

## 进度（2026-11-11）

- 工具链：Rust stable，GNU 目标（`native/rust-toolchain.toml`）。VS Build Tools 的管理员安装被取消，GNU 目标不需要它。
- 已完成并有测试：动作全部模块（金样逐帧对比 JS，约 3 万帧，最大误差 1.9e-12）；渲染几何（顶点与点击判定对比 JS，120 万个坐标）；CPU 光栅化和 Direct3D 11 两条绘制路径（与 WebGL 截图逐像素对比，平均误差约 0.1/255）；分层窗口、拖动、脱离/趴回任务栏、呆毛牵引、托盘、原生右键菜单、快捷键、设置文件（`native/` 下 `cargo test`，以及 `BLUEFISH_SMOKE` 冒烟）。
- 实测（240 大小、150% 缩放、空闲 30 帧）：

| | 独占内存 | 空闲 CPU |
|---|---|---|
| Electron 0.7 | 约 370MB（6 个进程） | 约 33% 单核 |
| 原生，CPU 绘制（`BLUEFISH_CPU=1`） | 约 21MB（1 个进程） | 约 20% 单核 |
| 原生，Direct3D 11 绘制 | 约 100MB（显卡驱动占大头） | 约 6% 单核 |

- 绘制路径：默认 Direct3D 11（用户选定），`BLUEFISH_CPU=1` 或显卡不可用时退回 CPU。
- 里程碑 2（聊天）已完成：`native/src/chat/`（设置与每日额度、DPAPI 存密钥、首次运行导入 Electron 版的设置/Key/微信凭证/聊天记录、OpenAI 兼容客户端、规划器/回复器、防抖与打断、微信 ClawBot、截图/读窗口/看图）和 `native/src/win/chat_ui.rs`、`chat_app.rs`（系统控件做的气泡和设置窗口，单击/菜单/Ctrl+Shift+F9 打开）。`node native/golden/chat-smoke.cjs` 用假模型和假微信端到端验证。
- 界面按原版 OMNI 设计复刻（2026-11-12）：`native/src/ui/` 是一套小的 Direct2D/DirectWrite 绘制工具（tokens.css 的颜色、圆角、字体，icons.mjs 的描边图标原样解析，图标按钮、药丸、细线滑条、开关、状态点、下拉列表、带输入法与剪贴板的文本框）。右键菜单（`win/menu.rs`）、聊天气泡与设置面板（`win/bubble.rs`，含小尾巴、深色模式、设置区滚动）、动作编辑器（`win/editor.rs`，`bluefish.exe --editor [--preview 名称 --at 秒]`，20 个预览由 `motion/preview.rs` 逐行移植并有金样测试）都用它绘制。
- 还没做：B站扫码登录（需要内嵌浏览器）；菜单和气泡的弹出动画；编辑器的悬停提示（原版的 title）；睡着/揉眼等手部阴影只是近似；安装包与自动更新（里程碑 4）。
- 第 3 节"CPU 光栅化足够"的估计偏乐观：实际每帧约 5ms，见上表。

## 0. 为什么重写

Electron 版稳定后独占内存约 370MB（主进程、GPU 进程、工具进程、三个渲染进程），启动时 GPU 进程冲到约 600MB。真正画小鱼的那部分只占很小一块，其余都是 Chromium 的固定开销，靠优化省不掉。

目标：

| | Electron 0.7 | Rust 目标 |
|---|---|---|
| 进程数 | 6 | 1 |
| 稳定独占内存 | 约 370MB | 30MB 以内 |
| 空闲 CPU（165Hz 屏） | 约 33% 单核（修复后） | 5% 以内 |
| 安装包 | 约 100MB | 5MB 以内（含美术资源） |

## 1. 不变的东西

- 美术资源 `assets/`（`rig.json`、图层 PNG）原样使用，不重新导出。
- 行为一律以现有 JS 为准：`src/motion.mjs`、`touch.mjs`、`attention.mjs`、`peek.mjs`、`tow.mjs`、`ahoge.mjs` 等逐个函数翻译，**数值不改**。
- 设置文件沿用 `%APPDATA%/bluefish-complete/window.json` 的格式，换版本不丢大小、位置和开关。
- 聊天大脑的设计（`2026-11-06-chat-brain-design.md`）不变，第二个里程碑用 Rust 重新实现。
- 动作编辑器（`npm run editor`，浏览器工具）不移植，继续用 JS 版。它只是开发工具，不随桌宠运行。

## 2. 窗口：分层窗口，不再用鼠标钩子

一个 Win32 分层窗口（`WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE`），每帧把画好的预乘 BGRA 位图交给 `UpdateLayeredWindow`。

- **点击穿透由系统按像素判断**：透明的地方鼠标直接落到下面的窗口，不需要 `setIgnoreMouseEvents`，也没有任何全局鼠标钩子。Electron 版"整机鼠标卡死"那类问题从结构上消失。
- 按下时 `SetCapture`，拖动由本进程自己按光标位移挪窗口，和 Electron 版 `drag.cjs`、`dock.cjs` 的规则一致（趴着只能横移、往上拉 0.35 倍大小就脱离任务栏、靠近底边自动趴回）。
- 视线跟随仍然是每 33ms 读一次 `GetCursorPos`，和现在一样。
- 每个显示器单独的 DPI（Per-Monitor V2）。内部统一用设备无关像素（DIP），绘制时乘缩放比例。
- 趴着时每 2 秒重新置顶一次，盖住任务栏。

## 3. 绘制：CPU 光栅化

小鱼在屏幕上很小：240 大小时，2048 的美术网格只占约 211 DIP，缩放 150% 也才约 320 像素见方。所有图层加起来每帧大约 17 万像素，CPU 直接画完全够用，不需要 GPU，也就没有 GPU 进程和显存。

- 图层加载时按 rig 里的 `box` 裁剪，并预先缩成几级（相当于 mipmap），绘制时按当前缩放挑最接近的一级做双线性采样。内存只留裁剪后的小图。
- 每层仍是 22×22 网格（眼睛 6×6，呆毛 256 段条带），顶点投影逐行翻译 `renderer.mjs` 的 `project()`。
- 眼睛片元着色器（眼睑弧线、瞳孔遮罩、侧目、描边）翻译成每像素函数，只在眼睛图层的范围里跑。
- 手（任务栏边上的两团）、捂头、揉眼的手用 tiny-skia 画椭圆和阴影。
- 预乘 alpha 混合（`ONE, ONE_MINUS_SRC_ALPHA`），和 WebGL 版一致。
- 绘制结果同时用于点击判定：判断"点在哪个部位"沿用网格反查纹理 alpha（`pickHit`），判断"点没点到她"直接看帧缓冲 alpha。
- 帧率：和 Electron 修复后一致，互动时 60 帧、空闲 30 帧；隐藏时不画。

以后如果要更省 CPU，可以换成 Direct3D 11 加 DirectComposition 的后端，接口按"给一个位姿，出一帧图"设计，换后端不影响其余部分。

## 4. 代码结构（`native/`）

```
native/
  Cargo.toml
  src/
    main.rs        入口：单实例、加载设置、建窗口、消息循环
    rig.rs         读 rig.json 和图层 PNG，裁剪并生成多级缩小图
    rng.rs         可注入的随机数（测试用固定种子）
    motion/        逐文件翻译 JS：spring、motion、touch、attention、eyelids、
                   doze、wake、slump、sleep、reluctance、peek、tow、fringe、ears、eyes、ahoge
    render/        project()、三角形光栅化、眼睛着色、手
    pet.rs         对应 overlay.mjs：布局、输入状态机、单击/双击/拖动判定、每帧调度
    window.rs      分层窗口、DPI、消息处理
    dock.rs        对应 dock.cjs 和 drag.cjs
    menu.rs        右键菜单（大小滑条、三个开关、说话/隐藏/退出）
    tray.rs        托盘图标和全局快捷键
    settings.rs    window.json 读写
```

依赖尽量少：`windows`（Win32）、`png`、`tiny-skia`、`serde`/`serde_json`。菜单上的数字用运行时读取的系统字体（`fontdue`），不打包字体。

## 5. 怎么保证"和原来一模一样"

**金样测试**：`native/golden/` 下有一个 Node 脚本，用固定种子的随机数驱动 JS 版的 `Motion`、`Peek` 等，喂一段脚本化输入（指针移动、按住、拖动、拽呆毛、拍头、长时间不理），每帧把输出写成 JSON。Rust 测试用同样的种子和输入重放，逐帧比对，误差不超过 1e-9。`project()`、`solveAhoge()`、`deformEar()`、`eyeFrame()` 等纯函数也单独做金样对比。

画面用截图对比：同一位姿下 Electron 截图和 Rust 渲染逐像素比较，允许抗锯齿边缘的小误差。

## 6. 里程碑

1. **小鱼本体**：窗口、绘制、全部动作和触摸（拖动、刘海、呆毛牵引、耳朵、睡觉、靠墙、探头、拍头躲下）、右键菜单、托盘、快捷键、设置文件。验收：金样测试全过，内存和 CPU 达到第 0 节目标。
2. **聊天**：原生气泡和设置面板（egui，运行时读取系统中文字体），DeepSeek 客户端、规划器/回复器、事件流、微信 ClawBot。API key 和微信 token 改用 Windows DPAPI 加密。
3. **工具和站点**：截屏/读窗口（她的"手和眼"）、代理设置、B 站扫码登录（只在登录时临时开一个 WebView2 窗口，登录完就关）。
4. **发行**：替换 Electron 版，安装包、自动更新。

## 7. 风险

- **CPU 光栅化在最大尺寸加 200% 缩放时**每帧约 110 万像素，30 帧下可能用到 20% 以上单核。对策：每层先用包围盒剔除；多级缩小图让采样不跨级；必要时再换 Direct3D 后端（第 3 节）。
- **分层窗口的点击判定是 alpha 大于 0**，Electron 版是 alpha 大于 24。差别只在抗锯齿的半透明边缘，可接受。
- **逐行翻译的工作量**：行为代码约 2000 行，靠金样测试兜底，不靠肉眼。
