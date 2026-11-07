<div align="center">

<img src="assets/icon.png" width="64" height="64" alt="蓝色肥鱼">

# 蓝色肥鱼 · Bluefish

Windows 任务栏桌宠

[**下载 Windows 版**](https://github.com/fupangzhu/bluefish-desktop/releases/latest) · [使用说明](docs/usage.md) · [更新记录](docs/release-notes.md)

</div>

<img src="docs/hero.gif" width="100%" alt="鼠标跟随与任务栏挪动演示">

## 互动

<img src="docs/interaction.gif" width="100%" alt="揉头、入睡与点击唤醒的连贯演示">

## 动画编辑器 · 源码

<img src="docs/console.png" width="100%" alt="仅源码提供的动画编辑器，支持单手揉眼、侧瞥和睡眠细节预览">

<details>
<summary>从源码运行</summary>

```powershell
git clone https://github.com/fupangzhu/bluefish-desktop.git
cd bluefish-desktop
npm ci
npm start
npm run editor  # 动画预览与调试
```

</details>

[开发文档](DEVELOPMENT.md) · [素材制作](tools/docs/README.md)

## 致谢

聊天功能（桌面对话、微信）是这个项目自己写的，没有复制下面这些项目的代码；它们提供了思路、参数或协议资料，在此致谢。

| 项目 | 作者 | 参考了什么 |
| :--- | :--- | :--- |
| [MaiBot 麦麦](https://github.com/Mai-with-u/MaiBot) | Mai-with-u（千石可乐等） | 等主人说完再想的防抖时长；规划器和回复器分开；"说话是一个工具，默认沉默"；分句发送和按字数算打字时间 |
| [dsh-fish 大肥鱼](https://github.com/ssamurias/dsh-fish) | ssamurias | 只追加的事件流；用"劲儿"和闸门决定要不要主动开口的做法和参数；主动说的话必须指向真实发生过的事 |
| [dsh-fish-memory 鱼的记忆](https://github.com/Yuuyuko-uu/dsh-fish-memory) | Yuuyuko-uu | 会淡忘的记忆打分公式、长期事实常驻、问句信息量门槛、每日记忆配额 |
| [dsh-bili-whale](https://github.com/ggxx001/dsh-bili-whale) | ggxx001 | 在作息时段里随机醒来；对外发言先预检再发送；额度写死在代码里 |
| [dsh-fish-soul](https://github.com/Britneycode/dsh-fish-soul) | Britneycode | 按人隔离的记忆、关键词与向量检索融合、同一个人格出现在多个平台 |
| [weixin-bot](https://github.com/epiral/weixin-bot) | epiral | 微信 ClawBot（iLink Bot API）协议分析文档和 SDK |
| [wechat-ilink-client](https://github.com/photon-hq/wechat-ilink-client) | photon-hq | iLink 协议细节：请求头、`context_token`、会话过期 |
| [browser-use](https://github.com/browser-use/browser-use) | browser-use | 以后给她上网能力时的参考：网页元素编号、模型选动作、执行后再观察 |
| [QR Code generator](https://github.com/nayuki/QR-Code-generator) | Nayuki | 内置二维码生成器的实现思路 |
| [node-qrcode](https://github.com/soldair/node-qrcode) | soldair | 开发时用来逐格核对内置二维码生成器的结果，不随应用发布 |

微信聊天使用腾讯官方开放的微信 ClawBot（iLink Bot API）；默认的模型接口是 [DeepSeek](https://www.deepseek.com/)。动画部分的参考见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
