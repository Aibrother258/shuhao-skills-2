#!/usr/bin/env node
// 仓库级规范检查：每个 skill 必须满足硬要求，防止 h3 那种漏网之鱼再发生。
// 零依赖，node >= 18 直接跑：
//   node scripts/check.mjs            只查结构
//   node scripts/check.mjs --run      结构通过后再把每个 selftest 跑一遍

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = resolve(import.meta.dirname, '..');
const skillsDir = join(repo, 'skills');
const errors = [];
const warnings = [];

function frontmatter(raw) {
  const m = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return fm;
}

const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

if (!skillDirs.length) {
  console.error('✗ skills/ 目录下没有 skill');
  process.exit(1);
}

for (const name of skillDirs) {
  const dir = join(skillsDir, name);
  const label = `skills/${name}`;
  const skillPath = join(dir, 'SKILL.md');

  if (!existsSync(skillPath)) {
    errors.push(`${label} 缺 SKILL.md`);
    continue;
  }
  const raw = readFileSync(skillPath, 'utf8');
  const fm = frontmatter(raw);
  if (!fm) {
    errors.push(`${label} SKILL.md 缺 frontmatter`);
  } else {
    for (const field of ['name', 'version', 'description']) {
      if (!fm[field]) errors.push(`${label} frontmatter 缺 ${field}`);
    }
    if (fm.name !== name) warnings.push(`${label} frontmatter.name 与目录名不一致（${fm.name}）`);
  }

  for (const f of ['scripts/selftest.mjs', 'README.md', 'README.en.md']) {
    if (!existsSync(join(dir, f))) errors.push(`${label} 缺 ${f}（仓库硬要求）`);
  }
}

for (const w of warnings) console.log(`⚠ ${w}`);
for (const e of errors) console.log(`✗ ${e}`);

if (errors.length) {
  console.log(`\n结果：错误 ${errors.length} / 警告 ${warnings.length}`);
  process.exit(1);
}

console.log(`✓ ${skillDirs.length} 个 skill 结构全部达标（警告 ${warnings.length}）`);

if (process.argv.includes('--run')) {
  console.log('\n跑全部自测：');
  let fail = 0;
  for (const name of skillDirs) {
    const test = join(skillsDir, name, 'scripts', 'selftest.mjs');
    if (!existsSync(test)) continue;
    const r = spawnSync(process.execPath, [test], { stdio: 'inherit', cwd: join(skillsDir, name) });
    console.log('');
    if (r.status !== 0) {
      console.log(`✗ ${name} 自测失败`);
      fail += 1;
    } else {
      console.log(`✓ ${name} 自测通过`);
    }
  }
  if (fail) {
    console.log(`\n自测失败 ${fail} 个`);
    process.exit(1);
  }
  console.log('\n全部自测通过');
}
