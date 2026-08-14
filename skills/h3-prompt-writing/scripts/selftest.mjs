#!/usr/bin/env node
// h3-prompt-writing 自测：不调模型、不花额度，只验参考规范的确定性内容。
// 防止文档被改散：字段名、顺序、关键句式都是 H3 的硬约定，漂了故事板
// skill 生成的 h3CopyBlock 就跟着漂。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const base = readFileSync(join(here, '../references/base-en.txt'), 'utf8');
const ref = readFileSync(join(here, '../references/ref-en.txt'), 'utf8');
const skill = readFileSync(join(here, '../SKILL.md'), 'utf8');

let passed = 0;
function ok(name) {
  passed += 1;
  console.log(`  PASS ${name}`);
}

function indexOfAll(text, needle) {
  const out = [];
  let i = -1;
  while ((i = text.indexOf(needle, i + 1)) !== -1) out.push(i);
  return out;
}

// base-en.txt：三个核心字段按固定顺序出现
const baseFields = ['integrated_multimodal_description:', 'overall_soundscape:', 'non_diegetic_music:'];
const baseIdx = baseFields.map((f) => base.indexOf(f));
assert.ok(baseIdx.every((i) => i >= 0), 'base-en.txt 缺核心字段');
assert.ok(baseIdx[0] < baseIdx[1] && baseIdx[1] < baseIdx[2], 'base-en.txt 字段顺序错');
ok('base-en.txt 三个核心字段顺序正确');

// base-en.txt：I2VA 首帧引用句式
assert.ok(base.includes('For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'));
ok('base-en.txt 保留 I2VA 首帧引用句式');

// base-en.txt：镜头时间戳与台词封装
assert.ok(base.includes('At 00:'), 'base-en.txt 缺镜头时间戳');
assert.ok(base.includes('<d>['), 'base-en.txt 缺台词封装记号');
ok('base-en.txt 镜头时间戳与 <d> 台词封装都在');

// ref-en.txt：六个 section 在完整示例里按固定顺序出现（前面零散示例不算）
const refFields = ['subject_definitions:', 'summary:', 'retention_analysis:', 'detailed_description:', 'overall_soundscape:', 'non_diegetic_music:'];
const refIdx = refFields.map((f) => ref.lastIndexOf(f));
assert.ok(refIdx.every((i) => i >= 0), 'ref-en.txt 缺 section');
for (let i = 1; i < refIdx.length; i++) assert.ok(refIdx[i - 1] < refIdx[i], `ref-en.txt section 顺序错：${refFields[i]}`);
ok('ref-en.txt 六个 section 顺序正确');

// ref-en.txt：保留分析必须有判定词
assert.ok(ref.includes('fully_preserved'), 'ref-en.txt 缺 fully_preserved 判定词');
ok('ref-en.txt retention_analysis 带 fully_preserved 判定词');

// ref-en.txt：台词/歌词只在 <d> 内
assert.ok(ref.includes('<d>[English]'), 'ref-en.txt 缺 <d> 台词示例');
ok('ref-en.txt 台词用 <d> 封装');

// SKILL.md：五种模式都提到
for (const mode of ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'Ref2VA']) {
  assert.ok(skill.includes(mode), `SKILL.md 缺模式 ${mode}`);
}
ok('SKILL.md 覆盖五种模式');

// SKILL.md 与 references 无字段名漂移
for (const f of ['integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music']) {
  assert.ok(skill.includes(f), `SKILL.md 缺字段 ${f}`);
}
ok('SKILL.md 字段名与 references 一致');

console.log(`\n✓ ${passed} 项自测全部通过`);
