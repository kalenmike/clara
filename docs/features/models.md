# Model visibility

## Summary

The Models tab controls which providers and models appear in the reply
composer. It also shows each model's capabilities, limits, pricing, cache
prices, and variants so people can decide what to keep.

## User flow

1. Open **Settings → Models**.
2. Filter the list between **All**, **Free**, and **Paid** models.
3. Provider sections start collapsed. Click a provider name or chevron to see
   its models.
4. Use the switch on a provider row to show or hide every model from that
   provider.
5. Use the switch on a model row to hide just that model.
6. Read the detail row under each model for capabilities, context and output
   limits, input and output modalities, cost, cache prices, family, release
   date, status, and variants.
7. Use **Disable all** to hide every provider at once, or **Enable all** to
   restore every provider and model.
8. Open the composer model picker. Hidden providers and models are absent, and
   the picker only lists models the server marks as enabled.
9. If the open session is stored on a hidden model, the composer shows **No
   model** and waits for a visible model before it can send.

## Core business rules

1. Provider and model choices are one local preference stored under
   `clara.hiddenModels`. The whole group syncs through the **Models** category,
   never as individual provider or model keys.
2. Hiding a provider hides all of its models. Individual model choices are kept
   separately, so showing the provider again restores them.
3. While a provider is hidden, its model switches are disabled. The provider
   switch is the way back.
4. Only models the server reports as enabled are listed and can be made visible.
   A server-disabled model never returns to the composer just because its local
   switch is on.
5. A model is **Free** when every cost tier has zero input, output, cache read,
   and cache write prices. An empty cost list is also free. Any positive price
   makes the model **Paid**.
6. Hidden models disappear from the composer picker and variant menu. New or
   forwarded sessions do not inherit a hidden model.
7. A session already stored on a hidden model opens with **No model** attached.
   Send and the queued-send menu stay disabled until the person picks a visible
   model. The stored model is not changed until then.

## Edge cases

- **Storage unavailable** — private browsing or blocked storage keeps the group
  in memory for the current tab and returns to everything visible after reload.
- **Catalog still loading** — the page reports that models are loading instead of
  claiming the list is empty.
- **Catalog request fails** — the card shows the error and a retry action.
- **Filter has no matches** — the list explains that no free or paid models are
  available for that filter.
- **Every model hidden** — the composer picker shows its empty state and points
  back to Settings → Models, where **Enable all** remains available.
- **Model or provider removed from the server** — stale hidden IDs are harmless
  and disappear from the list naturally. **Enable all** clears them too.
- **Provider list unavailable** — the card falls back to the provider ID as its
  heading while the model list still works.
- **Host-prefixed OpenCode provider** — the `opencode` provider always shows as
  **OpenCode**, even when the server prefixes its name with the host name.
- **Hidden model on an old session** — history, session cards, and token usage
  stay intact; only the composer's attached model and picker change.
- **Visibility sync conflict** — the whole group is replaced by the agent's
  snapshot. Individual toggles are never merged across devices.
- **Server-disabled model** — it is omitted from the settings list and cannot be
  selected in the composer.

## Out of scope

- Installing, authenticating, enabling, or editing providers.
- Per-model sync switches or merging individual visibility changes across
  devices.
- Automatically switching a hidden session to a fallback model.
- Hiding historical messages, token usage, or session metadata that mention a
  hidden model.
- Reordering providers or pinning favourite models.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Route: `/settings` with the **Models** tab
- Storage: `clara.hiddenModels` with
  `{ providers: string[], models: string[] }`
- Model key: `<providerID>/<modelID>`
- Visibility module: `src/features/models/visibility.ts`
- React hook: `src/features/models/use-model-visibility.ts`
- Settings card: `src/components/settings/models-card.tsx`,
  `src/components/settings/model-provider-row.tsx`, and
  `src/components/settings/model-details.tsx`
- Composer filtering: `src/components/chat/model-picker.tsx` and
  `src/components/chat/composer.tsx`
- Session inheritance: `src/features/sessions/use-start-session.ts` and
  `src/features/sessions/use-forward-message.ts`
- Sync field: Models in `src/features/sync/fields.ts`
- Catalog queries: `client.model.list()` and `client.provider.list()`
- Related: [settings](settings.md), [composer](composer.md),
  [sessions](sessions.md), [sync](sync.md),
  [capabilities](capabilities.md)

</details>
