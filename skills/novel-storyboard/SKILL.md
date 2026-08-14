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
确认：① 剧本路径（`script.json`）；② 是否带 `--art/--cast/--outline` 做对账与 autofill。

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

### Step 5 · 渲染报告
```bash
node scripts/novel-storyboard.mjs render <书名>-storyboard.json --md  > <书名>-storyboard.md
node scripts/novel-storyboard.mjs render <书名>-storyboard.json --html > <书名>-storyboard-report.html
```
HTML 报告含 KPI 带、质量门明细、生成批次单、逐集镜头表。

### Step 6 · 交付
把 `storyboard.json` + 报告交给下游"出图/出视频"工具（如 codex `$imagegen` 或 T2V/I2V），按 `batch` 批次批量生成首帧，再补镜头运动与配音。

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
