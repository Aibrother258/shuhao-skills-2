# Iteration 7 — 上游同步（eternityspring/shuohao-skills 新功能并入，本地成果不回退)

## 背景
用户把上游仓库 `https://github.com/eternityspring/shuohao-skills.git` 推了更新，要求"把相关更新功能同步到我的 skills 里"。
本地仓库（origin = `Aibrother258/shuohao-skills-2`）与上游是**两个不同方向的 fork**：

- **本地**在 `novel-project` 编排层方向上做了强化：`novel-project` 总控 + 5 层 HTML 报告固化（P0-4）、
  交互硬卡点 C1-C4、`project-layout.md` 引用、`novel-art` 的 `photorealistic` 预设、
  `novel-characters` 的 `portrait` 单视角参考图等。
- **上游**相对本地主要是**回退**：把上述 `novel-project` 相关引用删掉，并简化了
  `photorealistic` 预设与 `portrait` 单视角参考图等功能。

经核对，**上游真正的新增功能只在 `novel-script`**；其余差异均为回退。

## 同步策略（用户确认）
> 只取上游新功能，保本地成果。
> 把 `novel-script` 的 `hookBeat` + TTS 音色新功能同步进来，保留本地的 `novel-project`
> 编排层、HTML 固化、`photorealistic`、单视角参考图等所有增强，不回退任何本地功能。

## 实际合入（novel-script 上游新功能）

1. **`hookBeat` + 第 10 道门 `hook-open`**（来自上游）
   - `params.hookWindow = 3`：开场钩子的具象必须在全集前 3 拍内兑现
   - `ep.hookBeat: [场, 拍]` 认领钩子具象落点（基于本集 1 起始）
   - `validate` 新增 `hook-open` 门：缺字段 / 场越界 / 超出前 3 拍 / 跨场太远 均拦截
   - 报告（HTML + MD）钩子兑现的那一拍标红高亮，并显示 `第 X 场第 Y 拍兑现` 注解
2. **台词本对接 TTS 音色提示词**（来自上游）
   - CLI 新增 `--cast cast.json` 参数，`loadCtx` 一并加载 cast
   - 按 outline 角色名匹配 `voice.prompt`，台词本每个角色多出"音色提示词"复制钮
   - 未给 `--cast` 时不显示（向后兼容）

## 未动（本地已有功能，全部保留）
- `novel-project` 编排层 + 5 层 HTML 报告固化（P0-4 检查）
- 交互硬卡点 C1-C4、`project-layout.md` 引用
- `novel-art` 的 `photorealistic` 预设
- `novel-characters` 的 `portrait` 单视角参考图、candidates 目录
- `novel-storyboard` 的亮色国风报告、`--per-ep` 按集拆分、report-style.md

## 文档同步
- `SKILL.md`：门数 9 → 10、补 `hookBeat` 行、台词本补音色按钮、钩子高亮说明、自测数 125→129
- `references/schema.md`：补 `hookBeat` 字段说明
- 样例 `examples/渡口-script.json`：每集补 `hookBeat: [1,1]` 满足新门禁（全绿基线）
- `scripts/selftest.mjs`：门数断言 9 → 10、新增击穿用例、HTML 徽章 10/10、断言 125→129

## 验证
- `novel-script` 自测 **129 项全绿**（含 4 个 hook-open 击穿用例）
- `novel-project` 自测 **29 项全绿**（编排层未受影响）
- lint 0

## 提交
- commit `c194c30` → `main`，16 files changed（+1425 / -311）
- 含本次上游同步 + 前会话未提交成果（novel-project 固化 / novel-storyboard 按集报告）
- remote：`Aibrother258/shuohao-skills-2.git`

## 一句话
> 上游相对本地是回退，唯一实新功能是 `novel-script` 的 `hookBeat` 钩子门 + 台词本 TTS 音色；
> 按"只取新功能、不删本地成果"的策略并入并 push，本地编排层与所有增强原样保留。
