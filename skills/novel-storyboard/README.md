# novel-storyboard · 分镜表

把 AI 短剧**剧本**（`script.json`，来自 `novel-script`）拆成镜头级生产单：一拍戏 → 一条镜头，带镜号、场景、光照、景别、机位、时长、首帧生成提示词、生成批次。它是短剧生产链里"剧本 → 画面"的最后一块拼图。

**产出直接对接 ComfyUI 工作流**：每条镜头生成 `firstFrameCopyBlock`（首帧图，粘进 Krea2 出图）与 `h3CopyBlock`（视频，粘进 MiniMax H3 生视频），配合人物角色图反复抽卡出成片。

## 它解决什么

- 剧本只有"场次 + 节拍流 + 台词"，没有"镜头"。分镜把每拍拆成一镜一镜，给生成工具可直接用的生产单。
- **一一对应**：1 个 beat = 1 条 shot，剧本零漏拍，剧本改一句能精确定位到哪一镜。
- **时长继承剧本**：单镜时长沿用 `novel-script` 已校验的模型，分镜总时长天然贴合剧本目标，不脱节。
- **自动合成提示词**：`--autofill` 从 `art.json`/`cast.json` 抓场景光照与角色形象，拼出英文首帧提示词；同时按 `--prompt-format h3`（默认）为每条镜头合成 **MiniMax H3 三段式视频提示词**（`integrated_multimodal_description` / `overall_soundscape` / `non_diegetic_music`），默认 `i2va` 模式（首帧图+角色参考图驱动，可反复抽卡）。
- **可直接复制粘贴**：每条镜头额外生成 `firstFrameCopyBlock` 与 `h3CopyBlock` 两块整提示词，以及 `refImagePaths` 角色图清单，零手工拼装直接进 ComfyUI。
- **批次归并**：同"场景 + 光照"归一个生成批次，复用资产、省 token、保一致。

## 上游依赖

| 文件 | 来自 | 必填 |
| --- | --- | --- |
| `script.json` | novel-script | ✅ 主输入 |
| `art.json` | novel-art | 可选（用于场景/光照校验与提示词合成） |
| `cast.json` | novel-characters | 可选（用于角色形象提示词合成） |
| `outline.json` | novel-outline | 可选（C-id → 角色名映射） |

## 快速开始

```bash
# 1. 拆镜（带全部上游 + 自动合成提示词，默认 i2va 视频模式）
node scripts/novel-storyboard.mjs seed 渡口-script.json \
  --outline 渡口-outline.json --art 渡口-art.json --cast 渡口-cast.json \
  --autofill --out 渡口-storyboard.json

# 2. 过质量门（17 道，必须全过）
node scripts/novel-storyboard.mjs validate 渡口-storyboard.json \
  --script 渡口-script.json --outline 渡口-outline.json --art 渡口-art.json --cast 渡口-cast.json

# 3. 渲染报告（含每条镜头可复制首帧/H3 提示词块）
node scripts/novel-storyboard.mjs render 渡口-storyboard.json --html > 渡口-storyboard-report.html
```

> 提示词格式：`--prompt-format h3`（默认，生成 H3 视频提示词）或 `legacy`（仅首帧图像提示词，质量门退化为 13+G17 道）。H3 模式：`--h3-mode i2va`（默认，首帧图+角色图驱动，可抽卡）或 `t2va`（纯文生视频）。

## 端到端 ComfyUI 工作流

1. **首帧图（Krea2）**：取每条镜头的 `firstFrameCopyBlock`（正向+反向提示词）粘进 Krea2 文生图/图生图节点，把 `refImagePaths` 的人物角色图作参考 → 出首帧图 `E{nn}S{nnn}.png`。
2. **视频（MiniMax H3）**：取 `h3CopyBlock`，`i2va` 模式把"首帧引用句"粘到开头、首帧图作 `<Picture 1>`、角色图作参考，三段式粘入对应字段 → 反复抽卡至满意。

## 质量门（17 道，确定性）

beat 全覆盖 · shotId 合规 · 场景引用 · 光照注册 · 角色一致性 · 时长贴合 · 景别合法 · 机位非空 · 首帧提示词英文 · 反向提示词英文 · 批次分配 · VO 取景说明 · 难点预警 · **H3 描述规范**（运镜/景别骨架、`[Shot N]` 头、`<d>[` 台词封装；动作叙事须英文）· **H3 声景/配乐已填** · **H3 复制块已生成** · **首帧出图复制块已生成**。

`legacy` 模式下 H3 相关三道自动跳过，仅跑 13+G17 道。H3 提示词本身允许中文角色名与 `<d>[Chinese]` 台词。

不提供上游文件时，对应对账门自动"跳过"，其余门仍强制通过。

## 示例

`examples/渡口-storyboard.json` —— 由《渡口》四件套（`script`+`art`+`cast`+`outline`）经 `seed --autofill` 生成，210 条镜头 / 6 集，含 H3 I2VA 视频提示词与可直接复制块，17/17 质量门通过。

## 自测

```bash
node scripts/selftest.mjs
```

## 零依赖

仅用 Node.js 内置模块，无需 `npm install`，无需 API key。
