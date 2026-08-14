**中文** · [English](README.en.md)

> 👋 **找工作 / 合作** — 作者目前在空窗期，这个仓库就是业余的一点小探索。
> 有缘的朋友欢迎联系。**远程工作**之外，也接受**半合作**——每月几千块生活费 + 利润分成。如有必要，FED的话，也是可以考虑到场出差。希望在AI浪潮下，能找到同频朋友一起做点事情。
> 个人简历：**[resume.79px.com](https://resume.79px.com)**
> 
> 我建了一个 **AI 短剧交流群**（付费），聊 AI 短剧的工作流、工具和实操。
> 有兴趣的加我：**微信 `hao_dev`**，添加时**备注 `github`**。
>
> <img src="assets/wechat.png" alt="烁皓微信二维码" width="180">

# shuohao-skills-2

**AI 短剧制作的 skill 集合**：从一本小说到能开拍的制作素材——拆角色、排大纲、出场景与道具设定、写剧本、拆分镜，外加一个项目总控把五层串成一条可追踪的产线。给 AI 编码 agent 用，**Claude Code 和 codex 都能跑**。

| Skill | 做什么 |
| --- | --- |
| [**novel-characters**](skills/novel-characters) | 把一篇小说拆成角色设定集：人物画像、形象提示词、音色提示词、角色设定图。报告语言与出图风格可选 |
| [**novel-outline**](skills/novel-outline) | 把一本小说改编成短剧大纲五件套：改编说明、人物表、爽点表、分集梗概、资产清单。13 道质量门全部脚本检查，支持已有大纲的体检模式 |
| [**novel-art**](skills/novel-art) | 给 AI 短剧出美术设定集（场景 + 叙事道具）：一致性锚点、光照与状态变体、尺度参照、无人无手白底提示词。吃 outline.json 预填清单，11 道质量门全部脚本检查 |
| [**novel-script**](skills/novel-script) | 给 AI 短剧写剧本：场次 + 节拍流（动作与台词交替），逐集时长按语速确定性折算，台词本按角色聚合直接对接 TTS。9 道质量门全部脚本检查 |
| [**novel-storyboard**](skills/novel-storyboard) | 把剧本编译成镜头级生产单：镜号/景别/机位/时长/首帧提示词/H3 视频提示词/生成批次，`export` 还能平铺成 `prompts/` 目录让你打开即复制，`split` 把复杂动作镜自动拆成子镜（1 beat = 1+ shot）。可直接粘进 Krea2 + MiniMax H3 的 ComfyUI 工作流。17 道质量门全部脚本检查 |
| [**novel-project**](skills/novel-project) | 项目总控：一个 project.json 串起五份产物，`status` 看进度与生产状态（每镜 storyboard/首帧/视频/TTS 阶段机 + 失效传播进度条）、`build` 告诉你下一步、`verify` 做跨层契约校验 + 跨镜连续性状态机（服装/道具/光照跳变告警） |
| [**h3-prompt-writing**](skills/h3-prompt-writing) | MiniMax H3 提示词规范源：基础四模式 + Ref2VA 六段式重写，novel-storyboard 的 H3 提示词按它生成 |

丢一本小说进去，出这五套：

**novel-characters · 角色设定集**

![角色设定集报告](skills/novel-characters/assets/report.webp)

**novel-outline · 短剧改编大纲**

![短剧改编大纲报告](skills/novel-outline/assets/report.webp)

**novel-art · 美术设定集（场景 + 道具，设定图为 skill 实际生成）**

![美术设定集报告](skills/novel-art/assets/report.webp)

**novel-script · 剧本（时长仪表 + 分集剧本 + 台词本）**

![剧本报告](skills/novel-script/assets/report.webp)

**novel-storyboard · 分镜表（每镜带首帧提示词 + H3 视频提示词 + 生成批次）**

分镜表由脚本确定性生成，报告样例和端到端 ComfyUI 工作流见 [demo](skills/novel-storyboard/demo/README.md)。

## 安装

```bash
git clone https://github.com/Aibrother258/shuhao-skills-2.git
cd shuhao-skills-2
./scripts/install.sh
```

自动检测本机装了 Claude Code 还是 codex，把所有 skill **软链**过去——`git pull` 之后立刻生效，不用重装。

```bash
./scripts/install.sh novel-characters   # 只装某一个
./scripts/install.sh --codex            # 只装到 codex
./scripts/install.sh --uninstall        # 取消软链
```

不想用脚本就自己链：

```bash
ln -s "$PWD/skills/novel-characters" ~/.claude/skills/novel-characters
ln -s "$PWD/skills/novel-characters" ~/.codex/skills/novel-characters
```

## 前置条件

| | 必需？ | 说明 |
| --- | --- | --- |
| **Node** | 必需 | ≥ 18。skill 的脚本只用标准库，**没有 npm 依赖，不需要 install** |
| **模型额度** | 必需 | 用你当前会话的额度，**不需要任何 API key** |
| **codex CLI** | 可选 | 出图才用得上（走内置 `$imagegen`）。没有就跳过出图，其余产出照常 |

## 仓库约定

每个 skill 一个目录，**自包含、可以单独拷走**：

```
skills/<skill-name>/
├── SKILL.md          给 agent 读的工作流（必需）
├── README.md         给人读的说明
├── scripts/
│   ├── <name>.mjs    确定性工具，零依赖
│   └── selftest.mjs  自测，不调模型（必需）
├── references/       按需加载的详细指令
├── examples/         自带样例，同时当测试夹具
└── assets/           截图
```

三条硬要求：

- 每个 skill 必须有 `SKILL.md`
- 每个 skill 必须有 `scripts/selftest.mjs`，**不调用模型、不花额度**，覆盖全部确定性逻辑
- 每个 skill 必须有 `README.md` / `README.en.md`，frontmatter 带 `name` / `version` / `description` / `triggers`

加新 skill 之前，先跑仓库级检查 + 全部自测：

```bash
node scripts/check.mjs --run
```

`check.mjs` 校验每个 skill 的结构硬要求（SKILL.md / 自测 / 双语 README / frontmatter），
`--run` 再把全部自测跑一遍。想只跑自测也可以：

```bash
for f in skills/*/scripts/selftest.mjs; do node "$f"; done
```

已配 CI：`.github/workflows/ci.yml` 在 **Node 18 / 20 / 22** 上跑 `check.mjs --run` + novel-project 校验，每次 push 自动执行。自测也足够快，本地跑同样方便：

```bash
node scripts/check.mjs --run        # 结构校验 + 全 skill 自测
```

代码没有平台相关调用，macOS / Linux 均可；已在 Node 18/20/22 上验证。


## License

[Apache 2.0](LICENSE)
