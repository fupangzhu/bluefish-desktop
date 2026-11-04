<div align="center">

<img src="assets/icon.png" width="64" height="64" alt="蓝色肥鱼头像">

# 蓝色肥鱼 · Bluefish

**趴在 Windows 任务栏上的桌面小角色。**

会跟着光标看，摸头时晃晃脑袋，被冷落久了也会睡着。

[**下载 Windows 版**](https://github.com/fupangzhu/bluefish-desktop/releases/latest) · [动作演示](#互动) · [使用方法](#开始使用) · [从源码运行](#从源码运行)

Windows 10 / 11 x64 · 透明窗口 · 托盘常驻

</div>

<img src="docs/hero.gif" width="100%" alt="角色趴在任务栏上，眼睛跟随光标，小手轻抬后带着脑袋向两侧挪动">

## 互动

把鼠标移到脑袋附近，来回揉一揉。每次会随机选一种反应，连续揉头时保持同一种。

<img src="docs/petting.gif" width="100%" alt="三种揉头反应并排演示：放松闭眼、睁眼晃头和摆呆毛、轻微摇晃">

- **20% · 放松闭眼**：慢慢闭眼、停稳；离开后等 2–5 秒，再睁眼恢复移动。
- **50% · 开心晃头**：睁着眼睛晃脑袋，呆毛跟着轻摆。
- **30% · 轻轻回应**：小幅摇晃，反应更安静。

捏住呆毛拖动，会先拉直、再回弹；点击哪只耳朵，哪只就快速抖一两下。

## 状态

光标久停或离远后，她会停止注视，渐渐萎靡。**2 分钟**未互动后开始随机入睡，最迟 **10 分钟**一定睡着。

<img src="docs/sleep.png" width="100%" alt="萎靡与睡眠姿态对比：睡眠时头部更低、双眼闭合、耳朵更垂，双手仍在同一条任务栏上">

睡着后趴得更低，耳朵更耷拉，小手仍搭在任务栏上。只有点击角色才会唤醒。靠近或揉动不会打扰睡眠；醒来时随机播放慢慢醒来、轻轻伸展或左右张望，先睁眼再起身。

## 开始使用

1. 打开 [Releases](https://github.com/fupangzhu/bluefish-desktop/releases/latest)，下载 `bluefish-setup-*.exe`。
2. 双击安装，启动后常驻托盘；也可以下载便携 ZIP，完整解压后运行 `蓝色肥鱼.exe`。
3. 拖到任务栏边缘即可贴边，向上拖动可切换为悬浮头像。

当前发布版为 **v0.5.0**，main 源码为 **v0.6.6**。上方的随机揉头与睡眠演示来自 main；可按下方步骤运行最新源码。

| 操作 | 方法 |
| :--- | :--- |
| 调整大小 | 右键滑块，或在角色上按住 `Ctrl` 滚动鼠标滚轮 |
| 移动位置 | 贴边时左右拖动；向上拖成悬浮，拖回底部自动吸附 |
| 显示 / 隐藏 | 托盘菜单，或 `Ctrl` + `Shift` + `F10` |
| 回到原位 | `Ctrl` + `Shift` + `F11` |
| 退出程序 | 右键菜单中的电源按钮 |

## 调整与控制

大小支持 **150–460** 无级调节，贴边与悬浮共用同一套动作。

<img src="docs/sizes.png" width="100%" alt="150、240、460 三种大小的角色搭在同一条任务栏上，按实际比例展示">

### 右键菜单

快速调整大小、切换鼠标跟随与待机动作，也可以隐藏角色或打开控制台。

<img src="docs/menu.png" width="100%" alt="角色旁的右键菜单，包含大小滑块、表情动作、跟随和显示控制">

### 控制台

实时预览角色，调节左右转头、抬头低头和侧向倾斜；也可以导入动作 JSON、单独查看 PNG 图层。

<img src="docs/console.png" width="100%" alt="黑白控制台，左侧实时角色预览，右侧为大小、三个角度、动作与模式控制">

## 从源码运行

需要 Windows 10 / 11 x64 和 Node.js 22 或更高版本。

```powershell
git clone https://github.com/fupangzhu/bluefish-desktop.git
cd bluefish-desktop
npm ci
npm start
```

`npm run preview` 可打开浏览器预览；`npm test` 运行逻辑测试。

角色使用固定坐标的分层 PNG 和 WebGL 网格绑定驱动，不依赖 Live2D。

| 文档 | 内容 |
| :--- | :--- |
| [开发说明](DEVELOPMENT.md) | 项目结构、调试、交互回归与 Windows 打包 |
| [素材制作](tools/docs/README.md) | 从真实界面重新生成本页图片和动画 |
| [更新记录](docs/release-notes.md) | 各版本的动作与功能变化 |
