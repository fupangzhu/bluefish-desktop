# docs 素材生成

`docs/` 里的 README 图片全部由本目录的两个脚本从**真实运行的应用**里生成，不是手绘：

| 文件 | 作用 |
|---|---|
| `capture.cjs` | Electron 抓取脚本：自己起一个静态服务（注入透明背景 CSS），用隐藏窗口加载 `overlay.html` / `menu.html` / `index.html`，通过 `window.bluefish` 接口驱动指针、闹脾气、点击，逐帧 `capturePage()` 截图 |
| `compose.py` | Pillow 合成：画浅色渐变背景、任务栏图标与时钟、标题、光标，把抓到的帧/静帧拼成 `hero.gif`、`moods.gif`、`sizes.png`、`menu.png`、`console.png`（GIF 用有序抖动避免渐变断层） |

## 依赖

- Node 22+，仓库里已 `npm ci`（Electron 45）
- Python 3.10+，`pillow`、`numpy`
- Windows 自带字体：`msyh.ttc` / `msyhbd.ttc` / `segoeui.ttf`（脚本里写死了 `C:\Windows\Fonts`）
- 不需要联网

## 用法

在仓库根目录执行：

```powershell
# 1. 抓帧/截图（全部 5 组，约 2-3 分钟）
node node_modules/electron/cli.js tools/docs/capture.cjs

# 也可以只抓某一组：hero / moods / sizes / menu / console
node node_modules/electron/cli.js tools/docs/capture.cjs --only=sizes

# console 需要非 2x 缩放才能完整截到窗口（默认 2x 会被屏幕尺寸裁切）
$env:CAP_DPR = "1.5"
node node_modules/electron/cli.js tools/docs/capture.cjs --only=console
Remove-Item Env:CAP_DPR

# 2. 合成（输出到 tools/docs/.work/build）
python tools/docs/compose.py

# 3. 确认效果后写进 docs/
python tools/docs/compose.py --install
```

> 如果 shell 里存在 `ELECTRON_RUN_AS_NODE=1`，先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`（或 `unset`），
> 否则 `electron.exe` 会当成普通 node 运行。

## 输出

- `tools/docs/.work/shots/`：原始帧（`frames/hero`、`frames/moods`、`stills/`）
- `tools/docs/.work/build/`：最终 5 个文件
- 两个目录都在 `.gitignore` 里；改完样式/帧内容后重新跑即可

## 几个已知坑

- **隐藏窗口的 DOM 不重绘**：菜单/控制台必须靠「加载时注入 CSS」+「禁用 CSS 动画」拿到正确首帧；控制台的 WebGL 画面要用一个 2D canvas 镜像每帧，否则截到空白。
- **`capturePage()` 尺寸**：窗口是 `useContentSize` + `--force-device-scale-factor=2`，抓到的 PNG 是 CSS 像素的 2 倍；动画帧固定缩回 800×392 再合成。
- **GIF 循环**：`hero` 用自适应状态机驱动（等 `peek.offset` 到 ±0.12 再反向），保证结尾回到起始位置、循环不跳。
- **光标**：应用窗口本身不画鼠标指针，GIF 里的箭头是按录制的指针坐标在合成阶段叠加的。
- **改文案**：标题/副标题在 `compose.py` 的 `build_gif(...)` 调用里；任务栏图标与时钟在 `draw_taskbar` / `draw_icon`。
