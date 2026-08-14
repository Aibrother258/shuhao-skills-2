[中文](README.md) · **English**

# novel-storyboard

Break a screenplay into a shot-level production sheet. Input is `script.json` from
`novel-script` (scenes + beat flow + dialogue); optionally reconcile against
`novel-art` (`art.json`), `novel-characters` (`cast.json`) and `novel-outline`
(`outline.json`). Output is `storyboard.json` with shot ids, shot types, camera,
durations, first-frame prompts, H3 video prompts and generation batches — plus MD/HTML
reports. Zero dependencies, no API keys.

"The script runs the drama; the storyboard runs the shoot." This skill is the last piece
between script and picture: one beat → one shot, nothing lost.

## Pipeline position

```
novel-script → script.json ──► novel-storyboard → storyboard.json
                                   │
                   ──► first-frame (Krea2) / video (MiniMax H3)
```

## Key design

- **1 beat = 1 shot** — complete coverage, and "script line changed" maps straight to the
  affected shots.
- **Lighting follows the script first** — the seed prefers the lighting written in the
  script scene, falling back to the art scene's first registered state only when the
  script leaves it empty.
- **Batches by scene + lighting** — same scene asset reused per batch, consistent and
  token-frugal.
- **Copy-paste blocks** — every shot carries `firstFrameCopyBlock` (for Krea2) and
  `h3CopyBlock` (for MiniMax H3), plus `refImagePaths` for character-reference images.
- **17 quality gates** — all deterministic, each with a break-through test case.

## Commands

```bash
node scripts/novel-storyboard.mjs seed <script.json> [--outline --art --cast] [--autofill] [--prompt-format h3|legacy] [--h3-mode i2va|t2va] [--eps 1-3] [--out 路径]
node scripts/novel-storyboard.mjs validate <storyboard.json> [--script --outline --art --cast]
node scripts/novel-storyboard.mjs checkup <storyboard.json>
node scripts/novel-storyboard.mjs render <storyboard.json> [--md|--html]
node scripts/novel-storyboard.mjs batches <storyboard.json>
```

The end-to-end ComfyUI workflow (first frames via Krea2, video via MiniMax H3 I2VA) is
documented in `demo/README.md`.

## Self-test

```bash
node scripts/selftest.mjs
```

19 assertions, no model calls.
