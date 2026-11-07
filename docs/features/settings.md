# Settings

## Summary

Settings groups every Clara preference into eight tabs: Appearance,
Preferences, Pipelines, Models, Notifications, Sync, Shortcuts, and Advanced. A
device-local simplify switch keeps the common controls in view and hides the
detail rows that most people leave alone.

## User flow

1. Open **Settings** from the sidebar or the home screen.
2. The page opens on **Appearance**, where the light/dark/system mode and color
   theme live.
3. Use the tabs to reach **Preferences** for session wording, the default
   agent, and cost display, **Pipelines** for the built-in and custom request
   workflows, **Models** for provider and model visibility, **Notifications** for
   alerts and sounds, **Sync** for per-category settings sync, **Shortcuts** for
   the keyboard reference, and **Advanced** for the server connection and app
   build. On narrow screens the tab strip becomes a section menu.
4. In **Pipelines**, expand a pipeline to see its ordered stages. Open a stage to
   read its instructions, evidence, gate, and condition. The catalog is
   read-only.
5. Press the filter icon in the header to open **Filter settings**.
6. **Simplify settings** is on by default. Turn it off to see the full page.
7. With it on, the Notifications card shows one Inbox sounds switch instead of
   the four-state breakdown and volume slider, the Server card shows only
   Reconnect and Disconnect, and the App card shows only the version, update
   state, and cache reset.
8. Reload Clara or open it later; the same simplify choice is restored. The Sync
   tab is hidden when the home agent admin disables settings sync, the Pipelines
   tab is hidden in direct HTTP mode or when the build excludes Clara management,
   and the Shortcuts tab is hidden on touch-first devices.

## Core business rules

1. The simplify choice is stored locally under `clara.simplifySettings` and
   defaults to on for everyone, including people who never open the filter.
2. Tabs change only the layout, not the stored preferences. Switching tabs or
   simplifying the page never clears a setting.
3. In simplified mode, the primary **Inbox notification sounds** switch applies
   its new value to all four Inbox states in one action. Turning it on also
   restores the volume to 70%; turning it off leaves the volume alone. Turning
   simplify on by itself leaves the four stored state choices untouched.
4. Simplified Server keeps the recovery actions and any reconnect error, while
   hiding connection details. Simplified App keeps the version, update state,
   update action, and the clear-cache recovery action, while hiding build and
   runtime details.
5. The Sync tab contains category switches only. Each device stores its own
   choices; enabling a category can pull or push values, but the tab itself is
   never synchronized. See [sync](sync.md).
6. The Models tab hides providers and models from the composer. The whole
   visibility group is stored locally and syncs with the Models category; see
   [models](models.md).
7. The Pipelines tab is a read-only catalog. It reads from the home agent over
   the encrypted control channel, groups built-ins and custom files separately,
   and flags a custom file that replaces a preset. Editing and selecting
   pipelines from Settings is not available yet.
8. Every remaining control behaves the same as before. Simplification is a view
   filter, not a second settings model.
9. The **Cost display** choice is stored locally under `clara.costDisplay`,
   defaults to **Actual**, and is part of the Preferences sync category. It
   controls whether every cost surface shows the reported amount or an estimate
   from model prices.

## Edge cases

- **Storage unavailable** — private browsing or blocked storage keeps the choice
  in memory for the current tab and returns to the default (on) after a reload.
- **Two tabs open** — changing the switch in one tab updates the other through
  the browser storage event.
- **Partially muted Inbox states** — a device that muted one state before
  simplification still shows the primary switch as on while Inbox sounds are
  on. Toggling it off and back on applies the same value to every state.
- **Volume was lowered** — with the slider hidden, turning Inbox sounds on from
  simplified mode sets the volume back to 70% so a previously quiet level does
  not hide the alert.
- **Reconnect failure** — the error alert stays visible in simplified mode so
  the person can act on it.
- **Update ready** — the update row and **Update and reload** button stay in
  simplified mode.
- **Touch-first device** — the Shortcuts tab is absent, and the Notifications
  card keeps its existing desktop-only row rules.
- **Sync disabled by the agent** — the Sync tab disappears and the active section
  falls back to Appearance. Re-enabling sync makes it available again.
- **Direct OpenCode connection** — the Pipelines tab is absent because the home
  agent owns the pipeline files.
- **Clara management off** — the Pipelines tab stays visible with a notice that
  new requests will not run the listed pipelines.
- **Invalid custom pipeline** — the file appears in the custom section with its
  validation errors instead of an expandable stage list.
- **Older stored values** — a missing or unknown simplify value counts as on;
  no migration is needed.
- **Cost display value unknown** — an absent or invalid `clara.costDisplay`
  value counts as **Actual**; a synced value applies like any other preference.

## Out of scope

- Syncing the simplify choice, the Sync category choices, or the server-owned
  sync cadence between devices.
- Per-tab deep links or remembering the last open tab.
- Reordering or customizing the tab set.
- Hiding controls beyond the three simplified adjustments above.
- Editing, creating, deleting, reordering, or selecting pipelines from Settings;
  see [pipeline](pipeline.md).

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Route: `/settings`
- Simplify storage: `clara.simplifySettings` (`on` or `off`; missing means on)
- Simplify module: `src/features/settings/simplify-settings.ts` and
  `src/features/settings/use-simplify-settings.ts`
- Cost display card: `src/components/settings/cost-card.tsx`
- Cost display storage: `clara.costDisplay` (`actual` or `estimated`; missing
  means `actual`), module in `src/features/cost/cost-display.ts`
- Cost estimation: `src/features/cost/estimate.ts`
- Filter control: `src/components/settings/settings-filter.tsx`
- Page and tabs: `src/pages/settings-page.tsx`
- Pipelines card: `src/components/settings/pipelines-card.tsx`
- Pipeline rows and stage details: `src/components/settings/pipeline-row.tsx`,
  `src/components/settings/stage-detail-sheet.tsx`
- Pipeline catalog query: `src/features/pipelines/use-pipelines.ts`
- Models card: `src/components/settings/models-card.tsx`
- Model visibility: `src/features/models/visibility.ts`
- Sync card: `src/components/settings/sync-card.tsx`
- Sync categories and per-client preferences: `src/features/sync/`
- Simplified sound patch: `simplifiedInboxSoundPatch` and
  `DEFAULT_SOUND_VOLUME` in `src/features/notifications/settings.ts`
- Related: [theme](theme.md), [pipeline](pipeline.md), [models](models.md),
  [notifications](notifications.md), [sync](sync.md), [shortcuts](shortcuts.md),
  [connection](connection.md), [install](install.md),
  [capabilities](capabilities.md)

</details>
