# Feature specs

A feature spec explains what a feature does for the people who use it and the rules that shape it.

Feature docs live under `docs/features/`. Keep one canonical doc per topic and
edit the existing file instead of adding a second version. Generated per-request
records live in `docs/records/NNN-slug.md`; they are append-only audit artifacts,
not canonical docs, and stay out of the index.

## Folder option

Use a folder when a topic has **3–5 related specs**: an overview plus one page per
concern. A flat spec stays one file.

```text
docs/features/
  connection.md    # flat spec, one topic
  chat/
    index.md       # folder overview
    approvals.md
    composer.md
    fork.md
```

The folder index is an overview, not a sixth spec. It carries the shared rules
for every child and a **Read when** table naming each child. Do not nest deeper
than `docs/features/<topic>/`: a child is a page, not another folder.

## Index rules

- `docs/README.md` indexes the top-level docs under `docs/` and the docs inside
  the section folders (`architecture/`, `features/`). It lists each topic folder
  by its `index.md`, never its children.
- `docs/architecture/` and `docs/features/` are section folders indexed by the
  root index, so they have no `index.md` of their own.
- A topic folder inside a section folder (`docs/features/chat/`) must have an
  `index.md`, and that index lists its direct children: sibling `.md` files and
  child folder indexes. Other links on the page are cross-references.
- Every page under `docs/` except `docs/records/` must be reachable from
  `docs/README.md`. An index cannot link to a missing file.

## Required structure

Every spec, including a folder index, has these H2s. The docs checker enforces
them, and `Known gaps` stays optional.

1. **Summary** — 1–2 sentences: what the feature does, who it is for, and why.
2. **User flow** — 5–8 numbered steps describing what the user clicks and sees.
3. **Core business rules** — 3–5 constraints that actually drive behavior.
4. **Edge cases** — 5–10 bullets covering failures and partial success.
5. **Out of scope** — explicit non-goals that stop scope creep.
6. **Technical appendix** — a collapsed `<details>` block for routes and links.

## Length

- **Hard cap: 150 lines** per file under `docs/features/`, including frontmatter
  and the collapsed appendix. 80–150 is the target range; 150 is enforced.
- A reference page may reach **300 lines** when its frontmatter contains
  `kind: reference`. Use it for field tables and enumerations, not for flow.
- `GUIDE.md`, `capabilities.md`, and reference pages are exempt from the spec
  shape. `capabilities.md` still obeys the 150-line cap.

## Writing rules

- Do **not** list every file path, database column, or unit test name.
- Do **not** write FR-1…FR-N inventories; state the rules in plain language.
- Link to [capabilities.md](capabilities.md) for shipped scope; never restate it.
- Document current behavior and put mismatches under Known gaps.
- Relative links only, and every link must resolve.
- If the change is visible to people using Clara, update the matching page under
  `tools/docs/guide/` in the same change. The guide describes what people do; a
  feature spec describes how it works.

## Skeleton

```text
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

## Technical appendix
<details>
<summary>Routes, data, and references</summary>

- ...

</details>
```
