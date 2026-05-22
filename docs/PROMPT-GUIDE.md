# Prompt guide — how to write a channel's Scene Split prompt

This guide explains how to write a **Scene Split prompt** — the system prompt that tells the LLM (Gemini) how to slice your script into scenes and what kind of visuals to ask Grok for. It's the core of every **channel profile**.

You write it ONCE per channel on the **Channels & Prompts** page (Add new channel), then pick that channel from a dropdown on every New Run. No need to write per-scene prompts manually — Gemini generates them automatically from your channel's rules + your script.

Throughout this guide, "preset" and "channel profile" mean the same thing — a saved per-channel bundle whose main piece is the Scene Split prompt described here.

---

## What a preset must contain

Every preset has to cover **6 mandatory areas** for the pipeline to work correctly. If any is missing or wrong, the LLM either crashes the pipeline or produces unusable output.

### 1. Role / audience / tone (1–2 sentences)

Sets the channel identity. Example:

> *"You are the editor of a faceless YouTube longevity / women's health documentary channel. Audience: women 50–75. Tone: investigative documentary (Vox / BBC Earth), NOT clickbait."*

This anchors every visual decision downstream.

### 2. Scene length rules — **the most important section**

The pipeline uses xAI Grok via 69labs, which returns **fixed ~6-second clips** (we cannot ask for longer — 69labs runtime blocks it). If a scene's narration is longer than 6 s, the visual freezes on the last frame. If it's shorter than ~3.5 s, the Grok clip gets trimmed and you waste the credit.

So every preset MUST specify:

- **TARGET**: 8–13 words / ~3.5–5.5s narration
- **HARD MIN**: 7 words / 3.5s — anything shorter gets merged
- **HARD MAX**: 15 words / 6s — anything longer overshoots the clip

### 3. Sentence-handling rules

- **Cover the script verbatim** — no paraphrasing, no summarizing, no reordering. The pipeline relies on word-for-word equality between joined scenes and the original script.
- **Never split mid-sentence** — only at `.` `?` `!`. For raw transcribed style (no punctuation), split on natural narrator pauses (completed thoughts only).
- **Merge short fragments** — sentences shorter than 7 words ("zero.", "no supplement either.") get merged with the adjacent sentence into one scene. Combining sentences is allowed; splitting them is not.

### 4. Output JSON format — **REQUIRED**

The LLM must return strict JSON the pipeline can parse. Mandate:

```
{
  "text":              <verbatim slice of the script>,
  "visual_prompt":     <50–90 word English description of the shot>,
  "duration_hint_sec": <number, 3.5–6>
}
```

State in the preset that output must be:
- A strict JSON **array** (no markdown, no commentary, no code fences)
- No `text` field longer than 90 characters
- No `duration_hint_sec` greater than 6 or less than 3.5

If you skip this section, Gemini may wrap the array in markdown ```json blocks and the pipeline fails to parse.

### 5. Visual vocabulary — what to render

This is what gives your channel its branding. List 5–10 visual categories that match your niche, with concrete examples. For a Blue Zone documentary channel:

- **STATISTIC / DATA** scenes → pharmacy shelves, pill bottles, warm-amber microscope cells
- **LANDSCAPE** → region-specific establishing shots, golden hour, drone push-ins
- **FOOD / KITCHEN** → rustic tables, simmering stew, macro close-ups, warm earth tones
- **MODERN-MEDICINE CONTRAST** → sterile pharmacy aisles, cold fluorescents, blue-grey grading
- **ANONYMOUS ELDERLY** → weathered hands, backs of heads, silhouettes (NEVER faces close-up)
- **BIOLOGICAL MECHANISM** → warm macro-microscope, glowing molecules
- **ANTICIPATION / REVEAL** → slow push-in on single evocative object

The LLM picks one of these registers for each scene based on what the narration is literally about.

### 6. Hard bans (what to NEVER generate)

Grok will gladly generate clickbait or recognizable faces if you don't forbid it. Always include explicit bans:

- NO recognizable faces in close-up (Grok can't reliably render specific named people anyway)
- NO young people, NO children
- NO sick / hospitalized / frail imagery (channel is active aging, not decline)
- NO on-screen text or numbers as graphics (no "70%" overlays, no big bold digits)
- NO clickbait visuals (giant "5", before/after splits, red arrows)
- NO cartoon / fantasy / sci-fi / neon styling

---

## Continuity — the biggest quality lever

The default behavior of an LLM splitting a script is to treat each scene as an isolated visual prompt. The result is jarring — scene 1 is Sardinia, scene 2 is a cell microscope, scene 3 is Sardinia again but a different village. Feels like 100 unrelated stock clips, not one documentary.

To fix this, your preset should explicitly say:

> *"Treat the script as ONE film. Consecutive scenes on the same topic share the visual world — same village, same kitchen, same light, same palette. Topic shifts get intentional transitions (push-in on object / rack focus). Group contrasts in BLOCKS of 2–4 scenes — avoid Sardinia → pharmacy → Sardinia → pharmacy ping-pong."*

This single paragraph makes the output dramatically more cohesive.

---

## Optional: Region auto-detect

If you cover **multiple regions** under one channel theme (e.g. all the Blue Zones), include a region-detection block so the LLM picks the right visual vocabulary from the script itself:

> *"If narration names Okinawa/Ogimi → tropical Ryukyu farmhouses, banana leaves, turquoise sea. If Sardinia → stone villages, olive groves, terracotta palette. (etc.) Default to Sardinia if nothing named."*

Now the SAME preset handles videos about Okinawa OR Sardinia OR Ikaria — you don't need a separate preset per region.

---

## Optional: Animation Motion override

The `/prompts` page has a separate Animation Motion field on each preset. This is the **motion-style suffix** appended to every Grok video request — controls camera movement (slow dolly vs aggressive whip pans), pacing, breathing focus, etc.

Leave it empty in the preset to use the global default. Fill it in if you want a different motion style per channel — e.g. one channel uses contemplative slow drift, another uses energetic kinetic motion.

---

## Worked example — Blue Zone Longevity preset

This is the actual preset we use for longevity / Blue Zone documentary channels (audience 50–75, niche: menopause / hormonal aging / supplements debunk / Mediterranean diet). Copy-paste into a new preset as a starting point and edit to your niche.

```text
You are the editor of a faceless YouTube longevity / women's health / Blue Zone documentary channel. Audience: women 50–75. Tone: investigative documentary (Vox / BBC Earth), NOT clickbait.

Split the narrator transcript into scenes for an AI video pipeline (xAI Grok via 69labs, fixed ~6-second clips — scenes must NOT exceed clip length or visuals freeze).

═══ RULES ═══

1. Cover script VERBATIM. Joined `text` fields = original script word-for-word. No paraphrasing.
2. Never split mid-sentence. Sentence ends only at `.` `?` `!`. For raw transcribed style (no punctuation), split on natural pauses between complete thoughts.
3. SCENE LENGTH: 8–13 words / 3.5–5.5s narration. HARD MIN 7 words / 3.5s. HARD MAX 15 words / 6s. Past 6s the clip freezes on the last frame.
4. MERGE short fragments (<7 words, e.g. "zero.", "no supplement either.") with the nearest thematically connected sentence. Result ≤ 15 words. Sentence boundaries respected — we only COMBINE sentences, never split them.
5. When in doubt: longer scenes within the 6s cap > rapid cuts. Documentary pacing.
6. Section announcements, hook/foreshadow lines, and statistical claims each get their own scene. But if a stat is a short fragment, merge it (rule 4).
7. NO scenes under 3.5s except the very last scene of the script.

═══ CONTINUITY ═══

Treat the script as ONE film. Consecutive scenes on the same topic share the visual world (same village, same kitchen, same light, same palette). Topic shifts get intentional transitions (push-in on object / rack focus). Group contrasts in BLOCKS of 2–4 scenes — avoid Sardinia → pharmacy → Sardinia → pharmacy ping-pong.

═══ REGION DETECT ═══

If narration names a Blue Zone, anchor visuals in that region. Otherwise default to Sardinia.

• SARDINIA / OGLIASTRO — stone hilltop villages, terraced olive groves, dry-stone walls, terracotta palette
• OKINAWA / OGIMI — Ryukyu farmhouses, sugar cane, banana / goya leaves, turquoise sea, humid green palette
• IKARIA — whitewashed Greek villages, fig trees, Aegean blue
• NICOYA — dry tropical forests, oxen carts, Pacific coastline
• LOMA LINDA — California valley orchards, walnut groves, dry desert sunlight

═══ VISUAL CATEGORIES ═══

Pick what matches narration:
• STATISTIC / DATA — pharmacy shelves, pill bottles, warm-amber microscope cells, stacked research papers
• LANDSCAPE — region-specific establishing shots, golden hour, drone push-ins
• FOOD / KITCHEN — rustic tables, hand-kneaded bread, simmering stew, macro close-ups, warm earth tones
• MODERN-MEDICINE CONTRAST — sterile aisles, blister packs, cold fluorescents, blue-grey grading
• ANONYMOUS ELDERLY — weathered hands, backs of heads, silhouettes walking paths, grandmother stirring pot (over-shoulder). Always 60+, dignified, purposeful
• BIOLOGICAL MECHANISM — warm macro-microscope, glowing molecules through tissue, medical-illustration realism
• ANTICIPATION / REVEAL — slow push-in on single evocative object, empty negative space

═══ HARD BANS ═══

NO recognizable faces in close-up, NO young people / children, NO sick / frail / hospital imagery, NO on-screen text or numbers as graphics, NO clickbait visuals, NO cartoon / fantasy / sci-fi / neon styling.

═══ MOTION ═══

Always describe motion (slow dolly, gentle parallax, rack focus, golden-hour light shifting). Static descriptions freeze in the clip.

═══ OUTPUT ═══

Strictly valid JSON array — no markdown, no commentary. Per scene:
{ "text": <verbatim slice>, "visual_prompt": <50–90 words, composition + subject + motion + lighting>, "duration_hint_sec": <number 3.5–6> }

For a 3,000-word script expect 240–340 scenes. Any `text` > 90 chars OR `duration_hint_sec` > 6 = rule 3 violated, re-split with merge. Any scene under 3.5s = rule 4/7 violated, merge with neighbor.
```

---

## Adapting to other niches

The same structure works for any faceless YouTube niche. Just swap:

- **Role / tone** — match your channel ("conspiracy theory documentary", "tech explainer", "cooking how-to", etc.)
- **Visual vocabulary** — list what your channel actually shows ("cooking" → kitchens, ingredients, hands chopping; "tech" → screens, circuit close-ups, neon city lights)
- **Region / location anchors** — if relevant; otherwise drop the section
- **Hard bans** — what your channel never shows (each niche has its own list)

**Keep**:
- The scene length rules (the 6s cap is hard-coded by Grok via 69labs — applies to every niche)
- The output JSON format (the pipeline parser depends on it)
- The "treat the script as one film" continuity paragraph
- The hard ban on recognizable faces in close-up (Grok limitation, not niche-specific)

---

## Common mistakes

- **Forgetting the 6-second cap** → scenes freeze on the last frame
- **Forgetting the output JSON spec** → Gemini returns markdown that fails to parse
- **Allowing scenes under 3.5s** → wasted Grok credits + jarring rapid cuts
- **Listing only positive examples, no hard bans** → Grok generates clickbait or recognizable faces
- **Skipping the continuity paragraph** → the output looks like 100 unrelated stock clips
- **Trying to control individual scene prompts in the preset** — you can't. Gemini generates per-scene prompts automatically; you only define the rules. If you need specific visuals at specific moments, edit the script or use multiple presets.
