# 迭代记录 2026-08-14d — 文档清理 + 定位校准 + recommendSplit 口径对齐

> 接续 `ITERATION-2026-08-14c.md`（Prompt Pipeline 最后一公里）。本轮无代码逻辑改动，纯文档与口径收尾，守红线（零依赖、确定性、不新建大架构）。

## 1. 文档清理 + 定位校准（ChatGPT 第四次分析）

ChatGPT 第四次把仓库明确为 **Prompt Pipeline**（非生产 OS），方向与前两次一致；其中点名的"历史信息残留"类 P0 文档 bug 已修，产品层增强（导演层 / 多模型 Adapter / 智能时长）属第四次大迭代，留作待办不在此轮塞入。落地：

- **[P0 文档 bug] 安装地址错误**：`README.md` / `README.en.md` 仍 clone 旧仓库 `eternityspring/shuohao-skills.git` → 改为 `Aibrother258/shuhao-skills-2`。
- **[P0 文档 bug] CI / Node 版本矛盾**：主 README 写"没有配 CI / 只在 macOS + Node 24 验过"，实际已有 `.github/workflows/ci.yml`（Node 18/20/22 矩阵）。改为如实描述 CI + 本地 `check.mjs --run`。
- **[文档一致性] skill README 残留**：`novel-characters/outline/art/script` 的中英文 README 里"只在 macOS + Node 24 没验过"统一改为"已在 macOS + Node 18/20/22（CI 矩阵）验证"。
- **[定位校准] 模型二次润色降级**：`novel-storyboard/SKILL.md` 原把"模型逐镜精修/润色"写成正常必经流程；改为"autofill 确定性合成即最终可复制提示词，润色/微调仅为可选而非必需"，与红线（零模型依赖、确定性）对齐。

## 2. recommendSplit 口径对齐（复测残留修复）

复测发现 `recommendSplit` 与 `split` 能力不对齐：评分器按"逗号+句号"分句（"拿起手机，看了一眼消息，脸色骤变"→4 段→高分→`recommendSplit=true`），拆镜器只按句号分句且只拆动作镜。《渡口》4 条 `recommendSplit` 里仅 1 条真拆得动，75% 概率"提示了却拆不动"。采用方案 A（评分器与拆镜器共用一把尺子）：

- `recommendSplit` 仅在「动作镜 + ≥2 个句号/分号分句」时置 `true`，与拆镜器口径完全一致。
- `score` 仍含逗号分句用于展示镜头繁忙度，但不再驱动拆分决策。
- 逗号串成的连续动作改由 `complexity.warnings` 提示人工处理（拆镜器拆不动）。
- `scoreComplexity` 返回新增 `splitClauses` / `warnings`；seed 时把 `warnings` 合并进镜头级 `warnings`。

自测同步：storyboard 38 → **41**（[7] 复杂镜改用句号分句验证 `recommendSplit=true`，补逗号串镜 `recommendSplit=false`+warnings 断言；[9] 补"所有 `recommendSplit=true` 的镜都真实拆分"自洽断言）。修复后 41 项全绿、lint 0。

## 验证

- 未动代码逻辑，全仓库 `node scripts/check.mjs --run` 仍绿；lint 0。
- Ko-fi 捐赠链接（eternityspring 旧账号）与 ITERATION/CHANGELOG 里的"生产 OS"历史叙述保留不误改。
