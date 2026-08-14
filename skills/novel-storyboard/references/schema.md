# storyboard.json 数据结构

分镜表是 `novel-script`(剧本) 的下游产物：把剧本的**每条 beat（动作节拍 / 台词行 / 心声）**拆成一条可生成的分镜（shot）。一个 beat ↔ 一条 shot，一一对应，保证剧本被完整覆盖。

## 顶层

```jsonc
{
  "source": "渡口",                 // 书名，用于产出文件名
  "params": { ... },                // 可选：覆盖默认时长参数
  "episodes": [ { "ep": 1, "targetSeconds": 120, "shots": [ ... ] } ],
  "_embed": {                       // 仅记录来源，便于复跑
    "script": "渡口-script.json",
    "outline": "渡口-outline.json",
    "art": "渡口-art.json",
    "cast": "渡口-cast.json"
  }
}
```

### params（可覆盖，默认见下）

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `charsPerSecond` | 4.5 | 台词行语速（字/秒），用于估算台词镜头时长 |
| `actionSeconds` | 2.5 | 单条动作节拍基础时长 |
| `tolerance` | 0.15 | 单集预估时长相对剧本 `targetSeconds` 的容差（±15%） |
| `shotSecondsFloor` | 1.5 | 单镜最短秒数 |
| `shotSecondsCap` | 10 | 单镜最长秒数 |
| `style` | "semi-realistic" | 美术风格，需与 `art.json` 对齐 |
| `promptFormat` | "h3" | 提示词格式：`h3`=生成 H3 三段式视频提示词（MiniMax H3）；`legacy`=仅首帧图像提示词 |
| `h3Mode` | "i2va" | H3 生成模式：`i2va`=首帧图+角色参考图驱动（图生视频，可反复抽卡）；`t2va`=纯文生视频 |
| `h3Style` | "Live-action, cinematic" | H3 描述句首的主视觉风格 |
| `h3Music` | "A soft, understated background score ..." | H3 `non_diegetic_music` 默认值 |

## episode

```jsonc
{
  "ep": 1,                 // 集号
  "targetSeconds": 120,    // 本集预估总时长（自动汇总 shots.durationSec）
  "shots": [ ... ]
}
```

## shot（核心字段）

| 字段 | 来源 | 含义 |
| --- | --- | --- |
| `shotId` | 脚本生成 | 镜号，格式 `E{nn}S{nnn}`（如 `E01S001`） |
| `ep` | 脚本生成 | 所属集号 |
| `sceneId` | 剧本 | 场景 ID，**须在 `art.json` 的 `scenes[].id` 内** |
| `lighting` | 剧本/art | 光照状态名，**须是 `art.json` 该场景 `lighting[].state` 之一** |
| `characters` | 剧本 | 在场角色 ID 数组，**须 ⊆ 剧本该场 `characters`** |
| `props` | 剧本 | 道具 ID 数组（对应 `art.json` 的 `props[].id`） |
| `shotType` | 模型填（seed 给默认） | 景别，枚举见下 |
| `camera` | 模型填（seed 默认"固定机位"） | 机位/运动：固定/推/拉/摇/移/跟/手持 |
| `durationSec` | 脚本生成 | 单镜时长（秒），继承剧本 beat 时长模型 |
| `sourceBeat` | 脚本生成 | `{ sceneNo, beatNo }`，回溯到剧本的具体 beat |
| `beatKind` | 脚本生成 | `action` / `dialogue` / `vo` |
| `onScreen` | 脚本生成 | `vo` 默认 `false`（心声可不把说话人放进画面） |
| `prompt` | **模型填**（autofill 可自动合成） | 首帧生成提示词，**必须英文**（图生视频 I2VA/FL2VA 的首帧或 T2V 底图） |
| `splitPrompt` | autofill 生成 | 纯文本首帧提示词（单行），**可直接复制进 Krea2 ComfyUI 文生图/图生图节点** |
| `negativePrompt` | **模型填**（autofill 可自动合成） | 反向提示词，**必须英文** |
| `refImagePaths` | autofill 生成 | 本镜引用的人物角色图路径清单，**按景别推荐取用**：特写→`portrait`／近景·过肩→`portrait`(或`halfBody`)／中景→`halfBody`／全景·远景→`fullBody`／侧身→`side`。所选缺失时自动降级 `portrait → sheet → 【角色图:名】` 占位（`cast.json` 的多视角字段可选，skill 只管推荐+降级，生成图是你自己的事）。供首帧图生图与 H3 I2VA 复用 |
| `complexity` | autofill 生成（P0） | 镜头复杂度评分：`{ score, level: 'simple'\|'normal'\|'high', recommendSplit: bool, splitClauses: string[], warnings: string[] }`。`score` 为确定性打分（人数/互动、动作分句数、道具交互、情绪变化、镜头运动、空间位移），仅用于展示镜头繁忙程度；**`recommendSplit` 与拆镜器共用同一把尺子**：仅当「动作镜 + ≥2 个句号/分号分句」时置 `true`，保证"推荐可拆"必然"拆得动"（`split --auto` 据此拆分，同样只拆动作镜、只按句号分句）。逗号串成的连续动作（如"拿起手机，看了一眼消息"）不计入可拆分句，由 `warnings` 提示人工处理，避免"提示了却拆不动" |
| `continuity` | autofill 注入骨架（P0-3） | 连续性状态块：`{ characters: {cid:{name,wardrobe,emotion,state,position}}, props:{pid:{name,state}}, scene:{lighting,weather,time} }`。`wardrobe` 为服装 ID（如 `W01`），与 `cast.json` 的 `wardrobe` 表共用同一份 ID——既用于连续性检查，也由 `composePrompt` 展开成 `wearing <prompt>` 注入首帧。`identityAnchors` 不可变特征由 `composePrompt` 注入首帧（Identity Lock），防跨镜脸崩。缺省留空待模型 seed 后精修 |
| `direction` | autofill 注入骨架（Iteration 5） | 视觉导演块（Visual Direction）：`{ framing, cameraAngle, lens, subjectPriority[], composition, foreground, midground, background, visualFocus, pose, emotion, colorMood }`。seed 用确定性逻辑填骨架（`framing←shotType`、`cameraAngle` 默认 eye-level、`lens` 特写 85mm/其他 35mm、`subjectPriority←`角色顺序、`visualFocus←`动作主语、`emotion`/`pose` 由动作词表推断、`colorMood←`光照天气），`composePrompt` 在 `direction` 存在时追加构图/镜头/焦点/情绪/色调句，让首帧从"拼接"升级为"导演"。`foreground/midground/background` 可空待模型精修；无 `direction`（旧 storyboard.json）时 `composePrompt` 行为不变（向后兼容） |
| `firstFrameCopyBlock` | autofill 生成 | **首帧出图整块**：正向提示词 + 反向提示词 + 参考图，分块标注，**可直接复制粘贴到 Krea2 ComfyUI 工作流** |
| `h3` | autofill 生成（仅 `promptFormat=h3`） | H3 视频提示词三段式（见下），`mode` 为 `I2VA`/`T2VA`；I2VA 额外带 `firstFrameReference`/`characterReference` |
| `h3CopyBlock` | autofill 生成（仅 `promptFormat=h3`） | **视频生成整块**：首帧引用句(I2VA) + 三段式字段，分块标注，**可直接复制粘贴到 MiniMax H3 ComfyUI 工作流** |
| `batch` | 脚本生成 | 生成批次（同 `场景+光照` 归一批，如 `B1`） |
| `warnings` | 模型填 | 难点预警数组（多人近景/特写、含人群词等） |
| `note` | 模型填 | 取景/调度备注（`vo` 镜必须说明） |

### shotType 枚举

`全景` `远景` `中景` `近景` `特写` `过肩` `主观` `空镜`

### seed 默认景别推断（模型可覆盖）

- 动作节拍：在场 ≥3 人→`全景`，2 人→`中景`，1 人→`近景`
- 台词行：≥3 人→`中景`，2 人→`过肩`，1 人→`近景`
- 心声(vo)：`特写`

## 与上游的契约

| 上游 skill | 文件 | 分镜消费它的什么 |
| --- | --- | --- |
| novel-script | `script.json` | 每集每场 `flow` 的 beat → 拆镜；`targetSeconds` 用于单集时长对账；`characters` 用于角色一致性 |
| novel-art | `art.json` | `scenes[].id` / `lighting[].state` 校验场景与光照；`image.negativePrompt`、`props[].states[].prompt` 供 autofill 合成提示词 |
| novel-characters | `cast.json` | `characters[].name` ↔ outline 的 `C-id` 映射；`image.prompt` 供 autofill 合成角色形象 |
| novel-outline | `outline.json` | `characters[].id → name` 映射，把 `C01` 变成"沈知微"显示在报告里 |

> 不提供上游文件时，对应的对账类质量门自动"跳过"，其余门仍强制通过。

## 质量门（17 道，确定性）

1. **剧本 beat 全覆盖**：每个剧本 beat 都有对应 shot（需 `--script`）
2. **shotId 唯一且格式合规**：`^E\d{2,}S\d{3,}$`
3. **场景 ID 在 art.json 存在**（需 `--art`）
4. **光照状态在场景内注册**（需 `--art`）
5. **镜头角色 ⊆ 剧本在场角色**（需 `--script`）
6. **单镜时长合规 & 单集时长贴近**：单镜 ∈ [floor,cap]，单集总和贴近剧本 `targetSeconds`±容差（单集比对需 `--script`）
7. **景别取值合法**
8. **机位非空**
9. **首帧提示词非空且英文**（若 `--cast` 还校验不含角色中文名）
10. **反向提示词非空且英文**
11. **生成批次已分配**
12. **VO 镜头取景已说明**：`onScreen=false` 或 `note` 非空
13. **难点镜头已加预警**：≥3 人在场且景别为近景/特写、或提示词含人群词，须在 `warnings` 标注
14. **H3 描述符合规范**（仅 `promptFormat=h3`）：每条 `h3.integrated_multimodal_description` 非空、含 `[Shot N]` 头、含运镜(`The camera`)与景别词(`shot`/`frames`)、对白/心声镜含 `<d>[`；H3 允许中文（角色名/`<d>[Chinese]` 台词），但**动作叙事须为英文**（含中文动作自动退化占位）
15. **H3 声景/配乐已填**（仅 `promptFormat=h3`）：`h3.overall_soundscape` 与 `h3.non_diegetic_music` 均非空
16. **H3 复制块已生成**（仅 `promptFormat=h3`）：每条 `h3CopyBlock` 非空，可直接粘贴到 ComfyUI
17. **首帧出图复制块已生成**：每条 `firstFrameCopyBlock` 非空，可直接粘贴到 Krea2 ComfyUI

> `promptFormat=legacy` 时，G14/G15/G16 自动标记为"未生成 H3，跳过"，仅跑前 13 + G17 道。

## ComfyUI 工作流对接（端到端）

本 skill 的产出直接服务于你描述的两条 ComfyUI 链路，**全部字段开箱即可复制粘贴**：

### 链路 A · 首帧图（Krea2 ComfyUI）
- 输入：`firstFrameCopyBlock`（正向+反向提示词） + `refImagePaths`（人物角色图，作为图生图/角色一致性参考）。
- 操作：把"正向提示词"粘进 Krea2 文生图/图生图节点；把角色图作为参考图传入；"反向提示词"粘进 negative 节点。
- 产出：每条镜头一张首帧图（文件名建议 `E01S001.png`，与 `shotId` 对应）。

### 链路 B · 视频（MiniMax H3 ComfyUI）
- 输入：`h3CopyBlock`（首帧引用句 + 三段式） + 链路 A 的首帧图 + `refImagePaths`（人物角色图）。
- 操作：`h3Mode=i2va` 时，把"首帧引用句"粘到提示词开头，把首帧图作为 `<Picture 1>` 传入，把角色图作为参考图；其余三段（`integrated_multimodal_description` / `overall_soundscape` / `non_diegetic_music`）分别粘入对应字段。
- 抽卡：对同一 `shotId` 反复换随机种子/微调提示词，直到画面与角色一致、运镜满意，再进下一镜。

> `refImagePaths` 的真实路径优先在 `cast.json` 的 `image.portrait` 填入（干净单视角参考图，专供生成参考）；其次 `image.path`；缺省时退化为 `【角色图:名】` 占位，`novel-project verify` 会报"参考图文件缺失"提醒补图。

