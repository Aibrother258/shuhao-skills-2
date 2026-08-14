# 迭代记录 2026-08-14b — 生产闭环 P0（从内容 DAG → 生产 DAG 的脚手架）

## 背景：两份外部分析 + 上次 8-14 遗留

上次 `ITERATION-2026-08-14.md` 落地了 novel-project 总控 + 跨层契约 + 光照继承修复，并在
"遗留与下一步"里写了四条待办（A 角色参考图补干净图 / B storyboard 截图 / C 生产层适配器可选化 /
D continuity 先扩字段再写检查）。

本轮把 ChatGPT 与 DeepSeek 对当前 `main`（1912d28）的分析做了交叉核对，收敛出 P0 四项——全部
**纯确定性、零 API key、零 npm 依赖**，不破仓库红线。DeepSeek 的修正（不新建 manifest、不新建
asset-manager、production 先最小三阶段、build 的 Execute 归 SKILL.md、Eval 先降级为黄金回归）
被采纳；ChatGPT 的"全标 P0"被裁剪。

## 做了什么

### P0-1 资产引用修正
- `cast.json` 的 `image` 新增 `portrait` 字段（干净单视角参考图路径，如 `assets/cast/沈知微-portrait.png`），
  与 `sheet` 合成设定板分离——直接拿 sheet 当生成参考图会污染角色一致性（8-14 已发现）。
- `novel-storyboard/scripts/novel-storyboard.mjs` 的 `composeRefImages`：优先取 `cast.image.portrait`，
  其次 `image.path`，两者皆缺退化为 `【角色图:名】` 占位。
- 新增 `composeContinuity()`：seed 时给每镜注入 `continuity` 骨架（角色 wardrobe/emotion/state/position、
  道具 state、场景 lighting/weather/time）。
- `novel-project verify` 里 `checkContinuity` 对真实路径（非占位符）做文件存在性核查，缺图告警。

### P0-2 幂等 + 失效传播
- `project.json` 新增 `versions`（各层产物文件 sha256 + 生成 skill 版本）与 `production`（每镜最小阶段
  状态机 `storyboard/firstFrame/video/tts`）。不新建 manifest.json——并入 project.json，避免双账本漂移。
- `novel-project.mjs` 新增 `fileHash()`；`verify` 比对产物 hash 与 `versions[id].hash`，变更报"过期"。
- `status` 打印生产进度条（每阶段完成度）+ 阻塞列表（failed/blocked）。
- `build` 仍是 Plan 层（脚本不调外部工具，Execute 归 SKILL.md，符合红线）。

### P0-3 连续性状态机
- `novel-storyboard` 每镜 `continuity` 块（schema.md 同步）。
- `novel-project checkContinuity`：全部镜头拍平按序比对相邻镜——角色服装跳变 / 道具状态突变（缺承接
  节拍）/ 场景光照突变均告警。旧分镜无 `continuity` 块自动跳过，向后兼容。
- DeepSeek 关键修正落地：道具状态按"状态机"而非静态存在，跳变需承接节拍。

### P0-4 CI + 黄金回归
- 新增 `.github/workflows/ci.yml`：node 18/20/22 矩阵，跑 `scripts/check.mjs --run` 聚合自测 +
  渡口示例 `verify`/`status` 冒烟。保持零依赖；LLM-judge rubric eval 留 P2。

## 测试结果
- novel-project 自测 15 → **21 项**（新增：失效传播、生产状态初始化、连续性跳变/突变/向后兼容）。
- 全仓库自测 805 → **811**，全部绿色（`node scripts/check.mjs --run`）。
- 0 lint 错误。

## 未做（明确的红线/后移）
- 生产层适配器（comfyui/h3/indextts/ffmpeg worker）：保持可选、缺工具退化为任务单，不进核心（C）。
- 独立审查层（novel-review）：采纳 DeepSeek 从 drama-skills 抄的方向，但定为 **P2**。
- Director/Planner/Repair Agent OS、manifest.json、成本报告、rubric eval：远期，本轮不做。

## 下一步（建议顺序）
1. **P1 生产适配器接口 + 第一个参考 worker**（tts 或首帧）：可选、缺工具退化，验证 production 状态机真能流转。
2. **P2 独立审查层** novel-review（内容级审查 + 接受生命周期，从 drama-skills 借鉴）。
3. **P3 Look Development / rubric eval / 成本报告**。

## 一句话
> 上次解决了"AI 短剧怎么设计"，本轮把脚手架升级到"AI 短剧怎么像工厂一样稳定生产"——但只搭不破红线。

---

## 复查与修复（2026-08-14b 补）

对上面 P0 落地做了代码级复查，四个真 bug 全部修掉。**记录里写的"已验证"与实际代码不完全一致**，
这是复查的价值所在——自测数字和文档都是 Hy3 写的，代码才是真相。

### 修了什么

1. **portrait 样例脏数据**：`渡口-cast.json` 三个角色的参考图文件名被写成
   林晚/顾沉舟/苏曼（角色实际是陆行远/老周/胡二爷），且这些文件仓库里根本不存在。
   文件名已改回；novel-characters 的 Step 8 / sheet.md 补了 portrait 出图流程——
   之前只有"storyboard 消费 portrait"这一半，没有"谁生成 portrait"这一半。
2. **参考图存在性检查是死代码**：`checkContinuity` 读 `paths['novel-characters']`，
   实际键名是 `cast`，base 恒为 null，检查从不执行。已修（`paths.cast` + 项目根解析）
   并补击穿测试。
3. **失效传播空转且方向反了**：`verify --write`/`build` 都不写 `versions`，hash 比对
   永不触发；原逻辑检测"本文件变了"，正确语义是"上游变了而下游没重跑"。已改为记录
   各层 hash + 上游 hash + 生成 skill 版本，只报真正过期的下游，过期的层 --write 不覆盖。
4. **连续性检查假警报 + 空转**：光照比较不区分场景/集边界（实测渡口 5 条全是合法换场
   误报）；道具状态读 `states[0].name`（实际字段是 `state`）永远为空。已改为同集比服装、
   同场同集比道具与光照；`continuity` 全骨架时明确提醒"检查未生效"。

### 附带修复

- `check.mjs` 用 `import.meta.dirname`（Node ≥ 20.11），CI 矩阵里的 node 18 必挂 → 换 `fileURLToPath`
- skill 版本硬编码 `SKILL_VERSIONS`（novel-characters 写 1.0.0，实际 1.7.0）→ 运行时读各 SKILL.md frontmatter
- README.en.md 的 novel-project 描述未同步 → 已更新

### 修复后验证

- novel-project 自测 21 → **29 项**，全仓库 **819 项**断言全绿
- 《渡口》端到端 verify：假警报清零；4 张不存在的 portrait 被点名"参考图文件缺失"；
  continuity 全骨架被提醒"检查未生效"；改上游后 `verify` 只报真正变动的层
