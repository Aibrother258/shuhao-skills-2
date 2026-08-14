# 项目目录结构规范（cross-skill）

本文件定义 novel-* skills 产出物在**实际项目**里应如何组织目录。各 skill 在 SKILL.md 的
"最终落地"段只写自己那段产物落点，细节引这里。改目录结构先改本表，再同步各 skill。

## 设计原则

1. **按数据流编号**：outline → cast → art → script → storyboard → prompts，编号即顺序。
2. **共享资产就近归阶段**：角色图归 `02_cast/images/`、场景道具图归 `03_art/images/`，
   跨阶段引用用相对路径（如 `05_storyboard/storyboard.json` 引用 `../02_cast/images/X.png`）。
3. **图片 / 视频 / 音频不归 skills 产出**：由用户去别处生成后回填，放 `07_generated/`。
   外部工作流（ComfyUI / Python）放 `08_workflows/`，**不纳入 skills 职责**。
4. **三层交付物分层清晰**：JSON（Agent）/ HTML（人审）/ prompts（生产）各归其位。

## 标准结构

```
<project>/pipeline/
├── 01_outline/      outline.json, outline.md,
│                    outline-report.html                 · novel-outline（HTML 交付物）
├── 02_cast/         cast.json, cast.md, report.html,
│                    images/                             · novel-characters（HTML 交付物）
│                    images/<角色>-model-sheet.png
│                    images/candidates/（候选，供挑选）
├── 03_art/          art.json, art.md, art-report.html,
│                    images/                             · novel-art（HTML 交付物）
│                    images/（场景图 + 道具图，待生成回填）
├── 04_script/       script.json, script.md,
│                    script-report.html                  · novel-script（HTML 交付物）
├── 05_storyboard/   storyboard.json, storyboard.md,
│                    storyboard-report.html,             · novel-storyboard（整份 HTML 交付物）
│                    by-episode/                          · 按集拆分（推荐，每集一个 HTML）
│                      ├ index.html                        · 目录导航页
│                      ├ E01.html … E<NN>.html             · 每集独立报告（亮色国风，与另4个统一）
├── 06_prompts/      shots/ characters/ scenes/ props/   · novel-storyboard --all
├── 07_generated/    frames/ video/ audio/（外部生成产物占位）
├── 08_workflows/    外部工作流（不纳入 skills）
├── tools/           build-panel.mjs, backfill-cast.mjs（辅助脚本，规划中，尚未实现）
├── project.json     五层总账（paths + reports + skills 状态 + 生产状态）
└── README.md        结构说明 + skills 映射
```

> HTML 报告是每层质量门通过后的**人审交付物**，由对应 skill 的 `render --html` 产出，文件名
> 固定见各 skill SKILL.md；`verify` 会检查这 5 个 HTML 是否齐备（见 schema.md P0-4）。

## 引用约定（必须保持）

| 引用方 | 字段 | 路径写法 | 校验 |
| --- | --- | --- | --- |
| storyboard.json | `refImagePaths` / `characterReference` | `../02_cast/images/<角色>-model-sheet.png` | 相对 05_storyboard/ 存在 |
| cast.json | `image.portrait/halfBody/fullBody` | `images/<角色>-portrait.png`（占位，待回填） | 生成定稿后补 |
| storyboard-report.html | 内嵌 JSON + 展示路径 | 同 storyboard.json | 渲染时同步 |

> 重排目录后务必跑一次精确校验：只查真实路径字段（refImagePaths / characterReference），
> 排除提示词文本里作为说明文字出现的路径串。

## 与另一套（Python/ComfyUI）结构的区别

参考模板 `LastHuihua/` 把 `.py` 脚本、`.log`/`.err`、MiniMax mp4 也编进编号目录。本 skills
体系**只产出 JSON/MD/HTML/prompts/images/candidates**，Python/ComfyUI/MiniMax 等外部环节
只留占位目录（07_generated、08_workflows），不写进 skill 职责范围。
