#!/usr/bin/env node
'use strict';
// novel-storyboard — 把剧本(script.json)拆成可生成的分镜表
// 消费上游：novel-script(script.json) / novel-art(art.json) / novel-characters(cast.json) / novel-outline(outline.json)
// 产出：<书名>-storyboard.json + 渲染报告(MD/HTML)
// 零依赖、零 API key。所有约束由脚本确定性检查，不靠模型自觉。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCRIPT_VERSION = '1.0.0';

// ── 可调参数 ──────────────────────────────────────────────
const DEFAULT_PARAMS = {
  charsPerSecond: 4.5,   // 台词行语速（字/秒）
  actionSeconds: 2.5,    // 单条动作节拍基础时长
  tolerance: 0.15,       // 单集预估时长相对 script 目标时长的容差
  shotSecondsFloor: 1.5, // 单镜最短秒数
  shotSecondsCap: 10,    // 单镜最长秒数
  splitSecondsFloor: 1.0, // split 子镜下限（更低，允许把短动作拍拆开；G4 对 split 镜用此值）
  style: 'semi-realistic', // 美术风格（与 art.json 对齐）
  // ── H3 (MiniMax H3) 视频提示词相关 ──
  promptFormat: 'h3',    // 'h3' = 生成 H3 结构化视频提示词；'legacy' = 仅首帧图生提示词
  h3Mode: 'i2va',        // 'i2va' = 首帧图+角色参考图驱动(图生视频，可抽卡)；'t2va' = 纯文生视频
  h3Style: 'Live-action, cinematic',
  h3Music: 'A soft, understated background score at a slow tempo that supports the scene mood.'
};

function paramsOf(doc) {
  return { ...DEFAULT_PARAMS, ...(doc && doc.params ? doc.params : {}) };
}

// ── 小工具 ────────────────────────────────────────────────
const CJK = /[㐀-鿿]/;
function hasCJK(s) { return s ? CJK.test(String(s)) : false; }
function lineChars(s) { return s ? String(s).replace(/\s+/g, '').length : 0; }
function getJSON(p) { return JSON.parse(readFileSync(p, 'utf8')); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function slugify(s) {
  return String(s || '').trim().replace(/[^\w一-龥]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'story';
}
function fmtSec(s) { return (Math.round((s || 0) * 10) / 10).toFixed(1); }
function pad(n, w) { return String(n).padStart(w, '0'); }

const SHOT_TYPES = ['全景', '远景', '中景', '近景', '特写', '过肩', '主观', '空镜'];
const SHOT_TYPES_EN = { '全景': 'wide shot', '远景': 'establishing shot', '中景': 'medium shot', '近景': 'close-up', '特写': 'extreme close-up', '过肩': 'over-the-shoulder shot', '主观': 'POV shot', '空镜': 'empty establishing shot' };
const CROWD_KEYWORDS = ['人群', '多人', 'crowd', 'crowds', 'a crowd', 'many people'];

// H3 运镜词表：把中文机位映射到 H3 的 camera motion 描述
const CAMERA_H3 = {
  '固定机位': 'The camera holds a static shot.',
  '固定': 'The camera holds a static shot.',
  '推': 'The camera pushes in with small amplitude at slow speed.',
  '推近': 'The camera pushes in with small amplitude at slow speed.',
  '推入': 'The camera pushes in with small amplitude at slow speed.',
  '拉': 'The camera pulls out with small amplitude at slow speed.',
  '拉远': 'The camera pulls out with small amplitude at slow speed.',
  '拉出': 'The camera pulls out with small amplitude at slow speed.',
  '摇': 'The camera pans right with small amplitude at slow speed.',
  '横摇': 'The camera pans right with small amplitude at slow speed.',
  '移': 'The camera tracks the subject with small amplitude at slow speed.',
  '跟': 'The camera tracks the subject with small amplitude at slow speed.',
  '跟拍': 'The camera tracks the subject with small amplitude at slow speed.',
  '升': 'The camera pedestals up with small amplitude at slow speed.',
  '降': 'The camera pedestals down with small amplitude at slow speed.',
  '环绕': 'The camera arcs around the subject with small amplitude at slow speed.',
  '手持': 'The camera moves with a subtle handheld drift.'
};

// 动作文本 → 环境音效（overall_soundscape 启发式）
const SFX_HINTS = [
  ['脚步', 'soft footsteps on the ground'],
  ['门', 'a door creaks and clicks shut'],
  ['水', 'water drips steadily'],
  ['雨', 'rain taps against the windows'],
  ['风', 'wind passes through the space'],
  ['火', 'a fire crackles'],
  ['碗', 'chopsticks tap against a bowl'],
  ['笑', 'a faint laugh slips out'],
  ['哭', 'a choked sob'],
  ['船', 'the ferry horn sounds in the distance'],
  ['车', 'a car engine idles'],
  ['电话', 'a phone rings'],
  ['钟', 'a distant bell tolls'],
  ['雷', 'thunder rolls overhead']
];

// H3 规范：括号内的中文台词关键词，用于锁定 CJK 检查豁免
const H3_DIALOGUE_RE = /<d>\[Chinese\][\s\S]*?<\/d>/g;

// ── 构建上游上下文（用于 seed autofill 与对账类质量门）─────────
function buildContext({ script, outline, art, cast }) {
  const ctx = { script: null, outline: null, art: null, cast: null };
  if (script && existsSync(script)) ctx.script = getJSON(script);
  if (outline && existsSync(outline)) ctx.outline = getJSON(outline);
  if (art && existsSync(art)) ctx.art = getJSON(art);
  if (cast && existsSync(cast)) ctx.cast = getJSON(cast);

  // C-id → 角色名（来自 outline）
  ctx.cidToName = {};
  if (ctx.outline && Array.isArray(ctx.outline.characters)) {
    for (const c of ctx.outline.characters) ctx.cidToName[c.id] = c.name;
  }
  // 角色名 → cast.json 形象提示词
  ctx.nameToCast = {};
  if (ctx.cast && Array.isArray(ctx.cast.characters)) {
    for (const c of ctx.cast.characters) ctx.nameToCast[c.name] = c;
  }
  // sceneId → { name, lighting:[{state,prompt}], image.negativePrompt }（来自 art）
  ctx.sceneMap = {};
  if (ctx.art && Array.isArray(ctx.art.scenes)) {
    for (const s of ctx.art.scenes) {
      const lighting = Array.isArray(s.lighting) ? s.lighting.map(l => ({ state: l.state, prompt: l.prompt })) : [];
      ctx.sceneMap[s.id] = {
        name: s.name,
        lighting,
        negativePrompt: s.image && s.image.negativePrompt ? s.image.negativePrompt : null
      };
    }
  }
  // propId → [{state,prompt}]（来自 art）
  ctx.propMap = {};
  if (ctx.art && Array.isArray(ctx.art.props)) {
    for (const p of ctx.art.props) {
      const states = Array.isArray(p.states) ? p.states.map(st => ({ state: st.state, prompt: st.prompt })) : [];
      ctx.propMap[p.id] = { name: p.name, states };
    }
  }
  return ctx;
}

// ── 从剧本拆镜 ────────────────────────────────────────────
// 每个 beat（动作节拍 / 台词行 / 心声）→ 一条 shot。
function deriveShotsFromScript(script, { ctx, autofill, params }) {
  const episodes = [];
  const batchKey2Id = new Map();
  let batchCounter = 0;

  function nextBatch(sceneId, lighting) {
    const key = `${sceneId}__${lighting}`;
    if (!batchKey2Id.has(key)) {
      batchCounter += 1;
      batchKey2Id.set(key, `B${batchCounter}`);
    }
    return batchKey2Id.get(key);
  }

  // 光照优先级：剧本该场指定（且美术已登记）> 美术场景第一个状态 > '默认'
  function resolveLighting(sceneId, scriptLighting) {
    const sm = ctx.sceneMap[sceneId];
    if (!sm || !sm.lighting.length) return '默认';
    if (scriptLighting && sm.lighting.some((l) => l.state === scriptLighting)) return scriptLighting;
    return sm.lighting[0].state;
  }

  for (const ep of script.episodes || []) {
    const shots = [];
    let shotSeq = 0;

    // 本集角色出场顺序 → 稳定 speaker ID (S1, S2...)（H3 要求跨镜头稳定）
    const epCharOrder = [];
    for (const scene of ep.scenes || []) for (const c of (scene.characters || [])) if (!epCharOrder.includes(c)) epCharOrder.push(c);
    const epSpeakerMap = new Map(epCharOrder.map((c, i) => [c, `(S${i + 1})`]));

    for (const scene of ep.scenes || []) {
      const sceneId = scene.sceneId || scene.id;
      const sceneChars = scene.characters || [];
      const flow = scene.flow || [];

      flow.forEach((beat, beatIndex) => {
        // 剧本 beat 无顶层 kind 字段：action/line/vo 由存在字段推断
        const kind = (beat.kind === 'vo' || beat.kind === 'voiceover') ? 'vo'
          : (beat.action != null ? 'action' : 'dialogue');
        shotSeq += 1;
        const shotId = `E${pad(ep.ep, 2)}S${pad(shotSeq, 3)}`;

        // 时长沙盘：动作节拍=基础秒数；台词/心声=字数/语速（与 novel-script 同模型，确保单集时长贴合）
        let dur;
        if (kind === 'action') dur = params.actionSeconds;
        else dur = Math.max(params.shotSecondsFloor, Math.ceil((lineChars(beat.line) / params.charsPerSecond) * 10) / 10);

        // 景别默认（模型可覆盖）：由 beat 类型与在场人数推断
        let shotType;
        if (kind === 'vo') shotType = '特写';
        else if (kind === 'dialogue') shotType = sceneChars.length >= 3 ? '中景' : (sceneChars.length === 2 ? '过肩' : '近景');
        else shotType = sceneChars.length >= 3 ? '全景' : (sceneChars.length === 2 ? '中景' : '近景');

        const onScreen = kind !== 'vo'; // 心声默认不把说话人放进画面
        const shot = {
          shotId,
          ep: ep.ep,
          sceneId,
          lighting: resolveLighting(sceneId, scene.lighting),
          characters: sceneChars.slice(),
          props: scene.props || [],
          shotType,
          camera: '固定机位',
          durationSec: dur,
          sourceBeat: { sceneNo: (ep.scenes.indexOf(scene)) + 1, beatNo: beatIndex + 1 },
          beatKind: kind,
          onScreen,
          action: kind === 'action' ? (beat.action || '') : '',
          line: kind === 'vo' ? (beat.line || '') : (kind === 'dialogue' ? (beat.line || '') : ''),
          speaker: (kind !== 'action' && beat.speaker) ? beat.speaker : null,
          prompt: '',
          negativePrompt: '',
          // ── 首帧图 / 视频 ComfyUI 工作流专用字段 ──
          splitPrompt: '',          // 纯文本首帧提示词（可直接复制进 Krea2 文生图/图生图）
          refImagePaths: [],        // 本镜引用的人物角色图路径（来自 cast.json，供 H3 I2VA 与首帧图生图复用）
          continuity: null,         // 连续性状态块（P0-3）：角色服装/状态、道具状态、场景光照，跨镜比对用；autofill 时注入骨架
          firstFrameCopyBlock: '',  // 可直接复制粘贴到 Krea2 ComfyUI 的首帧出图整块
          batch: nextBatch(sceneId, resolveLighting(sceneId, scene.lighting)),
          warnings: [],
          complexity: scoreComplexity({ kind, sceneChars, beat, shotType, camera: '固定机位', props: scene.props || [] }),
          note: kind === 'vo' ? '心声/画外音：可不放说话人入画，仅给表情或空镜' : ''
        };

        // 把复杂度评分里的 warnings 合并进镜头级 warnings（逗号串/非动作镜提示）
        const cmp = shot.complexity;
        if (cmp && Array.isArray(cmp.warnings)) shot.warnings.push(...cmp.warnings);

        if (autofill && ctx) autofillShot(shot, ctx, params, epSpeakerMap);
        shots.push(shot);
      });
    }

    const targetSeconds = sumShotSeconds(shots);
    episodes.push({
      ep: ep.ep,
      targetSeconds: Math.round(targetSeconds * 10) / 10,
      shots
    });
  }

  return episodes;
}

function sumShotSeconds(shots) { return shots.reduce((a, s) => a + (s.durationSec || 0), 0); }

// 镜头复杂度评分（确定性，不依赖模型）：用于判断"1 beat 是否该拆成多镜"。
// 评分项：人数(互动) / 动作数 / 道具交互 / 情绪变化 / 镜头运动 / 空间变化。
// 评分器与拆镜器共用同一把尺子：recommendSplit 只在「动作镜 + ≥2 个句号分句 + score≥6」时置 true，
// 保证"推荐可拆"必然"拆得动"（拆镜器同样只拆动作镜、只按句号分句），同时过滤掉简单建立镜
// （如"浓雾把栈桥吃得只剩三步远。梆子声从岸上飘过来…"单角色无动作的 2 分句镜，score 低，不推荐拆）。
// 逗号串成的连续动作（如"拿起手机，看了一眼消息，脸色骤变"）不再计入可拆分句，
// 改为通过 warnings 提示人工处理，避免"提示了却拆不动"。
function scoreComplexity({ kind, sceneChars, beat, shotType, camera, props }) {
  let score = 0;
  const n = sceneChars.length;
  if (n >= 2) score += 2;          // 多人互动
  else if (n === 1) score += 1;    // 单角色在场

  const actionText = (kind === 'action' ? (beat.action || '') : (beat.line || ''));

  // 拆镜器可拆的分句：仅按句号/分号切（与 cmdSplit 一致，不含逗号）
  const splitClauses = String(actionText).split(/[。；;]/).map(s => s.trim()).filter(Boolean);
  // 逗号串标志：同一句号段内若存在逗号，说明是"逗号串成的连续动作"，拆镜器无法拆
  const hasCommaRun = /[，,]/.test(actionText);

  // 复杂度评分：沿用含逗号的全部分句（用于展示镜头繁忙程度）
  const clauses = String(actionText).split(/[。；;，,]/).map(s => s.trim()).filter(Boolean);
  const actionCount = Math.max(0, clauses.length - 1); // 1 段不加分，2 段 +1，3 段 +2 …
  score += Math.min(actionCount, 4); // 动作连续变化，封顶 +4

  if (props && props.length) score += 1; // 道具交互

  // 情绪变化：动作文本含情绪/表情/脸色等线索
  if (/表情|脸色|神情|情绪|惊讶|震惊|怒|悲|喜|慌|愣|怔|变色|骤变/.test(actionText)) score += 1;

  if (camera && camera !== '固定机位') score += 1; // 镜头运动

  // 空间变化：走向/转身/离开/走近/环顾等位移
  if (/走[向过]|转身|离开|走近|环顾|四下|迈步|跨[出过]|挪[到动]/.test(actionText)) score += 2;

  let level = 'simple';
  if (score >= 7) level = 'high';
  else if (score >= 4) level = 'normal';

  // recommendSplit 与拆镜器对齐（能拆才推荐），同时保留复杂度语义（过滤简单建立镜）：
  // 仅「动作镜 + ≥2 个句号分句 + score≥6」才推荐拆镜
  const recommendSplit = kind === 'action' && splitClauses.length >= 2 && score >= 6;
  // 逗号串提示：本可算复杂但拆镜器拆不动，交给人工处理
  const warnings = [];
  if (recommendSplit === false && kind === 'action' && hasCommaRun && splitClauses.length < 2) {
    warnings.push('逗号串成的连续动作，拆镜器无法自动拆分；如需拆镜请改为句号分句或人工处理');
  } else if (kind !== 'action' && score >= 7) {
    warnings.push('非动作镜复杂度偏高，但拆镜器仅拆动作镜，不自动拆分');
  }

  return { score, level, recommendSplit, splitClauses, warnings };
}

// seed 与 split 共用的 autofill：把结构化字段拼成可直接复制的提示词块。
function autofillShot(shot, ctx, params, epSpeakerMap) {
  shot.prompt = composePrompt(shot, ctx, params);
  shot.negativePrompt = composeNegative(shot, ctx);
  shot.splitPrompt = composeSplitPrompt(shot, ctx, params);
  shot.refImagePaths = composeRefImages(shot, ctx);
  shot.continuity = composeContinuity(shot, ctx);
  shot.firstFrameCopyBlock = composeFirstFrameCopyBlock(shot, ctx, params);
  if (params.promptFormat !== 'legacy') {
    shot.h3 = composeH3(shot, ctx, params, epSpeakerMap || new Map());
    shot.h3CopyBlock = composeH3CopyBlock(shot, params);
  }
}

// 把复杂动作镜（complexity.recommendSplit 或指定 --shot）按分句拆成多条子镜。
// 严守红线：① 所有子镜共享同一 sourceBeat（保证 G1 beat 覆盖门仍通过）；
//           ② shotId 加小写后缀避免与 G2 唯一/格式门冲突；③ 时长按段数均分。
function cmdSplit(args) {
  const { pos, opts } = parseArgs(args);
  const p = pos[0];
  if (!p) { console.error('用法: split <storyboard.json> [--shot E01S001 | --auto] [--cast --art --outline] [--autofill] [--out 路径]'); process.exit(2); }
  if (!opts.shot && !opts.auto) { console.error('需指定 --shot <shotId> 或 --auto（拆所有 recommendSplit 动作镜）'); process.exit(2); }
  const doc = readDoc(p);
  const ctx = resolveCtx(opts);
  const params = paramsOf(doc);
  if (opts['prompt-format']) params.promptFormat = opts['prompt-format'];
  if (opts['h3-mode']) params.h3Mode = opts['h3-mode'];
  const autofill = !!opts.autofill;
  const target = opts.shot || null;

  let splitCount = 0;
  for (const ep of doc.episodes || []) {
    const newShots = [];
    for (const shot of ep.shots || []) {
      const want = target ? (shot.shotId === target) : (shot.complexity && shot.complexity.recommendSplit);
      if (!want || shot.beatKind !== 'action') { newShots.push(shot); continue; }
      const clauses = String(shot.action || '').split(/[。；;]/).map(s => s.trim()).filter(Boolean);
      if (clauses.length < 2) { newShots.push(shot); continue; } // 单段不拆
      const splitFloor = params.splitSecondsFloor || 1.0;
      const perRaw = (shot.durationSec || clauses.length) / clauses.length;
      // 用更低的 splitFloor 判断能否拆：子镜各 ≥ splitFloor 即可（G4 对 split 镜也用此下限）
      if (perRaw < splitFloor) { newShots.push(shot); continue; }
      const per = Math.max(splitFloor, Math.round(perRaw * 10) / 10); // 每段至少 splitFloor
      clauses.forEach((cl, i) => {
        const suffix = String.fromCharCode(97 + i); // a,b,c…
        const isLast = i === clauses.length - 1;
        const sub = {
          ...shot,
          shotId: `${shot.shotId}${suffix}`,
          action: cl,
          durationSec: isLast
            ? Math.round(Math.max(splitFloor, ((shot.durationSec || clauses.length) - per * (clauses.length - 1))) * 10) / 10
            : per,
          split: true, // 标记由 split 产生的子镜，G4 用 splitFloor 而非 shotSecondsFloor
          sourceBeat: { ...shot.sourceBeat }, // 关键：沿用原 beat，守住覆盖率门
          complexity: scoreComplexity({ kind: 'action', sceneChars: shot.characters, beat: { action: cl }, shotType: shot.shotType, camera: shot.camera, props: shot.props })
        };
        if (autofill && ctx) autofillShot(sub, ctx, params, new Map());
        newShots.push(sub);
      });
      splitCount += 1;
    }
    ep.shots = newShots;
  }

  const outPath = opts.out ? resolve(opts.out) : resolve(process.cwd(), `${slugify(doc.source || 'storyboard')}-storyboard.split.json`);
  writeFileSync(outPath, JSON.stringify(doc, null, 2));
  const stats = computeStats(doc);
  console.error(`✓ 已拆分 ${splitCount} 条复杂镜 → ${outPath}`);
  console.error(`  现共 ${stats.totalShots} 条镜头 / 预估 ${fmtSec(stats.totalSeconds)}s`);
  console.error(`  提示：拆分后请重新跑 validate 确认 G1/G2 仍通过，再 export 出 Prompt 包`);
  return outPath;
}


// 首帧提示词合成（autofill）：场景光照 + 在场角色形象 + 道具状态 + 景别 + 风格
function composePrompt(shot, ctx, params) {
  const parts = [];
  const sm = ctx.sceneMap[shot.sceneId];
  if (sm && sm.lighting.length) {
    const lit = sm.lighting.find(l => l.state === shot.lighting) || sm.lighting[0];
    parts.push(lit.prompt);
  } else {
    parts.push('cinematic interior setting');
  }

  if (shot.onScreen) {
    for (const cid of shot.characters) {
      const name = ctx.cidToName[cid];
      const cast = name && ctx.nameToCast[name];
      if (cast && cast.image && cast.image.prompt) {
        const p = cast.image.prompt;
        const slim = p.includes(' Three-quarter view') ? p.split(' Three-quarter view')[0] : p.slice(0, 400);
        let seg = slim.trim().replace(/[.]+$/, '');
        // Identity Lock：把不可变特征注入首帧，防止"第一镜一个脸、第二镜一个脸"
        const anchors = (cast.identityAnchors && cast.identityAnchors.length) ? cast.identityAnchors : (cast.identity ? [cast.identity] : []);
        if (anchors.length) seg += ', ' + anchors.join(', ');
        // Wardrobe：展开角色服装（优先 continuity 指定的 wardrobeId，否则默认第一条）
        const wId = shot.continuity && shot.continuity.characters && shot.continuity.characters[cid]
          ? shot.continuity.characters[cid].wardrobe : null;
        const wardrobe = (cast.wardrobe && cast.wardrobe.length)
          ? (cast.wardrobe.find(w => w.id === wId) || cast.wardrobe[0]) : null;
        if (wardrobe && wardrobe.prompt) seg += `, wearing ${wardrobe.prompt}`;
        parts.push(seg);
      }
    }
  } else {
    parts.push('a face in shadow, thoughtful expression, not identified');
  }

  for (const pid of shot.props) {
    const pm = ctx.propMap[pid];
    if (pm && pm.states.length) parts.push(pm.states[0].prompt);
  }

  const en = SHOT_TYPES_EN[shot.shotType] || 'shot';
  parts.push(`${en}, cinematic composition, ${params.style} style, Republican-era China, coherent lighting`);
  return parts.join('. ') + '.';
}

function composeNegative(shot, ctx) {
  const sm = ctx.sceneMap[shot.sceneId];
  if (sm && sm.negativePrompt) return sm.negativePrompt;
  return 'people, crowds, extra fingers, malformed hands, text, watermark, signature, oversaturated';
}

// 首帧提示词（纯文本，可直接复制给 ComfyUI 文生图 / 图生图节点）。
// 与 prompt 同源，去掉句尾标点、压缩为单行，便于粘贴。
function composeSplitPrompt(shot, ctx, params) {
  const base = composePrompt(shot, ctx, params);
  return base.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
}

// 本镜要用到的人物角色图路径（来自 cast.json，供首帧图生图 + H3 I2VA 复用）。
// 按景别推荐最贴合的参考图：特写→portrait / 中景→halfBody / 全景→fullBody / 侧身→side；
// 所选缺失时降级 portrait → path → 占位符（sheet 是提示词文本不是路径，永不进 refImagePaths），绝不阻断生成。
const SHOT_REF_PREF = [
  { types: ['特写', '大特写'], pick: ['portrait'] },
  { types: ['近景', '过肩'], pick: ['portrait', 'halfBody'] },
  { types: ['中景'], pick: ['halfBody', 'portrait'] },
  { types: ['全景', '远景', '大远景'], pick: ['fullBody', 'halfBody', 'portrait'] },
  { types: ['侧拍', '侧面'], pick: ['side', 'portrait'] }
];
function composeRefImages(shot, ctx) {
  const paths = [];
  const pref = SHOT_REF_PREF.find(r => r.types.includes(shot.shotType)) || { pick: ['portrait'] };
  for (const cid of shot.characters) {
    const name = ctx.cidToName[cid];
    const cast = name && ctx.nameToCast[name];
    const img = cast && cast.image;
    let chosen = null;
    for (const key of pref.pick) { if (img && img[key]) { chosen = img[key]; break; } }
    if (!chosen && img && img.portrait) chosen = img.portrait;       // 降级 portrait（干净单视角图）
    if (!chosen && img && img.path) chosen = img.path;               // 再降级 path（旧字段）
    if (chosen) paths.push(chosen);
    else if (name) paths.push(`【角色图:${name}】`);
    else paths.push(`【角色图:${cid}】`);
  }
  return [...new Set(paths)];
}

// 连续性状态块（P0-3）：给出每镜的"状态快照"骨架，供 novel-project 跨镜状态机比对。
// 取值优先来自角色/道具/场景当前设定；缺失项留空字符串，由人工在 seed 后精修。
// continuity 不代表最终生成结果，而是"这一镜应有的连续性约束"。
function composeContinuity(shot, ctx) {
  const characters = {};
  for (const cid of shot.characters) {
    const name = ctx.cidToName[cid];
    const cast = name && ctx.nameToCast[name];
    characters[cid] = {
      name: name || cid,
      wardrobe: (cast && cast.wardrobe) || '',      // 服装状态（如 W01 藏青学生装）；缺省留空待补
      emotion: (cast && cast.emotion) || '',        // 情绪（如 angry/calm）；缺省留空
      state: 'on_screen',                           // 在场状态：on_screen / off_screen / held
      position: ''                                  // 画面位置（如 left/center/right）；缺省留空
    };
  }
  const props = {};
  for (const pid of shot.props) {
    const pm = ctx.propMap[pid];
    props[pid] = {
      name: (pm && pm.name) || pid,
      state: (pm && pm.states && pm.states[0] && pm.states[0].state) || ''  // 当前道具状态（如 held/on_table），art.json 的字段名是 state
    };
  }
  const sm = ctx.sceneMap[shot.sceneId];
  const lit = (sm && sm.lighting && sm.lighting.find(l => l.state === shot.lighting)) || (sm && sm.lighting && sm.lighting[0]);
  const scene = {
    lighting: shot.lighting || (lit && lit.state) || '',
    weather: (sm && sm.weather) || '',
    time: (sm && sm.time) || ''
  };
  return { characters, props, scene };
}

// 首帧出图整块（可直接复制粘贴到 Krea2 ComfyUI 工作流）：
// 正向提示词 + 反向提示词，分两段标注，零依赖即可用。
function composeFirstFrameCopyBlock(shot, ctx, params) {
  const pos = composeSplitPrompt(shot, ctx, params);
  const neg = composeNegative(shot, ctx);
  const refNote = shot.refImagePaths && shot.refImagePaths.length
    ? `\n\n[参考图] ${shot.refImagePaths.join(' | ')}\n（将上述角色图作为图生图/角色一致性参考传入 Krea2 工作流）`
    : '';
  return `=== 正向提示词 ===\n${pos}\n\n=== 反向提示词 ===\n${neg}${refNote}`;
}

// ── H3 (MiniMax H3) 视频提示词合成 ─────────────────────────
// 每条 shot ＝ 一个 H3 视频片段，输出三段式结构：
//   mode / integrated_multimodal_description / overall_soundscape / non_diegetic_music
// 遵循 h3-prompt-writing 规范：镜头头 [Shot 1] + 风格 + 景别；角色用 (S1) 稳定 ID；
// 台词用 <d>[Chinese] ... </d>；VO 用 off-screen voiceover + 闭唇；机位映射到 H3 运镜词。
function h3CameraClause(shot) {
  const c = (shot.camera || '固定机位').trim();
  if (CAMERA_H3[c]) return CAMERA_H3[c];
  // 未命中则按景别给一个稳妥默认
  return ['特写', '大特写'].includes(shot.shotType)
    ? 'The camera holds a static close shot.'
    : 'The camera holds a static shot.';
}

function h3Soundscape(shot, ctx, params) {
  const sm = ctx.sceneMap[shot.sceneId];
  const sceneName = sm ? sm.name : 'the location';
  const action = shot.action || shot.line || '';

  // 环境底噪：与光照/动作粗略对应（H3 规范提示词全英文，不内嵌中文场景名）
  let ambience = 'Ambient room tone continues';
  if (sm && sm.lighting.length) {
    const lit = sm.lighting.find(l => l.state === shot.lighting) || sm.lighting[0];
    const lp = (lit.prompt || '').toLowerCase();
    if (lp.includes('rain')) ambience = 'Rain taps against the windows';
    else if (lp.includes('wind') || lp.includes('storm')) ambience = 'Wind passes through the space';
    else if (lp.includes('night')) ambience = 'Quiet night ambience';
    else if (lp.includes('fire')) ambience = 'A fire crackles in the hearth';
  }

  // 动作音效：启发式匹配
  const sfx = [];
  for (const [kw, s] of SFX_HINTS) if (action.includes(kw)) sfx.push(s);
  const sfxText = sfx.length ? '; ' + sfx.join('; ') : '';

  // 台词/心声：叠加上的人声
  let voice = '';
  if (shot.beatKind !== 'action' && shot.line) {
    voice = shot.beatKind === 'vo' ? '; the off-screen voiceover is clear and close' : '; a natural speaking voice carries the line';
  }
  return `${ambience}${sfxText}${voice}.`;
}

function composeH3(shot, ctx, params, epSpeakerMap) {
  const style = params.h3Style || 'Live-action, cinematic';
  const mode = params.h3Mode === 't2va' ? 'T2VA' : 'I2VA';
  const en = SHOT_TYPES_EN[shot.shotType] || 'shot';
  const sm = ctx.sceneMap[shot.sceneId];
  const litPrompt = (sm && sm.lighting.length)
    ? (sm.lighting.find(l => l.state === shot.lighting) || sm.lighting[0]).prompt
    : 'an interior setting';

  // 在场角色形象 + 稳定 ID
  let charClause = '';
  if (shot.onScreen && shot.characters.length) {
    const parts = [];
    for (const cid of shot.characters) {
      const name = ctx.cidToName[cid];
      const sid = epSpeakerMap.get(cid) || '';
      const cast = name && ctx.nameToCast[name];
      let look = '';
      if (cast && cast.image && cast.image.prompt) {
        const p = cast.image.prompt;
        look = (p.includes(' Three-quarter view') ? p.split(' Three-quarter view')[0] : p.slice(0, 280)).trim().replace(/[.]+$/, '');
      }
      parts.push(`${name} ${sid}, ${look}`.replace(/\s+/g, ' ').trim());
    }
    charClause = parts.join('; ') + '. ';
  } else {
    charClause = 'A face in shadow, thoughtful expression, not identified. ';
  }

  const cameraClause = h3CameraClause(shot);

  // 主体内容：动作 / 对白 / 心声
  let body;
  if (shot.beatKind === 'vo') {
    const lead = shot.characters.length ? `${ctx.cidToName[shot.characters[0]]} ${epSpeakerMap.get(shot.characters[0]) || ''}` : 'A character';
    const gender = 'their';
    body = `${lead} says in an off-screen voiceover: <d>[Chinese] ${shot.line || ''}</d> while ${gender} lips remain completely closed. `;
  } else if (shot.beatKind === 'dialogue') {
    const lead = shot.characters.length ? `${ctx.cidToName[shot.characters[0]]} ${epSpeakerMap.get(shot.characters[0]) || ''}` : 'A character';
    body = `${lead} says: <d>[Chinese] ${shot.line || ''}</d> `;
  } else {
    // 动作叙事必须是英文（H3 规范）；剧本动作常为中文，含中文时退化为安全英文占位并标注让用户补
    const act = shot.action || '';
    if (act && !hasCJK(act)) body = `${act} `;
    else body = 'The scene continues with subtle natural motion. ';
  }

  // I2VA：首帧图 + 角色参考图驱动。开头插首帧引用句，Shot 1 里点明与参考图一致。
  let refIntro = '';
  let firstFrameAnchor = '';
  if (mode === 'I2VA') {
    refIntro = 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\n';
    // 若本镜有角色参考图，明确"角色形象与参考图一致"，保证抽卡时角色不漂移
    if (shot.refImagePaths && shot.refImagePaths.length) {
      firstFrameAnchor = 'The character appearance, clothing, and facial features exactly match the supplied character reference image(s). ';
    }
  }

  const desc = `[Shot 1] ${style}, a ${en} frames ${litPrompt}. ${firstFrameAnchor}${charClause}${cameraClause} ${body}`.replace(/\s+/g, ' ').trim();
  const sound = h3Soundscape(shot, ctx, params);
  const music = params.h3Music || 'A soft, understated background score at a slow tempo that supports the scene mood.';
  const h3 = { mode, integrated_multimodal_description: desc, overall_soundscape: sound, non_diegetic_music: music };

  // I2VA 时把首帧引用句与角色图信息一并带出，便于直接喂给 H3 ComfyUI 工作流
  if (mode === 'I2VA') {
    h3.firstFrameReference = '<Picture 1> = 本镜首帧图（由 Krea2 生成）';
    if (shot.refImagePaths && shot.refImagePaths.length) {
      h3.characterReference = shot.refImagePaths.join(' | ');
    }
  }
  return h3;
}

// H3 视频生成整块（可直接复制粘贴到 MiniMax H3 ComfyUI 工作流）：
// 首帧引用句(仅 I2VA) + 三段式字段，分块标注，零依赖即可用。
function composeH3CopyBlock(shot, params) {
  const h3 = shot.h3;
  if (!h3) return '';
  const parts = [];
  const mode = h3.mode || 'T2VA';
  if (mode === 'I2VA') {
    parts.push('=== 参考图(传入 H3 工作流) ===');
    parts.push('首帧图(Picture 1): 本镜首帧图文件（由 Krea2 生成）');
    if (h3.characterReference) parts.push(`角色参考图: ${h3.characterReference}`);
    parts.push('');
    parts.push('=== 首帧引用句(粘贴到提示词开头) ===');
    parts.push('For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.');
    parts.push('');
  }
  parts.push('=== integrated_multimodal_description ===');
  parts.push(h3.integrated_multimodal_description);
  parts.push('');
  parts.push('=== overall_soundscape ===');
  parts.push(h3.overall_soundscape);
  parts.push('');
  parts.push('=== non_diegetic_music ===');
  parts.push(h3.non_diegetic_music);
  return parts.join('\n');
}

// ── 统计 ──────────────────────────────────────────────────
function computeStats(doc) {
  const params = paramsOf(doc);
  let totalShots = 0;
  let totalSec = 0;
  const batches = new Map();
  for (const ep of doc.episodes || []) {
    for (const s of ep.shots || []) {
      totalShots += 1;
      totalSec += s.durationSec || 0;
      if (s.batch) {
        if (!batches.has(s.batch)) batches.set(s.batch, []);
        batches.get(s.batch).push(s.shotId);
      }
    }
  }
  return {
    episodes: (doc.episodes || []).length,
    totalShots,
    totalSeconds: Math.round(totalSec * 10) / 10,
    avgShotSec: totalShots ? Math.round((totalSec / totalShots) * 10) / 10 : 0,
    batchCount: batches.size,
    batches: Array.from(batches.entries()).map(([id, ids]) => ({ id, count: ids.length, shotIds: ids }))
  };
}

// ── 质量门（13 道，确定性）──────────────────────────────
// 返回 { gates:[{id,name,ok,info}], passed, total, skipped }
function gateReport(doc, ctx) {
  const params = paramsOf(doc);
  const gates = [];
  const push = (id, name, ok, info) => gates.push({ id, name, ok, info: info || '' });

  // 建立脚本 beat 索引（用于覆盖率与角色一致性）
  const scriptBeats = []; // {ep, sceneNo, beatNo, kind, chars}
  if (ctx && ctx.script) {
    for (const ep of ctx.script.episodes || []) {
      (ep.scenes || []).forEach((sc, si) => {
        (sc.flow || []).forEach((b, bi) => {
          scriptBeats.push({ ep: ep.ep, sceneNo: si + 1, beatNo: bi + 1, kind: b.kind, chars: sc.characters || [] });
        });
      });
    }
  }
  const sbMap = new Map();
  for (const b of scriptBeats) sbMap.set(`${b.ep}:${b.sceneNo}:${b.beatNo}`, b);

  const allShots = [];
  for (const ep of doc.episodes || []) for (const s of ep.shots || []) allShots.push(s);

  // G1 覆盖率：每个剧本 beat 都有对应 shot
  if (ctx && ctx.script) {
    let missing = 0;
    const covered = new Set();
    for (const s of allShots) {
      if (s.sourceBeat && s.sourceBeat.sceneNo != null) covered.add(`${s.ep}:${s.sourceBeat.sceneNo}:${s.sourceBeat.beatNo}`);
    }
    for (const key of sbMap.keys()) if (!covered.has(key)) missing += 1;
    push('coverage', '剧本 beat 全覆盖', missing === 0, missing ? `缺 ${missing} 条 beat 的分镜` : `共 ${sbMap.size} 条 beat 全有分镜`);
  } else {
    push('coverage', '剧本 beat 全覆盖', true, '未提供 --script，跳过');
  }

  // G2 shotId 唯一且符合 E{nn}S{nnn}
  {
    const idset = new Set();
    let dup = 0, bad = 0;
    for (const s of allShots) {
      if (!/^E\d{2,}S\d{3,}[a-z]?$/.test(s.shotId || '')) bad += 1;
      if (idset.has(s.shotId)) dup += 1; idset.add(s.shotId);
    }
    push('shot-id', 'shotId 唯一且格式合规', dup === 0 && bad === 0, `重复 ${dup} / 格式错 ${bad}`);
  }

  // G3 场景引用（需 --art）
  if (ctx && ctx.art) {
    let bad = 0; const ids = Object.keys(ctx.sceneMap);
    for (const s of allShots) if (!ids.includes(s.sceneId)) bad += 1;
    push('scene-ref', '场景 ID 在 art.json 存在', bad === 0, bad ? `${bad} 个镜头场景缺失` : '全部命中');
  } else push('scene-ref', '场景 ID 在 art.json 存在', true, '未提供 --art，跳过');

  // G4 光照状态注册（需 --art）
  if (ctx && ctx.art) {
    let bad = 0;
    for (const s of allShots) {
      const sm = ctx.sceneMap[s.sceneId];
      if (!sm || !sm.lighting.some(l => l.state === s.lighting)) bad += 1;
    }
    push('lighting-ref', '光照状态在场景内注册', bad === 0, bad ? `${bad} 个镜头光照未注册` : '全部命中');
  } else push('lighting-ref', '光照状态在场景内注册', true, '未提供 --art，跳过');

  // G5 角色一致性：镜头角色 ⊆ 剧本该场角色（需 --script）
  if (ctx && ctx.script) {
    let bad = 0; const detail = [];
    for (const s of allShots) {
      if (!s.sourceBeat || s.sourceBeat.sceneNo == null) continue;
      const key = `${s.ep}:${s.sourceBeat.sceneNo}:${s.sourceBeat.beatNo}`;
      const sb = sbMap.get(key);
      if (!sb) continue;
      for (const c of (s.characters || [])) if (!(sb.chars).includes(c)) { bad += 1; detail.push(s.shotId); }
    }
    push('char-consistency', '镜头角色 ⊆ 剧本在场角色', bad === 0, bad ? `越界 ${bad} 处：${detail.slice(0, 5).join(',')}` : '一致');
  } else push('char-consistency', '镜头角色 ⊆ 剧本在场角色', true, '未提供 --script，跳过');

  // G6 时长：单镜在 [floor,cap]，单集总和贴近 script 目标（需 --script）
  let durBad = 0;
  for (const s of allShots) {
    const d = s.durationSec || 0;
    // split 子镜用更低的 splitSecondsFloor（允许短动作拍拆开），普通镜用 shotSecondsFloor
    const floor = s.split ? (params.splitSecondsFloor || 1.0) : params.shotSecondsFloor;
    if (d < floor || d > params.shotSecondsCap) durBad += 1;
  }
  let epBad = 0;
  if (ctx && ctx.script) {
    const scriptEp = new Map();
    for (const ep of ctx.script.episodes || []) scriptEp.set(ep.ep, ep.targetSeconds);
    for (const ep of doc.episodes || []) {
      const tgt = scriptEp.get(ep.ep);
      if (tgt != null) {
        const diff = Math.abs((ep.targetSeconds || 0) - tgt) / tgt;
        if (diff > params.tolerance) epBad += 1;
      }
    }
  }
  push('duration', '单镜时长合规 & 单集时长贴近', durBad === 0 && epBad === 0,
    `单镜越界 ${durBad} / 单集越界 ${epBad}${ctx && ctx.script ? '' : '（单集比对需 --script）'}`);

  // G7 景别枚举
  {
    let bad = 0;
    for (const s of allShots) if (!SHOT_TYPES.includes(s.shotType)) bad += 1;
    push('shot-type', '景别取值合法', bad === 0, bad ? `${bad} 个非法` : '全部合法');
  }

  // G8 机位非空
  {
    let bad = 0;
    for (const s of allShots) if (!s.camera || !String(s.camera).trim()) bad += 1;
    push('camera', '机位非空', bad === 0, bad ? `${bad} 个空` : '全部填写');
  }

  // G9 首帧提示词：非空 + 英文 + 不含角色中文名（--cast 越界检测）
  {
    let bad = 0, cjk = 0;
    for (const s of allShots) {
      if (!s.prompt || !String(s.prompt).trim()) { bad += 1; continue; }
      if (hasCJK(s.prompt)) cjk += 1;
      if (ctx && ctx.cast) {
        for (const name of Object.keys(ctx.nameToCast)) {
          if (String(s.prompt).includes(name)) { bad += 1; break; }
        }
      }
    }
    push('prompt', '首帧提示词非空且英文', bad === 0 && cjk === 0, `空/越界 ${bad} / 含中文 ${cjk}`);
  }

  // G10 反向提示词：非空 + 英文
  {
    let bad = 0, cjk = 0;
    for (const s of allShots) {
      if (!s.negativePrompt || !String(s.negativePrompt).trim()) { bad += 1; continue; }
      if (hasCJK(s.negativePrompt)) cjk += 1;
    }
    push('neg-prompt', '反向提示词非空且英文', bad === 0 && cjk === 0, `空 ${bad} / 含中文 ${cjk}`);
  }

  // G11 生成批次已分配
  {
    let bad = 0;
    for (const s of allShots) if (!s.batch || !String(s.batch).trim()) bad += 1;
    push('batch', '生成批次已分配', bad === 0, bad ? `${bad} 个未分配` : '全部分配');
  }

  // G12 心声（VO）镜头必须说明取景（onScreen=false 或 note 非空）
  {
    let bad = 0;
    for (const s of allShots) {
      if (s.beatKind === 'vo' && s.onScreen !== false && !(s.note && String(s.note).trim())) bad += 1;
    }
    push('vo-framing', 'VO 镜头取景已说明', bad === 0, bad ? `${bad} 个 VO 未说明` : '全部说明');
  }

  // G13 预警清单：多人近景/特写须预警；含人群词须预警
  {
    let bad = 0;
    for (const s of allShots) {
      const onScreenCount = s.onScreen === false ? 0 : (s.characters || []).length;
      const hardType = ['特写', '近景'].includes(s.shotType);
      const needWarn = (onScreenCount >= 3 && hardType);
      const crowdHit = (s.prompt && CROWD_KEYWORDS.some(k => String(s.prompt).includes(k)));
      const warns = s.warnings || [];
      if (needWarn && warns.length === 0) bad += 1;
      if (crowdHit && warns.length === 0) bad += 1;
    }
    push('warnings', '难点镜头已加预警', bad === 0, bad ? `${bad} 个难点缺预警` : '全部补齐');
  }

  // H3 视频提示词质量门（仅当存在 h3 字段时启用）
  {
    const h3Shots = allShots.filter(s => s.h3);
    if (h3Shots.length === 0) {
      push('h3-desc', 'H3 描述符合规范', true, '未生成 H3 提示词（legacy 模式），跳过');
      push('h3-sound', 'H3 声景/配乐已填', true, '未生成 H3 提示词（legacy 模式），跳过');
    } else {
      // G14 h3-desc：非空 + [Shot N] 头 + 英文骨架(运镜+景别) + 台词镜含 <d>[（H3 允许中文：角色名/动作叙事/对话<d>[Chinese]）
      let bad = 0, info = [];
      for (const s of h3Shots) {
        const d = s.h3.integrated_multimodal_description || '';
        if (!d.trim()) { bad += 1; info.push(`${s.shotId}:空`); continue; }
        if (!/\[Shot\s*\d+\]/.test(d)) { bad += 1; info.push(`${s.shotId}:缺[Shot]`); }
        if (!/The camera/i.test(d)) { bad += 1; info.push(`${s.shotId}:缺运镜`); }
        if (!/\bshot\b/i.test(d) && !/frames/i.test(d)) { bad += 1; info.push(`${s.shotId}:缺景别`); }
        if ((s.beatKind === 'dialogue' || s.beatKind === 'vo') && !d.includes('<d>[')) { bad += 1; info.push(`${s.shotId}:台词缺<d>`); }
      }
      push('h3-desc', 'H3 描述符合规范', bad === 0, bad ? `${bad} 处异常：${info.slice(0, 5).join(',')}` : `${h3Shots.length} 条全部合规`);

      // G15 h3-sound：overall_soundscape 与 non_diegetic_music 均非空
      let bad2 = 0;
      for (const s of h3Shots) {
        if (!s.h3.overall_soundscape || !String(s.h3.overall_soundscape).trim()) bad2 += 1;
        if (!s.h3.non_diegetic_music || !String(s.h3.non_diegetic_music).trim()) bad2 += 1;
      }
      push('h3-sound', 'H3 声景/配乐已填', bad2 === 0, bad2 ? `${bad2} 处缺失` : `${h3Shots.length} 条全部填写`);

      // G16 h3-copy：可直接复制的 H3 文本块非空（供 ComfyUI 直接粘贴）
      let bad3 = 0;
      for (const s of h3Shots) if (!s.h3CopyBlock || !String(s.h3CopyBlock).trim()) bad3 += 1;
      push('h3-copy', 'H3 复制块(可直接粘贴)已生成', bad3 === 0, bad3 ? `${bad3} 条缺失` : `${h3Shots.length} 条全部生成`);
    }
  }

  // G17 首帧出图复制块非空（供 Krea2 ComfyUI 直接粘贴）
  // 仅对已填 prompt 的镜头强制；纯空骨架（prompt 为空，待手工填）跳过，避免误伤未 autofill 的草稿。
  {
    let bad = 0, skipped = 0;
    for (const s of allShots) {
      if (!s.prompt || !String(s.prompt).trim()) { skipped += 1; continue; }
      if (!s.firstFrameCopyBlock || !String(s.firstFrameCopyBlock).trim()) bad += 1;
    }
    const info = bad ? `${bad} 条已填 prompt 却缺复制块` : `已填镜头全部生成${skipped ? `（${skipped} 条空骨架跳过）` : ''}`;
    push('firstframe-copy', '首帧出图复制块已生成', bad === 0, info);
  }

  const failed = gates.filter(g => !g.ok);
  return { gates, passed: gates.length - failed.length, total: gates.length, skipped: gates.filter(g => /跳过/.test(g.info)).length, failed };
}

function validateStoryboard(doc, ctx) {
  const r = gateReport(doc, ctx);
  return { ok: r.failed.length === 0, report: r };
}

// ── 渲染：Markdown ───────────────────────────────────────
function renderMarkdown(doc, ctx) {
  const p = paramsOf(doc);
  const stats = computeStats(doc);
  const gr = gateReport(doc, ctx);
  const L = [];
  L.push(`# ${doc.source || '未命名'} —— 分镜表`);
  L.push('');
  L.push(`> 由 novel-storyboard ${SCRIPT_VERSION} 渲染 ｜ 风格：${p.style} ｜ 提示格式：${p.promptFormat} ｜ 参数：语速 ${p.charsPerSecond} 字/秒，动作 ${p.actionSeconds}s，容差 ±${Math.round(p.tolerance * 100)}%`);
  L.push('');
  L.push('## 总览');
  L.push('');
  L.push(`- 集数：${stats.episodes}`);
  L.push(`- 镜头数：${stats.totalShots}`);
  L.push(`- 预估总时长：${fmtSec(stats.totalSeconds)}s`);
  L.push(`- 平均镜长：${fmtSec(stats.avgShotSec)}s`);
  L.push(`- 生成批次：${stats.batchCount}`);
  L.push('');
  L.push('## 质量门');
  L.push('');
  L.push(`通过 ${gr.passed}/${gr.total}（跳过 ${gr.skipped}）${gr.failed.length ? ' ❌' : ' ✅'}`);
  L.push('');
  for (const g of gr.gates) L.push(`- [${g.ok ? 'x' : ' '}] **${g.name}** ${g.info}`);
  L.push('');
  for (const ep of doc.episodes || []) {
    L.push(`## 第 ${ep.ep} 集（预估 ${fmtSec(ep.targetSeconds)}s）`);
    L.push('');
    L.push('| 镜号 | 场景 | 光照 | 角色 | 道具 | 景别 | 机位 | 时长 | 首帧提示词 | H3 描述 | 批次 | 预警 |');
    L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const s of ep.shots || []) {
      const chars = (s.characters || []).map(c => ctx && ctx.cidToName[c] ? ctx.cidToName[c] : c).join('、');
      const prompt = (s.prompt || '').slice(0, 90) + ((s.prompt || '').length > 90 ? '…' : '');
      const h3 = (s.h3 && s.h3.integrated_multimodal_description || '').slice(0, 110) + ((s.h3 && s.h3.integrated_multimodal_description || '').length > 110 ? '…' : '');
      L.push(`| ${s.shotId} | ${s.sceneId} | ${s.lighting} | ${chars} | ${(s.props || []).join('、')} | ${s.shotType} | ${s.camera} | ${fmtSec(s.durationSec)}s | ${prompt} | ${h3} | ${s.batch} | ${(s.warnings || []).join(';')} |`);
    }
    L.push('');
    // 可复制提示词块（首帧出图 + H3 视频），直接粘进 ComfyUI 工作流
    L.push(`### 第 ${ep.ep} 集 · 可复制提示词块`);
    L.push('');
    for (const s of ep.shots || []) {
      L.push(`#### ${s.shotId}（${s.shotType} / ${s.camera} / ${fmtSec(s.durationSec)}s）`);
      L.push('');
      L.push('**首帧出图（Krea2 ComfyUI）**');
      L.push('');
      L.push('```');
      L.push(s.firstFrameCopyBlock || '（未生成）');
      L.push('```');
      L.push('');
      if (s.h3CopyBlock) {
        L.push('**视频生成（MiniMax H3 ComfyUI）**');
        L.push('');
        L.push('```');
        L.push(s.h3CopyBlock);
        L.push('```');
      }
      L.push('');
    }
  }
  return L.join('\n');
}

// ── 渲染：HTML ───────────────────────────────────────────
function renderHtml(doc, ctx) {
  const p = paramsOf(doc);
  const stats = computeStats(doc);
  const gr = gateReport(doc, ctx);
  const gateRows = gr.gates.map(g => `<li class="${g.ok ? 'ok' : 'bad'}">${g.ok ? '✅' : '❌'} <b>${esc(g.name)}</b> <span class="info">${esc(g.info)}</span></li>`).join('');
  const batchRows = stats.batches.map(b => `<div class="batch"><b>${esc(b.id)}</b> ×${b.count}：${esc(b.shotIds.join(', '))}</div>`).join('');

  const epSections = (doc.episodes || []).map(ep => {
    const rows = (ep.shots || []).map(s => {
      const chars = (s.characters || []).map(c => ctx && ctx.cidToName[c] ? ctx.cidToName[c] : c).join('、');
      const prompt = (s.prompt || '').slice(0, 120) + ((s.prompt || '').length > 120 ? '…' : '');
      const h3 = (s.h3 && s.h3.integrated_multimodal_description || '').slice(0, 160) + ((s.h3 && s.h3.integrated_multimodal_description || '').length > 160 ? '…' : '');
      const warn = (s.warnings || []).map(w => `<span class="warn">⚠ ${esc(w)}</span>`).join(' ');
      return `<tr><td>${esc(s.shotId)}</td><td>${esc(s.sceneId)}</td><td>${esc(s.lighting)}</td><td>${esc(chars)}</td><td>${esc((s.props||[]).join('、'))}</td><td>${esc(s.shotType)}</td><td>${esc(s.camera)}</td><td>${fmtSec(s.durationSec)}s</td><td class="prompt">${esc(prompt)}</td><td class="h3desc">${esc(h3)}</td><td>${esc(s.batch)}</td><td>${warn}</td></tr>`;
    }).join('');
    const copyBlocks = (ep.shots || []).map(s => {
      const h3 = s.h3CopyBlock ? `<div class="cb"><div class="cbl">视频生成（MiniMax H3 ComfyUI）</div><pre>${esc(s.h3CopyBlock)}</pre></div>` : '';
      return `<details class="shot-copy"><summary>${esc(s.shotId)} · 可复制提示词块</summary><div class="cb"><div class="cbl">首帧出图（Krea2 ComfyUI）</div><pre>${esc(s.firstFrameCopyBlock || '（未生成）')}</pre></div>${h3}</details>`;
    }).join('');
    return `<section class="ep"><h2>第 ${ep.ep} 集 <span class="sub">预估 ${fmtSec(ep.targetSeconds)}s</span></h2><table><thead><tr><th>镜号</th><th>场景</th><th>光照</th><th>角色</th><th>道具</th><th>景别</th><th>机位</th><th>时长</th><th>首帧提示词</th><th>H3 描述</th><th>批次</th><th>预警</th></tr></thead><tbody>${rows}</tbody></table>${copyBlocks}</section>`;
  }).join('');

  const passClass = gr.failed.length ? 'fail' : 'pass';
  const passText = gr.failed.length ? `未通过 ${gr.failed.length} 道` : '全部通过';

  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(doc.source || '分镜表')} · 分镜</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;background:#0f1115;color:#e6e6e6;padding:24px}
h1{font-size:22px;margin-bottom:6px}.meta{color:#8b93a1;font-size:13px;margin-bottom:18px}
.kpis{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.kpi{background:#1a1d24;border:1px solid #2a2f3a;border-radius:10px;padding:12px 16px;min-width:110px}
.kpi .v{font-size:22px;font-weight:700;color:#7aa2ff}.kpi .k{font-size:12px;color:#8b93a1;margin-top:2px}
.banner{border-radius:10px;padding:12px 16px;font-weight:700;margin-bottom:18px}
.pass{background:#16301f;color:#5ee08a;border:1px solid #2c5a3c}
.fail{background:#311717;color:#ff7a7a;border:1px solid #5a2c2c}
h2{font-size:17px;margin:22px 0 8px}.sub{color:#8b93a1;font-size:13px;font-weight:400}
table{width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:8px}
th,td{border:1px solid #2a2f3a;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#1a1d24;color:#aab2c0}
.prompt{color:#9fb4d8;max-width:300px}
.h3desc{color:#b8d8c0;max-width:360px}
.warn{color:#ffcf6b;font-size:11.5px}
.gates{background:#1a1d24;border:1px solid #2a2f3a;border-radius:10px;padding:14px 18px;margin-bottom:18px}
.gates h2{margin-top:0}.gates ul{list-style:none}.gates li{margin:5px 0;font-size:13px}.gates .ok{color:#5ee08a}.gates .bad{color:#ff7a7a}.gates .info{color:#8b93a1}
.batches{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}.batch{background:#1a1d24;border:1px solid #2a2f3a;border-radius:8px;padding:6px 10px;font-size:12px}
.shot-copy{background:#1a1d24;border:1px solid #2a2f3a;border-radius:8px;padding:8px 12px;margin:8px 0}
.shot-copy>summary{cursor:pointer;color:#7aa2ff;font-size:13px;font-weight:600}
.cb{margin:8px 0}.cbl{color:#8b93a1;font-size:11.5px;margin-bottom:4px}
.cb pre{background:#0f1115;border:1px solid #2a2f3a;border-radius:6px;padding:10px;font-size:11.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word;color:#cdd6e6;max-height:320px;overflow:auto}
</style></head><body>
<h1>${esc(doc.source || '未命名')} · 分镜表</h1>
<div class="meta">novel-storyboard ${SCRIPT_VERSION} ｜ 风格 ${esc(p.style)} ｜ 提示格式 ${esc(p.promptFormat)} ｜ 语速 ${p.charsPerSecond} 字/秒 ｜ 动作 ${p.actionSeconds}s ｜ 容差 ±${Math.round(p.tolerance * 100)}%</div>
<div class="kpis">
<div class="kpi"><div class="v">${stats.episodes}</div><div class="k">集数</div></div>
<div class="kpi"><div class="v">${stats.totalShots}</div><div class="k">镜头数</div></div>
<div class="kpi"><div class="v">${fmtSec(stats.totalSeconds)}s</div><div class="k">预估总时长</div></div>
<div class="kpi"><div class="v">${fmtSec(stats.avgShotSec)}s</div><div class="k">平均镜长</div></div>
<div class="kpi"><div class="v">${stats.batchCount}</div><div class="k">生成批次</div></div>
</div>
<div class="banner ${passClass}">质量门：通过 ${gr.passed}/${gr.total}（跳过 ${gr.skipped}）｜ ${passText}</div>
<div class="gates"><h2>质量门明细</h2><ul>${gateRows}</ul></div>
<div class="gates"><h2>生成批次单</h2><div class="batches">${batchRows || '<span class="info">无</span>'}</div></div>
${epSections}
</body></html>`;
}

// ── CLI ───────────────────────────────────────────────────
function readDoc(p) { return getJSON(p); }
function printJSON(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }

function parseArgs(argv) {
  const pos = []; const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      let k = a.slice(2); let v = true;
      if (k.includes('=')) { const idx = k.indexOf('='); v = k.slice(idx + 1); k = k.slice(0, idx); }
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) { v = argv[i + 1]; i++; }
      opts[k] = v;
    } else pos.push(a);
  }
  return { pos, opts };
}

function resolveCtx(opts) {
  return buildContext({
    script: opts.script || opts.s,
    outline: opts.outline || opts.o,
    art: opts.art || opts.a,
    cast: opts.cast || opts.c
  });
}

function cmdSeed(args) {
  const { pos, opts } = parseArgs(args);
  const scriptPath = pos[0];
  if (!scriptPath) { console.error('用法: seed <script.json> [--outline --art --cast] [--autofill] [--prompt-format h3|legacy] [--h3-mode i2va|t2va] [--eps 1-3]'); process.exit(2); }
  const script = getJSON(scriptPath);
  const ctx = resolveCtx(opts);
  const params = paramsOf(script);
  if (opts['prompt-format']) params.promptFormat = opts['prompt-format']; // 'h3' | 'legacy'
  if (opts['h3-mode']) params.h3Mode = opts['h3-mode']; // 'i2va' | 't2va'
  let episodes = deriveShotsFromScript(script, { ctx, autofill: !!opts.autofill, params });

  // --eps 范围裁剪（支持 "3" 单集 或 "1-3" 区间）
  if (opts.eps) {
    const parts = opts.eps.split('-').map(Number);
    const a = parts[0]; const b = parts.length > 1 ? parts[1] : a;
    episodes = (episodes || []).filter(e => e.ep >= a && e.ep <= b);
  }

  const doc = {
    source: script.source || basename(scriptPath, extname(scriptPath)),
    params,
    episodes,
    _embed: {
      script: opts.script || opts.s || null,
      outline: opts.outline || opts.o || null,
      art: opts.art || opts.a || null,
      cast: opts.cast || opts.c || null
    }
  };
  const outName = `${slugify(doc.source)}-storyboard.json`;
  const outPath = opts.out ? resolve(opts.out) : resolve(process.cwd(), outName);
  writeFileSync(outPath, JSON.stringify(doc, null, 2));
  const stats = computeStats(doc);
  console.error(`✓ 已生成 ${outPath}`);
  console.error(`  镜头 ${stats.totalShots} 条 / ${stats.episodes} 集 / 预估 ${fmtSec(stats.totalSeconds)}s / 批次 ${stats.batchCount}`);
  if (opts.autofill) console.error(`  --autofill：提示词已按 art/cast 自动合成（格式=${params.promptFormat}${params.promptFormat !== 'legacy' ? `，含 H3 ${params.h3Mode.toUpperCase()} 视频提示词 + 首帧/视频可直接复制块` : '，仅首帧图像提示词'}，可继续手工润色）`);
  console.error('  下一步：运行 validate 过质量门，或 render 预览');
  return outPath;
}

function cmdValidate(args) {
  const { pos, opts } = parseArgs(args);
  const p = pos[0];
  if (!p) { console.error('用法: validate <storyboard.json> [--script --outline --art --cast]'); process.exit(2); }
  const doc = readDoc(p);
  const ctx = resolveCtx(opts);
  const v = validateStoryboard(doc, ctx);
  const gr = v.report;
  console.error(`质量门：通过 ${gr.passed}/${gr.total}（跳过 ${gr.skipped}）`);
  for (const g of gr.gates) console.error(`  [${g.ok ? 'PASS' : 'FAIL'}] ${g.name} — ${g.info}`);
  if (!v.ok) { console.error('✗ 存在未通过的质量门'); process.exit(1); }
  console.error('✓ 全部质量门通过');
}

function cmdCheckup(args) {
  const { pos, opts } = parseArgs(args);
  const p = pos[0];
  if (!p) { console.error('用法: checkup <storyboard.json> [--script --outline --art --cast]'); process.exit(2); }
  const doc = readDoc(p);
  const ctx = resolveCtx(opts);
  const gr = gateReport(doc, ctx);
  const L = [];
  for (const g of gr.gates) L.push(`${g.ok ? 'PASS' : 'FAIL'}  ${g.name}  (${g.info})`);
  L.push(`---`);
  L.push(`通过 ${gr.passed}/${gr.total}，跳过 ${gr.skipped}，失败 ${gr.failed.length}`);
  process.stdout.write(L.join('\n') + '\n');
}

function cmdRender(args) {
  const { pos, opts } = parseArgs(args);
  const p = pos[0];
  if (!p) { console.error('用法: render <storyboard.json> [--md|--html] [--script --outline --art --cast]'); process.exit(2); }
  const doc = readDoc(p);
  const ctx = resolveCtx(opts);
  const md = opts.html ? null : true;
  const html = opts.html ? true : false;
  if (html) {
    const out = renderHtml(doc, ctx);
    if (opts.out) writeFileSync(resolve(opts.out), out);
    else process.stdout.write(out + '\n');
  } else {
    const out = renderMarkdown(doc, ctx);
    if (opts.out) writeFileSync(resolve(opts.out), out);
    else process.stdout.write(out + '\n');
  }
}

function cmdBatches(args) {
  const { pos, opts } = parseArgs(args);
  const p = pos[0];
  if (!p) { console.error('用法: batches <storyboard.json>'); process.exit(2); }
  const doc = readDoc(p);
  const stats = computeStats(doc);
  for (const b of stats.batches) console.log(`${b.id}\t×${b.count}\t${b.shotIds.join(', ')}`);
}

// 把结构化 JSON 里分散的 Prompt 抽成"打开就能复制"的平铺文件。
// 这是 Prompt Pipeline 的最后一公里：JSON 给 Agent、HTML 给人审、txt 给你直接粘进 ComfyUI/H3。
function cmdExport(args) {
  const { pos, opts } = parseArgs(args);
  const p = pos[0];
  if (!p) { console.error('用法: export <storyboard.json> [--cast <cast.json> --art <art.json>] [--out <dir>]'); process.exit(2); }
  const doc = readDoc(p);
  const ctx = resolveCtx(opts);
  const base = opts.out ? resolve(opts.out) : resolve(process.cwd(), `${slugify(doc.source || 'storyboard')}-prompts`);
  const dirs = {
    characters: join(base, 'characters'),
    scenes: join(base, 'scenes'),
    props: join(base, 'props'),
    shots: join(base, 'shots')
  };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });

  // ── 角色 Prompt（来自 cast.json）──
  let charN = 0;
  if (ctx.cast && Array.isArray(ctx.cast.characters)) {
    for (const c of ctx.cast.characters) {
      const id = c.id || slugify(c.name);
      const img = c.image || {};
      const identity = (c.identityAnchors && Array.isArray(c.identityAnchors) && c.identityAnchors.length)
        ? c.identityAnchors.join('\n- ')
        : (c.identity || '');
      const wardrobe = (c.wardrobe && Array.isArray(c.wardrobe) && c.wardrobe.length)
        ? c.wardrobe.map(w => `  ${w.id} — ${w.prompt}`).join('\n')
        : '';
      const body = [
        `=== ${c.name} 角色生成 Prompt ===`,
        img.prompt ? img.prompt : '（cast.json 未提供 image.prompt）',
        '',
        identity ? `=== 不可变特征 Identity Lock（注入每个 Prompt 防脸崩）===\n- ${identity}` : '',
        wardrobe ? `=== 服装 Wardrobe ===\n${wardrobe}` : '',
        img.portrait ? `\n=== 参考图 Reference ===\n${img.portrait}` : (img.sheet ? `\n=== 参考图（设定板，仅作风格参考）===\n${img.sheet}` : '\n=== 参考图 ===\n（未提供，需先生成角色图）')
      ].filter(Boolean).join('\n');
      writeFileSync(join(dirs.characters, `${id}-${slugify(c.name)}.txt`), body + '\n');
      charN += 1;
    }
  }

  // ── 场景 Prompt（来自 art.json）──
  let sceneN = 0;
  if (ctx.art && Array.isArray(ctx.art.scenes)) {
    for (const s of ctx.art.scenes) {
      const lightingLines = (Array.isArray(s.lighting) ? s.lighting : [])
        .map(l => `  [${l.state}] ${l.prompt || ''}`).join('\n');
      const empty = s.image && s.image.prompt ? s.image.prompt : '（art.json 未提供空景提示词）';
      const body = [
        `=== ${s.name || s.id} 空景 Prompt ===`,
        empty,
        '',
        lightingLines ? `=== 光照状态 Lighting ===\n${lightingLines}` : '',
        s.image && s.image.negativePrompt ? `=== 反向提示词 ===\n${s.image.negativePrompt}` : ''
      ].filter(Boolean).join('\n');
      writeFileSync(join(dirs.scenes, `${s.id}-${slugify(s.name || s.id)}.txt`), body + '\n');
      sceneN += 1;
    }
  }

  // ── 道具 Prompt（来自 art.json）──
  let propN = 0;
  if (ctx.art && Array.isArray(ctx.art.props)) {
    for (const pr of ctx.art.props) {
      const states = (Array.isArray(pr.states) ? pr.states : [])
        .map(st => `  [${st.state}] ${st.prompt || ''}`).join('\n');
      const body = [
        `=== ${pr.name || pr.id} 道具 Prompt（白底无手）===`,
        pr.image && pr.image.prompt ? pr.image.prompt : '（art.json 未提供道具图提示词）',
        '',
        states ? `=== 状态变体 States ===\n${states}` : ''
      ].filter(Boolean).join('\n');
      writeFileSync(join(dirs.props, `${pr.id}-${slugify(pr.name || pr.id)}.txt`), body + '\n');
      propN += 1;
    }
  }

  // ── 镜头 Prompt（来自 storyboard 每条 shot 的 copy block）──
  let shotN = 0;
  for (const ep of doc.episodes || []) {
    for (const s of ep.shots || []) {
      const sd = join(dirs.shots, s.shotId);
      mkdirSync(sd, { recursive: true });
      const refLines = (s.refImagePaths && s.refImagePaths.length) ? s.refImagePaths.join('\n') : '（无）';
      writeFileSync(join(sd, 'first-frame.txt'), `${s.firstFrameCopyBlock || s.splitPrompt || '（未 autofill，无首帧提示词）'}\n`);
      writeFileSync(join(sd, 'negative.txt'), `${s.negativePrompt || '（无）'}\n`);
      // h3.txt 直接写完整 h3CopyBlock（含首帧引用句 "For the target video... <Picture 1> is fully referenced"），
      // 这是 I2VA 模式赖以定位首帧的关键信息；formatH3 仅 legacy 模式（无 h3CopyBlock）兜底。
      writeFileSync(join(sd, 'h3.txt'), (s.h3CopyBlock || (s.h3 ? formatH3(s.h3) : '（legacy 模式无 H3 提示词）')) + '\n');
      writeFileSync(join(sd, 'refs.txt'), `=== 本镜参考图 Reference（建议按景别取用）===\n${refLines}\n`);
      shotN += 1;
    }
  }

  console.error(`✓ 已导出 Prompt 包：${base}`);
  console.error(`  角色 ${charN} / 场景 ${sceneN} / 道具 ${propN} / 镜头 ${shotN}`);
  console.error(`  工作流：打开 → 复制 → 生成（角色/场景/道具供抽卡，shots/E01S001 供首帧+H3）`);
  return base;
}

// 把 h3 对象格式化成可读文本块（与 h3CopyBlock 同源但独立于渲染器）
function formatH3(h3) {
  if (typeof h3 === 'string') return h3 + '\n';
  const lines = [];
  if (h3.mode) lines.push(`mode: ${h3.mode}`);
  if (h3.integrated_multimodal_description) lines.push(`\n[integrated_multimodal_description]\n${h3.integrated_multimodal_description}`);
  if (h3.overall_soundscape) lines.push(`\n[overall_soundscape]\n${h3.overall_soundscape}`);
  if (h3.non_diegetic_music) lines.push(`\n[non_diegetic_music]\n${h3.non_diegetic_music}`);
  return lines.join('\n') + '\n';
}

function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd) { console.error('novel-storyboard v' + SCRIPT_VERSION); console.error('命令: seed | validate | checkup | render | batches | export | split'); process.exit(2); }
  switch (cmd) {
    case 'seed': return cmdSeed(rest);
    case 'validate': return cmdValidate(rest);
    case 'checkup': return cmdCheckup(rest);
    case 'render': return cmdRender(rest);
    case 'batches': return cmdBatches(rest);
    case 'export': return cmdExport(rest);
    case 'split': return cmdSplit(rest);
    default: console.error('未知命令: ' + cmd); process.exit(2);
  }
}

main();
