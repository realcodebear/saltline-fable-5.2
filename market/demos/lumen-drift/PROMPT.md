# 流光漂移 LUMEN DRIFT

**标语 Tagline：** 驾一艘无重的滑艇，漂过一整池光。 / Drift a weightless skiff through a tank of light.
**标签 tags：** 俯视街机、惯性飞行、canvas2d、连击倍率、六十秒回合、触摸拖动、键盘、单文件、零依赖（top-down-arcade, inertia-flight, canvas2d, combo-multiplier, 60-second-round, touch-drag, keyboard, single-file, zero-dependency）
**主色 Accent：** `#5fd0e0`（流明青，落在盐线配色 `#0b0d0f` / `#e8e4da` / `#ffb347` 上）
**核心机制 Core mechanic：** 在圆形场地里惯性飞行——收集呼吸光点累积连锁倍率，躲开漂移碎晶，被撞掉四秒
**操作 Controls：** `←` `→` 转向、`↑` 推进、`↓` 刹车；触摸时按住并拖动，滑艇朝手指方向转舵并推进

## Prompt

```text
Build one self-contained index.html, "LUMEN DRIFT", a top-down arcade flight game drawn entirely with Canvas 2D. No images, fonts, libraries or network requests: inline CSS and JS only. It must open from file:// and stay under 45 KB.

Layout: a fixed header bar with a left "<- MARKET" link to ../../index.html, the game name centred in uppercase with wide letter-spacing, and right-aligned SCORE and BEST in tabular numerals. Below it the canvas fills the viewport, handling resize and devicePixelRatio (cap 2.5).

World: a circular arena of radius 0.43 x the smaller canvas dimension, centred; it renders as faint concentric rings, radial ticks, a cyan boundary ring, a soft halo and drifting salt dust. The ship is a small bone triangle with a cyan rim, a radial glow and a warm orange engine flare while thrusting. A fading glow trail follows it.

Physics: inertial and damped. Thrust is 820 px/s^2 along the heading, drag is exp(-1.7*dt) while thrusting and exp(-3.0*dt) while coasting, speed is capped at 470 px/s. The ship bounces softly off the circular wall (normal velocity reduced 1.55x). Pointer input rotates the heading toward the finger at up to 10x smoothing and thrusts while the pointer is more than 28 px away; keys rotate at 3.1 rad/s.

Mechanics: a 60-second round. Five pulsing light motes float in the arena; touching one scores 10 x multiplier and respawns it far from the ship. Each pickup extends a 2.6 s window and the multiplier grows from 1 to 6; letting it lapse resets the chain. Shards spawn with 4 at the start and grow to 9 as the round advances, drifting and bouncing off the wall. Touching one costs 4 seconds, resets the chain, flashes the screen and shoves the ship away.

Input: arrows/WASD, pointer drag on touch, SPACE/Enter to start or restart. Persist the best score in localStorage under "sl.lumen.best". Show remaining time, a bottom timer bar and the chain on the canvas. Pause on blur or tab hide. Run from requestAnimationFrame with a 50 ms delta clamp and cap particles.
```

## 提示词（中文）

```text
制作单文件 index.html，名为「流光漂移 LUMEN DRIFT」：一个完全用 Canvas 2D 绘制的俯视街机飞行游戏。不要图片、字体、库或网络请求，只用内联 CSS 与 JS；必须能从 file:// 打开，体积压在 45 KB 以内。

布局：固定顶栏，左侧「← 市集」返回 ../../index.html，中间居中显示游戏名并留宽字距，右侧右对齐「得分」与「最高」，数字等宽。下方画布满屏，处理窗口缩放与 devicePixelRatio（上限 2.5）。

世界：圆形场地半径取画布短边的 0.43 倍并居中，内部画淡同心圆环、径向刻度、青色边界环、柔和光晕与漂浮盐尘。滑艇是一枚骨白小三角，带青色描边与径向辉光，推进时喷出暖橙尾焰，身后拖着渐隐光带。

物理：惯性与阻尼。推力 820 像素/秒² 沿艏向，阻尼在推进时为 exp(-1.7×dt)、滑行时为 exp(-3.0×dt)，速度上限 470 像素/秒。撞到圆形边界柔弹，法向速度衰减 1.55 倍。指针输入以最高 10 倍平滑把艏向转向手指，指针离艇超过 28 像素时持续给推力；键盘转向 3.1 弧度/秒。

机制：一回合 60 秒。场地浮动 5 颗呼吸光点，吃到得 10×倍率并在远离滑艇处重生；每次拾取刷新 2.6 秒连锁窗口，倍率从 1 涨到 6，窗口过期即归零。碎晶开局 4 块，随回合推进最多增至 9 块，漂移并撞墙反弹。被碎晶碰到扣 4 秒、清空连锁、闪屏并把滑艇弹开。

输入：方向键或 WASD、触摸拖动，空格或回车开始与重开。最高分写入 localStorage 的 "sl.lumen.best"。画布上显示剩余时间、底部时间条与连锁数。失焦或切页时暂停。用 requestAnimationFrame 驱动，单帧时间差上限 50 毫秒，并给粒子设上限。
```

## Build notes

- 惯性用手写阻尼：推力期 exp(-1.7*dt)、滑行期 exp(-3.0*dt)，再叠加速度硬上限 470，滑行手感"飘但不失控"。
- 触点操控是"朝向插值 + 超距才给推力"，靠近目标时自动收油门，避免绕圈；键盘路径完全独立。
- 圆形边界用法向速度反射（保留 45%），并每帧少量喷火花，让撞墙有反馈而不是硬停。
- 连击窗口 2.6s、倍率 1→6 按 chain/2 递增；碎片撞击只扣 4 秒不结束回合，失败感靠时间压力而不是一次死亡。
- 光点用径向渐变 + 呼吸相位，拖尾用逐段递减 alpha 的描边叠加 lighter 混合，画面亮而不糊。
- 粒子上限 320、碎片上限 9；成品 21.5KB，零外部请求，DPR 3 下仍按 CSS 像素布局。
