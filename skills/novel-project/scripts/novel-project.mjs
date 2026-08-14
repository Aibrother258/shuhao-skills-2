#!/usr/bin/env node
// novel-project — 项目总控：把六个 skill 的 JSON 产物串成一条可追踪的产线。
// 零依赖，node >= 18 直接跑。核心价值是跨 skill 契约校验：
// 单层 skill 的 validate 只保证自己那份 JSON 合法，这里保证层与层之间对得上。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// 生产阶段（最小集，随适配器上线再扩展）。status 取值见 PROD_STATUS。
export const PROD_STAGES = ['storyboard', 'firstFrame', 'video', 'tts'];
export const PROD_STATUS = ['pending', 'ready', 'generated', 'passed', 'failed', 'blocked'];

// 失效传播：每个产物的上游依赖。某上游 hash 变了，下游产物就算"过期"。
export const UPSTREAM = {
  'novel-outline': [],
  'novel-characters': [],
  'novel-art': ['novel-outline'],
  'novel-script': ['novel-outline'],
  'novel-storyboard': ['novel-script', 'novel-outline', 'novel-art', 'novel-characters'],
};

// 从各 skill 的 SKILL.md frontmatter 读版本，单一事实源，不硬编码。
export function skillVersionOf(id) {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, '..', '..', id, 'SKILL.md'), 'utf8');
    const m = /^version:\s*["']?([0-9][^\s"']*)/m.exec(raw);
    return m ? m[1] : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// 幂等：每个产物文件算 sha256，作为失效传播的基础。
export function fileHash(abs) {
  try {
    const buf = readFileSync(abs);
    return createHash('sha256').update(buf).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

export const SKILLS = [
  { id: 'novel-characters', key: 'cast',       label: '角色设定', need: '小说原文' },
  { id: 'novel-outline',    key: 'outline',    label: '改编大纲', need: '小说原文' },
  { id: 'novel-art',        key: 'art',        label: '美术设定', need: 'outline.json' },
  { id: 'novel-script',     key: 'script',     label: '剧本',     need: 'outline.json' },
  { id: 'novel-storyboard', key: 'storyboard', label: '分镜表',   need: 'script.json' },
];

// build 的推进顺序：大纲/角色先出，美术吃大纲，剧本吃大纲，分镜吃剧本。
export const BUILD_ORDER = [
  'novel-outline',
  'novel-characters',
  'novel-art',
  'novel-script',
  'novel-storyboard',
];

export const STATUS = ['pending', 'passed', 'failed'];
const DURATION_TOLERANCE = 0.15;

export function templateProject(opts = {}) {
  return {
    projectId: opts.projectId || 'project-001',
    title: opts.title || '未命名项目',
    genre: opts.genre || '',
    lang: opts.lang || 'zh',
    episodes: Number(opts.episodes) || 6,
    episodeMinutes: Number(opts.episodeMinutes) || 2,
    source: opts.source || '',
    paths: {
      cast: '',
      outline: '',
      art: '',
      script: '',
      storyboard: '',
    },
    skills: {
      'novel-characters': 'pending',
      'novel-outline': 'pending',
      'novel-art': 'pending',
      'novel-script': 'pending',
      'novel-storyboard': 'pending',
    },
    // ── 失效传播 / 幂等（P0-2）──
    // versions：每层产物的文件 hash 与生成它的 skill 版本，供 build/status 判断"哪层过期、哪镜该重跑"。
    versions: {
      // 例： 'novel-storyboard': { hash: 'a1b2c3...', skillVersion: '1.3.0', generatedAt: '...' }
    },
    // ── 生产状态（P0-2，最小阶段集，随适配器上线再扩展）──
    // production.shots[shotId] = { storyboard, firstFrame, video, tts }，每项为 PROD_STATUS 之一。
    production: {
      shots: {},
    },
  };
}

/* ------------------------------------------------------------------ */
/* 基础设施                                                             */
/* ------------------------------------------------------------------ */

export function loadProject(projectPath) {
  const abs = resolve(projectPath);
  let raw;
  try {
    raw = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    throw new Error(`project.json 读不了或不是合法 JSON：${abs}（${e.message}）`);
  }
  const base = dirname(abs);
  const issues = [];
  for (const k of ['projectId', 'title']) {
    if (!raw[k] || typeof raw[k] !== 'string') {
      issues.push({ skill: 'project', level: 'error', msg: `project.json 缺顶层字段 ${k}` });
    }
  }
  for (const k of ['episodes', 'episodeMinutes']) {
    if (!Number.isInteger(Number(raw[k])) || Number(raw[k]) <= 0) {
      issues.push({ skill: 'project', level: 'error', msg: `${k} 必须是正整数（当前：${raw[k]}）` });
    }
  }
  if (raw.skills) {
    for (const s of SKILLS) {
      const v = raw.skills[s.id];
      if (v && !STATUS.includes(v)) {
        issues.push({ skill: 'project', level: 'error', msg: `skills.${s.id} 状态非法：${v}（应为 ${STATUS.join('/')}）` });
      }
    }
  }
  return { base, project: raw, issues };
}

export function projectFile(base, p) {
  if (!p) return null;
  return isAbsolute(p) ? p : join(base, p);
}

export function fileState(p) {
  if (!p) return 'missing';
  try {
    JSON.parse(readFileSync(p, 'utf8'));
    return 'present';
  } catch {
    return 'missing';
  }
}

export function readJson(rel, base, label) {
  const abs = projectFile(base, rel);
  if (!abs) return { abs: null, data: null };
  try {
    return { abs, data: JSON.parse(readFileSync(abs, 'utf8')) };
  } catch (e) {
    if (e.code === 'ENOENT') return { abs: null, data: null };
    throw new Error(`${label} 读不了或不是合法 JSON：${abs}（${e.message}）`);
  }
}

/* ------------------------------------------------------------------ */
/* 契约检查（每一条都只跨层，单层内部的事留给各 skill 自己的 validate）       */
/* ------------------------------------------------------------------ */

function uniqueIds(items, idFn, label) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const id = idFn(it);
    if (seen.has(id)) out.push(id);
    seen.add(id);
  }
  return out;
}

export function checkOutline(project, o, issues) {
  const n = project.episodes;
  if (!o.episodes || o.episodes.length !== n) {
    issues.push({ skill: 'novel-outline', level: 'error', msg: `集数不符：project=${n}，outline=${o.episodes ? o.episodes.length : '缺失'}` });
    return;
  }
  const eps = o.episodes;
  for (let i = 0; i < eps.length; i++) {
    if (eps[i].ep !== i + 1) {
      issues.push({ skill: 'novel-outline', level: 'error', msg: `第 ${i + 1} 条 ep.ep=${eps[i].ep}，应为 ${i + 1}` });
    }
  }
  const min = o.params && o.params.minutesPerEpisode;
  if (min != null && Number(min) !== project.episodeMinutes) {
    issues.push({ skill: 'novel-outline', level: 'warning', msg: `outline.params.minutesPerEpisode=${min} 与 project.episodeMinutes=${project.episodeMinutes} 不一致` });
  }
  const cs = o.characters || [];
  for (const id of uniqueIds(cs, (c) => c.id, 'outline.characters')) {
    issues.push({ skill: 'novel-outline', level: 'error', msg: `大纲角色 id 重复：${id}` });
  }
  for (const name of uniqueIds(cs, (c) => c.name, 'outline.characters')) {
    issues.push({ skill: 'novel-outline', level: 'error', msg: `大纲角色名重复：${name}` });
  }
  const scenes = o.scenes || [];
  const sceneIds = new Set(scenes.map((s) => s.id));
  const charIds = new Set(cs.map((c) => c.id));
  for (const ep of eps) {
    for (const sid of ep.sceneIds || []) {
      if (!sceneIds.has(sid)) {
        issues.push({ skill: 'novel-outline', level: 'error', msg: `第 ${ep.ep} 集引用场景 ${sid} 不在 outline.scenes 里` });
      }
    }
    for (const cid of ep.characterIds || []) {
      if (!charIds.has(cid)) {
        issues.push({ skill: 'novel-outline', level: 'error', msg: `第 ${ep.ep} 集引用角色 ${cid} 不在 outline.characters 里` });
      }
    }
  }
}

export function checkCast(project, c, outline, issues) {
  if (!c.characters || !c.characters.length) {
    issues.push({ skill: 'novel-characters', level: 'error', msg: 'cast.characters 为空' });
    return;
  }
  for (const name of uniqueIds(c.characters, (x) => x.name, 'cast.characters')) {
    issues.push({ skill: 'novel-characters', level: 'error', msg: `角色名重复：${name}` });
  }
  if (outline) {
    const castNames = new Set();
    for (const ch of c.characters) {
      castNames.add(ch.name);
      for (const a of ch.aliases || []) castNames.add(a);
    }
    for (const oc of outline.characters || []) {
      if (!castNames.has(oc.name)) {
        issues.push({
          skill: 'novel-characters', level: 'warning',
          msg: `大纲角色「${oc.name}」（${oc.id}）不在 cast 里——可能是功能角色没入选前 N 位，确认下是否需要`,
        });
      }
    }
  }
}

export function checkArt(project, a, outline, issues) {
  const scenes = a.scenes || [];
  if (!scenes.length) {
    issues.push({ skill: 'novel-art', level: 'error', msg: 'art.scenes 为空' });
  }
  for (const id of uniqueIds(scenes, (s) => s.id, 'art.scenes')) {
    issues.push({ skill: 'novel-art', level: 'error', msg: `场景 id 重复：${id}` });
  }
  for (const id of uniqueIds(a.props || [], (p) => p.id, 'art.props')) {
    issues.push({ skill: 'novel-art', level: 'error', msg: `道具 id 重复：${id}` });
  }
  if (outline) {
    const outIds = new Set((outline.scenes || []).map((s) => s.id));
    for (const sc of scenes) {
      if (!outIds.has(sc.id)) {
        issues.push({ skill: 'novel-art', level: 'warning', msg: `美术场景 ${sc.id}（${sc.name}）不在 outline.scenes 里——是变体场景吗？` });
      }
    }
    for (const os of outline.scenes || []) {
      if (!scenes.some((s) => s.id === os.id)) {
        issues.push({ skill: 'novel-art', level: 'warning', msg: `大纲主场景 ${os.id}（${os.name}）在美术设定里没覆盖` });
      }
    }
    const propSceneIds = new Set(scenes.map((s) => s.id));
    for (const p of a.props || []) {
      for (const rs of p.relatedScenes || []) {
        if (!propSceneIds.has(rs)) {
          issues.push({ skill: 'novel-art', level: 'warning', msg: `道具 ${p.id}（${p.name}）的 relatedScenes 引用了不存在的场景 ${rs}` });
        }
      }
    }
  }
}

export function checkScript(project, s, outline, art, issues) {
  const n = project.episodes;
  if (!s.episodes || s.episodes.length !== n) {
    issues.push({ skill: 'novel-script', level: 'error', msg: `集数不符：project=${n}，script=${s.episodes ? s.episodes.length : '缺失'}` });
    return;
  }
  const target = project.episodeMinutes * 60;
  const artScenes = new Map((art ? art.scenes : []).map((x) => [x.id, x]));
  const outlineScenes = new Set((outline ? outline.scenes : []).map((x) => x.id));
  const outlineChars = new Map((outline ? outline.characters : []).map((x) => [x.id, x.name]));
  const artProps = new Set((art ? art.props : []).map((x) => x.id));
  for (const ep of s.episodes) {
    if (Number(ep.targetSeconds) !== target) {
      issues.push({
        skill: 'novel-script', level: 'error',
        msg: `第 ${ep.ep} 集 targetSeconds=${ep.targetSeconds}，应为 ${target}（${project.episodeMinutes} 分钟 × 60）`,
      });
    }
    for (const sc of ep.scenes || []) {
      const sid = sc.sceneId;
      if (artScenes.size && !artScenes.has(sid)) {
        issues.push({ skill: 'novel-script', level: 'error', msg: `第 ${ep.ep} 集场景 ${sid} 不在 art.scenes 里` });
      } else if (artScenes.size && artScenes.has(sid)) {
        const states = (artScenes.get(sid).lighting || []).map((l) => l.state);
        if (sc.lighting) {
          if (!states.includes(sc.lighting)) {
            issues.push({ skill: 'novel-script', level: 'error', msg: `第 ${ep.ep} 集 ${sid} 光照「${sc.lighting}」不在美术登记的 [${states.join(' / ')}] 里` });
          }
        } else if (states.length) {
          issues.push({ skill: 'novel-script', level: 'warning', msg: `第 ${ep.ep} 集 ${sid} 没写光照状态，美术里可用 [${states.join(' / ')}]` });
        }
      }
      if (outlineScenes.size && !outlineScenes.has(sid)) {
        issues.push({ skill: 'novel-script', level: 'error', msg: `第 ${ep.ep} 集场景 ${sid} 不在 outline.scenes 里` });
      }
      for (const cid of sc.characters || []) {
        if (outlineChars.size && !outlineChars.has(cid)) {
          issues.push({ skill: 'novel-script', level: 'error', msg: `第 ${ep.ep} 集 ${sid} 引用角色 ${cid} 不在大纲里` });
        }
      }
      for (const pid of sc.props || []) {
        if (artProps.size && !artProps.has(pid)) {
          issues.push({ skill: 'novel-script', level: 'error', msg: `第 ${ep.ep} 集 ${sid} 引用道具 ${pid} 不在 art.props 里` });
        }
      }
    }
  }
}

export function checkStoryboard(project, b, script, art, cast, outline, issues) {
  const n = project.episodes;
  if (!b.episodes || b.episodes.length !== n) {
    issues.push({ skill: 'novel-storyboard', level: 'error', msg: `集数不符：project=${n}，storyboard=${b.episodes ? b.episodes.length : '缺失'}` });
    return;
  }
  const artScenes = new Map((art ? art.scenes : []).map((x) => [x.id, x]));
  const artProps = new Set((art ? art.props : []).map((x) => x.id));
  const outlineChars = new Map((outline ? outline.characters : []).map((x) => [x.id, x.name]));
  const scriptByEp = new Map();
  for (const ep of (script ? script.episodes : [])) {
    scriptByEp.set(ep.ep, new Map((ep.scenes || []).map((sc) => [sc.sceneId, sc])));
  }
  const castNames = new Set();
  if (cast) {
    for (const ch of cast.characters || []) {
      castNames.add(ch.name);
      for (const a of ch.aliases || []) castNames.add(a);
    }
  }
  const seenShots = new Set();
  const placeholderRefs = new Set();
  const missingCast = new Map();
  for (const ep of b.episodes) {
    const shots = ep.shots || [];
    if (!shots.length) {
      issues.push({ skill: 'novel-storyboard', level: 'error', msg: `第 ${ep.ep} 集没有镜头` });
      continue;
    }
    const sceneMap = scriptByEp.get(ep.ep);
    let total = 0;
    for (const sh of shots) {
      if (seenShots.has(sh.shotId)) {
        issues.push({ skill: 'novel-storyboard', level: 'error', msg: `shotId 重复：${sh.shotId}` });
      }
      seenShots.add(sh.shotId);
      total += Number(sh.durationSec) || 0;
      if (artScenes.size) {
        if (!artScenes.has(sh.sceneId)) {
          issues.push({ skill: 'novel-storyboard', level: 'error', msg: `${sh.shotId} 场景 ${sh.sceneId} 不在 art.scenes 里` });
        } else {
          const states = (artScenes.get(sh.sceneId).lighting || []).map((l) => l.state);
          if (sh.lighting && !states.includes(sh.lighting)) {
            issues.push({ skill: 'novel-storyboard', level: 'error', msg: `${sh.shotId} 光照「${sh.lighting}」不在 ${sh.sceneId} 美术登记的 [${states.join(' / ')}] 里` });
          }
        }
      }
      const sc = sceneMap && sceneMap.get(sh.sceneId);
      if (sceneMap && !sc) {
        issues.push({ skill: 'novel-storyboard', level: 'error', msg: `${sh.shotId} 场景 ${sh.sceneId} 不在剧本第 ${ep.ep} 集里` });
      }
      if (sc && sc.lighting && sh.lighting && sc.lighting !== sh.lighting) {
        issues.push({ skill: 'novel-storyboard', level: 'warning', msg: `${sh.shotId} 光照「${sh.lighting}」与剧本该场「${sc.lighting}」不一致` });
      }
      for (const cid of sh.characters || []) {
        if (sc && !(sc.characters || []).includes(cid)) {
          issues.push({ skill: 'novel-storyboard', level: 'error', msg: `${sh.shotId} 角色 ${cid} 不在剧本该场角色里` });
        }
        const name = outlineChars.get(cid);
        if (castNames.size && name && !castNames.has(name)) {
          missingCast.set(name, (missingCast.get(name) || 0) + 1);
        }
      }
      for (const pid of sh.props || []) {
        if (artProps.size && !artProps.has(pid)) {
          issues.push({ skill: 'novel-storyboard', level: 'error', msg: `${sh.shotId} 道具 ${pid} 不在 art.props 里` });
        }
        if (sc && !(sc.props || []).includes(pid)) {
          issues.push({ skill: 'novel-storyboard', level: 'warning', msg: `${sh.shotId} 道具 ${pid} 剧本该场没登记` });
        }
      }
      const refs = sh.refImagePaths || [];
      for (const r of refs) {
        const m = /【角色图:([^】]+)】/.exec(r);
        if (m) placeholderRefs.add(m[1]);
      }
    }
    const target = Number(ep.targetSeconds);
    if (target) {
      const lo = target * (1 - DURATION_TOLERANCE);
      const hi = target * (1 + DURATION_TOLERANCE);
      if (total < lo || total > hi) {
        issues.push({ skill: 'novel-storyboard', level: 'warning', msg: `第 ${ep.ep} 集分镜总时长 ${total.toFixed(1)}s 超出剧本目标 ${target}s ±${DURATION_TOLERANCE * 100}%` });
      }
    }
  }
  if (placeholderRefs.size) {
    const names = [...placeholderRefs].slice(0, 8).join('、');
    const extra = placeholderRefs.size > 8 ? ` 等 ${placeholderRefs.size} 个角色` : '';
    issues.push({
      skill: 'novel-storyboard', level: 'warning',
      msg: `${placeholderRefs.size} 个角色的参考图还是占位符（涉及：${names}${extra}），出图前先补 cast 里 image.portrait（干净单视角参考图，优先）或 image.path`,
    });
  }
  for (const [name, count] of missingCast) {
    issues.push({
      skill: 'novel-storyboard', level: 'warning',
      msg: `角色「${name}」在 ${count} 个镜头里出场，但没有对应的角色设定图/设定卡——功能角色可接受，主角/配角请回 novel-characters 补卡`,
    });
  }
}

// P0-1 + P0-3：跨镜连续性状态机校验。
// · 引用图真实路径（非占位符）必须文件存在，否则首帧出图会断链（相对 project.json 所在目录解析）。
// · 相邻镜同一角色：服装 wardrobe 跳变（穿帮）告警——只在同一集内比，跨集换装不算穿帮。
// · 相邻镜同一道具：状态 state 突变告警（提示核对是否有承接动作节拍）——同集同场才比。
// · 场景光照突变告警——只在同场（sceneId 相同）内比，换场/换集的光照变化是合法的。
// 说明：P0 阶段对"状态机合法转移"只做突变告警，不强制枚举，交由人工在 seed 后精修 continuity 块。
export function checkContinuity(project, base, b, issues) {
  // P0-1：引用图文件存在性（仅当为真实路径、非占位符时检查）
  const PLACEHOLDER = /【角色图:/;
  const missingFiles = new Set();
  for (const ep of b.episodes || []) {
    for (const sh of ep.shots || []) {
      for (const r of sh.refImagePaths || []) {
        if (!r || PLACEHOLDER.test(r)) continue; // 占位符由 checkStoryboard 单独报
        const abs = isAbsolute(r) ? r : join(base, r);
        try {
          readFileSync(abs);
        } catch {
          missingFiles.add(r);
        }
      }
    }
  }
  if (missingFiles.size) {
    issues.push({
      skill: 'novel-project', level: 'warning',
      msg: `角色参考图文件缺失，首帧出图将断链：${[...missingFiles].slice(0, 6).join('、')}${missingFiles.size > 6 ? ` 等 ${missingFiles.size} 个` : ''}`,
    });
  }
  // P0-3：把所有集的 shots 拍平成按顺序排列的镜头序列，再比对相邻镜连续性状态块
  const seq = [];
  for (const ep of b.episodes || []) {
    for (const sh of ep.shots || []) seq.push(sh);
  }
  for (let i = 1; i < seq.length; i++) {
    const prev = seq[i - 1];
    const cur = seq[i];
    const pc = prev.continuity, cc = cur.continuity;
    if (!pc || !cc) continue;
    if (prev.ep !== cur.ep) continue; // 跨集不比：换集换装/换场都是合法的
    // 角色服装跳变（同集内）
    for (const cid of Object.keys(cc.characters || {})) {
      const pch = (pc.characters || {})[cid];
      if (!pch) continue;
      const pw = (pch.wardrobe || '').trim();
      const cw = (cc.characters[cid].wardrobe || '').trim();
      if (pw && cw && pw !== cw) {
        issues.push({
          skill: 'novel-storyboard', level: 'warning',
          msg: `连续性：角色 ${cid} 服装在 ${prev.shotId}→${cur.shotId} 跳变（${pw}→${cw}），无换装节拍，疑似穿帮`,
        });
      }
    }
    // 道具状态突变（同集同场）
    if (prev.sceneId === cur.sceneId) {
      for (const pid of Object.keys(cc.props || {})) {
        const pp = (pc.props || {})[pid];
        if (!pp) continue;
        const ps = (pp.state || '').trim();
        const cs = (cc.props[pid].state || '').trim();
        if (ps && cs && ps !== cs) {
          issues.push({
            skill: 'novel-storyboard', level: 'warning',
            msg: `连续性：道具 ${pid} 状态在 ${prev.shotId}→${cur.shotId} 突变（${ps}→${cs}），请确认两镜之间有承接动作节拍`,
          });
        }
      }
    }
    // 场景光照突变（仅同场）
    if (prev.sceneId === cur.sceneId) {
      const pl = (pc.scene && pc.scene.lighting || '').trim();
      const cl = (cc.scene && cc.scene.lighting || '').trim();
      if (pl && cl && pl !== cl) {
        issues.push({
          skill: 'novel-storyboard', level: 'warning',
          msg: `连续性：场景光照在 ${prev.shotId}→${cur.shotId} 突变（${pl}→${cl}），确认是同一场内的合理变化`,
        });
      }
    }
  }
  // 完整性：continuity 块存在但全是骨架（wardrobe/emotion/position 未填）→ 检查实际未生效
  let withBlock = 0;
  let allSkeleton = 0;
  for (const sh of seq) {
    const c = sh.continuity;
    if (!c) continue;
    withBlock += 1;
    const filled = Object.values(c.characters || {})
      .some((v) => (v.wardrobe || '').trim() || (v.emotion || '').trim() || (v.position || '').trim());
    if (!filled) allSkeleton += 1;
  }
  if (withBlock && allSkeleton === withBlock) {
    issues.push({
      skill: 'novel-project', level: 'warning',
      msg: 'continuity 块全是 seed 骨架（wardrobe/emotion/position 未填），跨镜连续性检查未生效——请在 storyboard 里逐镜补状态后重跑 verify',
    });
  }
}

// 失效传播记录：把各产物当前 hash + 上游 hash + 生成 skill 版本写进 project.versions。
// 有上游过期的层不覆盖记录——否则 warning 会被 --write 静默吞掉，等于把"该重跑"藏起来。
export function recordVersions(project, loaded, staleSkills) {
  const versions = project.versions || (project.versions = {});
  for (const s of SKILLS) {
    const { abs } = loaded[s.id];
    if (!abs || !fileHash(abs)) continue;
    if (staleSkills.has(s.id)) continue; // 上游已变，保留旧记录直到真正重新生成
    const inputs = {};
    for (const up of UPSTREAM[s.id]) {
      const upAbs = loaded[up] && loaded[up].abs;
      if (upAbs) inputs[up] = fileHash(upAbs);
    }
    versions[s.id] = {
      hash: fileHash(abs),
      skillVersion: skillVersionOf(s.id),
      generatedAt: new Date().toISOString(),
      inputs,
    };
  }
  return versions;
}

// 找"上游已变但本层没重跑"的过期产物（失效传播的核心）。
export function staleArtifacts(project, loaded) {
  const stale = new Set();
  for (const s of SKILLS) {
    const { abs } = loaded[s.id];
    if (!abs) continue;
    const rec = project.versions && project.versions[s.id];
    if (!rec || !rec.inputs) continue;
    for (const up of UPSTREAM[s.id]) {
      const upAbs = loaded[up] && loaded[up].abs;
      if (!upAbs) continue;
      const recorded = rec.inputs[up];
      const cur = fileHash(upAbs);
      if (recorded && cur && recorded !== cur) stale.add(s.id);
    }
  }
  return stale;
}

/* ------------------------------------------------------------------ */
/* 汇总                                                                 */
/* ------------------------------------------------------------------ */

export function verifyProject(projectPath) {
  const { base, project, issues } = loadProject(projectPath);
  const loaded = {};
  for (const s of SKILLS) {
    const rel = project.paths && project.paths[s.key];
    const { abs, data } = readJson(rel, base, s.label);
    loaded[s.id] = { abs, data };
    if (!abs || !data) {
      issues.push({ skill: s.id, level: 'warning', msg: `缺 ${s.label} 产物（paths.${s.key} 未配置或文件不存在）` });
    }
  }
  const outline = loaded['novel-outline'];
  const cast = loaded['novel-characters'];
  const art = loaded['novel-art'];
  const script = loaded['novel-script'];
  const storyboard = loaded['novel-storyboard'];
  if (outline.data) checkOutline(project, outline.data, issues);
  if (cast.data) checkCast(project, cast.data, outline.data, issues);
  if (art.data) checkArt(project, art.data, outline.data, issues);
  if (script.data) checkScript(project, script.data, outline.data, art.data, issues);
  if (storyboard.data) checkStoryboard(project, storyboard.data, script.data, art.data, cast.data, outline.data, issues);
  if (storyboard.data) checkContinuity(project, base, storyboard.data, issues);
  // P0-2 失效传播：上游 hash 变了但本层没重跑 → 过期
  for (const id of staleArtifacts(project, loaded)) {
    const s = SKILLS.find((x) => x.id === id);
    const rec = project.versions && project.versions[id];
    const ups = UPSTREAM[id].filter((u) => {
      const upAbs = loaded[u] && loaded[u].abs;
      return upAbs && rec && rec.inputs && rec.inputs[u] && rec.inputs[u] !== fileHash(upAbs);
    });
    issues.push({
      skill: id, level: 'warning',
      msg: `上游已变更（${ups.map((u) => u).join('、')}），${s.label} 产物可能过期——请重新生成后重跑 verify`,
    });
  }
  // P0-2 生产状态初始化：storyboard 存在时，为每个 shot 建最小阶段状态（缺省 pending）
  if (storyboard.data && Array.isArray(storyboard.data.episodes)) {
    if (!project.production) project.production = { shots: {} };
    if (!project.production.shots) project.production.shots = {};
    const sbErrs = issues.filter((i) => i.skill === 'novel-storyboard' && i.level === 'error');
    for (const ep of storyboard.data.episodes) {
      for (const sh of ep.shots || []) {
        if (!project.production.shots[sh.shotId]) {
          const st = {};
          for (const stage of PROD_STAGES) st[stage] = stage === 'storyboard' ? (sbErrs.length ? 'failed' : 'passed') : 'pending';
          project.production.shots[sh.shotId] = st;
        }
      }
    }
  }
  return { base, project, issues, loaded };
}

export function planBuild(projectPath) {
  const { base, project, issues } = loadProject(projectPath);
  const present = new Set();
  for (const s of SKILLS) {
    const rel = project.paths && project.paths[s.key];
    const abs = projectFile(base, rel);
    let ok = false;
    if (abs) {
      try {
        JSON.parse(readFileSync(abs, 'utf8'));
        ok = true;
      } catch { /* 缺失或坏 JSON 都当没跑 */ }
    }
    if (ok) present.add(s.id);
  }
  const missing = BUILD_ORDER.filter((id) => !present.has(id));
  return { project, issues, present, missing };
}

export function summary(issues) {
  const errs = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warning');
  return { errs, warns };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function logIssue(i) {
  const mark = i.level === 'error' ? '✗' : '⚠';
  console.log(`  ${mark} [${i.skill}] ${i.msg}`);
}

function printVerify(issues) {
  const { errs, warns } = summary(issues);
  const bySkill = new Map();
  for (const i of [...errs, ...warns]) {
    if (!bySkill.has(i.skill)) bySkill.set(i.skill, []);
    bySkill.get(i.skill).push(i);
  }
  if (!issues.length) {
    console.log('✓ 跨 skill 契约全部通过');
    return;
  }
  for (const [skill, list] of bySkill) {
    console.log(`${list.some((i) => i.level === 'error') ? '✗' : '⚠'} ${skill}`);
    for (const i of list) logIssue(i);
  }
  console.log(`\n结果：错误 ${errs.length} / 警告 ${warns.length}`);
}

function cmdInit(args) {
  const dir = args[0];
  if (!dir) {
    console.error('用法：node novel-project.mjs init <目录> --title <标题> --episodes <集数> [--minutes <单集分钟>] [--lang <zh|en>] [--genre <题材>] [--source <原文路径>]');
    process.exit(1);
  }
  const opts = {};
  for (let i = 1; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--title') opts.title = process.argv[++i];
    if (a === '--episodes') opts.episodes = process.argv[++i];
    if (a === '--minutes') opts.episodeMinutes = process.argv[++i];
    if (a === '--lang') opts.lang = process.argv[++i];
    if (a === '--genre') opts.genre = process.argv[++i];
    if (a === '--source') opts.source = process.argv[++i];
  }
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'project.json');
  const p = templateProject(opts);
  writeFileSync(out, JSON.stringify(p, null, 2) + '\n');
  console.log(`✓ 已创建 ${out}`);
  console.log('下一步：node novel-project.mjs status <project.json> 看状态，或直接开跑第一个 skill。');
}

function cmdStatus(projectPath, opts) {
  const { base, project, issues } = loadProject(projectPath);
  console.log(`# ${project.title}（${project.projectId}）${project.episodes} 集 × ${project.episodeMinutes} 分钟`);
  for (const s of SKILLS) {
    const rel = project.paths && project.paths[s.key];
    const abs = projectFile(base, rel);
    const exists = abs ? fileState(abs) === 'present' : false;
    const recorded = (project.skills && project.skills[s.id]) || 'pending';
    const mark = exists ? '✓' : '—';
    console.log(`  ${mark} ${s.label}（${s.id}） 文件${exists ? '已就位' : '缺失'} · 记录状态 ${recorded}`);
  }
  // ── P0-2 生产进度（每镜最小阶段状态机）──
  const shots = (project.production && project.production.shots) || {};
  const shotIds = Object.keys(shots);
  if (shotIds.length) {
    console.log('\n生产进度（每镜最小阶段）：');
    for (const stage of PROD_STAGES) {
      let done = 0;
      for (const id of shotIds) {
        const st = shots[id][stage];
        if (st === 'passed' || st === 'generated' || st === 'ready') done++;
      }
      const pct = Math.round((done / shotIds.length) * 100);
      const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
      console.log(`  ${stage.padEnd(12)} ${bar} ${pct}%  (${done}/${shotIds.length})`);
    }
    const blocked = [];
    for (const id of shotIds) {
      for (const stage of PROD_STAGES) {
        const st = shots[id][stage];
        if (st === 'failed' || st === 'blocked') blocked.push(`${id}:${stage}=${st}`);
      }
    }
    if (blocked.length) {
      console.log(`\n阻塞（需人工处理）：\n  ${blocked.slice(0, 12).join('\n  ')}${blocked.length > 12 ? `\n  …共 ${blocked.length} 项` : ''}`);
    }
  }
  if (opts.verify) {
    const v = verifyProject(projectPath);
    console.log('\n契约：');
    printVerify(v.issues);
  }
}

function cmdVerify(projectPath, opts) {
  const v = verifyProject(projectPath);
  printVerify(v.issues);
  const { errs } = summary(v.issues);
  if (opts.write) {
    const stale = staleArtifacts(v.project, v.loaded);
    const next = {};
    for (const s of SKILLS) {
      const rel = v.project.paths && v.project.paths[s.key];
      const abs = projectFile(v.base, rel);
      const exists = abs ? fileState(abs) === 'present' : false;
      const skillErrs = errs.filter((i) => i.skill === s.id);
      next[s.id] = !exists ? 'pending' : skillErrs.length ? 'failed' : 'passed';
    }
    v.project.skills = next;
    recordVersions(v.project, v.loaded, stale);
    if (stale.size) {
      console.log(`⚠ 以下层上游已变更，versions 记录保留旧值，等重新生成后再 --write：${[...stale].join('、')}`);
    }
    writeFileSync(resolve(projectPath), JSON.stringify(v.project, null, 2) + '\n');
    console.log(`✓ 已把状态与 versions 回写到 ${projectPath}`);
  }
  process.exit(errs.length ? 1 : 0);
}

function cmdBuild(projectPath, opts) {
  const { project, issues, missing } = planBuild(projectPath);
  console.log(`# ${project.title}（${project.projectId}）`);
  if (missing.length) {
    for (const id of missing) {
      const s = SKILLS.find((x) => x.id === id);
      console.log(`→ 下一步：${s.label}（${s.id}）— 还没产出，需要 ${s.need}；按 skills/${id}/SKILL.md 从 Step 0 跑`);
    }
    if (!opts.all) {
      console.log(`\n共缺 ${missing.length} 层。加 --all 看全量计划；跑完一层后重跑 build 会自动推进。`);
    }
    return;
  }
  console.log('✓ 五份产物都在，跑跨层契约校验：');
  const v = verifyProject(projectPath);
  printVerify(v.issues);
  const { errs } = summary(v.issues);
  if (errs.length) {
    console.log('\n资产齐了但契约有错——先修再出片，别带病往下游走。');
    process.exit(1);
  }
  const stale = staleArtifacts(v.project, v.loaded);
  recordVersions(v.project, v.loaded, stale);
  writeFileSync(resolve(projectPath), JSON.stringify(v.project, null, 2) + '\n');
  if (stale.size) {
    console.log(`⚠ 以下层上游已变更，versions 保留旧记录：${[...stale].join('、')}——先重新生成再 build`);
  } else {
    console.log('✓ 已把 versions（上游 hash + 生成 skill 版本）写回 project.json');
  }
  console.log('\n✅ 全部就绪：角色 → 大纲 → 美术 → 剧本 → 分镜 契约一致，可以往下游出图/出视频了。');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const [, , cmd, ...rest] = process.argv;
  const opts = {};
  for (const a of rest) {
    if (a === '--write') opts.write = true;
    if (a === '--verify') opts.verify = true;
    if (a === '--all') opts.all = true;
  }

  const pathArg = rest.find((a) => !a.startsWith('-'));

  try {
    if (cmd === 'init') {
      cmdInit(rest.filter((a) => !a.startsWith('-')));
    } else if (cmd === 'status') {
      if (!pathArg) throw new Error('用法：node novel-project.mjs status <project.json>');
      cmdStatus(pathArg, opts);
    } else if (cmd === 'verify') {
      if (!pathArg) throw new Error('用法：node novel-project.mjs verify <project.json> [--write]');
      cmdVerify(pathArg, opts);
    } else if (cmd === 'build') {
      if (!pathArg) throw new Error('用法：node novel-project.mjs build <project.json> [--all]');
      cmdBuild(pathArg, opts);
    } else {
      console.error(`未知命令 ${cmd || ''}。可用：init / status / verify / build`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
