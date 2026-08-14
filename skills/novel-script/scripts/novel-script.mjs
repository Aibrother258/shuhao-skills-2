#!/usr/bin/env node
// novel-script — deterministic helpers for the novel-script skill (剧本).
// Zero dependencies on purpose: the skill must work in any directory
// without an npm install. Node 18+ (stdlib only).

import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/* 时长引擎                                                             */
/* ------------------------------------------------------------------ */
/*
 * 剧本层不分镜头（分镜是下一个 skill 的活），但时长预算必须在这层守住：
 * AI 短剧一集就是三分钟上下，台词写超了后面全盘返工。
 *
 * 估算模型：台词秒数 = 非空白字符数 ÷ 语速；动作节拍按固定秒数计。
 * 是估算不是秒表，所以容差给到 ±15%（可配）——但估算也比不算强得多，
 * 一集写到五分钟的剧本在这里就会被拦下，不会流到生成环节才发现。
 */

export const DEFAULT_PARAMS = {
  charsPerSecond: 4.5, // 中文口语偏快档
  actionSeconds: 2.5,  // 每个动作节拍的估时
  tolerance: 0.15,     // 时长容差 ±15%
  maxLineChars: 35,    // 单句台词上限——一口气说不完的台词也生成不了
};

export function paramsOf(doc) {
  return { ...DEFAULT_PARAMS, ...(doc?.params ?? {}) };
}

/** 台词计秒用的字符数：去空白，标点算时间（停顿也是时间）。 */
export const lineChars = (line) => String(line ?? '').replace(/\s+/g, '').length;

const r1 = (n) => Math.round(n * 10) / 10;

/** 一场戏的估秒。flow 里台词按语速折算，动作节拍按固定秒数。 */
export function sceneSeconds(scene, params = DEFAULT_PARAMS) {
  let dlg = 0;
  let act = 0;
  for (const b of scene?.flow ?? []) {
    if (typeof b?.line === 'string') dlg += lineChars(b.line) / params.charsPerSecond;
    else if (typeof b?.action === 'string') act += params.actionSeconds;
  }
  return { dialogue: r1(dlg), action: r1(act), total: r1(dlg + act) };
}

/* ------------------------------------------------------------------ */
/* stats — 报告与质量门共用的确定性统计                                   */
/* ------------------------------------------------------------------ */

export function computeStats(doc) {
  const params = paramsOf(doc);
  const episodes = [];
  const sceneTable = [];
  const byCharacter = new Map(); // C01 → { lines: [...], chars }

  for (const ep of doc?.episodes ?? []) {
    let dlg = 0;
    let act = 0;
    let lines = 0;
    (ep?.scenes ?? []).forEach((sc, idx) => {
      const sec = sceneSeconds(sc, params);
      dlg += sec.dialogue;
      act += sec.action;
      let lineCount = 0;
      for (const b of sc?.flow ?? []) {
        if (typeof b?.line !== 'string') continue;
        lineCount++;
        lines++;
        const key = b.speaker ?? '?';
        if (!byCharacter.has(key)) byCharacter.set(key, { lines: [], chars: 0 });
        const entry = byCharacter.get(key);
        entry.lines.push({ ep: ep.ep, sceneIndex: idx + 1, sceneId: sc.sceneId, line: b.line, delivery: b.delivery ?? '' });
        entry.chars += lineChars(b.line);
      }
      sceneTable.push({
        ep: ep.ep, index: idx + 1, sceneId: sc.sceneId, lighting: sc.lighting ?? '',
        characters: sc.characters ?? [], props: sc.props ?? [],
        lineCount, estSeconds: sec.total,
      });
    });
    episodes.push({
      ep: ep.ep,
      target: ep.targetSeconds,
      est: r1(dlg + act),
      dialogueSeconds: r1(dlg),
      actionSeconds: r1(act),
      lines,
      sceneCount: (ep?.scenes ?? []).length,
    });
  }

  const totals = {
    episodes: episodes.length,
    scenes: sceneTable.length,
    lines: episodes.reduce((n, e) => n + e.lines, 0),
    estSeconds: r1(episodes.reduce((n, e) => n + e.est, 0)),
    targetSeconds: episodes.reduce((n, e) => n + (e.target ?? 0), 0),
    dialogueSeconds: r1(episodes.reduce((n, e) => n + e.dialogueSeconds, 0)),
  };

  const castLines = [...byCharacter.entries()]
    .map(([id, v]) => ({ id, count: v.lines.length, chars: v.chars, lines: v.lines }))
    .sort((a, b) => b.count - a.count);

  return { params, episodes, sceneTable, castLines, totals };
}

/* ------------------------------------------------------------------ */
/* 质量门                                                               */
/* ------------------------------------------------------------------ */
/*
 * 与仓库里其他 skill 同一主张：checklist 是代码，不是给模型读的文字。
 * 需要上游对账的门（角色 / 场景与光照 / 爽点认领）在没给上游文件时
 * 明说跳过——静默通过和撒谎只差一步。
 */

const thText = (s) => typeof s === 'string' && s.trim();
/** 动作描述必须是叙述体——台词只能进 dialogue 字段，混进 action 就没法计秒。 */
const QUOTE_RE = /「|」|『|』|“|”/;

export function gateReport(doc, ctx = {}) {
  const gates = [];
  const add = (id, label, ok, detail = '') => gates.push({ id, label, ok, detail });
  const eps = Array.isArray(doc?.episodes) ? doc.episodes : [];
  const params = paramsOf(doc);
  const stats = computeStats(doc);
  const bad = { duration: [], lineLen: [], speaker: [], hook: [], noAction: [], prose: [], beats: [], chars: [], scenes: [] };

  for (const [i, ep] of eps.entries()) {
    const st = stats.episodes[i];
    const label = `第 ${ep?.ep} 集`;

    // 时长预算：写超写欠都在这层拦，别流到生成环节才发现
    if (ep?.targetSeconds > 0) {
      const lo = ep.targetSeconds * (1 - params.tolerance);
      const hi = ep.targetSeconds * (1 + params.tolerance);
      if (st.est < lo) bad.duration.push(`${label}欠 ${r1(lo - st.est)} 秒（估 ${st.est}s / 目标 ${ep.targetSeconds}s）`);
      if (st.est > hi) bad.duration.push(`${label}超 ${r1(st.est - hi)} 秒（估 ${st.est}s / 目标 ${ep.targetSeconds}s）`);
    }

    // 开场钩子与结尾悬念：说明必须落在纸面
    if (!thText(ep?.hook) || !thText(ep?.cliff)) bad.hook.push(label);

    for (const sc of ep?.scenes ?? []) {
      const cast = new Set(sc?.characters ?? []);
      let hasAction = false;
      for (const b of sc?.flow ?? []) {
        if (typeof b?.action === 'string') {
          hasAction = true;
          if (QUOTE_RE.test(b.action)) bad.prose.push(`${label} ${sc?.sceneId ?? '?'}`);
        }
        if (typeof b?.line === 'string') {
          if (lineChars(b.line) > params.maxLineChars) {
            bad.lineLen.push(`${label}「${b.line.slice(0, 12)}…」${lineChars(b.line)} 字`);
          }
          if (b.speaker !== 'VO' && !cast.has(b.speaker)) {
            bad.speaker.push(`${label} ${sc?.sceneId ?? '?'} 的「${b.speaker}」不在本场人物里`);
          }
        }
      }
      // 纯对白无动作的场 = 广播剧，生成时没有画面可写
      if ((sc?.flow ?? []).length > 0 && !hasAction) bad.noAction.push(`${label} ${sc?.sceneId ?? '?'}`);
    }
  }

  // ---- 需要上游对账的门 ----
  const outline = ctx.outline ?? null;
  const art = ctx.art ?? null;

  if (outline) {
    const charIds = new Set((outline.characters ?? []).map((c) => c.id));
    for (const ep of eps) {
      for (const sc of ep?.scenes ?? []) {
        for (const id of sc?.characters ?? []) {
          if (!charIds.has(id)) bad.chars.push(`第 ${ep.ep} 集 ${sc.sceneId ?? '?'} 的 ${id}`);
        }
      }
      // 爽点认领：大纲说这一集有的爆点，剧本必须认领
      const due = [...new Set((outline.beats ?? []).filter((b) => b.episode === ep.ep).map((b) => b.type))];
      const claimed = new Set(ep?.beatsClaimed ?? []);
      for (const t of due) if (!claimed.has(t)) bad.beats.push(`第 ${ep.ep} 集缺「${t}」`);
    }
  }

  if (art) {
    const sceneMap = new Map((art.scenes ?? []).map((s) => [s.id, s]));
    const propIds = new Set((art.props ?? []).map((p) => p.id));
    for (const ep of eps) {
      for (const sc of ep?.scenes ?? []) {
        const ref = sceneMap.get(sc?.sceneId);
        if (!ref) {
          bad.scenes.push(`第 ${ep.ep} 集引用了不存在的场景 ${sc?.sceneId}`);
        } else if (thText(sc?.lighting) && !(ref.lighting ?? []).some((l) => l.state === sc.lighting)) {
          bad.scenes.push(`第 ${ep.ep} 集 ${sc.sceneId} 的光照「${sc.lighting}」没在美术设定里登记`);
        }
        for (const pid of sc?.props ?? []) {
          if (!propIds.has(pid)) bad.scenes.push(`第 ${ep.ep} 集引用了不存在的道具 ${pid}`);
        }
      }
    }
  }

  const SKIP_OUTLINE = '未提供 outline.json，本门跳过（视为通过）';
  const SKIP_ART = '未提供 art.json，本门跳过（视为通过）';

  add('duration', `每集时长在目标 ±${Math.round(params.tolerance * 100)}% 内`, eps.length > 0 && bad.duration.length === 0, bad.duration.join('；'));
  add('line-length', `单句台词 ≤ ${params.maxLineChars} 字`, bad.lineLen.length === 0, bad.lineLen.join('；'));
  add('speaker', '说话人在本场人物里，或明确标画外音 VO', bad.speaker.length === 0, bad.speaker.join('；'));
  add('hook-cliff', '每集开场钩子与结尾悬念都落在纸面', eps.length > 0 && bad.hook.length === 0, bad.hook.join('；'));
  add('has-action', '每场至少一个动作节拍——纯对白的场是广播剧', eps.length > 0 && bad.noAction.length === 0, bad.noAction.join('；'));
  add('action-prose', '动作描述叙述体，台词只进 dialogue 字段', bad.prose.length === 0, bad.prose.join('；'));
  add('beats-claimed', '大纲爽点逐集认领', bad.beats.length === 0, outline ? bad.beats.join('；') : SKIP_OUTLINE);
  add('refs-characters', '角色引用对账大纲', bad.chars.length === 0, outline ? bad.chars.join('；') : SKIP_OUTLINE);
  add('refs-scenes', '场景／光照／道具对账美术设定', bad.scenes.length === 0, art ? bad.scenes.join('；') : SKIP_ART);

  return gates;
}

/* ------------------------------------------------------------------ */
/* validate                                                            */
/* ------------------------------------------------------------------ */

export function validateScript(doc, ctx = {}) {
  const problems = [];
  const p = (msg) => problems.push(msg);
  if (!doc || typeof doc !== 'object') return ['script.json 不是对象'];

  if (!thText(doc.source)) p('缺少 source（剧名/书名）');
  const eps = doc.episodes;
  if (!Array.isArray(eps) || eps.length === 0) {
    p('episodes 为空');
    return problems;
  }

  const seen = new Set();
  for (const ep of eps) {
    const label = `第 ${ep?.ep ?? '?'} 集`;
    if (!Number.isInteger(ep?.ep) || ep.ep < 1) p(`${label}的 ep 必须是正整数`);
    if (seen.has(ep?.ep)) p(`集号 ${ep.ep} 重复`);
    seen.add(ep?.ep);
    if (!(ep?.targetSeconds > 0)) p(`${label}缺 targetSeconds（目标秒数，来自大纲的单集时长）`);
    if (!Array.isArray(ep?.beatsClaimed)) p(`${label}缺 beatsClaimed（认领的爽点，可为空数组）`);
    if (!Array.isArray(ep?.scenes) || ep.scenes.length === 0) {
      p(`${label}没有场次`);
      continue;
    }
    ep.scenes.forEach((sc, i) => {
      const sLabel = `${label}第 ${i + 1} 场`;
      if (!/^S\d{2,}$/.test(sc?.sceneId ?? '')) p(`${sLabel} sceneId 必须是 S01 这种格式`);
      if (!Array.isArray(sc?.characters)) p(`${sLabel}缺 characters（本场人物，空镜给空数组）`);
      if (!Array.isArray(sc?.flow) || sc.flow.length === 0) p(`${sLabel}的节拍流为空`);
      for (const b of sc?.flow ?? []) {
        const isAction = typeof b?.action === 'string';
        const isLine = typeof b?.line === 'string';
        if (isAction === isLine) {
          p(`${sLabel}有节拍既不是动作也不是台词（action 与 line 二选一）`);
          continue;
        }
        if (isAction && !b.action.trim()) p(`${sLabel}有空动作节拍`);
        if (isLine) {
          if (!b.line.trim()) p(`${sLabel}有空台词`);
          if (!thText(b.speaker)) p(`${sLabel}有台词缺 speaker`);
        }
      }
    });
  }

  for (const g of gateReport(doc, ctx)) {
    if (!g.ok) p(`质量门未过：${g.label}${g.detail ? `（${g.detail}）` : ''}`);
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* seed — 从 outline.json 确定性预填骨架                                 */
/* ------------------------------------------------------------------ */
/*
 * 目标秒数、钩子、悬念、该集爽点在大纲里都是现成的——这些事实不让
 * 模型重新想。scenes 留空给模型写戏。
 */

export function seedFromOutline(outline, epRange = null) {
  const perEp = (outline?.params?.minutesPerEpisode ?? 3) * 60;
  const inRange = (n) => !epRange || (n >= epRange[0] && n <= epRange[1]);
  const episodes = (outline?.episodes ?? [])
    .filter((e) => inRange(e.ep))
    .map((e) => ({
      ep: e.ep,
      targetSeconds: perEp,
      hook: e.hook ?? '',
      cliff: e.suspense ?? '',
      beatsClaimed: [...new Set((outline.beats ?? []).filter((b) => b.episode === e.ep).map((b) => b.type))],
      scenes: [],
      // 从大纲搬来的参考，写完删掉也行
      seedNote: `大纲梗概：${e.synopsis ?? ''}　候选场景：${(e.sceneIds ?? []).join('、')}　人物：${(e.characterIds ?? []).join('、')}`,
    }));
  return { source: outline?.source ?? '', episodes };
}

/* ------------------------------------------------------------------ */
/* slug                                                                */
/* ------------------------------------------------------------------ */

export function slug(name) {
  const cleaned = String(name)
    .trim()
    .replace(/[\s/\\:*?"<>|·]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'script';
}

/* ------------------------------------------------------------------ */
/* render — 界面文案                                                    */
/* ------------------------------------------------------------------ */
/* v1 只有中文。全部收在这张表里，加语言时换成按 lang 取值的表。 */

const T = {
  kicker: '剧本',
  docTitle: (s, a, b) => `${s} · 剧本${a === b ? `（第 ${a} 集）` : `（第 ${a}–${b} 集）`}`,
  exportJson: '导出 JSON',
  gates: '质量门',
  gatesPass: '全部通过',
  gatesFail: (n) => `${n} 项未过`,
  gatePill: (okN, total) => `质量门 ${okN} / ${total}`,
  kpi: {
    eps: '集数', epsSub: (sc) => `${sc} 场戏`,
    time: '预估总时长', timeSub: (t) => `目标 ${t}`,
    lines: '台词', linesSub: (sec) => `约 ${sec} 秒对白`,
    dlgRatio: '台词占比', dlgRatioSub: '其余是画面与动作',
    avgScene: '平均每场', avgSceneSub: '换景是统计不是门——AI 换景不要钱',
  },
  secTiming: '时长仪表',
  secScript: '分集剧本',
  secSceneTable: '场次总表',
  secCastLines: '台词本',
  secGates: '质量门',
  timingNote: (tol) => `绿带 = 目标 ±${tol}%；台词按语速折算，动作按节拍估时`,
  scriptNote: '一排两集 · 场次信息超高自动截断，点开看全部',
  sceneTableNote: '自动汇总 · 模型不写',
  castLinesNote: '按角色聚合 · 列表最多显示 6 行可滚动 · 直接对接 TTS 批量生成',
  hookLabel: '开场钩子',
  cliffLabel: '结尾悬念',
  beatsLabel: '认领爽点',
  estLabel: (est, target) => `预估 ${est} 秒 / 目标 ${target} 秒`,
  sceneHead: (i) => `第 ${i} 场`,
  voLabel: '画外音',
  lightingLabel: '光照',
  showScenes: '▾ 展开全部场次',
  hideScenes: '▴ 收起场次',
  sceneCols: ['集', '场', '场景', '光照', '人物', '台词句数', '估秒'],
  castCols: ['角色', '台词句数', '字数', '约合秒数'],
  copyAllLines: '复制全部台词',
  copy: '复制', copied: '已复制', copyFailed: '复制失败',
  lineRef: (ep, i) => `E${String(ep).padStart(2, '0')} 第 ${i} 场`,
  dlgSec: (s) => `${s} 秒`,
  colophon: '剧本由模型依据大纲与美术设定生成，时长与引用由脚本确定性检查。分镜与首帧提示词是下一层的事，不在本报告里。',
};

/* ------------------------------------------------------------------ */
/* render — markdown                                                   */
/* ------------------------------------------------------------------ */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const mdRow = (cells) => `| ${cells.map((c) => String(c ?? '').replace(/\|/g, '\\|')).join(' | ')} |`;
const mdHead = (cols) => [mdRow(cols), mdRow(cols.map(() => '---'))].join('\n');

/** 显示名：给了上游映射就用名字，否则裸 ID。 */
function namer(ctx = {}) {
  const charName = new Map((ctx.outline?.characters ?? []).map((c) => [c.id, c.name]));
  const sceneName = new Map((ctx.art?.scenes ?? []).map((s) => [s.id, s.name]));
  const propName = new Map((ctx.art?.props ?? []).map((p) => [p.id, p.name]));
  return {
    char: (id) => (id === 'VO' ? T.voLabel : charName.get(id) ?? id),
    scene: (id) => sceneName.get(id) ?? id,
    prop: (id) => propName.get(id) ?? id,
  };
}

export function renderMarkdown(doc, ctx = {}) {
  const t = T;
  const n = namer(ctx);
  const stats = computeStats(doc);
  const eps = doc.episodes;
  const first = eps[0]?.ep;
  const last = eps[eps.length - 1]?.ep;
  const out = [`# ${t.docTitle(doc.source, first, last)}`, ''];

  for (const [i, ep] of eps.entries()) {
    const st = stats.episodes[i];
    out.push(`## 第 ${ep.ep} 集`, '');
    out.push(`> ${t.estLabel(st.est, ep.targetSeconds)} · ${t.hookLabel}：${ep.hook} · ${t.cliffLabel}：${ep.cliff}`);
    if (ep.beatsClaimed.length) out.push(`> ${t.beatsLabel}：${ep.beatsClaimed.join('、')}`);
    out.push('');
    ep.scenes.forEach((sc, idx) => {
      out.push(`### ${t.sceneHead(idx + 1)} · ${n.scene(sc.sceneId)}${sc.lighting ? `（${sc.lighting}）` : ''}`, '');
      if (sc.characters.length) out.push(`人物：${sc.characters.map(n.char).join('、')}${sc.props?.length ? `　道具：${sc.props.map(n.prop).join('、')}` : ''}`, '');
      for (const b of sc.flow) {
        if (typeof b.action === 'string') out.push(b.action, '');
        else out.push(`**${n.char(b.speaker)}**${b.delivery ? `（${b.delivery}）` : ''}：${b.line}`, '');
      }
    });
  }

  out.push('---', '', `## ${t.secSceneTable}`, '', mdHead(t.sceneCols));
  for (const row of stats.sceneTable) {
    out.push(mdRow([row.ep, row.index, n.scene(row.sceneId), row.lighting, row.characters.map(n.char).join('、'), row.lineCount, row.estSeconds]));
  }
  out.push('', `## ${t.secCastLines}`, '', mdHead(t.castCols));
  for (const c of stats.castLines) {
    out.push(mdRow([n.char(c.id), c.count, c.chars, r1(c.chars / stats.params.charsPerSecond)]));
  }
  out.push('');
  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* render — html                                                       */
/* ------------------------------------------------------------------ */
/*
 * 与另外三份报告同一套视觉语言：冷灰印张 + 铁锈红印记，1600 宽，
 * 零外部依赖。设计约定见 references/report-style.md。
 */

function embedDoc(doc) {
  return JSON.stringify(doc).replace(/</g, '\\u003c');
}

export function renderHtml(doc, ctx = {}) {
  const t = T;
  const n = namer(ctx);
  const stats = computeStats(doc);
  const gates = gateReport(doc, ctx);
  const failed = gates.filter((g) => !g.ok);
  const eps = doc.episodes;
  const first = eps[0]?.ep;
  const last = eps[eps.length - 1]?.ep;
  const tolPct = Math.round(stats.params.tolerance * 100);

  const fmtMin = (sec) => `${Math.floor(sec / 60)} 分 ${Math.round(sec % 60)} 秒`;
  const dlgRatio = stats.totals.estSeconds ? Math.round((stats.totals.dialogueSeconds / stats.totals.estSeconds) * 100) : 0;
  const avgScene = stats.totals.scenes ? r1(stats.totals.estSeconds / stats.totals.scenes) : 0;

  // ---- 时长仪表：每集一行，目标区间画成绿带，台词/动作堆叠 ----
  const scaleMax = Math.max(...stats.episodes.map((e) => Math.max(e.est, (e.target ?? 0) * (1 + stats.params.tolerance)))) * 1.08;
  const timingRows = stats.episodes
    .map((e) => {
      const lo = e.target * (1 - stats.params.tolerance);
      const hi = e.target * (1 + stats.params.tolerance);
      const inBand = e.est >= lo && e.est <= hi;
      const pct = (v) => `${r1((v / scaleMax) * 100)}%`;
      const status = inBand ? '' : e.est > hi ? ` <b class="over">超 ${r1(e.est - hi)} 秒</b>` : ` <b class="over">欠 ${r1(lo - e.est)} 秒</b>`;
      return `<div class="trow">
  <span class="tep">E${String(e.ep).padStart(2, '0')}</span>
  <div class="track">
    <span class="band" style="left:${pct(lo)};width:${pct(hi - lo)}"></span>
    <span class="fill dlg" style="width:${pct(e.dialogueSeconds)}"></span>
    <span class="fill act" style="left:${pct(e.dialogueSeconds)};width:${pct(e.actionSeconds)}"></span>
  </div>
  <span class="tval${inBand ? ' okc' : ''}">${e.est}s / ${e.target}s${status}</span>
</div>`;
    })
    .join('\n');

  // ---- 分集剧本 ----
  const epBlocks = eps
    .map((ep, i) => {
      const st = stats.episodes[i];
      const scenesHtml = ep.scenes
        .map((sc, idx) => {
          const flow = sc.flow
            .map((b) =>
              typeof b.action === 'string'
                ? `<p class="act-line">${esc(b.action)}</p>`
                : `<div class="dlg-line"><span class="who">${esc(n.char(b.speaker))}${b.delivery ? `<i>${esc(b.delivery)}</i>` : ''}</span><span class="said">${esc(b.line)}</span><button class="copy mini" data-copy="${esc(b.line)}">${esc(t.copy)}</button></div>`,
            )
            .join('\n');
          return `<section class="scene-blk">
  <header class="scene-h">
    <b>${esc(t.sceneHead(idx + 1))}</b>
    <span class="chip">${esc(sc.sceneId)} ${esc(n.scene(sc.sceneId))}</span>
    ${sc.lighting ? `<span class="chip lite">${esc(t.lightingLabel)} · ${esc(sc.lighting)}</span>` : ''}
    ${sc.characters.map((id) => `<span class="chip">${esc(n.char(id))}</span>`).join('')}
    ${(sc.props ?? []).map((id) => `<span class="chip prop">${esc(n.prop(id))}</span>`).join('')}
  </header>
  ${flow}
</section>`;
        })
        .join('\n');
      return `<article class="ep" id="ep-${ep.ep}">
  <header class="ep-h">
    <span class="ep-n">E${String(ep.ep).padStart(2, '0')}</span>
    <span class="ep-est">${esc(t.estLabel(st.est, ep.targetSeconds))}</span>
    ${ep.beatsClaimed.map((b) => `<i class="bt">${esc(b)}</i>`).join('')}
  </header>
  <div class="hk"><b>${esc(t.hookLabel)}</b><span>${esc(ep.hook)}</span></div>
  <div class="scenes clip">
  ${scenesHtml}
  </div>
  <button class="scmore">${esc(t.showScenes)}</button>
  <div class="hk cliff"><b>${esc(t.cliffLabel)}</b><span>${esc(ep.cliff)}</span></div>
</article>`;
    })
    .join('\n');

  // ---- 场次总表 / 台词本 ----
  const table = (cols, rows) =>
    `<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('\n')}</tbody></table>`;

  const sceneRows = stats.sceneTable.map((row) => [
    String(row.ep), String(row.index), esc(`${row.sceneId} ${n.scene(row.sceneId)}`), esc(row.lighting),
    esc(row.characters.map(n.char).join('、')), String(row.lineCount), String(row.estSeconds),
  ]);

  const castBlocks = stats.castLines
    .map((c) => {
      const allText = c.lines.map((l) => l.line).join('\n');
      return `<section class="cast-blk">
  <header class="cast-h">
    <b>${esc(n.char(c.id))}</b>
    <span class="cast-meta">${c.count} 句 · ${c.chars} 字 · 约 ${r1(c.chars / stats.params.charsPerSecond)} 秒</span>
    <button class="copy" data-copy="${esc(allText)}">${esc(t.copyAllLines)}</button>
  </header>
  <ol class="cast-lines">${c.lines.map((l) => `<li><i>${esc(t.lineRef(l.ep, l.sceneIndex))}</i><span>${esc(l.line)}</span>${l.delivery ? `<em>${esc(l.delivery)}</em>` : ''}</li>`).join('')}</ol>
</section>`;
    })
    .join('\n');

  const gateList = `<ul class="gate">
  ${gates
    .map(
      (g) => `<li class="${g.ok ? 'ok' : 'bad'}"><span class="m">${g.ok ? '✓' : '✗'}</span><span>${esc(g.label)}${
        (!g.ok && g.detail) || (g.ok && g.detail.includes('跳过')) ? `<small>${esc(g.detail)}</small>` : ''
      }</span></li>`,
    )
    .join('\n  ')}
</ul>`;

  return `<!doctype html>
<html lang="zh"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.docTitle(doc.source, first, last))}</title>
<style>
:root{
  --paper:#eceded; --panel:#f5f6f5; --side:#e4e6e3; --ink:#191d21; --ink-2:#5b636a; --ink-3:#8c9298;
  --rule:#d2d5d0; --rule-2:#c2c6bf; --seal:#8a3324; --seal-2:#c56a4e; --seal-soft:#8a332412; --ok:#3d6b4f;
  --band:#3d6b4f22;
  --serif:"Songti SC","STSong","Source Han Serif SC","Noto Serif CJK SC",Georgia,serif;
  --sans:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,-apple-system,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.7 var(--sans);-webkit-font-smoothing:antialiased}
.page{max-width:1600px;margin:0 auto;padding:24px 32px 90px}
h1,h2,h3{margin:0;font-weight:400}

.hd{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;border-bottom:2px solid var(--ink);padding-bottom:12px}
.hd h1{font:400 28px/1.1 var(--serif);letter-spacing:.06em}
.hd .sub{font-size:13px;color:var(--ink-2)}
.hd .right{margin-left:auto;display:flex;align-items:center;gap:10px}
.gatepill{display:inline-flex;align-items:center;gap:6px;font:500 12px/1 var(--sans);border-radius:99px;padding:6px 12px}
.gatepill.pass{color:var(--ok);border:1px solid var(--ok)}
.gatepill.fail{color:var(--seal);border:1px solid var(--seal);background:var(--seal-soft)}
.expo{font:500 11px/1 var(--sans);color:var(--ink-2);background:var(--panel);
  border:1px solid var(--rule-2);border-radius:2px;padding:7px 11px;cursor:pointer;transition:.15s}
.expo:hover{border-color:var(--seal);color:var(--seal)}
.expo:focus-visible{outline:2px solid var(--seal);outline-offset:2px}

.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:18px 0 6px}
@media(max-width:980px){.kpis{grid-template-columns:repeat(2,1fr)}}
.kpi{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:11px 14px 9px}
.kpi .l{font:500 10px/1 var(--sans);letter-spacing:.18em;color:var(--ink-3)}
.kpi .v{font:400 28px/1.15 var(--serif);margin-top:5px}
.kpi .v small{font:400 14px var(--serif);color:var(--ink-2)}
.kpi .d{font-size:11px;color:var(--ink-2);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kpi.accent{border-top:2px solid var(--seal)}
.galert{margin:14px 0 0;border:1px solid var(--seal);background:var(--seal-soft);border-radius:2px;
  padding:10px 14px;font-size:13px}
.galert b{color:var(--seal)}
.galert span{display:block;font-size:12px;color:var(--ink-2)}

section.top-sec{margin-top:34px}
.sec-h{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--rule-2);padding-bottom:8px;margin-bottom:16px}
.sec-h .no{font:500 12px/1 var(--mono);color:var(--seal)}
.sec-h h2{font:400 20px/1.2 var(--serif);letter-spacing:.05em}
.sec-h .note{margin-left:auto;font-size:12px;color:var(--ink-3)}

/* 时长仪表 */
.timing{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:16px 20px 10px}
.trow{display:grid;grid-template-columns:44px minmax(0,1fr) 220px;gap:12px;align-items:center;padding:5px 0}
.tep{font:500 12px/1 var(--mono);color:var(--ink-2)}
.track{position:relative;height:18px;background:var(--paper);border:1px solid var(--rule);border-radius:2px;overflow:hidden}
.band{position:absolute;top:0;bottom:0;background:var(--band)}
.fill{position:absolute;top:2px;bottom:2px;border-radius:1px}
.fill.dlg{left:0;background:var(--seal)}
.fill.act{background:var(--seal-2)}
.tval{font:500 12px/1.5 var(--sans);color:var(--ink-2)}
.tval.okc{color:var(--ok)}
.tval .over{color:var(--seal);font-weight:600}
.legend{display:flex;gap:18px;font-size:12px;color:var(--ink-2);margin:8px 0 2px}
.legend i{font-style:normal;display:inline-flex;align-items:center;gap:6px}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px}

/* 分集剧本：一排两集；场次区默认最多 300px，渐隐截断，点开展开 */
.eps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}
.eps.solo{grid-template-columns:minmax(0,1fr)}
@media(max-width:1100px){.eps{grid-template-columns:minmax(0,1fr)}}
.ep{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:18px 22px}
.scenes{position:relative}
.scenes.clip{max-height:300px;overflow:hidden}
.scenes.clip::after{content:'';position:absolute;left:0;right:0;bottom:0;height:70px;
  background:linear-gradient(180deg,transparent,var(--panel));pointer-events:none}
.scmore{display:block;width:100%;margin-top:8px;font:500 11.5px/1 var(--sans);letter-spacing:.06em;
  color:var(--ink-2);background:var(--paper);border:1px solid var(--rule-2);border-radius:2px;
  padding:7px 0;cursor:pointer;transition:.15s}
.scmore:hover{border-color:var(--seal);color:var(--seal)}
.scmore:focus-visible{outline:2px solid var(--seal);outline-offset:2px}
.ep-h{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--rule-2);padding-bottom:10px}
.ep-n{font:400 22px/1 var(--serif);letter-spacing:.04em;color:var(--seal)}
.ep-est{font-size:12.5px;color:var(--ink-2)}
.bt{font-style:normal;font-size:11px;padding:2px 8px;border:1px solid var(--seal);border-radius:99px;color:var(--seal)}
.hk{display:grid;grid-template-columns:70px minmax(0,1fr);gap:10px;font-size:13px;padding:10px 0;border-bottom:1px solid var(--rule)}
.hk.cliff{border-bottom:0;border-top:1px solid var(--rule)}
.hk b{font:500 11px/1.9 var(--sans);letter-spacing:.14em;color:var(--seal)}
.scene-blk{margin-top:14px}
.scene-h{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;margin-bottom:8px}
.scene-h b{font:500 13px var(--serif);letter-spacing:.06em}
.chip{font:400 10.5px/1.6 var(--mono);border:1px solid var(--rule-2);border-radius:2px;
  padding:0 6px;background:var(--paper);color:var(--ink-2)}
.chip.lite{border-color:var(--seal-2);color:var(--seal-2)}
.chip.prop{border-color:var(--seal);color:var(--seal)}
.act-line{margin:8px 0;font:400 13.5px/1.9 var(--sans);color:var(--ink-2)}
.dlg-line{display:grid;grid-template-columns:150px minmax(0,1fr) auto;gap:12px;align-items:baseline;
  padding:5px 0 5px 10px;border-left:2px solid var(--rule-2)}
.dlg-line:hover{border-left-color:var(--seal)}
.who{font:500 13px/1.6 var(--serif)}
.who i{display:block;font:400 11px var(--sans);color:var(--ink-3);font-style:normal}
.said{font:400 14.5px/1.8 var(--serif)}
.dlg-line .copy{opacity:0;transition:.15s}
.dlg-line:hover .copy{opacity:1}

/* 表格 */
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--rule);font-size:13px}
th,td{padding:8px 12px;border-bottom:1px solid var(--rule);text-align:left;vertical-align:top}
th{font:500 11px/1 var(--sans);letter-spacing:.1em;color:var(--ink-3);background:var(--side)}
tr:last-child td{border-bottom:0}
td:first-child{font-family:var(--mono);font-size:12px;color:var(--ink-2);white-space:nowrap}

/* 台词本：一排两个；列表最多 6 行高，纵向滚动 */
.casts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}
@media(max-width:1100px){.casts{grid-template-columns:minmax(0,1fr)}}
.cast-blk{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:14px 18px}
.cast-h{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--rule-2);padding-bottom:8px}
.cast-h b{font:400 17px/1.2 var(--serif);letter-spacing:.04em}
.cast-meta{font-size:12px;color:var(--ink-2)}
.cast-h .copy{margin-left:auto}
.cast-lines{margin:8px 0 0;padding:0 6px 0 0;list-style:none;max-height:186px;overflow-y:auto;
  scrollbar-width:thin;scrollbar-color:var(--rule-2) transparent}
.cast-lines::-webkit-scrollbar{width:6px}
.cast-lines::-webkit-scrollbar-thumb{background:var(--rule-2);border-radius:3px}
.cast-lines li{display:grid;grid-template-columns:110px minmax(0,1fr) auto;gap:12px;align-items:baseline;
  padding:4.5px 0;border-top:1px solid var(--rule);font-size:13px}
.cast-lines li:first-child{border-top:0}
.cast-lines i{font:400 11px/1.8 var(--mono);color:var(--ink-3);font-style:normal}
.cast-lines span{font-family:var(--serif)}
.cast-lines em{font-style:normal;font-size:11.5px;color:var(--ink-3)}

.copy{flex:none;font:500 11px/1 var(--sans);color:var(--ink-2);background:var(--paper);
  border:1px solid var(--rule-2);border-radius:2px;padding:4px 10px;cursor:pointer;transition:.15s}
.copy:hover{border-color:var(--seal);color:var(--seal)}
.copy:focus-visible{outline:2px solid var(--seal);outline-offset:2px}
.copy[data-done]{border-color:var(--seal);color:var(--seal)}
.copy.mini{padding:2px 7px;font-size:10.5px}

.gate{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:2px 28px}
@media(max-width:900px){.gate{grid-template-columns:1fr}}
.gate li{display:flex;gap:8px;padding:5px 0;font-size:12.5px;line-height:1.55}
.gate .m{flex:none;font-weight:700}
.gate li.ok .m{color:var(--ok)}
.gate li.bad .m{color:var(--seal)}
.gate li.bad{background:var(--seal-soft);border-radius:2px;padding-left:6px}
.gate small{display:block;color:var(--ink-3)}
.gsum{margin:10px 0 0;font-size:12px;color:var(--ink-2)}
.gsum b{color:var(--seal)}

.foot{margin-top:40px;font-size:11px;color:var(--ink-3);border-top:1px solid var(--rule);padding-top:14px}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media print{
  .expo,.copy,.scmore{display:none!important}
  .scenes.clip{max-height:none}
  .scenes.clip::after{display:none}
  .cast-lines{max-height:none;overflow:visible}
  .eps,.casts{grid-template-columns:minmax(0,1fr)}
  .page{max-width:none;padding:0}
  section.top-sec,.ep,.cast-blk{page-break-inside:avoid}
  body{background:#fff}
}
</style></head><body>
<div class="page">

<header class="hd">
  <h1>${esc(doc.source)}</h1>
  <span class="sub">${esc(t.kicker)}${first === last ? ` · 第 ${first} 集` : ` · 第 ${first}–${last} 集`}</span>
  <span class="right">
    <span class="gatepill ${failed.length ? 'fail' : 'pass'}">${failed.length ? '✗' : '✓'} ${esc(t.gatePill(gates.length - failed.length, gates.length))}</span>
    <button class="expo" data-name="${esc(slug(doc.source))}-script.json">${esc(t.exportJson)}</button>
  </span>
</header>

<div class="kpis">
  <div class="kpi accent"><div class="l">${esc(t.kpi.eps)}</div><div class="v">${stats.totals.episodes}</div><div class="d">${esc(t.kpi.epsSub(stats.totals.scenes))}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.time)}</div><div class="v">${esc(fmtMin(stats.totals.estSeconds))}</div><div class="d">${esc(t.kpi.timeSub(fmtMin(stats.totals.targetSeconds)))}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.lines)}</div><div class="v">${stats.totals.lines} <small>句</small></div><div class="d">${esc(t.kpi.linesSub(stats.totals.dialogueSeconds))}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.dlgRatio)}</div><div class="v">${dlgRatio}<small>%</small></div><div class="d">${esc(t.kpi.dlgRatioSub)}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.avgScene)}</div><div class="v">${avgScene} <small>秒</small></div><div class="d">${esc(t.kpi.avgSceneSub)}</div></div>
</div>
${failed.length ? `<div class="galert"><b>✗ ${esc(t.gatesFail(failed.length))}</b>${failed.map((g) => `<span>${esc(g.label)}${g.detail ? ` — ${esc(g.detail)}` : ''}</span>`).join('')}</div>` : ''}

<section class="top-sec" id="sec-timing">
  <div class="sec-h"><span class="no">01</span><h2>${esc(t.secTiming)}</h2><span class="note">${esc(t.timingNote(tolPct))}</span></div>
  <div class="timing">
    <div class="legend">
      <i><span class="sw" style="background:var(--seal)"></span>台词</i>
      <i><span class="sw" style="background:var(--seal-2)"></span>动作</i>
      <i><span class="sw" style="background:var(--band)"></span>目标区间</i>
    </div>
${timingRows}
  </div>
</section>

<section class="top-sec" id="sec-script">
  <div class="sec-h"><span class="no">02</span><h2>${esc(t.secScript)}</h2><span class="note">${eps.length > 1 ? esc(t.scriptNote) : ''}</span></div>
  <div class="eps${eps.length > 1 ? '' : ' solo'}">
${epBlocks}
  </div>
</section>

<section class="top-sec" id="sec-scenes">
  <div class="sec-h"><span class="no">03</span><h2>${esc(t.secSceneTable)}</h2><span class="note">${esc(t.sceneTableNote)}</span></div>
  ${table(t.sceneCols, sceneRows)}
</section>

<section class="top-sec" id="sec-cast">
  <div class="sec-h"><span class="no">04</span><h2>${esc(t.secCastLines)}</h2><span class="note">${esc(t.castLinesNote)}</span></div>
  <div class="casts">
${castBlocks}
  </div>
</section>

<section class="top-sec" id="sec-gates">
  <div class="sec-h"><span class="no">05</span><h2>${esc(t.secGates)}</h2></div>
  ${gateList}
  <p class="gsum">${failed.length ? `<b>${esc(t.gatesFail(failed.length))}</b>` : esc(t.gatesPass)}</p>
</section>

<p class="foot">${esc(t.colophon)}</p>
</div>

<script type="application/json" id="script-data">${embedDoc(doc)}</script>
<script>
const L = ${JSON.stringify({ copied: T.copied, failed: T.copyFailed, show: T.showScenes, hide: T.hideScenes })};

// 分集剧本：场次区默认最多 300px。不够高的集直接放开；超高的集点开/收起
document.querySelectorAll('.scmore').forEach((btn) => {
  const zone = btn.previousElementSibling;
  if (zone.scrollHeight <= 320) {
    zone.classList.remove('clip');
    btn.remove();
    return;
  }
  btn.addEventListener('click', () => {
    const clipped = zone.classList.toggle('clip');
    btn.textContent = clipped ? L.show : L.hide;
    if (clipped) zone.closest('.ep').scrollIntoView({ block: 'nearest' });
  });
});

// 复制按钮（单句台词 / 整个角色的台词本）
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy');
  if (!btn) return;
  e.preventDefault();
  const label = btn.textContent;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    btn.textContent = L.copied;
    btn.dataset.done = '1';
  } catch {
    btn.textContent = L.failed;
  }
  setTimeout(() => { btn.textContent = label; delete btn.dataset.done; }, 1600);
});

// 导出：报告自己带着完整的 script.json，下载的是它原样
document.querySelector('.expo').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const url = URL.createObjectURL(
    new Blob([document.getElementById('script-data').textContent], { type: 'application/json' }),
  );
  const a = Object.assign(document.createElement('a'), { href: url, download: btn.dataset.name });
  a.click();
  // 别立刻回收——Safari 会抢在下载读完之前撤掉 blob
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
</script>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const USAGE = `novel-script.mjs — novel-script skill 的确定性工具（剧本）

  seed <outline.json> [--eps 1-6]           从大纲预填每集骨架（打印到 stdout）
  validate <script.json> [--outline o.json] 校验；有违规逐条打印并 exit 1
           [--art a.json]                   给了上游才做对账（角色 / 场景光照道具 / 爽点认领）
  checkup <script.json> [--outline] [--art] 只打印质量门 ✓/✗，有未过项 exit 1
  render <script.json> [--html|--md]        渲染报告到 stdout（默认 --md）
         [--outline o.json] [--art a.json]  给了上游就把 ID 显示成名字
  slug <name>                               剧名转安全文件名`;

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

function flag(rest, name, fallback = null) {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback;
}

function loadCtx(rest) {
  const outlinePath = flag(rest, '--outline');
  const artPath = flag(rest, '--art');
  return {
    outline: outlinePath ? readJson(outlinePath) : null,
    art: artPath ? readJson(artPath) : null,
  };
}

function main(argv) {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.log(USAGE);
    process.exit(cmd ? 0 : 1);
  }

  if (cmd === 'seed') {
    const [path] = rest;
    if (!path) throw new Error('用法：seed <outline.json> [--eps 1-6]');
    const range = flag(rest, '--eps');
    let epRange = null;
    if (range) {
      const m = String(range).match(/^(\d+)-(\d+)$/) ?? String(range).match(/^(\d+)$/);
      if (!m) throw new Error('--eps 形如 3 或 1-6');
      epRange = m[2] ? [Number(m[1]), Number(m[2])] : [Number(m[1]), Number(m[1])];
    }
    console.log(JSON.stringify(seedFromOutline(readJson(path), epRange), null, 2));
    return;
  }

  if (cmd === 'validate' || cmd === 'checkup') {
    const [path] = rest;
    if (!path) throw new Error(`用法：${cmd} <script.json> [--outline o.json] [--art a.json]`);
    const doc = readJson(path);
    const ctx = loadCtx(rest);
    if (!ctx.outline) console.error('⚠️ 没给 --outline，跳过角色引用与爽点认领检查');
    if (!ctx.art) console.error('⚠️ 没给 --art，跳过场景／光照／道具对账');

    if (cmd === 'checkup') {
      const gates = gateReport(doc, ctx);
      for (const g of gates) console.log(`${g.ok ? '✓' : '✗'} ${g.label}${!g.ok && g.detail ? ` — ${g.detail}` : ''}`);
      const failedN = gates.filter((g) => !g.ok).length;
      console.log(failedN ? `\n✗ ${failedN} 项未过` : '\n✓ 全部通过');
      if (failedN) process.exit(1);
      return;
    }

    const problems = validateScript(doc, ctx);
    if (problems.length) {
      console.error(`✗ ${problems.length} 处违规：\n`);
      for (const x of problems) console.error('  ' + x);
      process.exit(1);
    }
    const st = computeStats(doc);
    console.log(`✓ ${st.totals.episodes} 集 / ${st.totals.scenes} 场 / ${st.totals.lines} 句台词全部通过校验（预估 ${st.totals.estSeconds}s / 目标 ${st.totals.targetSeconds}s）`);
    return;
  }

  if (cmd === 'render') {
    const [path] = rest;
    if (!path) throw new Error('用法：render <script.json> [--html|--md] [--outline o.json] [--art a.json]');
    const doc = readJson(path);
    const ctx = loadCtx(rest);
    process.stdout.write((rest.includes('--html') ? renderHtml(doc, ctx) : renderMarkdown(doc, ctx)) + '\n');
    return;
  }

  if (cmd === 'slug') {
    if (!rest[0]) throw new Error('用法：slug <name>');
    console.log(slug(rest[0]));
    return;
  }

  throw new Error(`未知命令 ${cmd}\n\n${USAGE}`);
}

// 软链安装时 argv[1] 是链接路径，两边都取 realpath 才能比得上
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  // `render ... | head` 这类管道提前关闭时安静退出，别甩 EPIPE 堆栈
  process.stdout.on('error', (e) => {
    if (e.code === 'EPIPE') process.exit(0);
    throw e;
  });
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
