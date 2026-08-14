---
name: novel-storyboard
version: 1.0.0
description: 把 AI 短剧剧本拆成可生成的分镜表。输入 novel-script 产出的 script.json（剧本：场次+节拍流+台词），可选地账 novel-art(art.json)、novel-characters(cast.json)、novel-outline(outline.json)，产出带镜号/景别/机位/时长/首帧提示词/H3视频提示词/生成批次的分镜表 storyboard.json，并附 MD/HTML 报告。零依赖、零 API key。当用户说"出分镜""做分镜表""把剧本拆成一镜一镜""给每个镜头写生成提示词""分镜提示词""MiniMax H3 视频提示词""H3 格式提示词"时触发。剧本管戏，分镜管拍——本 skill 紧接 novel-script 下游，把剧本落成镜头级生产单。
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - Glob
triggers:
  - novel-storyboard
  - 出分镜
  - 做分镜表
  - 分镜提示词
  - 首帧提示词
  - H3 视频提示词
  - H3 格式提示词
metadata:
  license: Apache-2.0
  requires:
    bins:
      - node          # >= 18，只用标准库，无 npm 依赖
  runtimes:
    - claude-code
    - codex
---

# novel-storyboard · 分镜表

把剧本（`script.json`）拆成镜头级生产单：每一拍戏 → 一条镜头，带上镜号、场景、光照、景别、机位、时长、首帧生成提示词、生成批次。它是短剧生产链里"剧本→画面"的最后一道拼图。

**产出直接对接 ComfyUI 工作流**：每条镜头都生成 `firstFrameCopyBlock`（首帧图，可直接粘进 Krea2 工作流出图）和 `h3CopyBlock`（视频，可直接粘进 MiniMax H3 工作流生视频），配合人物角色图反复抽卡，最终得到成片。

## 上游链路（务必先跑通前序 skill）

```
小说 ─ novel-outline → 大纲 ─ novel-characters → 角色设定
                     ─ novel-art     → 美术设定(场景/道具)
                     ─ novel-script  → 剧本(script.json)  ← 本 skill 的主输入
                                         │
                                         ▼
                                   novel-storyboard → 分镜表(storyboard.json)
```

本 skill 消费四个上游产物：

| 文件 | 来自 | 用途 |
| --- | --- | --- |
| `script.json` | novel-script | 主输入：每集每场的 `flow` 节拍流 → 拆镜 |
| `art.json` | novel-art | 校验场景/光照；autofill 合成首帧与道具提示词 |
| `cast.json` | novel-characters | autofill 合成角色形象提示词 |
| `outline.json` | novel-outline | C-id → 角色名映射，报告里显示真名 |

不提供上游文件时，对应对账门自动"跳过"，其余门仍强制通过。

## 工作流（7 步）

### Step 0 · 收参数
> 交互约定见 `novel-project/references/interaction-checkpoints.md` 的 **开工前对齐②③**：
> 启动第一步先确认本次范围（剧本路径、是否带 `--art/--cast/--outline` 对账）与
> 产出形态（只交提示词与路径、不替出图）。

确认：① 剧本路径（`script.json`）；② 是否带 `--art/--cast/--outline` 做对账与 autofill。

#### ⚠️ 风格选择（必须先定，全程统一）（硬卡点 C2 · 仅继承）
> 见总表 **C2 风格决策**：分镜**不重选**风格，只继承上游。若从本 skill 启动，先确认
> art.json.style 已定且沿用，不要临时另选一档。

分镜的美术风格**不是本 skill 自己选的**，而是从上游 `art.json` 继承（`seed --art` 时自动读取 `art.json.style`）。因此：

- **跑流程第一步就要先选风格**，在 `novel-art`（Step 0）定下，之后 `novel-characters` → `novel-art` → `novel-storyboard` 全部沿用同一档，中途不能换。
- 改风格 = 上游重跑：换风格必须重跑 `novel-art` → `novel-characters` → `novel-storyboard` 全链路，单改一处风格会让角色/场景/分镜三套质感对不上（合成时没法看）。
- 常见可选风格（`STYLE_PRESETS` 里的 `id`，整套预设见 `novel-characters/references/style-presets.md`）：
  | id | 说明 | 典型用途 |
  | --- | --- | --- |
  | `realistic` | 半写实厚涂（默认） | 真人感短剧、纪实、情感向 |
  | `ghibli` | 吉卜力式手绘赛璐璐动画 | 治愈、童话、低龄向 |
  | `photorealistic` | 纯写实（照片级） | 真人感、写实短剧、纪录片质感 |
  | `comic` | 美式漫画 / 粗线赛璐璐 | 爽文、热血、条漫改 |
  | `ink` | 水墨 / 国风写意的 | 古风、武侠、文艺向 |
  | `noir` | 暗调胶片 / 高反差 | 悬疑、犯罪、黑色电影感 |
  > 注：当前内置预设为 `realistic`、`ghibli`、`photorealistic`；`comic`/`ink`/`noir` 为扩展方向，使用前需在 `STYLE_PRESETS` 补齐对应五块预设（`render/surface/lighting/negative/tags`），否则 `validate` 会因风格与反向词不匹配报错。
- 若 `seed` 未传 `--art`，本 skill 回落到默认 `realistic`，但**强烈建议始终传 `--art`** 以保证风格与上游一致。

### Step 1 · 定位输入
拿到 `script.json`。若上游没跑，先提示用户跑 `novel-script`。

### Step 2 · seed 拆镜（自动骨架）
```bash
node scripts/novel-storyboard.mjs seed <script.json> \
  --outline <outline.json> --art <art.json> --cast <cast.json> \
  --autofill --out <书名>-storyboard.json
```
- 每个 beat → 一条 shot（动作/台词/心声各一镜）。
- 自动填：镜号、场景、光照、在场角色、道具、景别（按人数/类型推断）、机位（默认"固定机位"）、时长（继承剧本模型）、生成批次（同场景+光照归一批）。
  光照优先级：**剧本该场指定的光照 > 美术场景第一个状态 > 默认**——剧本改光照，分镜跟着走；
  剧本没写，才回退美术的默认状态。
- `--autofill`：把场景光照 + 角色形象 + 道具状态 + 景别 + 风格拼成英文首帧提示词；同时为每条镜头合成 **H3 三段式视频提示词**（`integrated_multimodal_description` / `overall_soundscape` / `non_diegetic_music`），直接可喂给 MiniMax H3。每条镜头还会注入**视觉导演块 `direction`**（framing/cameraAngle/lens/subjectPriority/visualFocus/emotion/colorMood 等确定性骨架），首帧提示词据此追加构图/镜头/焦点句，从"拼接器"升级为"导演"。`foreground/midground/background` 可空待你精修。
- `--prompt-format h3|legacy`（默认 `h3`）：`h3` 生成 H3 视频提示词；`legacy` 只生成首帧图像提示词（不含 `h3` 字段，质量门退化为 13+G17 道）。
- `--h3-mode i2va|t2va`（默认 `i2va`）：`i2va`=首帧图+角色参考图驱动（图生视频，可反复抽卡，适合你的 ComfyUI 工作流）；`t2va`=纯文生视频。
- 每条镜头额外生成两个**可直接复制粘贴**的整块：`firstFrameCopyBlock`（首帧出图，粘进 Krea2）与 `h3CopyBlock`（视频生成，粘进 H3），并列出 `refImagePaths`（人物角色图路径，供两链路复用）。
- 加 `--autofill`：提示词由脚本**确定性合成**，产出的 `firstFrameCopyBlock` / `h3CopyBlock` 已是**直接可复制的最终提示词**，无需模型二次加工即可拿去生图/生视频。

### Step 3 · 可选微调（非必需）
脚本 autofill 已给出可直接用的提示词；只有当默认推断的景别/构图/情绪不符合你的意图时，才手动覆盖：
- `prompt`：首帧画面英文描述（autofill 已生成完整版，可直接复制；如需微调景别/构图/情绪可改，但非必经流程）。
- `negativePrompt`：反向提示词（autofill 已给，可改）。
- `shotType` / `camera`：按需覆盖默认。
- `warnings`：多人近景/特写、含人群等大模型难 render 的镜头，标注难点。
- `note`：VO（心声）镜必须说明取景（不放说话人/只给表情）。
- `continuity`：seed 只给骨架（角色名/在场状态/场景光照），**你要把每个有戏的角色补上
  wardrobe / emotion / position，道具有状态弧的补 state**——novel-project 的跨镜连续性
  检查靠它工作：服装跳变、道具状态突变、同场光照突变都会被拦。不填 = 检查不生效。

### Step 4 · 过质量门（必须全过）
```bash
node scripts/novel-storyboard.mjs validate <书名>-storyboard.json \
  --script <script.json> --outline <outline.json> --art <art.json> --cast <cast.json>
```
17 道门（见 `references/schema.md`）全 PASS 才继续。重点门：
- **beat 全覆盖**：剧本每拍都有镜，漏拍会被拦。
- **单集时长贴近**：单集总时长须贴近剧本 `targetSeconds`±15%。
- **首帧提示词必须英文**（legacy / 图生视频用）：含中文直接 FAIL。注意 **H3 视频提示词（`h3` 字段）允许中文角色名与 `<d>[Chinese]…</d>` 台词**，但**动作叙事必须为英文**（中文动作自动退化为安全英文占位）。
- **首帧出图复制块 & H3 复制块已生成**（G16/G17）：保证每条镜头都有可直接粘进 ComfyUI 的文本，无需手工抄写。
- **难点镜头须预警**：3 人近景/特写、含人群词必须进 `warnings`。

### Step 5 · 渲染报告（三件套一次出齐）（硬卡点 C6 · 三层交付）

> 交互约定见 `novel-project/references/interaction-checkpoints.md` 的 **C6 分镜三层交付** +
> **三层交付物**：这一步产出的 JSON / HTML / prompts 层级必须分清（JSON=Agent、HTML=人审、
> Prompt=生产），且**不替用户生图**——只给提示词与回填路径。

> 📐 **报告样式已固化**：`storyboard-report.html` 的视觉风格（亮色国风、配色令牌、版式结构）
> 由 `references/report-style.md` 统一定版，脚本内联 `<style>` 须与该规范同步。**改样式先改规范文件**，
> 不要临时在脚本里改配色——保证跨项目、跨次生成风格一致。其他 skill 的 HTML 报告也建议统一到本规范。

> 🗂 **按集拆分（避免单文件过长）**：`render --per-ep --out <目录>` 会把每个 episode 渲染成一份独立
> HTML（`E01.html / E02.html / …`），并在目录下生成 `index.html` 导航页；每集报告的排版沿用本规范、
> 借鉴 outline/script 的分集卡结构（单集 KPI + 质量门 + 批次 + 逐镜表）。超长分镜表推荐用此模式，
> 单集文件更小、更易审。整份 `render --html` 仍保留可用。
```bash
# 一条命令同时产出 JSON（Agent 用）+ HTML（人审用）+ prompts/（生产用）
node scripts/novel-storyboard.mjs render <书名>-storyboard.json --html --all \
  --cast <书名>-cast.json --art <书名>-art.json --out <书名>-storyboard-report.html
```
- `--html`：生成 HTML 报告，并在页内**内嵌完整 JSON 源码**（可展开、复制、下载）+ 每条镜头可复制提示词块。
- `--all`：与 HTML 同目录额外生成 `prompts/` 平铺包（characters/scenes/props/shots 四类 txt，打开即复制）。
- 也可分开跑：`--md` 出 Markdown；`export` 单独出 prompts 包。

> ⚠️ **本 skill 只产出"提示词与路径"，不调用任何生图/生视频工具**。角色图、首帧图、视频一律由你在别处生成后回填。具体见 Step 6。

### Step 6 · 三层交付物（用途必须分清）
| 层 | 产物 | 给谁 | 干什么 |
| --- | --- | --- | --- |
| **JSON** | `storyboard.json`（即输入文件本身） | **Agent** | 机器可读的分镜生产单，结构化、可程序化驱动下游 |
| **HTML** | `<书名>-storyboard-report.html` | **人** | 审 KPI / 质量门 / 批次 / 逐镜表，页内嵌 JSON 与提示词，人工决策 |
| **Prompt** | `prompts/` 平铺 txt 包 | **生产** | 直接粘进 Krea2 / MiniMax H3 / ComfyUI 生图生视频 |

**角色图回填约定（不在流程内生成）**：
1. `prompts/characters/*.txt` 是角色生成提示词，你拿去别处出角色图。
2. 定稿后把图放到 `storyboard.json` 里 `refImagePaths` 指向的路径（实际项目为 `../02_cast/images/林默-model-sheet.png`，即 `02_cast/images/` 下）。
3. 改 `refImagePaths` 即完成回填——分镜首帧/H3 提示词会自动引用该路径（见 `backfill` 类脚本或手工改 JSON）。
4. 再跑 `render --all` 刷新 HTML / prompts 即可。

> 实际项目里本 skill 对应 `05_storyboard/`，提示词包对应 `06_prompts/`，完整目录结构与跨阶段
> 引用约定见 `novel-project/references/project-layout.md`。

### Step 7 · 自测（改了脚本才需要）
```bash
node scripts/selftest.mjs
```

## 关键设计

- **一一对应**：1 beat = 1 shot，保证剧本零漏拍，也便于"剧本改一句→定位到哪一镜"。
- **时长继承剧本**：shot 时长直接沿用 `novel-script` 已校验的 beat 时长模型，所以分镜单集总时长天然贴合剧本目标，不会出现"剧本 2 分钟、分镜 5 分钟"的脱节。
- **批次归并**：同 `场景+光照` 的镜头归到一个生成批次，复用同一套场景资产，省 token 也保一致。
- **提示词自动合成（复制即用）**：`--autofill` 从 art/cast 抓场景光照与角色形象，确定性拼出**可直接复制的最终首帧/H3 提示词**，无需模型二次加工；如需微调景别/构图可手动改，但非必经流程。
- **H3 视频提示词一键到位**：`promptFormat=h3`（默认）时，每条镜头额外产出符合 `h3-prompt-writing` 规范的视频提示词——`[Shot N]` 镜头头 + 稳定 `(S1)` 说话人 ID + `<d>[Chinese]…</d>` 台词封装 + `off-screen voiceover` 闭唇规则 + 机位→H3 运镜词表 + 声景/配乐三段。默认 `h3Mode=i2va`：在开头插入首帧引用句并将角色图作为参考，直接对接你的"首帧图+角色图→H3 生视频" ComfyUI 抽卡链路。
- **可直接复制粘贴**：每条镜头生成 `firstFrameCopyBlock`（首帧出图块，粘进 Krea2）与 `h3CopyBlock`（视频生成块，粘进 H3），并列出 `refImagePaths`（人物角色图），全程零手工拼装。

## 边界（本 skill 不做）

- 不出图、不出视频、不配音——那是生成工具的事。
- 不写剧本（上游 `novel-script` 的活）。
- 不做美术设定（上游 `novel-art` 的活），但会用它们来合成提示词。
- 镜头运动（推拉摇移）只给 `camera` 字段标注，具体运镜参数由生成工具决定。

## 命令速查

| 命令 | 作用 |
| --- | --- |
| `seed <script.json> [--outline --art --cast] [--autofill] [--prompt-format h3|legacy] [--h3-mode i2va|t2va] [--eps 1-3] [--out 路径]` | 拆镜生成骨架 |
| `validate <storyboard.json> [--script --outline --art --cast]` | 跑 17 道质量门（legacy 模式 13+G17 道） |
| `checkup <storyboard.json> [...]` | 纯文本质量门明细 |
| `render <storyboard.json> [--md\|--html] [--out 路径]` | 渲染报告（含每条镜头可复制提示词块） |
| `batches <storyboard.json>` | 列出生成批次单 |
| `export <storyboard.json> [--cast --art] [--out 路径]` | 最后一公里：把分散在 JSON 里的提示词平铺导出为 `prompts/` 目录（characters/scenes/props/shots 四类 txt）。每条 shot 导出 `first-frame.txt`（带 `FINAL FIRST FRAME PROMPT` 标签）、`negative.txt`、`h3.txt`、`refs.txt` 与 `meta.txt`（生成说明：参考图 / 建议时长 / I2VA 模式 / 导演概要），打开即复制 |
| `split <storyboard.json> [--shot E01S001 \| --auto] [--autofill] [--out 路径]` | 把复杂动作镜（标记为 `recommendSplit=true`，即动作镜 + ≥2 句号分句）按分句拆成多条子镜，时长按比例分配，保留 `sourceBeat`（G1 覆盖门仍过）。逗号串成的连续动作不自动拆，由 `warnings` 提示人工处理 |

### 端到端 ComfyUI 工作流

1. **首帧图（Krea2）**：取每条镜头的 `firstFrameCopyBlock`（正向+反向提示词）粘进 Krea2 文生图/图生图节点，把 `refImagePaths` 的人物角色图作为参考图传入 → 出首帧图 `E{nn}S{nnn}.png`。
2. **视频（MiniMax H3）**：取 `h3CopyBlock`，`i2va` 模式把"首帧引用句"粘到开头、首帧图作为 `<Picture 1>`、角色图作参考，三段式粘入对应字段 → 反复抽卡至满意。

详细字段与质量门见 `references/schema.md`。完整可跑样例见 `examples/渡口-storyboard.json`（由《渡口》四件套生成，含 H3 I2VA 视频提示词与可直接复制块，17/17 通过）。H3 提示词规范另见 `h3-prompt-writing` skill。
