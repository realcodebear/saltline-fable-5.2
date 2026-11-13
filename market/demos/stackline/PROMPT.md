# 叠塔成线 STACKLINE

**标语 Tagline：** 一块块落下，直到塔缩成一条笔直的线。 / Drop slabs until the tower is one perfect line.
**标签 tags：** 叠塔游戏、节奏、时机、canvas2d、相机上升、完美奖励、键盘、触摸、单文件、零依赖（stacking-game, timing, rhythm, canvas2d, rising-camera, perfect-bonus, keyboard, touch, single-file, zero-dependency）
**主色 Accent：** `#ffb347`（信号琥珀，落在盐线配色 `#0b0d0f` / `#e8e4da` / `#d2622a` 上）
**核心机制 Core mechanic：** 一块板在塔顶来回滑行——落下、只保留重叠部分，失去的宽度就是失误的代价
**操作 Controls：** `空格` / `回车` / 点击 / 触摸 落下木板

## Prompt

```text
Build one self-contained index.html, "STACKLINE", a timing-based tower stacking game drawn entirely with Canvas 2D. No images, no fonts, no libraries, no network requests: inline CSS and JS only. It must open from file:// and stay under 45 KB.

Layout: a fixed header bar with a left "<- MARKET" link to ../../index.html, the game name centred in uppercase with wide letter-spacing, and right-aligned LAYERS and BEST in tabular numerals. The canvas fills the rest of the viewport and handles resize and devicePixelRatio (cap 2.5).

World: a dark vertical shaft with faint grid lines that drift with the camera, a warm glow behind the tower, dashed guide rails at the play-area edges and a ground line at 83% height. Every block is a front face with a vertical gradient, bright top plate, left rim, right shadow and one-pixel outline. The active slab glows amber with an accent top edge, and dashed lines connect its edges to the block below. Cut-off overhang pieces tumble away as separate debris with gravity and spin.

Mechanics: the base slab is 56% of the play width. A new slab spawns from alternating sides above the tower, oscillating at 210 + 8 x layer-count px/s (capped at 640) and bouncing between the play margins. Dropping it keeps only the horizontal overlap with the slab below; the overhang becomes debris. If the offset from the slab below is 3.5 px or less the drop counts as PERFECT: the slab snaps into place, keeps its full width, and builds a streak counter. A drop with no usable overlap ends the round. The camera eases upward (7x smoothing) to keep the tower top near 40% of the canvas height; ground, blocks and debris follow it.

Input: SPACE, Enter, click or tap drops the slab; the same input starts and restarts. Persist the best layer count in localStorage under "sl.stackline.best". Show the streak once it reaches two. Pause on window blur or tab hide with an overlay. Drive it from requestAnimationFrame with a 50 ms delta clamp, drawing only on-screen layers.
```

## 提示词（中文）

```text
制作单文件 index.html，名为「叠塔成线 STACKLINE」：一个完全用 Canvas 2D 绘制的节奏叠塔游戏。不要图片、字体、库或网络请求，只用内联 CSS 与 JS；必须能从 file:// 打开，体积压在 45 KB 以内。

布局：固定顶栏，左侧「← 市集」返回 ../../index.html，中间居中显示游戏名并留宽字距，右侧右对齐「层数」与「最高」，数字等宽。画布填满其余视口，处理窗口缩放与 devicePixelRatio（上限 2.5）。

世界：一条深色竖直井道，淡网格随相机漂移，塔后一团暖光，场地两侧画虚线导轨，地面线在画布高度 83% 处。每块板都是带纵向渐变的正面、亮色顶板、左缘高光、右缘暗边与一像素描边的方块；活动板带琥珀辉光与亮色顶边，虚线把它两侧连到下方那块。被切掉的悬空段脱离塔体，按重力 1500 加自转甩出。

机制：底板占场地宽度的 56%。新板从塔顶左右交替出现，以 210 + 层数×8 像素/秒的速度摆动（上限 640），在场地边距之间往返。落下后只保留与下层的水平重叠，悬空部分成为碎片；若与下层偏移不超过 3.5 像素且宽度差小于 0.6，判定为「完美」：吸附归位、保留全宽并累计连击。重叠宽度不足 2 像素即结束本局。相机以 7 倍平滑上移，让塔顶停在画布高度 40% 附近，地面、方块与碎片一起跟随。

输入：空格、回车、点击或触摸都落下木板，同一输入负责开始与重开。最高层数写入 localStorage 的 "sl.stackline.best"。连击达到 2 后在画布顶部显示连击条。失焦或切页时暂停并弹出遮罩。用 requestAnimationFrame 驱动，单帧时间差上限 50 毫秒，只绘制屏幕内的层。
```

## Build notes

- 相机不是跟随玩家而是跟随塔顶：camT = max(0, H*0.40 - (baseY - layers*bh))，钳制在 0 以上，所以矮塔不动、塔高了才整条线上移。
- 只绘制屏幕内的层：startI 由 (baseY+cam-H)/bh 反推，循环遇到顶部越界即 break，层数再多也只画十几块。
- 完美判定用 3.5px 偏移阈值 + 宽度不变量，命中后吸附保宽并累计 streak，给"节奏"一个可追求的奖励点。
- 切下来的悬空段变成独立碎片（重力 1500、自转），不参与后续判定，视觉上解释"宽度为什么变窄"。
- resize 时按宽度比例重映射所有层、活动块和碎片的坐标，再重算相机并吸附，避免中途拉伸把塔清空。
- 动画块用 shadowBlur 只在单块上开，其余用渐变假高光；成品 18.3KB，零外部请求。
