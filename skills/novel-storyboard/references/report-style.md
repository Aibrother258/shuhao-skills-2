# novel-storyboard · HTML 报告样式规范（标准版）

> 本文件是 storyboard-report.html 的**视觉风格定版**，所有分镜报告（以及统一到本规范的
> 其他 skill 报告：novel-outline / novel-characters / novel-art / novel-script）都必须遵循此样式，
> 保证整套交付物视觉一致、跨项目跨次生成不走样。
> 改样式前先改这里；脚本内联 `<style>` 须与本规范保持同步。
> 本规范与另外 4 个 skill 的 HTML 渲染共用同一套 CSS 变量（亮色国风）。

## 设计基调

- **亮色 · 国风排版**：纸感浅灰底 + 衬线标题（Songti SC）+ 印章红强调，专为「打印 / 屏幕审片
  对照原作」场景设计，低刺激、易读、可 PDF 归档。
- **信息密度优先**：三层交付物条 + JSON 折叠块 + KPI 卡 + 质量门 + 批次 + 逐镜表 + 可复制提示词，一页审完。
- **无外部依赖**：纯内联 CSS + 原生 JS，单文件可离线打开、可复制/下载 JSON。

## 设计令牌（CSS 变量，所有 skill 共用，脚本须原样使用）

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `--paper` | `#eceded` | 页面底色（纸感浅灰） |
| `--panel` | `#f5f6f5` | 卡片 / 表头底 / 折叠块底 |
| `--side` | `#e4e6e3` | 表格表头底 |
| `--ink` | `#191d21` | 正文 |
| `--ink-2` | `#5b636a` | 次要文字 / 元信息 |
| `--ink-3` | `#8c9298` | 标签/三级文字 |
| `--rule` | `#d2d5d0` | 主描边 |
| `--rule-2` | `#c2c6bf` | 次描边 |
| `--seal` | `#8a3324` | 印章红（主强调 / 失败 / 链接 / 标题） |
| `--seal-2` | `#c56a4e` | 印章红浅（次要强调 / 徽标） |
| `--seal-soft` | `#8a332412` | 印章红 8% 透明（告警/badge 底） |
| `--ok` | `#3d6b4f` | 通过绿（质量门） |
| `--mono` | `ui-monospace,...` | 等宽（提示词 / 镜号 / 代码） |
| 衬线 | `Songti SC / STSong / Source Han Serif SC` | 标题 h1/h2、KPI 数值、台词 |
| 无衬线 | `PingFang SC / Hiragino Sans GB / Microsoft YaHei` | 正文、标签 |

## 页面结构（从上到下）

1. **三层交付物条** `.layers`：说明 JSON / HTML / Prompt 各自的用途（人审视角必读）。
2. **JSON 源码折叠块** `.data`：内嵌完整 `storyboard.json`，带「复制 JSON」「下载 storyboard.json」按钮 + 大小/镜数信息。
3. **标题 + 元信息** `h1` + `.meta`：来源名、skill 版本、`style`、提示格式、语速、动作秒、容差。
4. **KPI 卡** `.kpis`：集数 / 镜头数 / 预估总时长 / 平均镜长 / 生成批次，各卡 `.kpi` 含数值 `.v` + 标签 `.k`。
5. **质量门 banner** `.banner.pass|.fail`：通过 X/Y（跳过 N）｜ 全部通过 / 未通过 n 道。
6. **质量门明细** `.gates`：逐门 `✅/❌` + 名称 + info。
7. **生成批次单** `.gates`：批次条 `.batch`（批次号 ×镜数：镜号列表）。
8. **逐集 section** `.ep`：每集 `h2 第 n 集 · 预估 Xs` + 逐镜表（镜号/场景/光照/角色/道具/景别/机位/时长/首帧提示词/H3 描述/批次/预警）+ 每镜「可复制提示词块」`.shot-copy`（首帧出图块 + 视频生成块）。

## 关键版式规则

- 卡片/表头/折叠块统一 `border:1px solid var(--rule); border-radius:2px`（小元素 2px，沿用国风方角）。
- 表格 `border-collapse:collapse`，`th` 用 `--side` 底 + `--ink-3` 文字，单元格 `padding:6px 8px`。
- 标题与 KPI 数值用衬线（Songti SC）；提示词/镜号用等宽 `--mono`。
- 提示词单元格 `.prompt` 限宽 `max-width:300px`、H3 描述 `.h3desc` 限宽 `360px`，过长由脚本 `slice` 截断（`…`）。
- 代码块 `.cb pre`：`white-space:pre-wrap; word-break:break-word; max-height:320px; overflow:auto`。
- 质量门通过=绿 `--ok`、失败=印章红 `--seal`；预警用 `--seal`；印章红用于可点击/标题强调。
- `@media print`：收起折叠按钮、纸白底，便于 PDF 归档（与另外 4 个 skill 一致）。

## 交互（原生 JS，无库）

- 「复制 JSON」：优先 `navigator.clipboard`，降级 `textarea+execCommand('copy')`，按钮反馈「已复制」1.2s。
- 「下载 storyboard.json」：Blob + `<a download>`，文件名固定 `storyboard.json`。
- 折叠块用原生 `<details>/<summary>`，无需 JS。

## 渲染模式（两种，统一本规范）

- **整份模式**：`render <storyboard.json> --html [--out 文件]` → 单文件 `storyboard-report.html`，全剧一页（KPI/质量门/批次/全部分集 section）。
- **按集模式（推荐，避免单文件过长）**：`render <storyboard.json> --per-ep --out <目录>` → 在目录下生成
  `E01.html / E02.html / …`（每集独立报告，排版同上但聚焦单集 KPI/批次/逐镜表）+ `index.html`
  目录导航页（亮色国风，列出各集入口）。**单集报告的 JSON 折叠块只内嵌本集 episode**（复制/下载 `E<NN>.json`），
  不内嵌全剧，文件更小。两种模式的视觉风格完全一致（共用上方 `:root` 令牌）。

## 约定（不改这里别动）

- 报告文件名固定 `<书名>-storyboard-report.html`（见 novel-project P0-4）。
- 渲染命令固定 `render <storyboard.json> --html [--all] --out <文件名>`（见 SKILL.md Step 5）。
- 风格统一从 `art.json.style` 继承，不在报告里另选。
- 全部 5 个 skill 的 HTML 报告共用本亮色国风 CSS 变量；某 skill 要微调版式时**只改结构类名、
  不要改 `:root` 令牌值**，保证整套交付物配色一致。
