# Iteration 5 — Visual Director 层 + Prompt Finalization（2026-08-14e）

## 背景
ChatGPT 第四次分析把仓库定位收敛为 **Prompt Pipeline**，指出"分镜工程能力已超过 Prompt 导演能力"——首帧 Prompt 仍是拼接器而非导演。
DeepSeek 复查确认该判断，并给出裁剪后的落地范围（加字段不加架构）：
- **P0**：shot 加可选 `direction` 块（seed 确定性骨架）+ `composePrompt` 注入 + export `FINAL`/`meta`
- **P1**：continuity 继承指导（仅文档，不做引擎）
- **明确不做**：新 skill、FirstFrameLock 独立字段、adapter、反馈闭环

## 落地（守红线：零依赖、确定性、不新建架构）

### 1. `shot.direction` 块（确定性骨架）
- 新增 `composeDirection(shot, ctx)`：seed 用确定性逻辑填骨架
  - `framing` ← shotType（中文景别→英文取景）
  - `cameraAngle` 默认 `eye-level`；`lens` 特写 85mm / 其他 35mm
  - `subjectPriority` ← 在场角色顺序
  - `visualFocus` ← 动作文本主语（角色名）或首个角色
  - `emotion` / `pose` ← 动作词表（EMOTION_MAP / POSE_MAP，新增常量）
  - `colorMood` ← 光照/天气词表
  - `composition` 默认 `rule-of-thirds`；`foreground/midground/background` 可空待精修
- seed 构造加 `direction: null`；`autofillShot` 调用 `composeDirection` 注入骨架

### 2. `composePrompt` 注入导演句（向后兼容）
- `direction` 存在时追加：`rule-of-thirds composition, eye-level camera angle, 35mm lens, visual focus on <焦点>, <情绪> expression, <色调>`
- **向后兼容**：无 `direction`（旧 storyboard.json）时行为不变
- 修复：visualFocus 可能是中文角色名，英文 prompt 不得含中文 → 中文时改写为 `the main subject`

### 3. export FINAL / meta
- `first-frame.txt` 加 `=== FINAL FIRST FRAME PROMPT（直接复制给 Krea2 文生图/图生图）===` 标签
- 新增 `meta.txt`：每镜生成说明（景别 / 建议时长 / 视频模式 I2VA·T2VA / 参考图 / 导演概要）
- 原 `refs.txt` / `h3.txt` / `negative.txt` 不变

### 4. 文档
- `schema.md`：加 `direction` 字段说明
- `SKILL.md`：`--autofill` 补 direction 导演块；`export` 补 FINAL/meta.txt

## 自测（42 → 48）
- [8] 内补：autofill 后 `shot.direction` 已注入骨架；lens 特写 85mm / 其他 35mm；`first-frame.txt` 含 FINAL 标签；`meta.txt` 存在且含建议时长+视频模式+导演；**无 direction 旧 storyboard 仍可 export（向后兼容）**

## 验证
- storyboard 自测 48 项全绿；全仓库 `check.mjs` 7 skill 全达标；lint 0
- 未动代码逻辑红线：零依赖、确定性、未新建 skill/架构
