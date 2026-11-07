# Third-party components and references

## Runtime dependencies

Electron is installed from npm and is not vendored in this source repository. The portable Windows release includes Electron's unmodified runtime and accompanying LICENSE, LICENSES.chromium.html, and notices. Refer to those files for the runtime's licenses.

The dependency graph and integrity hashes are recorded in package-lock.json.

## Animation references

The motion controller and layered renderer in this repository were written for this character. Related implementations studied for animation concepts and interfaces:

- [nasawz/GrokBot](https://github.com/nasawz/GrokBot)
- [Coiggahou2002/grokbot-web](https://github.com/Coiggahou2002/grokbot-web)
- [iduu/grokbot-animation](https://github.com/iduu/grokbot-animation)
- [promptwhisper/promptsoul](https://github.com/promptwhisper/promptsoul), particularly its resolved action-cue interface

These projects are not bundled, and the included character image is not a Grok character asset. The PromptSoul adapter handles offline JSON parameter curves; it does not bundle or start PromptSoul.

## Chat references

The chat brain (desktop bubble and WeChat channel) was written for this project. No code from the projects below is included; they were studied for ideas, parameters and protocol details:

- [Mai-with-u/MaiBot](https://github.com/Mai-with-u/MaiBot) (GPL-3.0): message debounce timings, separate planner and replyer, speaking as a tool with silence as the default, sentence splitting and typing delay.
- [ssamurias/dsh-fish](https://github.com/ssamurias/dsh-fish): append-only event stream, drive and proactive-speech gate, proactive lines that must cite real events.
- [Yuuyuko-uu/dsh-fish-memory](https://github.com/Yuuyuko-uu/dsh-fish-memory): fading memory scoring, always-present long-term facts, query gate and daily memory quota.
- [ggxx001/dsh-bili-whale](https://github.com/ggxx001/dsh-bili-whale) (MIT): random wake-ups inside a schedule window, dry-run before posting, hard-coded quotas.
- [Britneycode/dsh-fish-soul](https://github.com/Britneycode/dsh-fish-soul): per-person memory, keyword and vector retrieval fusion, one persona across platforms.
- [epiral/weixin-bot](https://github.com/epiral/weixin-bot) and [photon-hq/wechat-ilink-client](https://github.com/photon-hq/wechat-ilink-client): documentation of Tencent's WeChat ClawBot (iLink Bot) protocol used by src/brain/weixin.mjs.
- [browser-use/browser-use](https://github.com/browser-use/browser-use) (MIT): reference for a later, read-only web capability.

src/qr.mjs is an independent QR Code encoder following the structure of [nayuki/QR-Code-generator](https://github.com/nayuki/QR-Code-generator) (MIT). Its output was checked module by module against [soldair/node-qrcode](https://github.com/soldair/node-qrcode) (MIT) during development; that package is not a dependency and is not shipped.

## Artwork provenance

The head artwork was generated from a supplied character reference, then separated into source-aligned layers and completed in occluded regions. assets/master-source.png is the 1254-pixel generated source; assets/master.png and the 2048-pixel layers are resampled derivatives. Completion details are recorded in assets/rig.json.

The two rounded hand shapes are drawn in code (src/hands.mjs). Demo media in docs/ uses an abstract mock desktop, not a capture of a real desktop.
