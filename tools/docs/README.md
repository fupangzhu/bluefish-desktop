# README 素材生成

首页媒体来自真实运行的角色与界面，统一使用 800px 展示宽度、中性背景、相同的背景、画幅和任务栏基线，不叠加标题、标签或说明文字。PNG 以双倍分辨率保存，GIF 使用共享调色板以减少闪色。

## 重新生成

需要仓库的 Electron 依赖、Python 3.10+ 和 Pillow，以及 Windows 自带的微软雅黑字体。

```powershell
node node_modules/electron/cli.js tools/docs/capture-readme.cjs
python tools/docs/compose-readme.py --install
```

抓帧和合成中间文件保存在 `tools/docs/.work/readme-v2/`，已被 Git 忽略。脚本使用独立的隐藏窗口与配置目录，不修改正在运行的桌宠。

| 文件 | 内容 |
| :--- | :--- |
| `docs/hero.gif` | 鼠标跟随与任务栏挪动 |
| `docs/interaction.gif` | 揉头、睡眠与点击唤醒的连续演示 |
| `docs/sleep.png` | 萎靡与趴睡姿势，相同任务栏高度 |
| `docs/sizes.png` | 150 / 240 / 460 按真实比例展示 |
| `docs/menu.png` | 角色和右键菜单 |
| `docs/console.png` | 完整控制台预览与调节区 |

`capture-readme.cjs` 控制真实应用并逐帧截图；`compose-readme.py` 负责背景、画幅、边距和基线。演示中的揉头分支及入睡时机由抓帧脚本指定，产品中的随机概率保持不变。

旧版 `capture.cjs` / `compose.py` 仍可复现历史演示；首页更新请使用上面的新脚本。
