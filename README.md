# Bluefish Desktop · 蓝色肥鱼桌面角色

透明、置顶的 Windows 完整头部桌面角色，支持鼠标跟随、眨眼、三轴转头和分层附件动画。当前版本 **v0.2.1**，已修复连续点击时窗口越来越大的问题。

![蓝色肥鱼动画预览](docs/demo.gif)

## 下载运行

从 [Releases](https://github.com/fupangzhu/bluefish-desktop/releases/latest) 下载 Windows 运行包，完整解压后双击 **蓝色肥鱼.exe**。角色会显示在桌面右下角，无需安装 Node、Python 或填写 API Key。请保留整个目录，不能只移动 EXE；运行时已包含在下载包内。

源码仓库不包含编译后的 EXE 和 node_modules；从源码运行请看文末的开发说明。独立 PNG 分件包也提供在 Release 中。

## 使用

- 视线和头部跟随整个桌面的鼠标位置，自动眨眼、呼吸和轻微发梢摆动。
- 按住角色拖动；空白透明区域点击穿透。
- 右键角色：眨眼、单眼眨眼、点头、摇头、开心、开关跟随和待机。
- 右键还可切换 280 / 360 / 460 px 大小，回到右下角，打开动作工作台或退出。
- 系统托盘有角色图标，可显示 / 隐藏或退出。
- `Ctrl+Shift+F10` 显示 / 隐藏，`Ctrl+Shift+F11` 恢复右下角位置。
- 保留原母版的无嘴表情。本角色是完整头部特写，没有添加身体。

v0.2.1 修复了 Windows 150% 显示缩放下反复单击导致窗口越来越大的问题。单击仅触发眨眼，移动至少 5 个逻辑像素才开始拖动；拖动始终保持所选大小。

动作工作台中有三个角度滑杆、母版对照、单独查看分件、动作按钮和 JSON 曲线导入。桌面角色右键打开即可；或运行“启动动作工作台.cmd”（该独立脚本需要 Node.js）。

## PNG 分件和绑定

`assets/layers/` 内有 19 张 2048×2048 RGBA PNG，所有坐标固定：

body、hair_back、face、ear_l、ear_r、eye_l_open/half/closed、eye_r_open/half/closed、blush_l、blush_r、mouth、hair_front、ahoge、headdress、bow_l、bow_r。

body.png 和 mouth.png 是有意保留的空透明层，因为母版没有身体和嘴。其余 17 张有内容。眼睛三态共用绑定包围盒与中心；半闭眼保留原眼睛像素位置，通过上眼睑遮挡，闭眼是程序绘制的弧线。

- `assets/master-source.png`：生图模型返回的完整头部候选，原生 1254×1254。
- `assets/master.png`：清理透明边缘、规范实色区 alpha 后，Lanczos 重采样到 2048 的固定母版。不是原生 2K 生图。
- `assets/reconstructed.png`：按绑定顺序叠加分件的检查图。
- `assets/rig.json`：层顺序、各层枢轴、深度、包围盒、眼睛变体及补底记录。
- `assets/split-validation.json`：分件和叠加的量化检查结果。
- `tools/build_complete_rig.py`：可复现的分件与补底脚本，需要 Pillow 和 NumPy。

绑定已在本程序中实际运行：后发、脸、耳鳍、眼睛、腮红、刘海、蕾丝、蝴蝶结、呆毛分别绘制，使用弯曲网格和不同控制枢轴；后发、蝴蝶结和呆毛有跟随延迟。范围为左右 ±18°、上下 ±12°、侧倾 ±10°。

这是 **自定义 WebGL 分层网格绑定**，不包含 Live2D Cubism 的 .moc3 工程，不能直接作为 Cubism 模型导入其他播放器。支持头像小幅转动，不提供真实侧面或背面。

## 补绘与对齐说明

可见像素主要来自固定母版；脸部遮挡区、眼睛与腮红后的皮肤、后发底板以及附件根部做了代码补底。闭眼线是新增动画形态。因此不声称所有图层都是原图无损擦除。

12px 重叠只在有上层遮挡的连接边缘加入；外轮廓不外扩成色边，眼睛、腮红、蝴蝶结等没有可隐藏外扩空间的边缘保持原有轮廓。无姿态时重叠合成与固定母版的平均 RGBA 通道误差约 0.124 / 255；少量抗锯齿边缘存在差异，并非像素完全相同。

## PromptSoul

保留 PromptSoul 已解析动作 segment 的离线参数适配，支持 ParamAngleX/Y/Z、ParamEyeLOpen/ROpen、ParamEyeBallX/Y。工作台的“播放适配示例”可直接验证；未知参数和没有归零的曲线会被拒绝。聊天、语音、提示词生成动作服务没有接入，也不需要它们才能运行角色。

## 验证与开发

通过 11 项动作与拖动测试、4 项 PNG 合同检查，及真实 Chromium 的极限姿态、眨眼、分件显示和界面交互检查。Windows 150% 显示缩放下，连续点击 30 次后窗口和画布保持 360×360，30 次拖动更新未产生累积放大。Electron 也验证了全局鼠标、透明背景、拖动释放、大小切换和托盘。

![姿态检查](docs/pose-review.jpg)

从源码开始（需要 Node.js 22.12+，桌面模式需要 Windows）：

```powershell
git clone https://github.com/fupangzhu/bluefish-desktop.git
cd bluefish-desktop
npm ci
node node_modules/electron/install.js
npm test
npm start
```

`npm run preview` 启动本地浏览器工作台，默认地址 http://127.0.0.1:8766 。

Windows 原生点击回归检查：

```powershell
node_modules\electron\dist\electron.exe test\click-window.cjs
```

测试输出和隔离配置保存在 .test-output/，不会进入 Git。重建 PNG 分件需要 Python、Pillow 和 NumPy：`python tools/build_complete_rig.py`。

可选 EXE 启动器的源代码位于 tools/BluefishLauncher.cs；源码运行直接使用 npm start 即可。

窗口位置保存在系统应用数据目录 bluefish-complete/window.json。程序不修改开机启动，不访问摄像头或麦克风，不发送聊天或图片到外部服务。
