# 迭代记录 2026-08-14f — 批量功能变更复查（P0-4 报告交付 / hook-open 门 / 亮色国风 / --per-ep）

## 背景

工作区出现一批未提交的功能变更（跨 novel-script / novel-storyboard / novel-project 三个 skill），
本轮回溯核对代码与文档，修掉矛盾与残留后写此记录。

## 本批新增了什么（功能层，全部验证通过）

1. **novel-script 第 10 道质量门 `hook-open`**：`hookBeat: [场, 拍]` 认领钩子具象落点，
   必须在全集前 3 拍内兑现（`params.hookWindow=3`，可调）。《渡口》样例 6 集全部补了
   `hookBeat: [1,1]`，`validate` 全过；自测新增 4 个击穿用例（缺字段 / 场越界 / 超出前 3 拍 /
   跨场太远）。9 → **10 道门**，自测 125 → **129 项**。
2. **台词本对接 TTS 的音色提示词按钮**：`render --cast` 后台词本按角色带"音色提示词"复制钮。
3. **storyboard 报告统一为亮色国风**：内联样式从暗色换成纸感浅灰 + 印章红（与另 4 个 skill
   同套令牌），新增 `references/report-style.md` 定版规范。
4. **`render --per-ep` 按集拆分报告**：每集一份独立 HTML（单集 KPI / 质量门 / 批次 / 逐镜表 /
   可复制提示词 / 内嵌本集 JSON），外加 `index.html` 导航页，解决超长分镜单文件难审的问题。
5. **novel-project P0-4 HTML 报告交付物检查**：`project.json` 新增 `reports` 登记；
   `verify` 对"产物已存在但缺 HTML 报告"的层报警告（人审交付物铁律），未登记按
   「产物同目录 + 默认文件名」兜底。`project-layout.md` 同步目录规范。

## 排查发现的问题（已修）

| # | 问题 | 修复 |
| --- | --- | --- |
| 1 | **主题矛盾**：novel-storyboard/SKILL.md 与 novel-project/schema.md 都写"暗色主题"规范，但代码与 `report-style.md` 实际是**亮色国风**（本批刚统一） | 两处文档改为"亮色国风" |
| 2 | **门数/自测数残留**：novel-script README 中英仍写"9 道质量门 / 125 项断言"，仓库 README 中英 novel-script 行也写"9 道" | 全部改 10 道 / 129 项，README 质量门表补 `hook-open` 行 |
| 3 | **引用不存在的文件**：project-layout.md 列了 `tools/build-panel.mjs, backfill-cast.mjs（辅助脚本）`，但目录不存在 | 标注"规划中，尚未实现" |
| 4 | **误入文件**：工作区出现附件副本 `ChatGPT的分析.md`（未跟踪） | 移出工作区到 `/tmp/ChatGPT的分析-20260814.md`（可恢复） |

## 排查未发现问题的部分

- `parseArgs` 对 `--per-ep` 的短横参数解析正常
- `renderEpHtml` 内嵌 JSON / 复制块 / 质量门面板渲染正常，亮色令牌生效
- 新剧本样例（hookBeat）→ storyboard seed → validate 全链通过
- novel-project `checkReports` 只对"产物已存在"的层检查，缺报告报警告不报错
- `interaction-checkpoints.md`（C6 分镜三层交付）已存在且被正确引用

## 验证

```bash
node scripts/check.mjs --run
```

全仓库自测全绿（novel-characters 313 / novel-outline 200 / novel-project 29 /
novel-script 129 / novel-storyboard 48，h3 8 / novel-art 131）。
`rg` 复检"暗色 / 9 道 / 125 / Nine quality"等历史残留：0 处。

## 一句话

> 功能层这批变更质量不错（10 道门、报告交付铁律、按集报告都成立）；本轮主要修的是
> **文档与实现脱节**——主题规范说暗色实为亮色、门数/自测数停留在旧版、布局文档引用
> 了不存在的脚本。

---

## 复查续：novel-art photorealistic 预设的自测缺口（14f 补）

外部把上游（eternityspring）同步进来时（commit `c194c30`），novel-art 与 novel-characters
都带上了第三档画风 `photorealistic`（SKILL.md 已文档化、样式预设与校验规则已实现），
但 **novel-art 的 selftest 没同步**，断言还停在 `realistic,ghibli` 两档 → 全仓库
`check.mjs --run` 首次跑挂 1 个（novel-art）。

修复（本轮）：

- `novel-art.mjs` 校验补一条防御门：`photorealistic` 预设的负向提示词也不许禁
  `photorealistic`（写实预设禁写实是自相矛盾）——与 `realistic` 同规则
- `selftest.mjs`：`SUPPORTED_STYLES` 期望值更新为三档、补 photorealistic 预设不自禁 /
  自带禁人的断言、补"负向禁自身被拦"的击穿用例；131 → **134 项**
- `README.md` 风格门描述同步（realistic / photorealistic 都不禁 photorealistic）

验证：novel-art 134 项全绿，`node scripts/check.mjs --run` 全仓库通过。
