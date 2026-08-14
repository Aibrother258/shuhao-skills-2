# project.json 数据结构与跨 skill 契约

`project.json` 是 AI 短剧项目的**总账**：它不生产任何内容，只回答三个问题——
**在做哪部剧、做到哪一步、各层资产对得上吗**。

## 顶层

```jsonc
{
  "projectId": "dukou-001",        // 项目唯一 id，推荐 <剧名拼音>-<序号>
  "title": "渡口",
  "genre": "民国情感悬疑",          // 可空
  "lang": "zh",                    // 报告语言，跟随 novel-characters 的 --lang
  "episodes": 6,                   // 总集数（与 outline/script/storyboard 的 episodes 数必须一致）
  "episodeMinutes": 2,             // 单集分钟数（script.targetSeconds 必须 = 该值 × 60）
  "source": "source/渡口.txt",      // 小说原文路径，可空
  "paths": {
    "cast": "characters/渡口-cast.json",
    "outline": "outline/渡口-outline.json",
    "art": "art/渡口-art.json",
    "script": "script/渡口-script.json",
    "storyboard": "storyboard/渡口-storyboard.json"
  },
  "skills": {
    "novel-characters": "pending",  // pending / passed / failed
    "novel-outline": "pending",
    "novel-art": "pending",
    "novel-script": "pending",
    "novel-storyboard": "pending"
  }
}
```

`paths` 相对 `project.json` 所在目录解析，也可以写绝对路径。`skills` 状态由
`verify --write` 回写；`status` / `build` 只看文件存在性，不依赖记录状态做判断。

## 生产 DAG

```
小说原文
  ├── novel-characters → cast.json
  └── novel-outline    → outline.json
                            ├── novel-art     → art.json
                            └── novel-script  → script.json
                                                  └── novel-storyboard → storyboard.json
```

`build` 按此顺序找缺口：outline → characters → art → script → storyboard。

## 跨 skill 契约（verify 逐条检查）

### project 自身

| 规则 | 级别 |
| --- | --- |
| `projectId` / `title` 非空字符串 | 错误 |
| `episodes` / `episodeMinutes` 为正整数 | 错误 |
| `skills.*` 状态只能是 pending/passed/failed | 错误 |

### novel-outline ↔ project

| 规则 | 级别 |
| --- | --- |
| `outline.episodes.length` = `project.episodes`，ep 从 1 连续编号 | 错误 |
| `outline.params.minutesPerEpisode` = `project.episodeMinutes` | 警告 |
| `characters[].id` / `name` 全局唯一 | 错误 |
| 每集 `sceneIds` ⊆ `scenes[].id`，`characterIds` ⊆ `characters[].id` | 错误 |

### novel-characters ↔ outline

| 规则 | 级别 |
| --- | --- |
| `cast.characters` 非空、名字唯一 | 错误 |
| 大纲角色在 cast 里找不到（按名字/别名） | 警告——可能是功能角色没入选前 N 位 |

### novel-art ↔ outline

| 规则 | 级别 |
| --- | --- |
| `scenes[].id` / `props[].id` 全局唯一、scenes 非空 | 错误 |
| 美术场景不在大纲里 | 警告——变体场景可接受 |
| 大纲主场景没进美术 | 警告 |
| 道具 `relatedScenes` 引用不存在的场景 | 警告 |

### novel-script ↔ project / outline / art

| 规则 | 级别 |
| --- | --- |
| `episodes.length` = `project.episodes` | 错误 |
| `targetSeconds` = `episodeMinutes` × 60 | 错误 |
| 场次 `sceneId` ∈ art.scenes 且 ∈ outline.scenes | 错误 |
| 非空 `lighting` ∈ 该场景美术登记的光照状态 | 错误 |
| 场次没写 `lighting` 但美术有可用状态 | **警告**——各层校验器都放行，这里抓出来 |
| 场次角色 ∈ outline.characters | 错误 |
| 场次道具 ∈ art.props | 错误 |

### novel-storyboard ↔ script / art / cast

| 规则 | 级别 |
| --- | --- |
| `episodes.length` = `project.episodes`，每集有镜头 | 错误 |
| `shotId` 全局唯一 | 错误 |
| 镜头 `sceneId` ∈ 剧本同集场次 | 错误 |
| 镜头 `lighting` ∈ 该场景美术登记状态；与剧本该场不一致 | 错误 / 警告 |
| 镜头角色 ⊆ 剧本该场角色；映射到大纲名字后在 cast 里缺失 | 错误 / 警告 |
| 镜头道具 ∈ art.props；剧本该场没登记 | 错误 / 警告 |
| 单集镜头总时长超出剧本目标 ±15% | 警告 |
| 角色参考图是 `【角色图:…】` 占位符 | 警告（按角色聚合） |

## 边界

- `verify` 只查**跨层引用**；每份 JSON 的内部质量门（引文逐字、时长预算、钩子悬念等）
  由各 skill 自己的 validate 负责——这里不重复造轮子
- 缺失的文件报**警告**不报错误：项目做到一半是常态，`build` 负责告诉你下一步
- 契约规则随上游 schema 演进；改任何 skill 的 schema 后，先跑本 skill 的 selftest，
  再跑 novel-project 的 selftest，两边都过才算兼容
