#!/usr/bin/env node
// novel-project 自测：不调模型、不花额度，只验确定性逻辑。
// 原则与仓库其他 skill 一致：每条契约都要有击穿用例——证明它真的会拦。

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SKILLS,
  PROD_STAGES,
  loadProject,
  planBuild,
  recordVersions,
  summary,
  templateProject,
  verifyProject,
} from './novel-project.mjs';

let passed = 0;
function ok(name) {
  passed += 1;
  console.log(`  PASS ${name}`);
}

/* ------------------------------------------------------------------ */
/* 夹具：2 集 × 2 分钟的最小一致项目                                     */
/* ------------------------------------------------------------------ */

function fixture() {
  const outline = {
    source: '自测',
    params: { episodes: 2, minutesPerEpisode: 2, genre: '测试' },
    characters: [
      { id: 'C01', name: '阿甲', role: '女主', arc: '', from: [], tier: 'lead' },
      { id: 'C02', name: '阿乙', role: '男主', arc: '', from: [], tier: 'lead' },
    ],
    scenes: [{ id: 'S01', name: '屋里', primary: true }],
    beats: [],
    episodes: [
      { ep: 1, synopsis: '一', hook: '钩子1', suspense: '悬念1', sceneIds: ['S01'], characterIds: ['C01', 'C02'], crowdPlan: '', warnings: [] },
      { ep: 2, synopsis: '二', hook: '钩子2', suspense: '悬念2', sceneIds: ['S01'], characterIds: ['C01'], crowdPlan: '', warnings: [] },
    ],
  };
  const cast = {
    source: '自测', lang: 'zh', style: 'realistic', summary: '',
    characters: [
      { name: '阿甲', aliases: [], importance: 'protagonist', persona: {}, image: {}, voice: {} },
      { name: '阿乙', aliases: [], importance: 'protagonist', persona: {}, image: {}, voice: {} },
    ],
  };
  const art = {
    source: '自测', style: 'realistic',
    scenes: [{ id: 'S01', name: '屋里', primary: true, lighting: [{ state: '晨光', prompt: '' }] }],
    props: [{ id: 'P01', name: '茶碗', scale: '手持级', states: [{ state: '满', prompt: '' }] }],
  };
  const script = {
    source: '自测',
    episodes: [
      {
        ep: 1, targetSeconds: 120, hook: '钩子1', cliff: '悬念1', beatsClaimed: [],
        scenes: [{ sceneId: 'S01', lighting: '晨光', characters: ['C01', 'C02'], props: ['P01'], flow: [{ action: '推门' }] }],
      },
      {
        ep: 2, targetSeconds: 120, hook: '钩子2', cliff: '悬念2', beatsClaimed: [],
        scenes: [{ sceneId: 'S01', lighting: '晨光', characters: ['C01'], props: [], flow: [{ action: '坐下' }] }],
      },
    ],
  };
  const storyboard = {
    source: '自测', params: {},
    episodes: [
      { ep: 1, targetSeconds: 120, shots: [
        { shotId: 'E01S001', ep: 1, sceneId: 'S01', lighting: '晨光', characters: ['C01', 'C02'], props: ['P01'], durationSec: 3, sourceBeat: { sceneNo: 1, beatNo: 1 }, refImagePaths: [], continuity: { characters: { C01: { name: '阿甲', wardrobe: 'W01藏青衫', emotion: '', state: 'on_screen', position: 'left' }, C02: { name: '阿乙', wardrobe: 'W02灰袍', emotion: '', state: 'on_screen', position: 'right' } }, props: { P01: { name: '茶碗', state: '满' } }, scene: { lighting: '晨光', weather: '', time: '' } } },
        { shotId: 'E01S002', ep: 1, sceneId: 'S01', lighting: '晨光', characters: ['C01'], props: [], durationSec: 3, sourceBeat: { sceneNo: 1, beatNo: 2 }, refImagePaths: [], continuity: { characters: { C01: { name: '阿甲', wardrobe: 'W01藏青衫', emotion: '', state: 'on_screen', position: 'center' } }, props: {}, scene: { lighting: '晨光', weather: '', time: '' } } },
      ] },
      { ep: 2, targetSeconds: 120, shots: [{ shotId: 'E02S001', ep: 2, sceneId: 'S01', lighting: '晨光', characters: ['C01'], props: [], durationSec: 3, sourceBeat: { sceneNo: 1, beatNo: 1 }, refImagePaths: [], continuity: { characters: { C01: { name: '阿甲', wardrobe: 'W01藏青衫', emotion: '', state: 'on_screen', position: 'center' } }, props: {}, scene: { lighting: '晨光', weather: '', time: '' } } }] },
    ],
  };
  return { outline, cast, art, script, storyboard };
}

function writeProject(dir, data, project = {}) {
  mkdirSync(dir, { recursive: true });
  const p = templateProject({ projectId: 'selftest-001', title: '自测剧', episodes: 2, episodeMinutes: 2 });
  p.paths = {
    cast: 'cast.json',
    outline: 'outline.json',
    art: 'art.json',
    script: 'script.json',
    storyboard: 'storyboard.json',
  };
  Object.assign(p, project);
  writeFileSync(join(dir, 'project.json'), JSON.stringify(p));
  for (const [name, d] of Object.entries(data)) {
    if (d) writeFileSync(join(dir, `${name}.json`), JSON.stringify(d));
  }
  return join(dir, 'project.json');
}

function countIssues(projectPath, level) {
  const v = verifyProject(projectPath);
  return summary(v.issues)[level === 'error' ? 'errs' : 'warns'].length;
}

/* ------------------------------------------------------------------ */
/* 用例                                                                 */
/* ------------------------------------------------------------------ */

const root = mkdtempSync(join(tmpdir(), 'novel-project-selftest-'));

try {
  // templateProject
  const tpl = templateProject({ title: 'X', episodes: '12', episodeMinutes: '3' });
  assert.equal(tpl.episodes, 12);
  assert.equal(tpl.episodeMinutes, 3);
  assert.equal(Object.keys(tpl.paths).length, 5);
  assert.equal(Object.keys(tpl.skills).length, 5);
  for (const s of SKILLS) assert.equal(tpl.skills[s.id], 'pending');
  ok('templateProject 生成完整骨架');

  // 良好项目：零错误
  const goodDir = join(root, 'good');
  mkdirSync(goodDir);
  const goodPj = writeProject(goodDir, fixture());
  assert.equal(countIssues(goodPj, 'error'), 0);
  ok('良好项目 verify 零错误');

  // 击穿：大纲集数不符
  const d1 = fixture();
  d1.outline.episodes.push({ ...d1.outline.episodes[0], ep: 3 });
  const pj1 = writeProject(join(root, 'ep-count'), d1);
  assert.ok(countIssues(pj1, 'error') >= 1);
  ok('击穿：outline 集数不符被拦');

  // 击穿：大纲角色 id 重复
  const d2 = fixture();
  d2.outline.characters.push({ ...d2.outline.characters[0], name: '阿丙' });
  const pj2 = writeProject(join(root, 'dup-char'), d2);
  assert.ok(countIssues(pj2, 'error') >= 1);
  ok('击穿：outline 角色 id 重复被拦');

  // 击穿：script 引用不存在的场景
  const d3 = fixture();
  d3.script.episodes[0].scenes[0].sceneId = 'S99';
  const pj3 = writeProject(join(root, 'bad-scene'), d3);
  assert.ok(countIssues(pj3, 'error') >= 1);
  ok('击穿：script 引用 S99 被拦');

  // 击穿：script 光照未在美术登记
  const d4 = fixture();
  d4.script.episodes[0].scenes[0].lighting = '夜光';
  const pj4 = writeProject(join(root, 'bad-lighting'), d4);
  assert.ok(countIssues(pj4, 'error') >= 1);
  ok('击穿：script 光照未登记被拦');

  // 警告：script 场景缺光照字段
  const d5 = fixture();
  delete d5.script.episodes[0].scenes[0].lighting;
  const pj5 = writeProject(join(root, 'no-lighting'), d5);
  assert.ok(countIssues(pj5, 'warning') >= 1);
  assert.equal(countIssues(pj5, 'error'), 0);
  ok('警告：script 场景缺光照字段');

  // 击穿：script targetSeconds 与项目分钟数不符
  const d6 = fixture();
  d6.script.episodes[0].targetSeconds = 100;
  const pj6 = writeProject(join(root, 'bad-target'), d6);
  assert.ok(countIssues(pj6, 'error') >= 1);
  ok('击穿：script targetSeconds 不符被拦');

  // 击穿：storyboard 光照不在美术登记
  const d7 = fixture();
  d7.storyboard.episodes[0].shots[0].lighting = '夜光';
  const pj7 = writeProject(join(root, 'sb-lighting'), d7);
  assert.ok(countIssues(pj7, 'error') >= 1);
  ok('击穿：storyboard 光照未登记被拦');

  // 击穿：storyboard shotId 重复
  const d8 = fixture();
  d8.storyboard.episodes[1].shots[0].shotId = 'E01S001';
  const pj8 = writeProject(join(root, 'dup-shot'), d8);
  assert.ok(countIssues(pj8, 'error') >= 1);
  ok('击穿：storyboard shotId 重复被拦');

  // 击穿：storyboard 引用剧本外的角色
  const d9 = fixture();
  d9.storyboard.episodes[0].shots[0].characters = ['C99'];
  const pj9 = writeProject(join(root, 'bad-char-ref'), d9);
  assert.ok(countIssues(pj9, 'error') >= 1);
  ok('击穿：storyboard 引用剧本外角色被拦');

  // 警告：角色参考图占位符（聚合为一条）
  const d10 = fixture();
  d10.storyboard.episodes[0].shots[0].refImagePaths = ['【角色图:阿甲】'];
  const pj10 = writeProject(join(root, 'placeholder'), d10);
  const v10 = verifyProject(pj10);
  const placeholderWarns = v10.issues.filter((i) => i.msg.includes('参考图还是占位符'));
  assert.equal(placeholderWarns.length, 1);
  ok('警告：角色参考图占位符聚合为一条');

  // build：缺层时给出下一步
  const bDir = join(root, 'build-missing');
  mkdirSync(bDir);
  const bp = templateProject({ title: '半成品', episodes: 2, episodeMinutes: 2 });
  bp.paths = { cast: '', outline: '', art: '', script: '', storyboard: '' };
  writeFileSync(join(bDir, 'project.json'), JSON.stringify(bp));
  const plan = planBuild(join(bDir, 'project.json'));
  assert.equal(plan.missing.length, 5);
  assert.equal(plan.missing[0], 'novel-outline');
  ok('build：缺 5 层时按 DAG 顺序给出下一步');

  // build：齐了就没有 missing
  const plan2 = planBuild(goodPj);
  assert.equal(plan2.missing.length, 0);
  ok('build：产物齐全时无缺失层');

  // loadProject：坏 JSON 报错
  const badDir = join(root, 'bad-json');
  mkdirSync(badDir);
  writeFileSync(join(badDir, 'project.json'), '{不是JSON');
  assert.throws(() => loadProject(join(badDir, 'project.json')));
  ok('loadProject：坏 project.json 报错');

  /* ---- P0-2 幂等 + 失效传播 + 生产状态 ---- */
  // templateProject 含 versions / production 骨架
  assert.ok('versions' in tpl);
  assert.ok('production' in tpl);
  assert.ok('shots' in tpl.production);
  ok('templateProject 含 versions + production 骨架');

  // recordVersions：写 hash + 上游 hash + 生成 skill 版本
  const vRec = verifyProject(goodPj);
  recordVersions(vRec.project, vRec.loaded, new Set());
  const ver = vRec.project.versions;
  assert.ok(ver['novel-script'] && ver['novel-script'].hash.length === 16);
  assert.ok(ver['novel-script'].inputs['novel-outline']);
  assert.ok(ver['novel-storyboard'].inputs['novel-script']);
  assert.ok(ver['novel-storyboard'].inputs['novel-art']);
  assert.ok(typeof ver['novel-script'].skillVersion === 'string' && ver['novel-script'].skillVersion.length);
  ok('P0-2 recordVersions 写入 hash + 上游 hash + skill 版本');

  // verifyProject 后为每个 shot 建最小阶段状态（storyboard=passed，其余 pending）
  const vGood = verifyProject(goodPj);
  const prod = vGood.project.production.shots;
  assert.ok(prod['E01S001']);
  assert.equal(prod['E01S001'].storyboard, 'passed');
  assert.equal(prod['E01S001'].firstFrame, 'pending');
  ok('P0-2 verifyProject 为每镜初始化 production 状态');

  // 失效传播：上游（剧本）hash 变了、下游（分镜）没重跑 → 报"上游已变更"
  const staleDir = join(root, 'stale');
  mkdirSync(staleDir);
  const goodRaw = JSON.parse(readFileSync(goodPj, 'utf8'));
  writeFileSync(join(staleDir, 'project.json'), JSON.stringify({
    ...goodRaw,
    versions: {
      'novel-storyboard': {
        hash: 'x', skillVersion: '1.0.0', generatedAt: '',
        inputs: { 'novel-script': 'old-hash', 'novel-outline': 'x', 'novel-art': 'x', 'novel-characters': 'x' },
      },
    },
  }));
  // 复制一份好产物
  for (const k of ['cast', 'outline', 'art', 'script', 'storyboard']) {
    writeFileSync(join(staleDir, `${k}.json`), readFileSync(join(goodDir, `${k}.json`)));
  }
  const vStale = verifyProject(join(staleDir, 'project.json'));
  const staleWarns = vStale.issues.filter((i) => i.skill === 'novel-storyboard' && i.msg.includes('上游已变更'));
  assert.ok(staleWarns.length >= 1);
  ok('P0-2 失效传播：上游变更、下游未重跑报"过期"');

  // 有上游过期的层，recordVersions 保留旧记录（不让 --write 吞掉警告）
  const staleProj = JSON.parse(readFileSync(join(staleDir, 'project.json'), 'utf8'));
  recordVersions(staleProj, vStale.loaded, new Set(['novel-storyboard']));
  assert.equal(staleProj.versions['novel-storyboard'].hash, 'x');
  ok('P0-2 失效传播：过期的层不覆盖 versions 记录');

  // P0-1 参考图文件存在性：真实存在的文件不报，缺失的报
  const refOkDir = join(root, 'ref-ok');
  const dRef = fixture();
  dRef.storyboard.episodes[0].shots[0].refImagePaths = ['ref.png'];
  const pjRef = writeProject(refOkDir, dRef);
  writeFileSync(join(refOkDir, 'ref.png'), 'x');
  assert.ok(!verifyProject(pjRef).issues.some((i) => i.msg.includes('参考图文件缺失')));
  ok('P0-1 参考图：存在的文件不误报');
  const dRef2 = fixture();
  dRef2.storyboard.episodes[0].shots[0].refImagePaths = ['ref.png', 'missing.png'];
  const pjRef2 = writeProject(join(root, 'ref-missing'), dRef2);
  writeFileSync(join(root, 'ref-missing', 'ref.png'), 'x');
  const refWarns = verifyProject(pjRef2).issues.filter((i) => i.msg.includes('参考图文件缺失'));
  assert.ok(refWarns.length === 1 && refWarns[0].msg.includes('missing.png'));
  ok('P0-1 参考图：缺失文件被点名');

  /* ---- P0-3 跨镜连续性状态机校验 ---- */
  // 同集同场相邻镜服装跳变 → warning
  const d11 = fixture();
  d11.storyboard.episodes[0].shots[1].continuity.characters.C01.wardrobe = 'W99红衣';
  const pj11 = writeProject(join(root, 'continuity-wardrobe'), d11);
  const v11 = verifyProject(pj11);
  const wardrobeWarns = v11.issues.filter((i) => i.msg.includes('服装') && i.msg.includes('跳变'));
  assert.ok(wardrobeWarns.length >= 1);
  ok('P0-3 连续性：同集同场服装跳变被警告');

  // 跨集服装不同不误报（换集换装合法）
  const d11b = fixture();
  d11b.storyboard.episodes[1].shots[0].continuity.characters.C01.wardrobe = 'W88新衣';
  const pj11b = writeProject(join(root, 'continuity-cross-ep'), d11b);
  const v11b = verifyProject(pj11b);
  assert.ok(!v11b.issues.some((i) => i.msg.includes('服装') && i.msg.includes('跳变')));
  ok('P0-3 连续性：跨集换装不误报');

  // 同集同场道具状态突变（无承接）→ warning
  const d12 = fixture();
  d12.storyboard.episodes[0].shots[1].continuity.props = { P01: { name: '茶碗', state: '空' } };
  const pj12 = writeProject(join(root, 'continuity-prop'), d12);
  const v12 = verifyProject(pj12);
  const propWarns = v12.issues.filter((i) => i.msg.includes('道具') && i.msg.includes('突变'));
  assert.ok(propWarns.length >= 1);
  ok('P0-3 连续性：相邻镜道具状态突变被警告');

  // 同场光照突变 → warning；换场光照变化不误报
  const d14 = fixture();
  d14.storyboard.episodes[0].shots[1].continuity.scene.lighting = '夜光';
  const pj14 = writeProject(join(root, 'continuity-lighting'), d14);
  const v14 = verifyProject(pj14);
  assert.ok(v14.issues.some((i) => i.msg.includes('连续性：场景光照') && i.msg.includes('跳变') === false && i.msg.includes('突变')));
  ok('P0-3 连续性：同场光照突变被警告');
  const d15 = fixture();
  d15.storyboard.episodes[0].shots[1].sceneId = 'S02';
  d15.storyboard.episodes[0].shots[1].continuity.scene.lighting = '浓雾';
  const pj15 = writeProject(join(root, 'continuity-scene-change'), d15);
  const v15 = verifyProject(pj15);
  assert.ok(!v15.issues.some((i) => i.msg.includes('连续性：场景光照')));
  ok('P0-3 连续性：换场光照变化不误报');

  // continuity 全是 seed 骨架 → 提示"检查未生效"
  const d16 = fixture();
  for (const ep of d16.storyboard.episodes) {
    for (const sh of ep.shots) {
      for (const ch of Object.values(sh.continuity.characters)) {
        ch.wardrobe = '';
        ch.emotion = '';
        ch.position = '';
      }
    }
  }
  const pj16 = writeProject(join(root, 'continuity-skeleton'), d16);
  const v16 = verifyProject(pj16);
  assert.ok(v16.issues.some((i) => i.msg.includes('未生效')));
  ok('P0-3 连续性：全骨架 continuity 提醒未生效');

  // continuity 缺失不报错（向后兼容旧 storyboard）
  const d13 = fixture();
  delete d13.storyboard.episodes[0].shots[0].continuity;
  delete d13.storyboard.episodes[0].shots[1].continuity;
  const pj13 = writeProject(join(root, 'no-continuity'), d13);
  assert.equal(countIssues(pj13, 'error'), 0);
  ok('P0-3 连续性：旧 storyboard 无 continuity 块不报错');

  console.log(`\n✓ ${passed} 项自测全部通过`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
