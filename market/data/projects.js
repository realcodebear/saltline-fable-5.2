/* market/data/projects.js — 静态回退清单（国内版）。云端 API 可用时以前端拉取的 /api/projects 为准。 */
window.MARKET_META = {
  "version": "v2.0",
  "updated": "2026-11-13",
  "board": "B4 / 提示词市集",
  "headline": "提示词市集",
  "sub": "用提示词做出来的项目与游戏",
  "blurb": "数据来源：云端 API 优先，未连接时回退静态清单。"
};

window.MARKET_PROJECTS = [
  {
    "id": "saltline",
    "no": "01",
    "title": "盐线",
    "tagline": "一条提示词产出的雨夜港口 FPS：切断三条上行链路，然后活着上船。",
    "taglineEn": "SALTLINE · 单提示词 FPS",
    "model": {
      "name": "Claude Fable 5.2",
      "vendor": "Anthropic",
      "short": "Fable 5.2"
    },
    "type": "game",
    "tags": [
      "FPS",
      "three.js",
      "程序化资源",
      "单文件",
      "单提示词"
    ],
    "cover": "assets/covers/saltline.svg",
    "shot": "assets/covers/saltline.webp",
    "accent": "#ffb347",
    "featured": true,
    "status": "published",
    "createdAt": "2026-11-09T12:00:00.000Z",
    "author": {
      "name": "Felix Rieseberg",
      "url": "https://x.com/felixrieseberg/status/2119925633564463609"
    },
    "source": {
      "label": "claude.ai/artifact",
      "href": "https://claude.ai/artifact/BGY1SztrAYcJQHSsnHHGmp"
    },
    "demo": "../index.html",
    "prompt": "Build a small first-person shooter that runs entirely in the browser from a single HTML file. No external assets of any kind: every model, texture, sound and font fallback must be generated in code at load time.\n\nSetting. A container port at night, forty minutes before dawn. Rain, sodium lamps, wet asphalt, stacked containers, gantry cranes, fog that eats the far end of the quay. The palette is ink black, bone white and one amber signal colour. Type should feel like port-authority signage: condensed, letter-spaced, all caps, hard edges.\n\nObjective. There are three uplink relays mounted on piers around the basin. The player must reach each one, hold E for two seconds to cut it, then escape to the boat on the north side. Cutting a relay raises the alarm level and spawns more hunters.\n\nEnemies. Two kinds, both procedurally modelled: \"Gulls\" are quadcopter drones that hover, drift towards the player and fire short bursts; \"Hounds\" are four-legged robots that patrol, then sprint on contact. They must read as machines built from primitives, not as people.\n\nPlayer. Eye height 1.6, walk / sprint / crouch, jump, hitscan rifle with recoil, spread, magazine of 24 and reload. Health with regen delay, hurt vignette, bullet impacts, tracers. Mouse look with pointer lock, plus drag-look fallback, keyboard-only look, touch sticks and gamepad support.\n\nUI. Diegetic HUD: ammo, health, an objective tape that tracks relays cut, a radio log with short typed transmissions, hit markers, a compass. Menus: title, paused, dead, debrief with time / accuracy / kills / retries. Settings for quality preset, sensitivity, invert Y, volume, FOV, fullscreen.\n\nAudio. All synthesised with WebAudio: rain bed, footsteps on concrete and metal, rifle, reload clicks, drone whine with doppler, alarm siren.\n\nPerformance. Target 60 fps on integrated graphics. Shadow budget small, instanced props, no per-frame allocations in the loop, resolution scaling by quality preset, graceful degradation to a lower DPR. Keep the whole thing in one file that runs from a static file server.",
    "promptZh": "用单个 HTML 文件做一个完全跑在浏览器里的小型第一人称射击游戏，不允许任何外部素材：所有模型、贴图、音效、字体回退都必须在加载时用代码生成。\n\n场景：凌晨四点四十的集装箱港口。下雨、钠灯、湿沥青、堆叠的集装箱、龙门吊、吃掉码头尽头的雾。配色只有墨黑、骨白和一个琥珀信号色。字体气质像港口治安告示：窄体、大字距、全大写、硬边。\n\n目标：盆地四周的码头上装了三台上行中继，玩家走到每台前按住 E 两秒切断它，然后从北侧登船撤离。每切断一台，警戒等级上升，追兵变多。\n\n敌人：两种，全部程序化建模。\"海鸥\"是四旋翼无人机，悬停、向玩家漂移并短点射；\"猎犬\"是四条腿的机器狗，巡逻后接触即冲刺。它们必须读起来像用基础几何体搭出来的机器，而不是人。\n\n玩家：视高 1.6，走/冲刺/蹲、跳跃、带后坐力与散布的射线步枪、24 发弹匣与换弹。血量带延迟回复、受伤暗角、弹着点、曳光。鼠标指针锁定视角，另有拖拽视角、纯键盘视角、触摸双摇杆与手柄支持。\n\n界面：叙事化 HUD——弹药、血量、记录中继切断进度的任务带、短句电波日志、命中标记、罗盘。菜单：标题、暂停、阵亡、结算（时间/命中率/击杀/重试次数）。设置项含画质档位、灵敏度、Y 轴反转、音量、视野、全屏。\n\n音频：全部用 WebAudio 合成——雨声底噪、混凝土与金属上的脚步、步枪、换弹咔哒、带多普勒的无人机啸叫、警报。\n\n性能：集显上稳定 60 fps。阴影预算小、道具实例化、主循环零逐帧分配、按画质档位缩放分辨率、必要时降 DPR。整个作品保持单文件，从任意静态服务器打开即可运行。",
    "promptNote": "原始 run 只用了一条提示词，全文未公开。上面的中文版是按 README 与实机表现反推的可复现提示词；英文原文见 PROMPT 来源链接。",
    "metrics": [
      {
        "k": "首次公开",
        "v": "2026-11-09"
      },
      {
        "k": "投入",
        "v": "约 8 小时 · 1 条提示词 · 零人工反馈"
      },
      {
        "k": "用量",
        "v": "445M 输入 / 2.7M 输出（大量命中缓存）"
      },
      {
        "k": "成本",
        "v": "API 价格约 $550（作者自述）"
      },
      {
        "k": "产物",
        "v": "index.html · 1.4 MB · 单文件"
      }
    ],
    "credits": "原 run 由 Felix Rieseberg 在 Anthropic 组织并发于 X；原始可玩产物见来源链接，作品版权归原作者。本仓库仅为其可本地运行的镜像。"
  },
  {
    "id": "ember-run",
    "no": "02",
    "title": "余烬奔跑",
    "tagline": "横版自动奔跑：越过板条箱、滑过吊梁，跑进烧尽的黄昏。",
    "taglineEn": "EMBER RUN · 无尽跑酷",
    "model": {
      "name": "DeepSeek",
      "vendor": "深度求索",
      "short": "DeepSeek"
    },
    "type": "game",
    "tags": [
      "无尽跑酷",
      "canvas 2D",
      "视差",
      "触摸"
    ],
    "cover": "assets/covers/ember-run.svg",
    "accent": "#ff6f3c",
    "featured": false,
    "status": "published",
    "createdAt": "2026-11-13T06:00:00.000Z",
    "author": {
      "name": "YG"
    },
    "source": null,
    "demo": "demos/ember-run/index.html",
    "prompt": "Build one self-contained index.html, \"EMBER RUN\", an endless side-scrolling runner drawn entirely with Canvas 2D. No images, no fonts, no libraries, no network requests: only inline CSS and JS. It must open correctly from file:// and stay under 45 KB.\n\nLayout: a fixed header bar with a left \"<- MARKET\" link to ../../index.html, the game name centred in uppercase with wide letter-spacing, and right-aligned SCORE and BEST in tabular numerals. The canvas fills the rest of the viewport, adapts to resizes, scales for devicePixelRatio (capped at 2.5) and needs no letterboxing.\n\nWorld: an auto-running bone-white figure on a salt flat at 79% of the canvas height. Three parallax layers are drawn in code - distant cranes and light poles (0.075x), container stacks (0.24x), foreground lamp posts (1.12x) - over a near-black sky with a warm horizon glow, falling ash and a live ember trail behind the runner.\n\nMechanics: speed starts at 302 px/s and ramps to about 807 px/s with distance; score equals distance/12. After a 1.5 s opening grace period, obstacles enter from the right with a type-aware gap of 200 + speed*0.44 px, plus 170 px whenever a hanging girder is involved: crates (32-64 px tall, sometimes doubled), a girder hanging from cables whose underside sits 30 px above the ground so a slide clears it, and wide low blocks. Jump impulse is -1010 with gravity 2700 and a jump cut on key release. Slide lasts 0.62 s; pressing slide in mid-air fast-falls instead. Forgiving AABB collision ends the run: screen shake, ember burst, then an overlay with score and best.\n\nInput: SPACE or arrow up jumps, arrow down slides, SPACE/Enter restarts; pointer taps split the stage at 62% of its height into jump and slide. Persist the best in localStorage under \"sl.ember.best\". Pause on window blur and page hide with a paused overlay, and drive everything from requestAnimationFrame with a 50 ms delta clamp. Keep the frame budget light: cap particles and keep per-frame allocations low.",
    "promptZh": "用单个 index.html 做一个叫「余烬奔跑」的横版无尽跑酷，画面全部用 Canvas 2D 代码绘制。不要图片、不要字体文件、不要任何库、不要网络请求：只允许内联 CSS 与 JS。必须能从 file:// 直接打开，体积不超过 45KB。\n\n布局：固定顶栏，左侧「← 市集」链接指向 ../../index.html，中间是加宽字距的游戏名，右侧用等宽数字显示「得分 / 最高」。画布占满其余视口，随窗口 resize 自适应，按 devicePixelRatio 缩放（上限 2.5）。\n\n世界：一个骨白色的火柴人在盐滩上自动奔跑，站在画布高度 79% 处。三层视差全部由代码绘制——远处的吊机与灯杆（0.075 倍速）、集装箱堆（0.24 倍速）、前景灯柱（1.12 倍速），背景是近黑天空、暖色地平线辉光、飘落的灰烬，以及角色身后的余烬拖尾。\n\n机制：速度从 302 px/s 起步，随距离增长到约 807 px/s；得分 = 距离 / 12。障碍从右侧进入，间距按类型取 200 + 速度 × 0.44 像素，只要涉及吊梁再额外加 170 像素：板条箱（32-64 像素高，有时叠两层）、从缆绳垂下的吊梁（下沿离地 30 像素，滑铲可通过）、以及宽矮块。起跳初速 -1010、重力 2700，松开按键截断跳跃高度；滑铲持续 0.62 秒；空中按滑铲改为急坠。碰撞用宽容的 AABB：屏幕抖动、余烬迸发，然后弹出结算层显示本次得分与最高分。\n\n输入：空格或 ↑ 跳，↓ 滑，空格/回车重开；触摸把画面按高度 62% 分成上下两区，上跳下滑。最高分写入 localStorage 的 \"sl.ember.best\"。窗口失焦或页面隐藏时自动暂停并显示暂停层。主循环用 requestAnimationFrame，单帧 delta 钳制在 50ms，粒子数量设硬上限，保持每帧分配很低。",
    "promptNote": "",
    "metrics": [
      {
        "k": "产物",
        "v": "index.html · 23.7 KB · 零外部请求"
      },
      {
        "k": "速度",
        "v": "302 → 807 px/s 随距离递增"
      },
      {
        "k": "操作",
        "v": "空格/↑ 跳 · ↓ 滑 · 触摸上下分区"
      },
      {
        "k": "存档",
        "v": "localStorage · sl.ember.best"
      }
    ],
    "credits": "作者 YG。提示词与实现出自同一会话，PROMPT.md 与代码一一对应。"
  },
  {
    "id": "lumen-drift",
    "no": "03",
    "title": "流光漂移",
    "tagline": "无重量小艇在圆形光池里惯性漂移：捡光点拉连击，撞碎片扣时间。",
    "taglineEn": "LUMEN DRIFT · 街机飞行",
    "model": {
      "name": "DeepSeek",
      "vendor": "深度求索",
      "short": "DeepSeek"
    },
    "type": "game",
    "tags": [
      "街机",
      "canvas 2D",
      "连击",
      "60 秒回合"
    ],
    "cover": "assets/covers/lumen-drift.svg",
    "accent": "#5fd0e0",
    "featured": false,
    "status": "published",
    "createdAt": "2026-11-13T06:10:00.000Z",
    "author": {
      "name": "YG"
    },
    "source": null,
    "demo": "demos/lumen-drift/index.html",
    "prompt": "Build one self-contained index.html, \"LUMEN DRIFT\", a top-down arcade flight game drawn entirely with Canvas 2D. No images, fonts, libraries or network requests: inline CSS and JS only. It must open from file:// and stay under 45 KB.\n\nLayout: a fixed header bar with a left \"<- MARKET\" link to ../../index.html, the game name centred in uppercase with wide letter-spacing, and right-aligned SCORE and BEST in tabular numerals. Below it the canvas fills the viewport, handling resize and devicePixelRatio (cap 2.5).\n\nWorld: a circular arena of radius 0.43 x the smaller canvas dimension, centred; it renders as faint concentric rings, radial ticks, a cyan boundary ring, a soft halo and drifting salt dust. The ship is a small bone triangle with a cyan rim, a radial glow and a warm orange engine flare while thrusting. A fading glow trail follows it.\n\nPhysics: inertial and damped. Thrust is 820 px/s^2 along the heading, drag is exp(-1.7*dt) while thrusting and exp(-3.0*dt) while coasting, speed is capped at 470 px/s. The ship bounces softly off the circular wall (normal velocity reduced 1.55x). Pointer input rotates the heading toward the finger at up to 10x smoothing and thrusts while the pointer is more than 28 px away; keys rotate at 3.1 rad/s.\n\nMechanics: a 60-second round. Five pulsing light motes float in the arena; touching one scores 10 x multiplier and respawns it far from the ship. Each pickup extends a 2.6 s window and the multiplier grows from 1 to 6; letting it lapse resets the chain. Shards spawn with 4 at the start and grow to 9 as the round advances, drifting and bouncing off the wall. Touching one costs 4 seconds, resets the chain, flashes the screen and shoves the ship away.\n\nInput: arrows/WASD, pointer drag on touch, SPACE/Enter to start or restart. Persist the best score in localStorage under \"sl.lumen.best\". Show remaining time, a bottom timer bar and the chain on the canvas. Pause on blur or tab hide. Run from requestAnimationFrame with a 50 ms delta clamp and cap particles.",
    "promptZh": "用单个 index.html 做一个叫「流光漂移」的俯视角街机飞行游戏，画面全部用 Canvas 2D 代码绘制。不要图片、字体、库或网络请求：只允许内联 CSS 与 JS。必须能从 file:// 打开，体积不超过 45KB。\n\n布局：固定顶栏，左侧「← 市集」链接指向 ../../index.html，中间加宽字距的游戏名，右侧等宽数字显示「得分 / 最高」。下方画布占满视口，处理 resize 与 devicePixelRatio（上限 2.5），不出现滚动条。\n\n世界：一个圆形竞技场，半径为画布短边的 0.43 倍，居中；画成同心细环、径向刻度、青色边界环与柔和光晕，场内飘着盐尘。飞船是一枚骨白色小三角，青色描边、径向辉光，推进时喷出暖橙色尾焰，身后拖着渐隐光轨。\n\n物理：惯性与阻尼。推力 820 px/s²，方向沿机头；推进时阻尼 exp(-1.7·dt)，滑行时 exp(-3.0·dt)；速度上限 470 px/s。撞圆形边界时按法向速度反射（保留约 65%）。指针输入时，机头以最高 10 倍平滑度转向手指方向，且当手指距离超过 28 像素才给推力；键盘转向 3.1 rad/s。\n\n机制：一局 60 秒。场内漂浮 5 个呼吸闪烁的光点，吃到得 10 × 当前倍率，并在远离飞船处重生。每次拾取续上 2.6 秒连击窗口，倍率随连击从 1 长到 6；窗口断掉倍率归 1。碎片开局 4 个，随回合推进增到 9 个，在场地内漂移并撞墙反弹。撞到碎片扣 4 秒、清空连击、屏幕闪红并把飞船弹开。\n\n输入：方向键/WASD，触摸为任意位置按住拖动（飞船朝手指转向并推进），空格/回车开始或重开。最高分写入 localStorage 的 \"sl.lumen.best\"。画布上显示剩余时间、底部细进度条与当前连击。失焦或切标签页自动暂停。全部用 requestAnimationFrame 驱动，delta 钳制 50ms，粒子上限保持帧率。",
    "promptNote": "",
    "metrics": [
      {
        "k": "产物",
        "v": "index.html · 21.5 KB · 零外部请求"
      },
      {
        "k": "回合",
        "v": "60 秒 · 连击倍率 1 → 6"
      },
      {
        "k": "操作",
        "v": "← → 转向 · ↑ 推进 · ↓ 刹车 · 触摸拖动"
      },
      {
        "k": "存档",
        "v": "localStorage · sl.lumen.best"
      }
    ],
    "credits": "作者 YG。提示词与实现出自同一会话，PROMPT.md 与代码一一对应。"
  },
  {
    "id": "stackline",
    "no": "04",
    "title": "叠线",
    "tagline": "节奏堆叠：方块来回滑动，切准重叠部分，塔越高越抖。",
    "taglineEn": "STACKLINE · 节奏堆叠",
    "model": {
      "name": "DeepSeek",
      "vendor": "深度求索",
      "short": "DeepSeek"
    },
    "type": "game",
    "tags": [
      "节奏",
      "canvas 2D",
      "手感",
      "无损重开"
    ],
    "cover": "assets/covers/stackline.svg",
    "accent": "#ffb347",
    "featured": false,
    "status": "published",
    "createdAt": "2026-11-13T06:20:00.000Z",
    "author": {
      "name": "YG"
    },
    "source": null,
    "demo": "demos/stackline/index.html",
    "prompt": "Build one self-contained index.html, \"STACKLINE\", a timing-based tower stacking game drawn entirely with Canvas 2D. No images, no fonts, no libraries, no network requests: inline CSS and JS only. It must open from file:// and stay under 45 KB.\n\nLayout: a fixed header bar with a left \"<- MARKET\" link to ../../index.html, the game name centred in uppercase with wide letter-spacing, and right-aligned LAYERS and BEST in tabular numerals. The canvas fills the rest of the viewport and handles resize and devicePixelRatio (cap 2.5).\n\nWorld: a dark vertical shaft with faint grid lines that drift with the camera, a warm glow behind the tower, dashed guide rails at the play-area edges and a ground line at 83% height. Every block is a front face with a vertical gradient, bright top plate, left rim, right shadow and one-pixel outline. The active slab glows amber with an accent top edge, and dashed lines connect its edges to the block below. Cut-off overhang pieces tumble away as separate debris with gravity and spin.\n\nMechanics: the base slab is 56% of the play width. A new slab spawns from alternating sides above the tower, oscillating at 210 + 8 x layer-count px/s (capped at 640) and bouncing between the play margins. Dropping it keeps only the horizontal overlap with the slab below; the overhang becomes debris. If the offset from the slab below is 3.5 px or less the drop counts as PERFECT: the slab snaps into place, keeps its full width, and builds a streak counter. A drop with no usable overlap ends the round. The camera eases upward (7x smoothing) to keep the tower top near 40% of the canvas height; ground, blocks and debris follow it.\n\nInput: SPACE, Enter, click or tap drops the slab; the same input starts and restarts. Persist the best layer count in localStorage under \"sl.stackline.best\". Show the streak once it reaches two. Pause on window blur or tab hide with an overlay. Drive it from requestAnimationFrame with a 50 ms delta clamp, drawing only on-screen layers.",
    "promptZh": "用单个 index.html 做一个叫「叠线」的节奏堆叠游戏，画面全部用 Canvas 2D 代码绘制。不要图片、字体、库或网络请求：只允许内联 CSS 与 JS。必须能从 file:// 打开，体积不超过 45KB。\n\n布局：固定顶栏，左侧「← 市集」链接指向 ../../index.html，中间加宽字距的游戏名，右侧等宽数字显示「层数 / 最高」。画布占满其余视口，处理 resize 与 devicePixelRatio（上限 2.5）。\n\n世界：一条竖向暗井，带有随镜头漂移的细网格线、塔身后的暖色辉光、可玩区边缘的虚线导轨，以及位于画布高度 83% 的地面线。每个方块画成：正面竖向渐变、亮色顶板、左侧高光、右侧暗面、一像素描边。正在移动的方块用琥珀色发光并带高亮顶边，虚线把它与下方方块连起来。被切掉的悬空段脱离成独立碎片，受重力翻滚坠落。\n\n机制：基座宽度为可玩宽度的 56%。新方块从左右交替出现，在塔上方以 210 + 8 × 层数的速度（上限 640）来回移动，并在可玩边距之间反弹。落块只保留与下方方块的水平重叠部分，悬空部分变成碎片。若与下方偏移不超过 3.5 像素，判定为「完美」：吸附归位、保留原宽度，并累加连击。完全无重叠则本局结束。镜头以 7 倍平滑度上移，让塔顶稳定在画布高度 40% 附近，地面、方块与碎片一起跟随。\n\n输入：空格、回车、鼠标点击或触摸都执行落块，同一输入也用于开始与重开。最高层数写入 localStorage 的 \"sl.stackline.best\"。连击达到 2 起在画布上展示。窗口失焦或切标签页自动暂停并显示暂停层。用 requestAnimationFrame 驱动，delta 钳制 50ms，只绘制屏幕内实际可见的层。",
    "promptNote": "",
    "metrics": [
      {
        "k": "产物",
        "v": "index.html · 18.3 KB · 零外部请求"
      },
      {
        "k": "完美",
        "v": "偏差 ≤ 3.5 px 判定「完美」并保宽"
      },
      {
        "k": "操作",
        "v": "空格 / 回车 / 点击 / 触摸"
      },
      {
        "k": "存档",
        "v": "localStorage · sl.stackline.best"
      }
    ],
    "credits": "作者 YG。提示词与实现出自同一会话，PROMPT.md 与代码一一对应。"
  }
];
