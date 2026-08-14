#!/usr/bin/env node
'use strict';
// novel-storyboard 自测：确定性击穿质量门 + 端到端跑通《渡口》样例
// 约定：全部通过 exit 0；任一断言失败 exit 1。零依赖。
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const EX = join(ROOT, 'examples');
const SCRIPT = join(__dirname, 'novel-storyboard.mjs');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
function run(args, cwd) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: cwd || ROOT, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), raw: r };
}

// ── 1. 端到端：用《渡口》上游四件套 seed --autofill → validate 13/13 ──
console.log('[1] 端到端《渡口》样例：seed --autofill + validate');
{
  const tmp = mkdtempSync(join(tmpdir(), 'sb-'));
  const seed = run(['seed', join(EX, '渡口-script.json'),
    '--outline', join(EX, '渡口-outline.json'),
    '--art', join(EX, '渡口-art.json'),
    '--cast', join(EX, '渡口-cast.json'),
    '--autofill', '--out', join(tmp, '渡口-storyboard.json')], tmp);
  ok('seed 退出码 0', seed.code === 0, seed.out.slice(-300));
  const v = run(['validate', join(tmp, '渡口-storyboard.json'),
    '--script', join(EX, '渡口-script.json'),
    '--outline', join(EX, '渡口-outline.json'),
    '--art', join(EX, '渡口-art.json'),
    '--cast', join(EX, '渡口-cast.json')], tmp);
  ok('validate 退出码 0', v.code === 0, v.out.slice(-300));
  ok('validate 通过 17/17（H3 默认 i2va）', /通过 17\/17/.test(v.out), v.out.slice(-200));
  // 确认每条镜头都带 H3 三段式提示词 + 两个可直接复制块 + 首帧块
  const sb = JSON.parse(readFileSync(join(tmp, '渡口-storyboard.json'), 'utf8'));
  const allH3 = sb.episodes.every(e => e.shots.every(s => s.h3 && s.h3.integrated_multimodal_description && s.h3.overall_soundscape && s.h3.non_diegetic_music));
  ok('每条镜头都带 H3 三段式提示词', allH3);
  const allCopy = sb.episodes.every(e => e.shots.every(s => s.h3CopyBlock && s.firstFrameCopyBlock));
  ok('每条镜头都带 H3/首帧 可直接复制块', allCopy);
  const dia = sb.episodes[0].shots.find(s => s.beatKind === 'dialogue' || s.beatKind === 'vo');
  ok('对白/心声镜 H3 含 <d>[ 台词封装', dia ? dia.h3.integrated_multimodal_description.includes('<d>[') : true);
}

// ── 1b. seed --prompt-format legacy 应退化为 13+G17 道 ──
console.log('[1b] seed --prompt-format legacy → 含首帧块、不含 h3');
{
  const tmp = mkdtempSync(join(tmpdir(), 'sb-'));
  const seed = run(['seed', join(EX, '渡口-script.json'),
    '--outline', join(EX, '渡口-outline.json'),
    '--art', join(EX, '渡口-art.json'),
    '--cast', join(EX, '渡口-cast.json'),
    '--autofill', '--prompt-format', 'legacy', '--out', join(tmp, 'legacy.json')], tmp);
  ok('legacy seed 退出码 0', seed.code === 0, seed.out.slice(-300));
  const v = run(['validate', join(tmp, 'legacy.json'),
    '--script', join(EX, '渡口-script.json'),
    '--outline', join(EX, '渡口-outline.json'),
    '--art', join(EX, '渡口-art.json'),
    '--cast', join(EX, '渡口-cast.json')], tmp);
  ok('legacy validate 全过且 H3 门跳过', /全部质量门通过/.test(v.out) && /未生成 H3 提示词（legacy 模式），跳过/.test(v.out), v.out.slice(-200));
  const sb = JSON.parse(readFileSync(join(tmp, 'legacy.json'), 'utf8'));
  ok('legacy 模式镜头不含 h3 字段', sb.episodes.every(e => e.shots.every(s => !s.h3)));
}

// ── 1c. 击穿：H3 描述缺 [Shot 头必须 FAIL（G14）──
console.log('[1c] 击穿用例：H3 描述缺 [Shot 头 → G14 FAIL');
{
  const doc = {
    source: '击穿-H3', params: { promptFormat: 'h3' },
    episodes: [{ ep: 1, targetSeconds: 3, shots: [
      { shotId: 'E01S001', ep: 1, sceneId: 'S01', lighting: '晨', characters: [], props: [],
        shotType: '近景', camera: '固定机位', durationSec: 3, sourceBeat: { sceneNo: 1, beatNo: 1 },
        beatKind: 'action', onScreen: true, prompt: 'a calm pier in morning fog',
        negativePrompt: 'crowd', batch: 'B1', warnings: [],
        h3: { mode: 'T2VA', integrated_multimodal_description: 'a medium shot with no shot header', overall_soundscape: 'ambient', non_diegetic_music: 'soft score' } }
    ] }]
  };
  const tmp = mkdtempSync(join(tmpdir(), 'sb-'));
  const p = join(tmp, 'badh3.json'); writeFileSync(p, JSON.stringify(doc, null, 2));
  const v = run(['validate', p], tmp);
  ok('H3 缺 [Shot → validate 退出码 1', v.code === 1, 'code=' + v.code);
  ok('H3 缺 [Shot → 报 H3 描述 FAIL', /H3 描述/.test(v.out) && /FAIL/.test(v.out), v.out.slice(-200));
}

// ── 2. 构建最小合法分镜（不依赖上游）应通过无上游类质量门 ──
console.log('[2] 最小合法分镜（无上游）应全过可判定门');
{
  const doc = {
    source: '最小案例',
    params: {},
    episodes: [{
      ep: 1, targetSeconds: 8,
      shots: [
        { shotId: 'E01S001', ep: 1, sceneId: 'S01', lighting: '晨', characters: ['C01'], props: [],
          shotType: '近景', camera: '固定机位', durationSec: 3, sourceBeat: { sceneNo: 1, beatNo: 1 },
          beatKind: 'dialogue', onScreen: true, prompt: 'a close-up of a young woman, soft light, cinematic',
          negativePrompt: 'people, crowds, text', batch: 'B1', warnings: [], note: '',
          firstFrameCopyBlock: '=== 正向提示词 ===\na close-up of a young woman, soft light, cinematic\n\n=== 反向提示词 ===\npeople, crowds, text' }
      ]
    }]
  };
  const tmp = mkdtempSync(join(tmpdir(), 'sb-'));
  const p = join(tmp, 'min.json'); writeFileSync(p, JSON.stringify(doc, null, 2));
  const v = run(['validate', p], tmp);
  ok('最小分镜 validate 退出码 0', v.code === 0, v.out.slice(-300));
  ok('最小分镜未报 FAIL', !/FAIL/.test(v.out), v.out.slice(-200));
}

// ── 3. 击穿：非法 shotId 必须被拦下（validate 退出码 1）──
console.log('[3] 击穿用例：非法 shotId 必须 FAIL');
{
  const doc = {
    source: '击穿', params: {},
    episodes: [{ ep: 1, targetSeconds: 3, shots: [
      { shotId: 'shot1', ep: 1, sceneId: 'S01', lighting: '晨', characters: [], props: [],
        shotType: '近景', camera: '固定机位', durationSec: 3, sourceBeat: { sceneNo: 1, beatNo: 1 },
        beatKind: 'action', onScreen: true, prompt: 'empty scene, fog', negativePrompt: 'crowd', batch: 'B1', warnings: [] }
    ] }]
  };
  const tmp = mkdtempSync(join(tmpdir(), 'sb-'));
  const p = join(tmp, 'bad.json'); writeFileSync(p, JSON.stringify(doc, null, 2));
  const v = run(['validate', p], tmp);
  ok('非法 shotId → validate 退出码 1', v.code === 1, 'code=' + v.code);
  ok('非法 shotId → 报 shotId 门 FAIL', /shotId/.test(v.out) && /FAIL/.test(v.out), v.out.slice(-200));
}

// ── 4. 击穿：中文首帧提示词必须被拦下 ──
console.log('[4] 击穿用例：中文首帧提示词必须 FAIL');
{
  const doc = {
    source: '击穿2', params: {},
    episodes: [{ ep: 1, targetSeconds: 3, shots: [
      { shotId: 'E01S001', ep: 1, sceneId: 'S01', lighting: '晨', characters: [], props: [],
        shotType: '近景', camera: '固定机位', durationSec: 3, sourceBeat: { sceneNo: 1, beatNo: 1 },
        beatKind: 'action', onScreen: true, prompt: '这是一句中文提示词', negativePrompt: 'crowd', batch: 'B1', warnings: [] }
    ] }]
  };
  const tmp = mkdtempSync(join(tmpdir(), 'sb-'));
  const p = join(tmp, 'bad2.json'); writeFileSync(p, JSON.stringify(doc, null, 2));
  const v = run(['validate', p], tmp);
  ok('中文提示词 → validate 退出码 1', v.code === 1, 'code=' + v.code);
}

// ── 5. 击穿：多人近景缺预警必须 FAIL ──
console.log('[5] 击穿用例：3 人近景缺预警必须 FAIL');
{
  const doc = {
    source: '击穿3', params: {},
    episodes: [{ ep: 1, targetSeconds: 3, shots: [
      { shotId: 'E01S001', ep: 1, sceneId: 'S01', lighting: '晨', characters: ['C01','C02','C03'], props: [],
        shotType: '近景', camera: '固定机位', durationSec: 3, sourceBeat: { sceneNo: 1, beatNo: 1 },
        beatKind: 'action', onScreen: true, prompt: 'three people in a small boat cabin, wide', negativePrompt: 'crowd', batch: 'B1', warnings: [] }
    ] }]
  };
  const tmp = mkdtempSync(join(tmpdir(), 'sb-'));
  const p = join(tmp, 'bad3.json'); writeFileSync(p, JSON.stringify(doc, null, 2));
  const v = run(['validate', p], tmp);
  ok('3人近景缺预警 → validate 退出码 1', v.code === 1, 'code=' + v.code);
}

// ── 6. render 产出 MD 与 HTML ──
console.log('[6] render 产出 MD / HTML');
{
  const tmp = mkdtempSync(join(tmpdir(), 'sb-'));
  const src = join(tmp, 's.json');
  writeFileSync(src, JSON.stringify({
    source: '渲染', params: {},
    episodes: [{ ep: 1, targetSeconds: 3, shots: [
      { shotId: 'E01S001', ep: 1, sceneId: 'S01', lighting: '晨', characters: [], props: [],
        shotType: '全景', camera: '固定机位', durationSec: 3, sourceBeat: { sceneNo: 1, beatNo: 1 },
        beatKind: 'action', onScreen: true, prompt: 'empty pier in fog', negativePrompt: 'crowd', batch: 'B1', warnings: [] }
    ] }]
  }, null, 2));
  const md = run(['render', src, '--md'], tmp);
  const html = run(['render', src, '--html'], tmp);
  ok('render --md 退出 0', md.code === 0);
  ok('render --html 退出 0', html.code === 0);
}

console.log('');
console.log(`结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
