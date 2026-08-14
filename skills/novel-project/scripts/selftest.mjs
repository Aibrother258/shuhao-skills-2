#!/usr/bin/env node
// novel-project 自测：不调模型、不花额度，只验确定性逻辑。
// 原则与仓库其他 skill 一致：每条契约都要有击穿用例——证明它真的会拦。

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SKILLS,
  loadProject,
  planBuild,
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
      { ep: 1, targetSeconds: 120, shots: [{ shotId: 'E01S001', ep: 1, sceneId: 'S01', lighting: '晨光', characters: ['C01', 'C02'], props: ['P01'], durationSec: 3, sourceBeat: { sceneNo: 1, beatNo: 1 }, refImagePaths: [] }] },
      { ep: 2, targetSeconds: 120, shots: [{ shotId: 'E02S001', ep: 2, sceneId: 'S01', lighting: '晨光', characters: ['C01'], props: [], durationSec: 3, sourceBeat: { sceneNo: 1, beatNo: 1 }, refImagePaths: [] }] },
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

  console.log(`\n✓ ${passed} 项自测全部通过`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
