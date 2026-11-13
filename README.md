# Saltline — Fable 5.2 FPS

一条提示词产出的雨夜港口第一人称射击游戏：切断三条上行链路，然后活着上船。

这不是一个「项目」，只是一件作品：游戏本体来自一次 Claude 的 run，本仓库是它的可本地运行镜像。
收录这件作品的提示词商城在 MengBot 侧：**https://prompt.mengbot.com.cn/**（条目 PM-01）。

## Demo

https://realcodebear.github.io/saltline-fable-5.2/

## Where it comes from

- Built by **Claude Fable 5.2**. The run was set up by Felix Rieseberg (Anthropic) and shared on X on 2026-11-09:
  https://x.com/felixrieseberg/status/2119925633564463609
- Original playable artifact: https://claude.ai/artifact/BGY1SztrAYcJQHSsnHHGmp
- Per his post: one prompt, no human feedback, about 8 hours, about 2.7M output and 445M input tokens (heavily cached), about $550 at API pricing. Models, sounds and textures are all made in code. These numbers are his own and not checked here.

All credit for the game goes to its original author. This repo is a mirror so people can run it locally. If you are the author and want it taken down, open an issue.

## What changed from the artifact

Nothing in the game code. The claude.ai frame-runtime scripts were removed from `<head>`, and a doctype, charset and viewport tag were added so the file runs as a plain web page.

The only addition is a title-screen link to the prompt mall, plus two CSS rules and non-blocking font loading.

## Run it

```sh
python3 -m http.server 8731
```

Then open http://localhost:8731 and click the page to capture the mouse and start the sound.

The whole game is one file, `index.html` (~1.4 MB). It bundles three.js and loads fonts from Google Fonts. There are no other outside assets.

## 提示词商城 / Prompt Mall

商城的提示词、署名、审核与投稿都在 MengBot 项目里：`mengbot/prompt-mall`（`web/` + `server/`）。
本仓库只保留游戏本体；商城的任何改动都不在这里。
