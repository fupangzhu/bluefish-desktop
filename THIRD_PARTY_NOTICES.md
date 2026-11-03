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

## Artwork provenance

The head artwork was generated from a supplied character reference, then separated into source-aligned layers and completed in occluded regions. assets/master-source.png is the 1254-pixel generated source; assets/master.png and the 2048-pixel layers are resampled derivatives. Completion details are recorded in assets/rig.json.

The two rounded hand shapes are drawn in code (src/hands.mjs). Demo media in docs/ uses an abstract mock desktop, not a capture of a real desktop.
