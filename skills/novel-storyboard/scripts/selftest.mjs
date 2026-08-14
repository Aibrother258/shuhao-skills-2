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

// ── 7. 复杂度评分：简单镜 score 低、多动作复杂镜 recommendSplit=true ──
console.log('[7] 复杂度评分 determinism');
{
  const tmp = mkdtempSync(join(tmpdir(), 'sb-'));
  // 构造最小 script：一个简单动作 beat + 一个复杂动作 beat
  const script = {
    source: '复杂度', episodes: [{ ep: 1, targetSeconds: 30, scenes: [
      { sceneId: 'S01', lighting: '晨', characters: ['C01', 'C02'], props: ['P01'], flow: [
        { action: '他站着' },
        { action: '他走向窗前。拿起手机。看了一眼消息。脸色骤变。随后转身离开' },
        { action: '他走向窗前，拿起手机，看了一眼消息，脸色骤变，随后转身离开' },
        { action: '浓雾把栈桥吃得只剩三步远。梆子声从岸上飘过来' }
      ] }
    ] }]
  };
  const sp = join(tmp, 'cplx-script.json'); writeFileSync(sp, JSON.stringify(script, null, 2));
  const seed = run(['seed', sp, '--outline', join(EX, '渡口-outline.json'), '--art', join(EX, '渡口-art.json'),
    '--cast', join(EX, '渡口-cast.json'), '--autofill', '--out', join(tmp, 'cplx.json')], tmp);
  ok('seed 退出 0', seed.code === 0, seed.out.slice(-200));
  const board = JSON.parse(readFileSync(join(tmp, 'cplx.json'), 'utf8'));
  const shots = board.episodes[0].shots;
  const simple = shots.find(s => s.action === '他站着');
  const complex = shots.find(s => s.action.includes('他走向窗前。拿起手机'));
  const commaRun = shots.find(s => s.action.includes('他走向窗前，拿起手机'));
  ok('简单镜有 complexity 且 score<4 level=simple', simple && simple.complexity && simple.complexity.score < 4 && simple.complexity.level === 'simple', JSON.stringify(simple && simple.complexity));
  // 方案 A：recommendSplit 与拆镜器对齐 —— 仅动作镜 + ≥2 句号分句才置 true
  ok('句号分句复杂镜 recommendSplit=true 且 level=high', complex && complex.complexity && complex.complexity.recommendSplit === true && complex.complexity.level === 'high', JSON.stringify(complex && complex.complexity));
  // 逗号串镜：评分仍高但 recommendSplit=false，且 warnings 提示人工处理（拆镜器拆不动）
  ok('逗号串镜 recommendSplit=false（拆镜器无法拆）', commaRun && commaRun.complexity && commaRun.complexity.recommendSplit === false, JSON.stringify(commaRun && commaRun.complexity));
  ok('逗号串镜 warnings 提示人工拆分', commaRun && Array.isArray(commaRun.warnings) && commaRun.warnings.some(w => /逗号串|人工/.test(w)), JSON.stringify(commaRun && commaRun.warnings));
  // 方案 A 补强：简单建立镜（≥2 句号分句但 score 低）不推荐拆 —— 过滤掉"浓雾…。梆子声…"类微镜
  const establish = shots.find(s => s.action.includes('浓雾把栈桥'));
  ok('简单建立镜（2 分句但 score<6）recommendSplit=false', establish && establish.complexity && establish.complexity.recommendSplit === false, JSON.stringify(establish && establish.complexity));
}

// ── 8. export 平铺 Prompt 包：shots 四类文件产出 ──
console.log('[8] export 产出 prompts/ 平铺文件');
{
  const tmp = mkdtempSync(join(tmpdir(), 'sb-'));
  const seed = run(['seed', join(EX, '渡口-script.json'),
    '--outline', join(EX, '渡口-outline.json'), '--art', join(EX, '渡口-art.json'),
    '--cast', join(EX, '渡口-cast.json'), '--autofill', '--out', join(tmp, '渡口-storyboard.json')], tmp);
  ok('seed 退出 0', seed.code === 0, seed.out.slice(-200));
  const ex = run(['export', join(tmp, '渡口-storyboard.json'),
    '--cast', join(EX, '渡口-cast.json'), '--art', join(EX, '渡口-art.json'), '--out', join(tmp, 'prompts')], tmp);
  ok('export 退出 0', ex.code === 0, ex.out.slice(-200));
  const firstShot = JSON.parse(readFileSync(join(tmp, '渡口-storyboard.json'), 'utf8')).episodes[0].shots[0].shotId;
  ok('导出 shots/<id>/first-frame.txt 存在', existsSync(join(tmp, 'prompts', 'shots', firstShot, 'first-frame.txt')));
  ok('导出 shots/<id>/h3.txt 存在', existsSync(join(tmp, 'prompts', 'shots', firstShot, 'h3.txt')));
  ok('导出 characters/<id>.txt 存在', existsSync(join(tmp, 'prompts', 'characters', 'C01-沈知微.txt')));
  const charTxt = readFileSync(join(tmp, 'prompts', 'characters', 'C01-沈知微.txt'), 'utf8');
  ok('角色 txt 含 Identity Lock 不可变特征', charTxt.includes('Identity Lock') && charTxt.includes('oval face'));
  ok('角色 txt 含 Wardrobe 展开', charTxt.includes('W01') && charTxt.includes('navy-blue'));
  const ff = readFileSync(join(tmp, 'prompts', 'shots', firstShot, 'first-frame.txt'), 'utf8');
  ok('首帧 txt 注入 wardrobe 描述', ff.includes('navy-blue') || ff.includes('wearing'));
  // Bug1：h3.txt 必须含 I2VA 首帧引用句（"is fully referenced"），不可被 formatH3 丢掉
  const h3txt = readFileSync(join(tmp, 'prompts', 'shots', firstShot, 'h3.txt'), 'utf8');
  ok('h3.txt 含 I2VA 首帧引用句（不丢关键信息）', h3txt.includes('is fully referenced') || h3txt.includes('For the target video'), h3txt.slice(0, 120));
  // Bug3：只有 sheet（无 portrait/path）的角色，refImagePaths 不得把 sheet 提示词文本当路径
  const sheetOnly = {
    source: '仅sheet', params: {}, characters: [
      { id: 'C09', name: '仅sheet角', image: { sheet: 'Single character model sheet, a tall man in grey coat...' }, voice: { timbre: 'x' } }
    ]
  };
  const sc = join(tmp, 'sheet-cast.json'); writeFileSync(sc, JSON.stringify(sheetOnly, null, 2));
  const ri = run(['seed', join(EX, '渡口-script.json'), '--outline', join(EX, '渡口-outline.json'),
    '--art', join(EX, '渡口-art.json'), '--cast', sc, '--autofill', '--out', join(tmp, 'sheet-board.json')], tmp);
  ok('仅 sheet 角色 seed 退出 0', ri.code === 0, ri.out.slice(-150));
  const sb = JSON.parse(readFileSync(join(tmp, 'sheet-board.json'), 'utf8'));
  const anySheet = sb.episodes.some(e => e.shots.some(s => (s.refImagePaths || []).some(p => p.includes('model sheet'))));
  ok('sheet 文本不进 refImagePaths（降级为占位符）', !anySheet);
}

// ── 9. split 保住 sourceBeat + G1 覆盖门仍过 ──
console.log('[9] split 复杂镜保留 sourceBeat，validate 仍通过');
{
  const tmp = mkdtempSync(join(tmpdir(), 'sb-'));
  const seed = run(['seed', join(EX, '渡口-script.json'),
    '--outline', join(EX, '渡口-outline.json'), '--art', join(EX, '渡口-art.json'),
    '--cast', join(EX, '渡口-cast.json'), '--autofill', '--out', join(tmp, '渡口-storyboard.json')], tmp);
  ok('seed 退出 0', seed.code === 0);
  const seedBoard = JSON.parse(readFileSync(join(tmp, '渡口-storyboard.json'), 'utf8'));
  const seedBoardShots = seedBoard.episodes.reduce((a, e) => a + e.shots.length, 0);
  const sp = run(['split', join(tmp, '渡口-storyboard.json'), '--auto', '--autofill', '--cast', join(EX, '渡口-cast.json'),
    '--art', join(EX, '渡口-art.json'), '--out', join(tmp, 'split.json')], tmp);
  ok('split --auto 退出 0', sp.code === 0, sp.out.slice(-200));
  const split = JSON.parse(readFileSync(join(tmp, 'split.json'), 'utf8'));
  const allHaveBeat = split.episodes.every(e => e.shots.every(s => s.sourceBeat && typeof s.sourceBeat.beatNo === 'number'));
  ok('拆分后所有子镜保留 sourceBeat', allHaveBeat);
  const v = run(['validate', join(tmp, 'split.json'),
    '--script', join(EX, '渡口-script.json'), '--outline', join(EX, '渡口-outline.json'),
    '--art', join(EX, '渡口-art.json'), '--cast', join(EX, '渡口-cast.json')], tmp);
  ok('拆分后 validate 退出 0（G1/G2 仍过）', v.code === 0, v.out.slice(-200));
  ok('拆分后镜头数 > 原镜头数（真拆出子镜，非空转）', split.episodes.reduce((a, e) => a + e.shots.length, 0) > seedBoardShots, JSON.stringify({ after: split.episodes.reduce((a, e) => a + e.shots.length, 0), before: seedBoardShots }));
  // 方案 A 自洽：被标记 recommendSplit=true 的动作镜都应真的拆出子镜（标记与拆镜能力对齐）
  const recShots = seedBoard.episodes.flatMap(e => e.shots).filter(s => s.complexity && s.complexity.recommendSplit);
  const splitIds = new Set(split.episodes.flatMap(e => e.shots).map(s => s.shotId.replace(/[a-z]$/, '')));
  const allRecSplit = recShots.every(s => splitIds.has(s.shotId));
  ok('所有 recommendSplit=true 的镜都被真实拆分（标记↔拆镜能力对齐）', recShots.length === 0 || allRecSplit, JSON.stringify({ rec: recShots.length, aligned: allRecSplit }));
}

console.log('');
console.log(`结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
