[中文](README.md) · **English**

# h3-prompt-writing

Write MiniMax H3 video-generation prompts: rewrite a multimodal request into the
three-field structure (`integrated_multimodal_description` / `overall_soundscape` /
`non_diegetic_music`) for base modes, or the six-section full-reference rewrite for Ref2VA.

This skill is pure spec plus examples — **no API calls**:

- `references/base-en.txt` — final prompt structure for T2VA / I2VA / FL2VA / L2VA
- `references/ref-en.txt` — Ref2VA: subject_definitions / summary / retention_analysis / detailed_description / soundscape / music

It also serves as the H3 spec source for `novel-storyboard` — every shot's
`h3CopyBlock` is generated against these conventions. If you change the spec, run the
self-test first, then re-check the storyboard example.

## Self-test

```bash
node scripts/selftest.mjs
```

8 assertions: field names and order, reference phrasing, timestamps, `<d>` dialogue
wrapping, retention-analysis verdicts. No model calls.
