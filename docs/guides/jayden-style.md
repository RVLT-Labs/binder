# Jayden's observed cue style

## Evidence and confidence
Derived from all 198 SQLite cue rows in the supplied DNAHG, SFANW and Spring Chicken examples. These are production-specific observations, not inviolable personal rules. PDF text/metadata inspection covered 125 pages, but DNAHG/SFANW's text layers mainly contain flattened cue/cast overlays over scanned script images. Only nine representative pages were visually inspected; the complete script bodies were not OCRed/read. Spring's PDF is a one-page allocation table, not a script. Do not claim comprehensive script reconciliation. More examples or Jayden's corrections override an inference below.

| Example | Cues | Integer / point | Default profiles | Used DCAs |
|---|---:|---:|---:|---|
| DNAHG | 106 | 95 / 11 | 21 | 1–6 |
| SFANW | 62 | 21 / 41 | 6 | 1–6 |
| Spring Chicken | 30 | 28 / 2 | 27 | 1–12 |

## Numbering and naming
**Jayden's explicit standing preference (overrides inference from older examples):** use blocks of ten for songs: song1 starts at10, song2 at20, song3 at30. Use intervening integer cues11,12,… for changes within that song before the next tens anchor. Reserve decimal point cues for later insertions/overflow only when needed; do not default to song2.10-style numbering. On a numbered running order, state whether numbered transitions receive their own blocks; do not silently renumber supplied script annotations. Update the .tmix and all companion cue references together on revisions.

- DNAHG uses tens as major numbered-song anchors: 10 District 12 Start, 20 The Reaping, through 180 District 12 Medley. Integers within blocks identify events; point insertions include 14.50, 47.70, 121.25. The ACT 1 filename does not limit actual content to Act 1.
- SFANW uses successive song integers (2 Opening through 20 Hear My Song; 21 POST SHOW), with detailed point cues under songs, including 2.45, 2.75, 3.25, 3.27. Do not coarsen to tenths.
- Spring uses scene tens and intervening song/event integers or points: 10 SCENE 1, 10.50 SONG 1, 31 SCENE 3 Cast Change, 35 SONG 3, 42 SONG 4, 45 SCENE 4:After Song 4.
- DNAHG/SFANW have 0.50 line-check rows; Spring starts at 1 New Cue. Preserve existing line-check identities on revision; an explicit new-show line-check state need not imitate a template row.
- Labels are concise operational descriptions, not formal prose: add/remove performer, title plus solo/backing state, SCENE CHANGE, LONG VERB TRIGGER, and page references. Do not deliberately copy stale names or typos to imitate style. Null solo DCA labels can use profile names; temporary groups/roles use custom labels.

## Granularity: mix states, not pages or every line
DNAHG PDF p9 holds cues22 and23; SFANW PDF p5 holds five cues2.50–2.80. Page-per-cue is contradicted by these examples. Several dialogue lines can share one state.

Representative paired evidence (PDF pages are 1-based):
- DNAHG p3 cue14 After Snow VO puts Katniss/Prim/Gale/Peeta on individual DCAs and shopkeepers on remaining controls. Stored14.50 further splits shopkeepers, but its exact GO was not verified in that page.
- DNAHG p9 cue22 Mom Time retains Katniss/Peeta and adds Mom; cue23 at Prim's entrance introduces Prim and upcoming Male/Female ensemble groups. State changes anticipate the passage, not each speaker turn.
- SFANW p3 cue2.10 Performer A Only; 2.20 keeps Performer A and adds Performer B for SINGING OVERLAPS; 2.30 changes to Performer C in a SHORT GAP. Preserve sustaining voices and distinguish a safe gap from an overlap.
- SFANW p5 cue2.50: Performer D solo plus Part A channels2,6,5 and Part B3,4. Cue2.80 changes to Part A3,6,4 and Part B2,1,5. Group membership changes with musical parts; labels are not fixed lists.
- SFANW p8 cue3.50 All Build up makes all six individually accessible. It anticipates the build rather than only the next printed singer.
- SFANW p10 cues4,4.50 LONG VERB TRIGGER,4.75 BACK TO NORMAL VERB all retain Performer A on DCA3. Extra cues may be operating reminders even with identical memberships. No populated FX/scene data proves automatic effects in these rows.

## DCA allocation
Prefer local continuity, not a permanent DCA per person. Adjacent continuing-channel comparisons show DNAHG 385 same-DCA /118 reassigned; SFANW53/22; Spring20/1. These exclude disappearing/reappearing channels and are not an optimisation target.

Katniss often occupies DNAHG DCA1 but moves to DCA2 while Effie takes1. Ensemble controls move between4/5 and5/6. SFANW Performer D can move from backing group to DCA3 to DCA5. For a new show preserve ergonomic continuity within a passage but allow deliberate changes for capacity and solo/group needs. Identify safe GO landmarks rather than shuffling every line.

All three examples have zero within-cue duplicate channel-to-DCA memberships. Prefer disjoint solo/group allocation. DNAHG has multi-channel groups in35 cues, SFANW12, Spring0. DNAHG extracts soloists from backing groups; SFANW has changing harmonic Part A/Part B groups. Do not infer membership from gender/group labels alone: DNAHG labels have operational exceptions. Ensemble templates are populated only in DNAHG; empty Male/Female templates elsewhere are not evidence of actual usage.

## Mic identity and integrations
All54 profiles are defaults with empty processing data. Cue channelProfiles and all actor tables are empty. No example demonstrates automated profile swaps or physical pack transfer. Multiple roles on a performer channel usually mean role doubling, not hardware sharing.

Spring allocation maps EW-DX1–10 to channels1–10 and ULXD1–17 to11–27, plus ULXD18 spare. Profile id17 maps to channel27: never use row/profile ID as channel. Performer F EW-DX3/ch3 is Offstage, Butch or Rat1 via contextual labels, not necessarily a physical swap.

SFANW has20 nonempty QLab identifiers, mostly structural anchors, e.g.2→1002,3→1003,10.50→1010.5. Cue9 has no QLab ID: do not extrapolate. DNAHG/Spring have none. Scene recall flags are enabled in two shows but all cue scene fields are empty. FX instruction names do not prove automation.

DNAHG32 cues and SFANW18 cues store lead/backing position intent: default Lead/LVox position id0 and Ensemble/EVox id2/id6; bus strings1201/1202. This is observed routing intent, not a verified universal bus mapping or inheritance rule. Do not flatten or discard it on revision. New-show tooling currently emits only a flat, no-routing draft until mappings are approved/tested.

## Do not perpetuate unresolved differences
- SFANW opening cue2 title says Performer D, but ch4 profile and rendered opening script indicate Performer E. Treat as stale-name discrepancy, not a personal convention.
- SFANW PDF p42 contains20.35; database lacks that row. Intended state unknown.
- DNAHG PDF p50 marks119 at Burned Reprise; database uses110 and has no119. Preserve literal discrepancy; do not silently renumber.
- Spring allocation has Thursday/Friday Performer G/Performer H role reversal. Saved profile labels appear to match Thursday, but filename does not prove date. Performer I's profile says Shep3/Benny while allocation says Sheep2/Benny and cue30 correctly says Sheep2.
- Spring's12 SONG rows have no DCA memberships. Their intent is unresolved: do not learn mute-all-song as Jayden's rule.
- Identical memberships are not grounds to delete a cue; timing, reminders, positions or integration can differ.

For each future show deliver cue trigger/page, confidence, exact assignments, transition notes and unresolved decisions alongside the draft. Ask for an explanation when a contradictory example would change the plan; otherwise retain the evidence and move on.
