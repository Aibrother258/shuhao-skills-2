[中文](README.md) · **English**

# novel-project

**Project control for AI short drama**: one `project.json` turns five skill outputs
(characters / outline / art / script / storyboard) into a trackable production line.

Each skill validates its own JSON, but nothing answered *"which show am I making, how far
along is it, and do the layers still line up?"* — until now:

```bash
node scripts/novel-project.mjs init <dir> --title Ferry --episodes 6   # scaffold a project
node scripts/novel-project.mjs status <project.json>                    # progress overview
node scripts/novel-project.mjs build <project.json>                     # what to run next
node scripts/novel-project.mjs verify <project.json>                    # cross-layer contracts
```

## What it actually checks

Only **cross-layer references** — it never re-runs each skill's internal gates. The four
classes of drift it catches that single-layer validators miss:

| Problem | Why single layers miss it |
| --- | --- |
| A script scene has no lighting state even though art registered one | script's validate treats an empty lighting as "not provided" and skips it |
| Storyboard lighting differs from the script scene | storyboard validates against art only, never back against the script |
| Episode count / duration drifts between layers | every layer compares only with itself |
| Dangling character / scene / prop ids | each layer validates only its own file |

Full rules live in `references/schema.md`. Missing files are **warnings, not errors** —
half-finished projects are normal; `build` tells you the next step.

## Commands

| Command | What it does |
| --- | --- |
| `init` | Scaffolds `project.json` (episodes, minutes, paths, statuses) |
| `status` | File presence + recorded state per layer; `--verify` also runs contracts |
| `verify` | Cross-layer contract check; `--write` persists per-skill verdicts into project.json |
| `build` | Walks the DAG (outline → characters → art → script → storyboard) and prints the next missing step; runs verify once everything exists |

## Self-test

```bash
node scripts/selftest.mjs
```

15 assertions, no model calls: template, episode alignment, id references, lighting
registration, duration targets, placeholder aggregation, build planning. Every contract
has a break-through case proving it actually blocks.
