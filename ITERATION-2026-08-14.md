# 迭代记录 2026-08-14 — 项目总控 + 规范化收尾

## 背景

仓库从 6 个 skill 的集合升级到"一条 AI 短剧生产链"后，最大的缺口不再是某个单层能力，
而是**层与层之间的一致性**：六个 skill 各产一份 JSON、各有质量门，但单层的 validate
只保证"自己那份合法"，没人回答"我在做哪部剧、做到哪一步、各层对得上吗"。

本轮先评审了网页版 ChatGPT 给的一份升级方案（Skill OS / 统一 schema / 生产层 skill /
总导演），结论是**方向对、落地要裁剪**：

- 采纳：项目总控、资产引用统一、跨层契约、build 入口
- 修正：不做根目录中央 `schemas/`（破坏"自包含、可单拷"的仓库约定，改为契约测试）；
  生产层 skill（video-generation / tts-production）不做核心依赖（撞"零依赖、零 API key"
  的定位红线，留作可选适配器）；全自动视觉 QC 降级为确定性 QC + 人工核对清单

## 本轮改动

### 1. 新增 novel-project（项目总控）— 本迭代核心

```
skills/novel-project/
├── SKILL.md
├── README.md / README.en.md
├── scripts/
│   ├── novel-project.mjs   init / status / verify / build
│   └── selftest.mjs        15 项断言
├── references/
│   └── schema.md           project.json 结构 + 全部跨层契约规则
└── examples/
    └── 渡口-project.json   《渡口》五份产物串成一个项目
```

四个命令：

| 命令 | 作用 |
| --- | --- |
| `init` | 生成 project.json 骨架（剧名/集数/单集分钟/五层路径/状态） |
| `status` | 五层文件就位情况 + 记录状态，`--verify` 连契约一起看 |
| `build` | 按 DAG（大纲 → 角色 → 美术 → 剧本 → 分镜）找缺口，打印下一步 |
| `verify` | 跨层契约校验；`--write` 回写每层 verdict 到 project.json |

契约规则覆盖：集数对齐、ep 连续编号、角色/场景/道具 id 引用、光照登记、
`targetSeconds = 分钟 × 60`、分镜角色 ⊆ 剧本该场、单集时长 ±15%、参考图占位符。
只查**跨层引用**，单层内部质量门仍由各 skill 自己的 validate 负责。

### 2. 修复 novel-storyboard 的光照继承 bug

`seed` 之前固定取美术场景的**第一个**光照状态，导致剧本第 6 集 S01 写的是
「雾散近岸」、分镜却用了「晨雾」——分镜自己的 17 道门只查美术登记、不回头对剧本，
所以这个不一致一直没被发现。

修复后优先级：**剧本该场指定（且美术已登记）> 美术第一个状态 > 默认**。
这是 novel-project 的契约校验上线后抓出的第一个真实 bug。

### 3. 规范化收尾（补齐仓库硬要求）

- **h3-prompt-writing**：补 `version`、8 项自测（字段顺序/引用句式/`<d>` 封装/
  Ref2VA 六 section 顺序/保留分析判定词）、双语 README。此前它是唯一没有
  `scripts/selftest.mjs` 的 skill，违反仓库硬要求且无人发现
- **novel-storyboard**：frontmatter 补全（version / allowed-tools / triggers / metadata）、
  新增 README.en.md
- **scripts/check.mjs（新增）**：仓库级结构检查，`--run` 连全部自测一起跑，
  让"装上去但没自测"的漏网之鱼进不了仓库
- README 中英文补全 7 个 skill 条目；CHANGELOG 记录四个条目

## 验证

```bash
node scripts/check.mjs --run
```

- 7 个 skill 结构检查全部达标（警告 0）
- 自测共 **805 项断言**全部通过：
  h3 8 / novel-art 131 / novel-characters 307 / novel-outline 200 /
  novel-project 15 / novel-script 125 / novel-storyboard 19
- 《渡口》端到端演练：build → 生成分镜 → verify `--write`，五层全 passed，
  分镜光照与剧本一致（修复生效）

## 真实数据发现（《渡口》样例）

跨层契约把样例里三个"单层校验器都放行"的问题暴露了出来：

1. 剧本第 6 集 S02 场没写光照状态（美术里有「浓雾清晨」可用）
2. 大纲功能角色「岸上挑灯的更夫」（C05）没有角色设定卡
3. 全剧角色参考图还是 `【角色图:…】` 占位符（cast.json 的 image.path 未填）

前两条是警告不阻塞；第三条出片前必须补。

## 遗留与下一步

- **角色参考图**：novel-characters 出的 sheet 是"半身像 + 三视图 + 细节条"合成板，
  直接当 Krea2/H3 角色参考会污染生成；建议补一张干净单视角参考图
- **novel-storyboard 报告截图**：README 里目前是文字链接，可补 assets/report.webp
- **生产层适配器**：tts-production / video-generation 以可选适配器形态接入，
  保持"缺了外部工具照跑"的承诺
- **continuity-check**：先给 storyboard 扩展每镜服装/道具状态字段，再写连续性检查

## 复现命令

```bash
# 看《渡口》样例的项目状态（分镜需先 seed）
node skills/novel-project/scripts/novel-project.mjs status skills/novel-project/examples/渡口-project.json

# 五层齐了以后跑跨层契约
node skills/novel-project/scripts/novel-project.mjs verify <project.json> [--write]

# 下一层该跑什么
node skills/novel-project/scripts/novel-project.mjs build <project.json>

# 仓库级结构检查 + 全部自测
node scripts/check.mjs --run
```
