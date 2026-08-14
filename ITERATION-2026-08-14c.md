# 迭代记录 2026-08-14c — Prompt Pipeline 最后一公里

> 基线：`6c26fe8`（P0 四项已落地：portrait/失效传播/连续性/Node18/版本读取）
> 本轮目标：把"结构化 JSON"变成"你直接能复制去生的 Prompt 文件"，守住红线（零依赖、确定性、自包含、不新建 manifest/schemas）

## 输入
- ChatGPT 重评（最新 main）：定位从"短剧生产 OS"收敛为 **Shuohao AI Drama Prompt Pipeline**；指出最大短板是"最后 10 米"——JSON 给 Agent、HTML 给人审、你干活要的是打开就能复制的 Prompt 文件。
- DeepSeek 修正：裁剪三处——① 加命令不加三层 Compiler 架构；② 多参考图只做字段+推荐+降级，不替你生成 120 张图；③ 不新建中央 `schemas/` 目录（破坏自包含）。

## 落地（对齐两份分析收敛后的六件）

### P0
1. **`export` 命令**（`novel-storyboard`）——最后一公里
   - 把 storyboard 内嵌的 `firstFrameCopyBlock` / `h3` / `refImagePaths` 平铺成 `prompts/` 四类文件：
     - `characters/<id>-<name>.txt`：形象提示词 + portrait + Identity Lock + Wardrobe
     - `scenes/<id>.txt`：空景提示词 + 各光照状态
     - `props/<id>.txt`：白底无手提示词 + 状态变体
     - `shots/<shotId>/{first-frame,negative,h3,refs}.txt`
   - 纯确定性逻辑，不破红线。工作流变成"打开 → 复制 → ComfyUI/H3 生成"。

2. **复杂度评分**（`scoreComplexity`，seed 时算）
   - 确定性打分：人数/互动、动作分句数（含逗号）、道具交互、情绪变化、镜头运动、空间位移。`score` 仅用于展示镜头繁忙度。
   - `recommendSplit` 与拆镜器共用一把尺子：仅「动作镜 + ≥2 个句号/分号分句」置 `true`，保证"推荐可拆"必然"拆得动"。逗号串连续动作不计入可拆分句，由 `warnings` 提示人工处理。
   - 输出 `{score, level: simple|normal|high, recommendSplit, splitClauses, warnings}`。不依赖模型，进 G 体系但只做提示不强制。

3. **`split` 拆镜子命令**
   - 对 `recommendSplit` 动作镜（或 `--shot` 指定）按分句拆成子镜，时长按比例分配。
   - **严守契约**：① 所有子镜沿用原 `sourceBeat` → G1 beat 覆盖门仍过；② shotId 加 `a/b/c` 后缀，G2 正则放宽允许；③ 子镜时长下限保护（<floor 不拆，避免 G4 越界）。

### P1
4. **Wardrobe Bible + Identity Lock**
   - `cast.json` 新增 `wardrobe:[{id,prompt}]` 与 `identityAnchors:[...]`。
   - `composePrompt` 拼首帧时展开 `wearing <prompt>`，并把不可变特征注入（防跨镜脸崩）。
   - continuity 的 `wardrobe` 字段与 wardrobe 表共用同一份 ID —— 检查与生成输入同源。

5. **按景别推荐参考图**（多视角，降级式）
   - `cast.image` 支持可选 `halfBody`/`fullBody`/`side`。
   - `composeRefImages` 按 shotType 推荐（特写→portrait／中景→halfBody／全景→fullBody／侧身→side），缺失时 `portrait → sheet → 占位符` 自动降级。skill 不替你生成这些图。

## 红线核对
- 零 API key：✅ 全确定性脚本
- 零 npm 依赖：✅ 纯 node:fs/path/crypto
- 不新建 manifest.json / schemas/ 目录：✅ 字段并入现有 cast/storyboard schema
- skill 自包含可单拷：✅

## 验证
- `novel-storyboard` 自测：19 → **35**（新增 [7] 复杂度评分 / [8] export 平铺 / [9] split 保 sourceBeat+G1 仍过）
- 全仓库 `node scripts/check.mjs --run`：**全部自测通过**
- lint：0 错误
- `novel-project verify --write`（渡口）假警报清零，未引入新回归

## 改动文件
- `skills/novel-storyboard/scripts/novel-storyboard.mjs`（export / scoreComplexity / split / 按景别选图 / wardrobe+identity 注入 / G2 正则放宽）
- `skills/novel-storyboard/scripts/selftest.mjs`（[7][8][9] 用例）
- `skills/novel-storyboard/SKILL.md`（命令速查补 export+split）
- `skills/novel-storyboard/references/schema.md`（complexity / 按景别选图 / wardrobe+identity 说明）
- `skills/novel-characters/references/schema.md`（wardrobe / identityAnchors / 多视角 / id 字段说明）
- `skills/novel-characters/examples/渡口-cast.json`（补 id C01..C04、wardrobe W01、identityAnchors、多视角字段）
- `skills/novel-storyboard/examples/渡口-cast.json`（同步上述字段，保持与 canonical cast 一致）
- `CHANGELOG.md` / `README.md`（Prompt Pipeline 描述更新）

## 明确不做（按 DeepSeek 裁剪 + 既有纪律）
- ❌ 三层 Prompt Compiler 架构（Canonical→Adapter→Copy Block）：加命令不加架构，现有 compose* 即 adapter
- ❌ 强制每角色 4 张参考图（120 次调用成本由你承担）
- ❌ 中央 `schemas/` 目录
- ❌ Director Agent / FFmpeg / 自动 TTS / 独立 Manifest / 复杂 LLM Eval

## 复查修复（DeepSeek 复查后，提交前）

初版落地后 DeepSeek 复查指出 3 个真 bug + 2 个次要问题，均已修复并补断言（storyboard 自测 35 → **38**）：

1. **[真 bug] export 的 h3.txt 丢 I2VA 首帧引用句** — `formatH3` 漏了 `firstFrameReference`/`characterReference`/首帧引用句（"For the target video... <Picture 1> is fully referenced"）。改：h3.txt 直接写完整 `h3CopyBlock`，`formatH3` 仅 legacy 兜底。**断言**：h3.txt 含 `is fully referenced`。
2. **[真 bug] split --auto 在真实数据上空转（拆 0 条）** — 默认 2.5s 动作拍拆 2 段每段 1.25s < floor 1.5s 全被拦下，且原自测 [9] 只断言"退出 0 + 数量≥原"掩盖了空转。改：新增 `splitSecondsFloor=1.0`，拆镜子镜标 `split:true`，G4 对 split 镜用该下限；原镜时长仍用 shotSecondsFloor。自测加"拆分后镜头数 > 原数"断言。
3. **[真 bug] composeRefImages 把 sheet 提示词文本当路径** — 回退链 `portrait→sheet→占位符` 中 `image.sheet` 是提示词文本不是路径，污染 refImagePaths/refs.txt 且触发 novel-project 误报"参考图缺失"。改：回退链 `pref→portrait→path→占位符`，sheet 永不进 refImagePaths。**断言**：仅 sheet 角色时 refImagePaths 不含 "model sheet"。
4. **[次要] cast 示例字段不齐** — 仅沈知微有 wardrobe/identityAnchors，陆行远/老周/胡二爷补齐（含修正一处误插的重复块），两份 cast 现已字段齐全且一致。
5. **[次要] overall_soundscape 混中文场景名** — "渡口栈桥 room tone continues" 违反 H3 全英文规范。改：`ambience = 'Ambient room tone continues'`（去场景名）。

修复后：storyboard 38 项全绿、全仓库 check.mjs 全绿、lint 0。

> 后续两处收尾已拆到独立记录：文档清理 + 定位校准见 `ITERATION-2026-08-14d.md`；`recommendSplit` 与 `split` 口径对齐（复测残留）同见 14d。
