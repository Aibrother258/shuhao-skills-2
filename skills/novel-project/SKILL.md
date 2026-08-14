---
name: novel-project
version: 1.0.0
description: |
  AI 短剧项目总控：用一个 project.json 串起角色/大纲/美术/剧本/分镜五份产物，
  提供 status（状态总览）、verify（跨 skill 契约校验）、build（缺哪层跑哪层）三个确定性命令。
  单层 skill 的 validate 只保证自己那份 JSON 合法，这里保证层与层之间对得上——
  集数、角色 id、场景 id、光照状态、道具引用、单集时长全部交叉检查。
  零依赖、零 API key，用当前会话额度。
  Use when asked to 建项目、项目总控、看进度、跨层校验、一条龙、把小说做成短剧、build 全流程。
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - Glob
triggers:
  - novel-project
  - 项目总控
  - 建项目
  - 项目进度
  - 跨层校验
  - 全流程
  - build 短剧
metadata:
  license: Apache-2.0
  requires:
    bins:
      - node          # >= 18，只用标准库，无 npm 依赖
  runtimes:
    - claude-code
    - codex
---

## novel-project

六个 skill 各产一份 JSON、各有质量门，但之前没有一层东西回答：
**我现在在做哪部剧、做到哪一步、各层资产对得上吗**。本 skill 就是这一层。

`{baseDir}` = 本文件所在目录。脚本 `{baseDir}/scripts/novel-project.mjs`，零依赖，`node` 直接跑。

**边界（不做的事）**：不拆角色、不排大纲、不出美术、不写剧本、不分镜——那是五个上游
skill 的活。本 skill 只管项目状态与跨层一致性，**单层内部的质量门仍由各 skill 自己的 validate 负责**。

---

### ⚠️ 开工前对齐三件事（任何流水线启动第一步）

跑任何一条 novel-* 流水线（单跑或本 skill 的 `build` 全流程）**第一步**就要和用户对齐：
**①美术风格**（realistic / ghibli / photorealistic …，整链路同一档，中途不能换）、
**②本次范围**（跑哪几层 / 哪几集 / 是否联动上游）、
**③产出形态**（本管线**只交提示词与路径，不替用户生图 / 生视频**）。
对齐后用一句话向用户复述确认结果再开工。完整的交互确认点、硬卡点与三层交付约定见
`references/interaction-checkpoints.md`——各 skill 的确认环节都引这份总表，改交互约定先改它。
实际项目里各阶段产物如何落盘（编号目录、相对引用、外部资产占位）见
`references/project-layout.md`。

### Step 0 — 建项目（project.json）

```bash
node {baseDir}/scripts/novel-project.mjs init <项目目录> \
  --title <剧名> --episodes <集数> [--minutes <单集分钟>] [--lang <zh|en>] [--genre <题材>] [--source <原文路径>]
```

产物是 `<项目目录>/project.json`，路径字段留空，等各层产物落地后回填（或用 `--source` 先指向原文）。
用户已有散落的五份 JSON？直接手写/改一份 project.json 把 `paths` 指过去即可，见 `references/schema.md`。

### Step 1 — 看状态

```bash
node {baseDir}/scripts/novel-project.mjs status <project.json>
```

打印五层各自的：文件是否就位、记录状态（pending/passed/failed）。
分镜表存在时，额外打印**生产进度**（每镜最小阶段状态机 storyboard/firstFrame/video/tts 的
完成度进度条 + 阻塞列表）。加 `--verify` 连契约一起看。

### Step 2 — 跨层校验 ⛔ 出片前必跑

```bash
node {baseDir}/scripts/novel-project.mjs verify <project.json> [--write]
```

只查**跨层引用**，不重复各层自己的质量门。规则全文见 `references/schema.md`，最常抓到的四类：

| 问题 | 为什么单层抓不到 |
| --- | --- |
| 剧本第 N 集场景没写光照，美术里有可用状态 | script 的 validate 把空光照当"没提供"跳过 |
| 分镜光照与剧本该场不一致 | storyboard 的 validate 只查美术登记，不回头对剧本 |
| 集数/时长在层与层之间漂移 | 每层只跟自己比 |
| 角色/场景/道具 id 引用悬空 | 各层 validate 只查自己那份 JSON |

`--write` 把每层 verdict（passed/failed/pending）回写进 project.json 的 `skills` 字段，
并把各层产物的 sha256 + 上游 hash + 生成 skill 版本写进 `versions`；不加就只读。
**有错误先修，改完重跑，直到错误归零**。警告不阻塞，但要看一眼：
功能角色没设定卡、参考图文件缺失这类，出片前要拍板。

#### P0-2 失效传播（幂等）

`verify` 会把各层产物的当前 hash 与记录在 `project.versions[id].inputs` 里的**上游 hash**
比对：上游（如剧本）变了、而本层（如分镜）没重新生成，就报"上游已变更……产物可能过期"。
`verify --write` 和 `build` 都会把当前 hash 写回 `versions`；**有上游过期的层保留旧记录**，
直到真正重新生成——这样"该重跑"不会被 `--write` 静默吞掉。

注意：**手工精修产物本身（比如逐镜润色 prompt）不算过期**——只有上游输入变了才失效。
这就是无外部工具依赖下的幂等生产基础。

#### P0-3 连续性状态机（跨镜）

分镜每镜带 `continuity` 块（角色 wardrobe/emotion/state/position、道具 state、场景
lighting/weather/time）。`verify` 比对相邻镜：**同集内**角色服装跳变、**同场同集内**
道具状态突变（缺承接节拍）与光照突变都会告警；换场/换集的光照与服装变化是合法的，不误报。
旧分镜无 `continuity` 块时自动跳过，向后兼容；`continuity` 块全是 seed 骨架（关键字段
未填）时也会提醒——连续性检查只有在状态被填实后才真正生效。

### Step 3 — 下一步该干什么（build）

```bash
node {baseDir}/scripts/novel-project.mjs build <project.json> [--all]
```

按 DAG（outline → characters → art → script → storyboard）找第一个缺口，打印该跑哪个
skill、需要什么上游。跑完一层重跑 build 会自动推进。五层齐了就跑 verify：

- 契约全过 → `✅ 全部就绪`，可以往下游出图/出视频
- 契约有错 → 报错清单，**不带病往下游走**

---

## 联动约定

- **改了上游必须重跑 verify**：outline 砍了场景 → art/script/storyboard 里悬空的引用
  当场点名；剧本改了光照 → 分镜的光照不一致当场点名
- **缺文件不是错误**：项目做到一半是常态，verify 报警告、build 报下一步，不误伤
- **改任何 skill 的 schema 后**：先跑该 skill 的 selftest，再跑本 skill 的 selftest，
  契约测试就是跨层兼容的闸门

## 自测

```bash
node {baseDir}/scripts/selftest.mjs
```

29 项断言，不调模型、不花额度。每道跨层契约都有击穿用例——证明它真的会拦。

## 自带样例

`{baseDir}/examples/渡口-project.json`：指向仓库里五份《渡口》样例产物。直接跑
`build` 会告诉你"分镜表还没出"——按提示先跑 novel-storyboard 的 seed，再 `verify`
就能看到全部契约（含真实存在的警告：更夫没设定卡、剧本第 6 集 S02 缺光照、
分镜表缺失等）。P0 之后新增的 `versions` / `production` 区也在本样例里展示。
