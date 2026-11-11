# Feature specs

A feature spec explains what a feature does for the people who use it and the rules that shape it.

Feature docs live in `docs/features/<topic>.md` and are listed in
[docs/README.md](../README.md). Keep one canonical doc per topic and edit the
existing file instead of adding a second version.

Generated per-request records live in `docs/records/NNN-slug.md`. They are
append-only audit artifacts, not canonical docs, and are not listed in the
index.

## Required structure

1. **Summary** — 1–2 sentences: what the feature does, who it is for, and why it matters.
2. **User flow** — 5–8 numbered steps describing what the user clicks and sees.
3. **Core business rules** — 3–5 constraints that actually drive behavior. State
   them in plain language; do not build an FR-1…FR-N inventory.
4. **Edge cases** — 5–10 bullets covering failures, missing data, and partial
   success.
5. **Out of scope** — explicit non-goals that stop scope creep.
6. **Known gaps** — optional and short; only where documentation and code
   disagree.
7. **Technical appendix** — a collapsed `<details>` block at the bottom for key
   routes, data, and links.

## Writing rules

- Target **80–150 lines** per feature spec. If it grows, move detail into the
  appendix or link to a canonical doc.
- Do **not** list every file path, database column, or unit test name.
- Do **not** write FR-1…FR-N inventories; state the rules in plain language.
- Link to [capabilities.md](../features/capabilities.md) for shipped scope; never
  restate it.
- Document current behavior and put mismatches under Known gaps.
- Prefer user language over implementation language.
- One canonical doc per topic; edit the existing feature doc.
- Relative links only, and every link must resolve.
- If the change is visible to people using Clara, update the matching page under
  `apps/docs/guide/` in the same change. The guide describes what people do; a
  feature spec describes how it works.

## Skeleton

```markdown
# Feature name

## Summary

...

## User flow

1. ...

## Core business rules

1. ...

## Edge cases

- ...

## Out of scope

- ...

## Known gaps

- ...

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- ...

</details>
```
