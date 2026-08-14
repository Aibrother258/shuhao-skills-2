**中文** · [English](README.en.md)

# novel-project

AI 短剧**项目总控**：用一个 `project.json` 把角色 / 大纲 / 美术 / 剧本 / 分镜五份产物串成一条可追踪的产线。

六个 skill 各产一份 JSON、各有质量门，但单层的 validate 只保证"自己那份合法"——没人回答
**"我现在在做哪部剧、做到哪一步、各层对得上吗"**。本 skill 补的就是这一层：

```bash
node scripts/novel-project.mjs init <目录> --title 渡口 --episodes 6   # 建项目骨架
node scripts/novel-project.mjs status <project.json>                    # 看进度
node scripts/novel-project.mjs build <project.json>                     # 下一步该跑哪个 skill
node scripts/novel-project.mjs verify <project.json>                    # 跨层契约校验（出片前必跑）
```

## 它到底查什么

只查**跨层引用**，不重复各层自己的质量门。最常抓到单层校验器漏掉的问题：

| 问题 | 为什么单层抓不到 |
| --- | --- |
| 剧本某场没写光照，美术里有可用状态 | script 的 validate 把空光照当"没提供"跳过 |
| 分镜光照与剧本该场不一致 | storyboard 只查美术登记，不回头对剧本 |
| 集数 / 时长在层与层之间漂移 | 每层只跟自己比 |
| 角色 / 场景 / 道具 id 引用悬空 | 各层 validate 只查自己那份 JSON |

规则全文见 `references/schema.md`。缺失的文件报**警告**不报错误——项目做到一半是常态，
`build` 负责告诉你下一步。

## 内置命令

| 命令 | 作用 |
| --- | --- |
| `init` | 生成 `project.json` 骨架（集数、单集分钟、路径、状态） |
| `status` | 五层文件就位情况 + 记录状态，`--verify` 连契约一起看 |
| `verify` | 跨层契约校验；`--write` 把每层 verdict 回写进 project.json |
| `build` | 按 DAG（大纲 → 角色 → 美术 → 剧本 → 分镜）找缺口，打印下一步；全齐后跑 verify |

## 跟五个 skill 的关系

```
小说原文
  ├── novel-characters → cast.json
  └── novel-outline    → outline.json
                            ├── novel-art     → art.json
                            └── novel-script  → script.json
                                                  └── novel-storyboard → storyboard.json
                                                            ↓
                                                  novel-project（总账 + 契约）
```

本 skill 不生产内容，只让"缺哪层、哪层坏了"变成机器可判断的事实。

## 文件

```
SKILL.md                 给 agent 读的工作流
scripts/
  novel-project.mjs      init / status / verify / build
  selftest.mjs           15 项断言，不调模型
references/
  schema.md              project.json 结构 + 全部跨层契约规则
examples/
  渡口-project.json      《渡口》五份产物串成一个项目，跑 build 看它怎么推你走下一步
```

## 自测

```bash
node scripts/selftest.mjs
```

15 项断言，覆盖模板 / 集数对齐 / id 引用 / 光照登记 / 时长目标 / 占位符聚合 / build 计划。
不调模型、不花额度、1 秒跑完。每道契约都有击穿用例——证明它真的会拦。
