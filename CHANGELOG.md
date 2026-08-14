# Changelog

## novel-storyboard — 2026-08-14x：对齐上游数据模型 + 结构化 HTML 报告

本地 `novel-storyboard` 此前偏离上游，用了 `episodes[].shots[]` 扁平镜数组 → 12 列大表
（3.8MB、布局差），上游实为 `episodes[].segments[]→cuts[]` 段卡 + 节奏带模型（≤15s=一次
生成调用）。本次整体对齐回上游：

- **脚本整体替换**：`novel-storyboard.mjs` 用上游 `segments[]→cuts[]` 模型重写，校验门按
  上游口径（节拍覆盖、段≤15s、台词秒数、frame 英文+Cinematic 风格短语、禁角色中文名、h3Prompt
  含 `[Shot N]`+`<d>[中文]台词</d>` 逐字匹配）
- **补齐 references**：新增 `frame.md` / `h3-prompt.md` / `storyboard-pass.md`，`schema.md`
  换上游版；新增 `assets/report.webp` 报告样例图
- **加回 `--per-ep`**：本地独有增强，复用 `renderHtml` 整页产物按 `<section class="ep">`
  切片输出 `E{ep}.html` + `index.html`，无逻辑分叉
- **selftest 对齐上游**：165 项全绿，全仓库 check 通过

## novel-art — 2026-08-14h：photorealistic 预设自测同步 + 防御门

上游同步（14g）带来的第三档画风 `photorealistic` 代码和文档都已就位，但 selftest 没跟上
（断言还停在 `realistic,ghibli` 两档），导致 `check.mjs --run` 挂 novel-art。修复：

- 校验新增防御门：`photorealistic` 预设的负向提示词也不许禁 `photorealistic`
  （写实预设禁写实自相矛盾），与 `realistic` 同规则
- selftest 同步：三档期望值 + photorealistic 不自禁/自带禁人断言 + 击穿用例；131 → **134 项**
- README 风格门描述同步

验证：novel-art 134 项全绿，全仓库 check.mjs --run 通过。

## 仓库 — 2026-08-14g：上游同步（eternityspring 新功能并入，本地成果不回退)

用户要求把上游 `eternityspring/shuohao-skills` 的更新同步进来。经核对，上游相对本地主要是回退
（`novel-project` 编排层引用、`photorealistic` 预设、`portrait` 单视角参考图等被删），唯一真正的
新增功能在 `novel-script`：

- **`hookBeat` + 第 10 道门 `hook-open`**：钩子具象须在全集前 3 拍（`hookWindow=3`）内兑现，报告标红高亮
- **台词本对接 TTS 音色**：CLI 新增 `--cast cast.json`，按角色名匹配 `voice.prompt` 带"音色提示词"按钮

按"只取上游新功能、保留本地全部成果"的策略并入：`novel-project` 编排层 / 5 层 HTML 固化 /
`photorealistic` / `portrait` 等所有本地增强原样保留。样例补 `hookBeat:[1,1]`，自测 125→129，
novel-project 29 项全绿。已提交 push（commit `c194c30`，16 files +1425/-311）。

## 仓库 — 2026-08-14f：批量功能变更复查

工作区新到一批跨 skill 功能变更，回溯核对后确认功能全部成立，并修掉文档与实现的脱节：

- **功能确认**：novel-script 新增第 10 道门 `hook-open`（hookBeat 前 3 拍兑现，自测 125→129）；
  台词本带音色提示词按钮（`render --cast`）；storyboard 报告统一亮色国风 + 新增
  `references/report-style.md` 定版；`render --per-ep` 按集出报告 + index 导航；
  novel-project 新增 `reports` 登记与 `verify` 的 HTML 报告交付检查（P0-4）
- **文档修复**：storyboard SKILL.md / novel-project schema.md 的"暗色主题"改"亮色国风"
  （与代码和 report-style.md 一致）；novel-script 中英 README 与仓库 README 的门数/自测数
  从 9/125 更新到 10/129（质量门表补 hook-open 行）；project-layout.md 的 tools/ 标注
  "规划中"（build-panel.mjs / backfill-cast.mjs 尚不存在）
- **清理**：误入工作区的 `ChatGPT的分析.md` 移到 /tmp（可恢复）
- **验证**：全仓库 check.mjs --run 全绿，历史残留复检 0 处

## novel-storyboard — Visual Director 层 + Prompt Finalization（2026-08-14e，Iteration 5）

ChatGPT 第四次 / DeepSeek 复查把仓库定位收敛为 Prompt Pipeline，指出"分镜工程 > Prompt 导演"。按裁剪范围落地（守红线：零依赖、确定性、不新建架构）：

- **`shot.direction` 视觉导演块**：seed 用确定性逻辑填骨架（framing←shotType、cameraAngle 默认 eye-level、lens 特写 85mm/其他 35mm、subjectPriority←角色顺序、visualFocus←动作主语、emotion/pose/colorMood←词表）；`foreground/midground/background` 可空待精修
- **`composePrompt` 注入导演句**：direction 存在时追加构图/镜头/焦点/情绪/色调句（从"拼接器"升级为"导演"）；无 direction 时行为不变（向后兼容）
- **export FINAL / meta**：`first-frame.txt` 加 `FINAL FIRST FRAME PROMPT` 标签；新增 `meta.txt`（景别/建议时长/视频模式/参考图/导演概要）；复制即用更明确
- 自测 42 → **48**；全仓库 check 绿；lint 0

## 文档清理 + 定位校准（2026-08-14d，ChatGPT 第四次分析）

ChatGPT 第四次把仓库定位收敛为 **Prompt Pipeline**（非生产 OS）。本轮修掉其点名的历史信息残留类 P0 文档 bug，并校准定位措辞，未动代码逻辑（守红线）：

- **安装地址修复**：`README.md` / `README.en.md` 的 clone 地址从旧仓库 `eternityspring/shuohao-skills.git` 改为 `Aibrother258/shuhao-skills-2`
- **CI / Node 描述修复**：主 README 原写"没配 CI / 只在 Node 24 验过"，改为如实描述 `.github/workflows/ci.yml`（Node 18/20/22 矩阵）+ 本地 `check.mjs --run`
- **skill README 一致性**：`novel-characters/outline/art/script` 中英 README 的"Node 24 没验过"统一改为"已在 Node 18/20/22（CI 矩阵）验证"
- **模型二次润色降级**：`novel-storyboard/SKILL.md` 把"模型逐镜精修"从正常必经流程改为"autofill 产出即最终可复制提示词，微调可选而非必需"，与零模型依赖红线对齐

## novel-storyboard — Prompt Pipeline 最后一公里（2026-08-14c）

把"结构化 JSON"补成"你直接能复制去生的 Prompt 文件"，对齐最新 ChatGPT/DeepSeek 收敛后的定位（**Shuohao AI Drama Prompt Pipeline**，不是生产 OS）：

- **`export` 命令**：把 storyboard 内嵌的可复制提示词平铺成 `prompts/` 目录——`characters/`（形象+Identity Lock+Wardrobe）、`scenes/`（空景+各光照）、`props/`（白底无手+状态）、`shots/<id>/{first-frame,negative,h3,refs}.txt`。工作流变成"打开→复制→ComfyUI/H3 生成"
- **复杂度评分**：seed 时确定性打 `complexity{score,level,recommendSplit,splitClauses,warnings}`。`recommendSplit` 与拆镜器共用一把尺子——仅「动作镜 + ≥2 个句号/分号分句」置 `true`，保证"推荐可拆"必然"拆得动"；逗号串连续动作不计入可拆分句，由 `warnings` 提示人工处理
- **`split` 拆镜子命令**：把 `recommendSplit=true` 的动作镜按**句号分句**拆成子镜、时长按比例分配；严守契约——子镜沿用原 `sourceBeat`（G1 覆盖门仍过）、shotId 加 `a/b/c` 后缀（G2 正则放宽）、子镜时长下限保护（避免 G4 越界）
- **Wardrobe Bible + Identity Lock**：`cast.json` 加 `wardrobe[{id,prompt}]` 与 `identityAnchors[]`；首帧提示词自动展开 `wearing <prompt>` 并注入不可变特征（防跨镜脸崩）；continuity 的 `wardrobe` 与 wardrobe 表共用同一份 ID
- **按景别推荐参考图**：`cast.image` 支持可选 `halfBody/fullBody/side`，`composeRefImages` 按 shotType 推荐（特写→portrait／中景→halfBody／全景→fullBody），缺失自动降级 `portrait→sheet→占位符`
- 自测 19 → **41**（复查修复 3 个真 bug：h3.txt 丢 I2VA 首帧引用句 / split 真实数据空转 / sheet 文本当路径；+ 2 个次要：cast 字段补齐 / soundscape 去中文；+ 复测残留：`recommendSplit` 与 `split` 口径对齐，逗号串改 warnings 提示）；全仓库 check.mjs 全绿；lint 0
- 红线守住：零依赖、确定性、不新建 manifest/schemas、skill 自包含。明确不做三层 Compiler 架构 / 强制每角色 4 张图 / 中央 schemas 目录

## novel-project — 复查修复（2026-08-14b 补）

对 2026-08-14b 的 P0 迭代做代码级复查，修掉四个真 bug（自测 21 → 29 项，全仓库 819 项）：

- **portrait 样例脏数据**：`渡口-cast.json` 里三个角色的参考图文件名被写错
  （陆行远→林晚、老周→顾沉舟、胡二爷→苏曼），已改回；并在 novel-characters
  的 Step 8 / sheet.md 补上 portrait 出图流程——之前字段只有消费端（storyboard
  引用）没有生产端（没有一步告诉 agent 怎么生成这张干净单视角图）
- **参考图文件存在性检查是死代码**：`checkContinuity` 读 `project.paths['novel-characters']`
  （键名实际是 `cast`），base 永远为 null，检查从不执行。已改用 `paths.cast` +
  project.json 所在目录，路径解析规则明确（相对项目根），并补击穿测试
- **失效传播空转**：`verify --write` 和 `build` 之前都不写 `versions`，hash 比对永远不触发；
  且检测方向反了（"本文件变了"而非"上游变了"）。现在 `--write`/`build` 记录
  各层 hash + **上游 hash** + 生成 skill 版本；只有上游输入变了才报"产物可能过期"，
  过期的层保留旧记录直到真正重新生成（防止 --write 吞掉警告）
- **连续性检查假警报 + 空转**：光照比较不区分场景/集边界（每次换场都误报）、
  道具状态读错字段（`states[0].name`，实际是 `.state`，永远为空）。已改为
  同集比服装、同场同集比道具与光照；道具状态字段修正；`continuity` 全是 seed
  骨架时明确提醒"检查未生效"，不再假装在查

另修：`check.mjs` 用 `import.meta.dirname`（Node 18 不支持）导致 CI 必挂，已换
`fileURLToPath`；skill 版本不再硬编码（novel-characters 之前被写成 1.0.0，实际
1.7.0），改为运行时读各 SKILL.md frontmatter；README.en 同步。

## novel-project — 生产闭环升级（P0，2026-08-14b）

从「内容 DAG 总控」迈向「生产 DAG 总控」。零 API key、零 npm 依赖、核心逻辑确定性的红线不变。
本轮回应在 ChatGPT / DeepSeek 对上一版（1912d28）的架构建议，收敛为四件纯确定性工作：

- **P0-1 资产引用修正**：`cast.json` 的 `image` 新增 `portrait` 字段（干净单视角参考图，专供生成参考），
  与 `sheet` 合成设定板分离；`novel-storyboard` 的 `refImagePaths` 优先取 `portrait`，缺失时退化为
  `【角色图:名】` 占位；`novel-project verify` 核查真实路径文件是否存在（缺图则告警，不再静默占位）
- **P0-2 幂等 + 失效传播**：`project.json` 新增 `versions`（各层产物文件 sha256 + 生成 skill 版本）与
  `production`（每镜最小阶段状态机 `storyboard/firstFrame/video/tts`）；`verify` 比对产物 hash 与
  记录值，变更则报"过期"；`status` 打印生产进度条 + 阻塞列表。不新建 manifest.json（并入 project.json）
- **P0-3 连续性状态机**：分镜每镜新增 `continuity` 块（角色 wardrobe/emotion/state/position、道具 state、
  场景 lighting/weather/time）；`novel-project verify` 把全部镜头拍平按序比对相邻镜，服装跳变 / 道具状态
  突变（缺承接节拍）/ 光照突变均告警。旧分镜无 `continuity` 块自动跳过，向后兼容
- **P0-4 CI + 黄金回归**：新增 `.github/workflows/ci.yml`（node 18/20/22 矩阵），跑 `scripts/check.mjs --run`
  聚合自测 + 渡口示例 `verify`/`status` 冒烟。保持零依赖，LLM-judge 类 rubric eval 留待 P2

novel-project 自测 15 → 21 项（新增失效传播、生产状态初始化、连续性跳变/突变/向后兼容用例）。
全仓库自测总数由 805 增至 811，全部绿色。


## novel-project 1.0.0 — 2026-08-14

**项目总控：五层产物串成一条可追踪的产线**

六个 skill 各产一份 JSON、各有质量门，但单层的 validate 只保证"自己那份合法"——
没人回答"我现在在做哪部剧、做到哪一步、各层对得上吗"。新增的总控层补的就是这个：

- `project.json`：项目 id / 剧名 / 集数 / 单集分钟 / 五份产物的路径 / 每层状态
- `status`：五层文件就位情况 + 记录状态，`--verify` 连契约一起看
- `build`：按 DAG（大纲 → 角色 → 美术 → 剧本 → 分镜）找缺口，打印下一步该跑哪个 skill
- `verify`：**跨层契约校验**，只查跨层引用、不重复各层自己的质量门

跨层契约抓到的最有价值的三类问题（单层校验器都漏）：

- 剧本某场没写光照、美术里有可用状态——script 的 validate 把空光照当"没提供"跳过
- 分镜光照与剧本该场不一致——storyboard 只查美术登记，不回头对剧本
- 集数 / 时长在层与层之间漂移、角色/场景/道具 id 引用悬空

自测 15 项，每道契约都有击穿用例。自带样例 `examples/渡口-project.json` 把仓库里
五份《渡口》产物串成一个项目，跑 `build` 能看到它怎么推你走下一步。

## novel-storyboard 1.0.0 — 2026-08-14

**规范化收尾 + 光照继承修复**

- frontmatter 补全 version / allowed-tools / triggers / metadata，与仓库其他 skill 对齐
- 新增 README.en.md
- **修复 seed 光照 bug**：之前固定取美术场景的第一个光照状态，导致剧本第 6 集
  S01 写的是「雾散近岸」、分镜却用了「晨雾」。现在光照优先级改为
  **剧本该场指定（且美术已登记）> 美术第一个状态 > 默认**——剧本改光照，分镜跟着走

## h3-prompt-writing 1.0.0 — 2026-08-14

**补齐仓库硬要求**

- 新增 `scripts/selftest.mjs`（8 项断言）：核心字段顺序、I2VA 引用句式、时间戳、
  `<d>` 台词封装、Ref2VA 六 section 顺序、保留分析判定词——防止规范文档被改散
- frontmatter 补 version；新增 README.md / README.en.md

## 仓库 — 2026-08-14

**结构检查脚本 + 文档更新**

- 新增 `scripts/check.mjs`：校验每个 skill 的结构硬要求（SKILL.md / selftest /
  双语 README / frontmatter 五要素），`--run` 连全部自测一起跑——h3 那种
  "装上去但没自测"的漏网之鱼以后进不了仓库
- README 中英文补全 novel-storyboard / novel-project / h3-prompt-writing 三个条目，
  硬要求从两条扩到三条

## novel-characters 1.7.0 — 2026-08-13

**归并复核、cast.json 机器合成、更大的块**

跨块身份消解是全管线语义最难的一步，这版把校验预算往它身上挪：

- `merge` 输出改为 `{characters, mergeCandidates}`：精确匹配收敛不了的疑似同人
  （「陆」⊂「陆行远」这类名字包含关系）列成候选，模型复核后写 merges.json，
  用 `merge <workdir> --apply merges.json` 确定性落地。判断留给模型，
  落地回到脚本——谁擅长什么谁干什么
- 新增 `assemble` 命令：把 card-*.json + summary.txt（+ ui.json）合成 cast.json。
  这是纯机械活，之前留给模型手拼，手拼会丢字段、写错顶层键。
  坏卡逐个点名，只重跑坏的那个角色；同档角色按 merge 输出的
  戏份顺序排（`<workdir>/merged.json` 自动读，`--order` 可覆盖）
- 分块从 14k 字符提到 **4 万字符**：现在的模型读 4 万字符毫无压力，
  块数少三倍，跨块归并的接缝（也就是漏归并的机会）少三倍；
  单次上限从约 33 万字符提到约 93 万字符（净覆盖，已扣块间重叠）
- 断点续跑写进流程：`card-<slug>.json` 和 `images/<slug>-sheet.png`
  已存在就跳过，失败重来只补缺的

自测 274 → 307 项。

## novel-script 1.0.0 — 2026-08-12

首个版本。给 AI 短剧写**剧本**——前提刻在骨子里：**剧本管戏，分镜管拍**。
「爽不爽」和「怎么拍」是两种迭代节奏，台词要反复推翻重写，绑上镜头
分解每改一句都得重排镜头。所以这层只有集、场次、节拍流，没有镜号；
镜头、首帧提示词、生成批次都留给下一层分镜 skill。

守住的底线：**台词是结构化数据，不是散文**——每句台词独立条目
（说话人 + 台词 + 语气），动作一拍一件事。这是全部确定性检查的地基：

- **逐集时长预算**：台词按语速折算（默认 4.5 字/秒）、动作按节拍估时
  （默认 2.5 秒/拍），每集必须落在目标 ±15% 内。一集三分钟就是三分钟，
  写超写欠当场拦下，不流到生成环节才发现
- **台词本**：按角色聚合全部台词，整组复制——TTS 是按角色批量跑的，
  这页就是工作清单；`VO` 画外音单独成组
- **时长仪表**：每集一行条形图打在目标区间绿带上，超欠红字点名差几秒

**9 道质量门全是代码**：每集时长 ±15%、单句 ≤35 字、说话人在本场或标
VO、钩子悬念落纸、每场至少一个动作节拍（纯对白的场是广播剧）、动作
叙述体不混引号台词、爽点认领（大纲说这集有的爆点必须有戏扛）、角色
对账大纲、场景/光照/道具对账美术设定——剧本写了美术没登记的光照状态
当场报。对账门缺上游时明说跳过，不静默。

`seed` 吃 outline.json 确定性预填每集骨架（目标秒数、钩子、悬念、爽点
认领）。四个 skill 接力打通：characters（谁）→ outline（什么）→
art（哪里）→ script（戏）。

自带样例是《渡口》**全 6 集完整剧本**：9 场 123 句台词，每集都落在
120 秒 ±15% 内，对着大纲与美术设定样例全部质量门通过。

自测 122 项。

## novel-art 1.0.0 — 2026-08-11

首个版本。给 AI 短剧出**美术设定集（场景 + 叙事道具）**——前提刻在
骨子里：**环境和道具都是生成资产，不是实拍**。没有堪景搭景置景采买，
交付的是让同一个环境、同一件道具被生成几十次还长一样的一致性方案。

**每个场景的交付**

- 设计意图（这个空间为哪场戏存在）
- 一致性锚点 3–5 个：每次生成必现的可辨识特征，观众靠它认场景，
  QC 靠它核对生成镜头有没有漂
- 光照时段变体：换时段 = 重新生成不是重新打灯，每个状态落成英文提示词
- 空景出图提示词：环境和角色是两层资产，参考图混进人一致性全毁
- 变体机制：`variantOf` + `changes` 把衍生场景挂在母场景上，出图拿
  母场景成图当参考

**叙事道具层**（只收有特写、跨集、承载剧情的，3–8 件为宜）

- 戏剧功能优先：皮箱是全剧悬念、旧砚是爆点实体
- 状态变体：合上/打开是两张参考图——道具有状态弧，场景没有
- 尺度参照写死进提示词（手持级/桌面级/家具级）——AI 把手持道具
  画成家具尺寸是高频事故
- 白底无手：道具图要被贴进镜头，必须可抠；拿着道具的手是最常见污染
- 场景陈设归场景锚点、一次性手部道具镜头级解决，都不单独建资产

**11 道质量门全是代码**：锚点 3–5、光照 ≥1、无人（场景道具都查）、
提示词全英文、不含角色名（`--cast` 才查，不给就明说跳过）、变体引用
完整、风格与反向词匹配，道具另有状态 ≥1、尺度短语、禁手、纯白背景
四道。自测每道门都有击穿用例。

**三个 skill 接力**：`seed` 吃 novel-outline 的 outline.json 确定性
预填场景清单/出现集/承载爽点；`validate --cast` 吃 novel-characters
的 cast.json 查角色名；画风预设与角色 skill 同名对齐（realistic /
ghibli）但内容是环境版——真实感来自用旧的材质，不是皮肤毛孔。

**报告**：与另外两份同一套视觉语言。KPI 带、场景清单、场景设定卡、
道具清单、道具设定卡（一排两卡方便截图，图可点弹层放大）、质量门
面板、导出 JSON（下载的就是 art.json 原样）。

**自带样例**：《渡口》三场景（两主一变体）+ 两件道具（旧皮箱、
县衙旧砚），全部质量门通过，五张设定图已用 codex $imagegen 实际
生成验证（含变体拿母场景当参考图）。

自测 131 项。

## novel-outline 1.0.0 — 2026-08-10

首个版本。把一本小说改编成短剧大纲五件套：改编说明 / 人物表 / 爽点表 /
分集梗概 / 资产清单。

**核心主张：checklist 交给模型自觉是靠不住的**

- 模型只填 outline.json，Markdown 和 report.html 由 `render` 渲染，
  资产清单由脚本从分集数据自动汇总——**四件模型写、一件算出来**
- 13 道质量门全部是 `validate` 里的确定性代码：角色分档上限、主场景上限
  **随集数动态**（4 + ⌈集数/10⌉ 夹在 5–15，60 集 → 10，显式给了就用给的。
  按 AI 短剧定的数——场景是生成的没有搭景钱，放宽换观赏性，上限守的是
  跨集一致性资产和空间认知）、
  一次性场景有规避方案、爽点间隔 ≤ 3 集无真空、第 1 集有钩子、大爆点
  不压最后一集、每集三栏齐全、三人同框有拆解、生成难点进预警、
  引用完整（无失业角色/空转场景/悬空 ID）、叙述体无对白
- **角色按资产量分档**，不做一刀切上限：主角组 1–5（全套设定图 + 逐镜
  一致性核对）、重要配角 ≤ 10（半身参考图）、功能性角色 ≤ 10（占脸不占名，
  提示词直出），无名背景人不进表不限量。资产清单按档自动折算工作量
- 阈值参数化（`params.thresholds`）——爽点间隔在不同平台不是一个数
- 自测里 13 道门**每一道都有击穿用例**，证明它真的会拦

**流程门**

- 三档 stage：skeleton（骨架拍板前）→ beats（**写分集之前必须过**）→ full。
  「快版拍板再细化」靠 stage 变成可执行的，不是口头约定
- 分集每批 ≤ 10 集，60 集一口气写后半段必崩
- 长文本按章节分卷（每卷 15 章，上限 60 卷），超限明确报 `truncated`
- 关键取舍必须附原文逐字 evidence——禁止凭书名脑补

**报告：业内评审用的单页文档（1600 宽，全部平铺可 Cmd+F）**

- KPI 带六张统计卡开门见山；**关键决策**区块把拍板三件事落进纸面：
  砍了哪条线（带 cutNote 结论句）、合了哪些人（角色位统计与主角组名单
  算出来）、大爆点落在第几集（从爽点表自动列，首末带标记）
- 爽点节奏是**剧情时间轴**：大爆点实心、常规浅色、标签上下交替防撞，
  **空档直接标在轴上**、超阈值变铁锈红；超过 20 集自动折行。
  配色跑过 dataviz 验证器（#8a3324 / #c56a4e 六项全过）
- **每集调度矩阵**：角色 + 场景同一张网格，一列竖着读就是那一集的
  需求单；**场景概览**每景一卡——右上浅灰剧集编号（连续合写 1–6）、
  出现集微条、承载爽点、出场角色或复用方案
- 质量门：页眉徽章 + 未过时的病灶横幅 + 文末完整清单，✓/✗ 由脚本
  算好烘进页面；体检模式 = 贴现成大纲只跑诊断
- 导出 JSON 下载的就是 outline.json 原样，改完直接喂回 render/validate
- 全部图形内联 SVG/CSS，不引任何库，离线双击能开

**自带样例**：《渡口》6 集微型大纲，全部质量门通过，兼自测夹具。

自测 200 项。

## novel-characters 1.6.0 — 2026-08-09

**报告可以导出 JSON**

- 顶栏新增「导出 JSON」，下载的**就是 `cast.json` 本身的形状**
  （`source` / `lang` / `style` / `summary` / `ui` / `characters`），
  不另立一套导出格式
- 所以外部工具改完可以**直接喂回 `render` 重新出报告**，也能过 `validate`。
  自测里有一条断言就是拿导出的数据跑 `validateCast`，必须通过
- 角色卡里的 `sheetImage` 一并带出，外部工具知道哪张图对应哪个人
- 数据以 `<script type="application/json">` 内嵌，点导出只是把它包成 Blob 下载，
  **不发任何网络请求**，报告仍然是离线单文件
- `renderHtml()` 补上第 6 个参数 `style`——之前顶层的画风没传进渲染层，
  导出时会漏掉这个字段

**两个坑**

- 正文里出现 `</script` 会把内嵌数据块提前截断。JSON 里 `<` 只可能在字符串值里，
  整体转成 `<` 就安全了，自测里拿 `</script><script>alert(1)</script>` 当夹具
- `URL.revokeObjectURL` **不能跟在 `a.click()` 后面立刻调用**——Safari 会抢在
  下载读完之前撤掉 blob，存出来是空文件

自测 259 → 274 项。

## novel-characters 1.5.0 — 2026-08-09

**默认拆 30 个角色，每个都出图**

- 选角默认从 10 位提到 **30 位**
- 出图**不再按 `importance` 筛**，选中的角色全都出。一个角色一次调用，
  30 个就是 30 次——这是整条管线最慢的一步，开始前要跟用户报张数
- 新增第 4 条硬规则：**族裔、年代、地域必须从原文推断，并明确写进
  `image.prompt` 和 `image.sheet`**。不写死的话图像模型默认画当代西方白人，
  民国的老船夫会出成穿工装的美国老头
- 这条**不跟报告语言走**——`lang` 管的是谁来读，不是故事发生在哪。
  报告出成日文，不该把民国船夫画成日本人

**关系图谱**

- 报告新增一个全景视图，左栏顶部进入，跟角色详情互斥
- 数据直接来自 `persona.relationships`，不用模型再跑一趟
- 按**名字 + 别名**建索引连边——老周的关系里写「老伯」也要连到同一个节点，
  只按 `name` 匹配会漏掉一半
- 同一对人的两条单向记述合并成一条边，两个方向的说法都留着
- 圆环布局 + 向心贝塞尔，位置在 Node 里算好写进内联 SVG。**不引任何库**，
  报告仍然是离线双击能开的单文件
- 弦上标关系文字：取较短的那种说法截到 6 字，全文进 `<title>`。
  边 ≤ 14 条默认标出来，再多默认收起，顶部有开关
- 悬停节点亮出他的全部关系、悬停关系表某行只亮那一条弦、点节点或点行
  跳到对应角色。节点带 74px 透明命中区——圆点本身才十来像素，压不准

**报告细节**

- 故事摘要默认三行 + 底部渐隐，点一下展开；本来就不到三行的不显示入口
- 主区右侧信息卡从 340px 加宽到 500px

**踩到的两个坑**（都写进注释了）

- 命中区圆和可见圆都用 `circle` 时，`.lead` 的填色会把命中区一起染成大红块。
  各给一个类才隔得开
- 正对面两个角色之间，弦的中点正好是圆心，标签会摞在一起。改成标签沿弦
  按序号错位，弦本身不动

自测 220 → 259 项。

## novel-characters 1.4.0 — 2026-08-08

**出图风格可选**

- 新增顶层 `style` 字段，默认 `realistic`（半写实厚涂），另有 `ghibli`
  （吉卜力式手绘赛璐璐）
- **换风格是整套换**：每个预设自带 render / surface / lighting / negative /
  tags 五块，整块取用不混搭。见 `references/style-presets.md`
- **两个预设的反向提示词几乎是相反的**：`realistic` 绝不能禁
  `photorealistic`，`ghibli` 必须禁。`validate` 会拦这个搞反
- 表面处理同理：写实要毛孔、皮下散射、根根碎发、布料织纹；吉卜力明确
  要无毛孔、成簇发丝、平涂无织纹
- 光照也不同：写实分区打光（左栏方向光、右侧平光），吉卜力全图平光——
  平光本来就是那个风格的一部分
- **版面规则不随风格变**：16:9 三区、比例协调、细节让位，两个风格都一样
- `novel-characters.mjs styles [id]` 打印预设完整内容

**报告交互**

- 点图弹层查看大图，点背景或 Esc 关闭
- 图片右下角一键**复制图片本身**到剪贴板（不是路径）；非 PNG 先过 canvas
  转码，因为 Safari 只认 `image/png`
- 左栏缩略图加圆角

已用《渡口》端到端验证：日文 + 吉卜力跑通（界面日文、引文保持中文原文、
出图确实是赛璐璐质感），再切回中文 + 默认风格。

自测 197 → 220 项。

## novel-characters 1.3.0 — 2026-08-08

**提示词转向半写实，人物更逼真**

- 反向提示词里**删掉 `photorealistic` / `3d render`**——一边要真实感一边
  禁真实感是自相矛盾的。改禁真正该禁的「假」：塑料蜡质皮肤、过度磨皮、
  无毛孔娃娃脸、完全对称的脸、没有高光的死眼、头盔状头发、无织纹布料
- 画风从「扁平矢量卡通」换成**半写实厚涂**。原来那句跟写实拧巴，实测
  同一批角色有的出成动画、有的出成写实，画风飘
- 真实感靠不完美而不是细节量：可见毛孔、肤色不匀、眼睛湿润高光与虹膜
  纤维、**眼睑眉毛左右不对称**、碎发破开轮廓；老年角色的皱纹**顺表情肌走**
- 布料写织纹、肘部袖口的磨损光泽、垂坠重量、褶皱自阴影
- **分区光照**：左栏半身像给柔和方向主光 + 环境遮蔽（要体积），右侧三视图
  和细节条保持平光正交（要抠图和量比例）。设定表和写实的矛盾在这里化解

**报告**

- 主区最大宽度 1500px
- 左栏缩略图改用精灵图切片：设定图固定 16:9、左栏约 34%，按 294% 放大
  左上对齐，裁出来正好是半身像，不用另存缩略图

自测 174 → 192 项。

## novel-characters 1.2.0 — 2026-08-08

**报告改成三栏工作台**

- 顶栏：书名 + 搜索框（按名字、别名、身份、特质找人）+ 元信息
- 左栏：故事摘要 + 角色列表，每条带缩略图、序号、重要度、性别年龄、
  一句话、特质标签；缩略图自动取设定图左半边，正好是半身像
- 主区：**一次只看一个角色**，左栏点谁显示谁。图 + 两栏文字 + 原文依据，
  右侧四张信息卡（基本信息 / 关系 / 声音 / 画风），底部两组可折叠提示词
- 打印时自动展开全部角色和全部提示词——屏幕上一次一个，纸上要完整
- 配色和双字域排版不变，换的是结构

**设定图改成 16:9 三区版面**

- 画布写死 **16:9**
- 左约 34% 半身像（面部基准）／右上全身三视图／**右下新增细节条**
  （4–5 个关键细节的小特写），三区之间细线分隔
- 细节放不下就沿右缘往下延伸，**但永远是细节让位，不是人物让位**
- 强调比例：三视等高、头身比一致、脚踩同一地平线，**禁止为了腾地方
  拉伸或压扁人物**——这是这个版面最容易崩的地方

自测 132 → 174 项。

## novel-characters 1.1.0 — 2026-08-08

**多语言**

- 调用时加 `--lang <code>` 指定报告语言，默认中文
- 内置 **中文 / English / 日本語** 三套界面文案
- **其他任何语言也支持**：skill 现场把界面文案翻译成目标语言，存进 `cast.json` 的 `ui` 字段，渲染时合并。用 `ui-template <lang>` 生成待翻译骨架
- 不给 `ui` 又用了内置表没有的语言，`validate` 会直接报错——避免「内容是法语、界面是英文」的半吊子报告
- 分工：人类可读字段跟随 `lang`；出图和 TTS 提示词**永远英文**，那些引擎吃英文最稳
- 校验的语言规则跟着 `lang` 走，能自动判别 zh / en / ja，其他语言不猜

**出图改成左右分栏的单张设定图**

- `image.face` + `image.turnaround` 合并为 **`image.sheet`**，一个角色一张图
- 一张横构图内部分两栏：**左栏约 38%** 是证件照式半身像（面部设计基准），
  **右栏约 62%** 是全身三视图（正/侧/背）
- 左栏尺寸大、五官画得细，可以直接拿去做表情设计；右栏管剪影、比例、服装，
  脸照左栏画
- 比例必须写死在提示词里，说反了整张图就废
- 最容易出的问题是**一张图里两个长相**，提示词里明确要求两边一致
- 左栏还要显式禁掉两个默认行为：**裁掉两侧肩膀**、**底边圆角渐隐**。
  不写就一定会出，看着很别扭

**破坏性变更**

- `image.promptZh` / `voice.promptZh` 更名为 `promptLocal`——多语言下 `Zh` 这个名字不成立
- `image.turnaround` 更名为 `image.sheet`，内容从「三视图」变成「半身像 + 三视图」
- `cast.json` 顶层新增必填 `lang`
- 出图落盘从 `<slug>-turnaround.png` 改为 `<slug>-sheet.png`
- `references/turnaround.md` 更名 `references/sheet.md`

自测 73 → 132 项。

## novel-characters 1.0.0 — 2026-08-06

首个版本。

**管线**

- 两趟：分块扫描角色 → 别名归并 → 逐角色出完整设定
- 输出人物画像、卡通形象提示词（中英）、音色提示词（中英）
- 三视图出图，走 codex 内置 `$imagegen`，零 API key；没有 codex 就跳过，其余照常
- 三视图一律**纯白背景**，方便抠图

**产出**

- `cast.json` + Markdown + 自包含 `report.html`
- report.html 的设计约定见 `references/report-style.md`：
  双字域排版（宋体＝原文 / 黑体＝分析 / 等宽＝提示词）、不藏内容可 Cmd+F、
  「（推断）」自动高亮、冷灰印张配铁锈红印记
- 每段提示词各自一个复制按钮，每个角色 8 个

**校验**

确定性检查，不靠模型自觉：逐字引文、出图提示词不含人名、字段语言分工、结构与枚举。

**自测**

62 项断言覆盖分块 / 归并 / 校验 / 渲染，不调模型、1 秒跑完。
