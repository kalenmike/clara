---
request: 1
slug: panel-toggles-show-red-when-the-agent-is-stopped
workspace: clara
pipeline: software@1
state: draft
created: 2026-11-02T01:47:01.197Z
---

# 001 — Panel toggles show red when the agent is stopped

## Intent

A user can tell at a glance, from the toggle colors alone, whether the services behind them are actually running: enabled toggles are green while the agent runs and red once 'Stop agent' has stopped it.

## Why

Stopping the agent disables the server controls but leaves the toggles green, so the panel reads as "services still active" when they are not. The color misreports state and undermines trust in the rest of the panel.

## Non-goals

- Changing the chips
- Moving or re-laying-out elements
- Changing any panel text or labels
- Changing toggle behavior, wiring, or what a click does
- Changing the enabled/disabled logic of the toggles
- Persisting or resetting toggle state differently than today

## Constraints

- Color of the enabled toggles is the only visual change
- Enabled toggles are green when the agent is running
- Enabled toggles are red when the agent is stopped
- Functionality and previous toggle state are unchanged by the stop/start cycle

## Not worth it if

If the panel already conveys stopped-ness unambiguously through a stronger signal (e.g. toggles disable and grey out plus a stopped banner), or if the toggles genuinely remain active while stopped — in which case red would be the lie and the real bug is elsewhere.

## Budget

soft: 40k tokens · hard: 90k tokens

## Docs impact

`docs/features/panel.md`: the feature switches' color semantics should name the
stopped state (green while running, red while stopped) alongside the existing
amber-to-green shell wording. No other doc changes.

## Checkpoints

_None yet._

## Acceptance criteria

| #   | Criterion                                                                                                                                                                                                 | Test                                     | Human gate |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------- |
| 1   | While the agent is running, the toggle accent rule yields the green enabled accent for an enabled toggle and leaves a disabled toggle on the existing disabled accent.                                    | apps/panel/src/lib/toggle-accent.test.ts | no         |
| 2   | While the agent is stopped, the same toggle accent rule yields the red stopped accent for an enabled toggle and leaves a disabled toggle on the existing disabled accent.                                 | apps/panel/src/lib/toggle-accent.test.ts | no         |
| 3   | Crossing the stop/start boundary changes only the accent: a toggle's enabled value is untouched, so starting again restores green on exactly the toggles that were enabled before Stop.                   | apps/panel/src/lib/toggle-accent.test.ts | no         |
| 4   | With the agent running, every enabled feature switch (OpenCode, local transport, relay, push) is green, matching today's running appearance.                                                              | —                                        | yes        |
| 5   | After Stop agent, every enabled feature switch is red and every disabled feature switch keeps its current disabled appearance; no chip, label, layout, or card-expansion behavior changes.                | —                                        | yes        |
| 6   | Loading the panel while the agent is already stopped shows enabled feature switches red on first paint, without a Stop action in that page session.                                                       | —                                        | yes        |
| 7   | After Start agent, enabled feature switches are green again with the exact pre-stop enabled set, and no toggle must be clicked to restore it.                                                             | —                                        | yes        |
| 8   | Scope gate: the shell, Traffic, and Client sync switches keep their current colors while the agent is stopped unless the human explicitly approves extending the red stopped treatment to them at review. | —                                        | yes        |

## Kill criteria

- The panel already conveys stopped-ness unambiguously through a stronger signal (e.g. toggles grey out plus a stopped banner), so red adds no information.
- The toggles genuinely remain active while the agent is stopped, making red inaccurate; the real bug would be elsewhere.
- Showing red requires changing toggle enable/disable logic, saved or restored toggle state, chips, labels, or layout.
- The work cannot stay inside the panel UI (for example it requires changing the agent's stopped state or snapshot shape).

- **#1** 2026-11-02T02:30:26.016Z — tests 3/3, 3 files, blocked: Frozen test apps/panel/src/lib/toggle-accent.test.ts imports type ToggleState (line 18) but never uses it. tsc -b fails with TS6133 and eslint fails with @typescript-eslint/no-unused-vars. Fixing requires editing the frozen test, which is prohibited., next: Human decides whether to amend the frozen test to remove the unused import (or use it) and re-freeze; implementation is otherwise complete and all 3 automated criteria pass.

- **#2** 2026-11-02T02:39:33.124Z — tests 3/3, 3 files, next: Human review of criteria 4-8 (running green, stopped red, first-paint stopped, start restores, shell/traffic/client-sync unchanged), then docs stage for docs/features/panel.md.

## Outcome

- Closed 2026-11-02T02:57:48.030Z in state `done` after the judge recorded every gate.
