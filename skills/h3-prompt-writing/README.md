**中文** · [English](README.en.md)

# h3-prompt-writing

给 MiniMax H3 视频生成模型写提示词：把多模态需求重写成
`integrated_multimodal_description` / `overall_soundscape` / `non_diegetic_music`
三段式（基础模式），或六段式全参考重写（Ref2VA）。

本 skill 是纯规范 + 示例，**不调用任何 API**：

- `references/base-en.txt` — T2VA / I2VA / FL2VA / L2VA 四种基础模式的最终提示词结构
- `references/ref-en.txt` — Ref2VA 全参考模式：subject_definitions / summary / retention_analysis / detailed_description / 声景 / 配乐

它同时是 `novel-storyboard` 的 H3 提示词规范源——分镜表里每条镜头的
`h3CopyBlock` 都按这里的约定生成。改这里的规范，记得先跑自测，再检查分镜样例。

## 自测

```bash
node scripts/selftest.mjs
```

8 项断言：字段名与顺序、引用句式、时间戳、`<d>` 台词封装、保留分析判定词。
不调模型、不花额度。
