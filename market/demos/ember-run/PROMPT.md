# 余烬奔跑 EMBER RUN

**标语 Tagline：** 在地平线烧尽之前，跑穿整片盐滩。 / Sprint the salt flats until the horizon burns out.
**标签 tags：** 无尽跑酷、横向卷轴、canvas2d、视差、程序化障碍、速度递增、键盘、触摸、单文件、零依赖（endless-runner, side-scroller, canvas2d, parallax, procedural-obstacles, speed-ramp, keyboard, touch, single-file, zero-dependency）
**主色 Accent：** `#ff6f3c`（余烬橙，落在盐线配色 `#0b0d0f` / `#e8e4da` / `#ffb347` 上）
**核心机制 Core mechanic：** 自动奔跑越过程序化生成的木箱、吊梁与贴地宽块，世界速度随里程递增
**操作 Controls：** `空格` / `↑` 跳跃（提前松键缩短抛物线），`↓` 滑铲或急坠；触摸时点画布上部 62% 跳跃、下部滑铲

## Prompt

```text
Build one self-contained index.html, "EMBER RUN", an endless side-scrolling runner drawn entirely with Canvas 2D. No images, no fonts, no libraries, no network requests: only inline CSS and JS. It must open correctly from file:// and stay under 45 KB.

Layout: a fixed header bar with a left "<- MARKET" link to ../../index.html, the game name centred in uppercase with wide letter-spacing, and right-aligned SCORE and BEST in tabular numerals. The canvas fills the rest of the viewport, adapts to resizes, scales for devicePixelRatio (capped at 2.5) and needs no letterboxing.

World: an auto-running bone-white figure on a salt flat at 79% of the canvas height. Three parallax layers are drawn in code - distant cranes and light poles (0.075x), container stacks (0.24x), foreground lamp posts (1.12x) - over a near-black sky with a warm horizon glow, falling ash and a live ember trail behind the runner.

Mechanics: speed starts at 302 px/s and ramps to about 807 px/s with distance; score equals distance/12. After a 1.5 s opening grace period, obstacles enter from the right with a type-aware gap of 200 + speed*0.44 px, plus 170 px whenever a hanging girder is involved: crates (32-64 px tall, sometimes doubled), a girder hanging from cables whose underside sits 30 px above the ground so a slide clears it, and wide low blocks. Jump impulse is -1010 with gravity 2700 and a jump cut on key release. Slide lasts 0.62 s; pressing slide in mid-air fast-falls instead. Forgiving AABB collision ends the run: screen shake, ember burst, then an overlay with score and best.

Input: SPACE or arrow up jumps, arrow down slides, SPACE/Enter restarts; pointer taps split the stage at 62% of its height into jump and slide. Persist the best in localStorage under "sl.ember.best". Pause on window blur and page hide with a paused overlay, and drive everything from requestAnimationFrame with a 50 ms delta clamp. Keep the frame budget light: cap particles and keep per-frame allocations low.
```

## 提示词（中文）

```text
制作单文件 index.html，名为「余烬奔跑 EMBER RUN」：一个完全用 Canvas 2D 绘制的无尽横向跑酷。不要图片、字体、库或网络请求，只用内联 CSS 与 JS；必须能从 file:// 直接打开，体积压在 45 KB 以内。

布局：固定顶栏，左侧「← 市集」链接指向 ../../index.html，中间居中显示游戏名并留宽字距，右侧右对齐「得分」与「最高」，数字用等宽字形。画布填满其余视口，随窗口缩放，按 devicePixelRatio 放大（上限 2.5），不留黑边。

世界：骨白色的自动奔跑小人站在画布高度 79% 的盐滩上。三层视差全部由代码绘制——远处吊车与灯杆 0.075 倍、集装箱堆 0.24 倍、前景灯柱 1.12 倍——背景是近黑的天空、暖色地平线辉光、飘落的灰屑，以及角色身后实时生成的余烬拖尾。

机制：初速 302 像素/秒，随里程爬升到约 807 像素/秒，得分等于里程除以 12。开场 1.5 秒宽限期后障碍从右侧进入，间距 200 + 速度×0.44 像素，只要牵涉吊梁再追加 170 像素：木箱高 32–64 像素（偶尔双联）、钢索吊起的横梁（下沿离地 30 像素，滑铲可过）、贴地宽块。起跳冲量 −1010，重力 2700，松键即时截断上升速度；滑铲持续 0.62 秒，空中按下改为急坠。宽容的 AABB 判定结束本局：屏幕抖动、余烬迸发，随后显示带得分与最高的结束遮罩。

输入：空格或 ↑ 跳跃、↓ 滑铲、空格或回车重开；指针触摸以画布高度 62% 为界，上部跳跃、下部滑铲。最高分写入 localStorage 的 "sl.ember.best"。窗口失焦或页面隐藏时暂停并弹出暂停遮罩；全部动画由 requestAnimationFrame 驱动，单帧时间差上限 50 毫秒，粒子数量设硬上限，每帧分配保持轻量。
```

## Build notes

- 三层视差都用固定 tile 宽度取模平铺，图案由带种子的 PRNG 一次生成；resize 只重建 tile 数据，滚动偏移由行驶距离推导，所以拉伸窗口不会丢位置。
- 跳跃是速度积分加松键截断（jump cut）；滑铲一个键两种语义——地面滑铲 0.62s，空中立即急坠，手感上形成"下砸"节奏。
- 障碍间距按类型加宽：只要相邻任一障碍是吊梁就额外 +170px，保证起跳落点不会撞进吊梁判定区。
- 角色全部手绘：圆角矩形躯干 + 摆腿线段 + 摆动围巾 + 余烬辉光，骨白配色在深色场景里比深色剪影更醒目。
- 碰撞盒比绘制盒内缩 3px、吊梁下沿留 8px 净空，让"擦边过"成立；死亡时 46 颗粒子爆发 + 屏幕抖动。
- 粒子硬上限 280、灰尘 80，渐变每帧重建仍稳定 60fps；成品 23.6KB，零外部请求。
