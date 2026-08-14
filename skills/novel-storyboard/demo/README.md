# Demo · 端到端：分镜 → 首帧图 → 视频

本 demo 用《渡口》第 1 集演示完整生产链路，所有产物均由 `scripts/novel-storyboard.mjs` 自动生成，可直接复制粘贴进你的 ComfyUI 工作流。

## 文件清单

| 文件 | 说明 |
| --- | --- |
| `渡口-storyboard.json` | 全 6 集分镜表（210 条镜头，17/17 质量门通过），每条含 `firstFrameCopyBlock` 与 `h3CopyBlock` |
| `渡口-storyboard-report.html` | 同上的可视化报告，每镜可展开复制块 |
| `firstframes/镜头E01S001-首帧出图.txt` | 第 1 镜「首帧出图」复制块（正向+反向提示词+参考图），粘进 Krea2 |
| `firstframes/镜头E01S001-视频生成.txt` | 第 1 镜「视频生成」复制块（首帧引用句+三段式），粘进 H3 |

## 链路 A · 首帧图（Krea2 ComfyUI）

1. 打开 `firstframes/镜头E01S001-首帧出图.txt`，内容形如：

   ```
   === 正向提示词 ===
   <英文首帧描述，可直接粘进文生图/图生图节点>
   === 反向提示词 ===
   <英文反向提示词>
   [参考图] 【角色图:沈知微】 | 【角色图:老周】 | ...
   ```

2. 把「正向提示词」粘进 Krea2 文生图/图生图节点，「反向提示词」粘进 negative。
3. 把 `refImagePaths` 里的人物角色图（真实文件需在 `cast.json` 的 `image.path` 填路径）作为参考图传入，保证角色一致。
4. 出图，保存为 `firstframes/E01S001.png`（文件名与 `shotId` 对应，方便后续对账）。

## 链路 B · 视频（MiniMax H3 ComfyUI）

1. 打开 `firstframes/镜头E01S001-视频生成.txt`，内容形如：

   ```
   === 参考图(传入 H3 工作流) ===
   首帧图(Picture 1): firstframes/E01S001.png
   角色参考图: <角色图路径>
   === 首帧引用句(粘贴到提示词开头) ===
   For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
   === integrated_multimodal_description ===
   [Shot 1] Live-action, cinematic, a wide shot frames ...
   === overall_soundscape ===
   ...
   === non_diegetic_music ===
   ...
   ```

2. `h3Mode=i2va`（默认）：把「首帧引用句」粘到提示词开头，把首帧图作为 `<Picture 1>`、角色图作参考，三段式分别粘入对应字段。
3. 反复换随机种子 / 微调提示词抽卡，直到画面与角色一致、运镜满意，再进下一镜 `E01S002`。

## 复跑命令

```bash
# 重新生成全部分镜（含首帧/视频复制块）
node scripts/novel-storyboard.mjs seed examples/渡口-script.json \
  --outline examples/渡口-outline.json --art examples/渡口-art.json --cast examples/渡口-cast.json \
  --autofill --out demo/渡口-storyboard.json

# 过质量门
node scripts/novel-storyboard.mjs validate demo/渡口-storyboard.json \
  --script examples/渡口-script.json --art examples/渡口-art.json --cast examples/渡口-cast.json

# 生成报告
node scripts/novel-storyboard.mjs render demo/渡口-storyboard.json --html > demo/渡口-storyboard-report.html

# 抽取单镜复制块（以 E01S001 为例）
node -e "const d=require('./demo/渡口-storyboard.json');const s=d.episodes[0].shots[0];\
require('fs').writeFileSync('demo/firstframes/镜头E01S001-首帧出图.txt',s.firstFrameCopyBlock);\
require('fs').writeFileSync('demo/firstframes/镜头E01S001-视频生成.txt',s.h3CopyBlock);"
```
