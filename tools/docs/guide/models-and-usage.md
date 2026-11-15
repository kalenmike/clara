---
title: Models and usage
description: Choose visible models, read usage, and switch cost display modes.
sidebar_position: 7
---

# Models and usage

## Pick a model

The composer's **To** row opens the model picker. It lists only models the server
has enabled and that you have not hidden. Choosing a model changes the session
immediately. If the model has variants, the variant menu appears beside it.

A new session inherits the model of the most recent active session in the
workspace you start it in. A workspace that has no earlier session starts on the
harness's own default; a model from another workspace is not carried over. A
model hidden for that harness in Settings is not inherited either; the new
session starts on the harness default.

## Hide models and providers

Open **Settings → Models**.

1. Choose **All harnesses** or one paired harness. This is a view filter, not a
   default harness.
2. Filter the list with **All**, **Free**, or **Paid**.
3. Expand a provider to see its models.
4. Use a provider switch to show or hide every model from that harness and
   provider.
5. Use a model switch to hide just that model on that harness.
6. **Disable all** hides every provider on one harness. **Enable all** or
   **Show all** restores them.

Each model row shows capabilities, context and output limits, modalities, cost,
cache prices, family, release date, status, and variants.

If the open session is stored on a hidden model, the composer shows **No model**
and Send stays disabled until you pick a visible one. Picking a model does not
change the stored session history.

## Read usage

The bar along the bottom of a chat shows:

- Input, output, reasoning, and cache tokens.
- Cost in the selected display mode.
- How long ago the session started.

These are server session totals, so older history pages do not reduce them. The
right panel's Info tab has the same detail with message counts, timing, and model
limits.

## Actual or estimated cost

**Settings → Preferences → Cost display** has two modes:

- **Actual** shows the amount reported by the server.
- **Estimated** derives the cost from model prices and marks it with `~`.

The estimate uses the same price entries as the Models tab, including context
tiers.

## Related

- [Settings](settings.md)
- [Chat and approvals](chat.md)
- [Self-hosting configuration](self-hosting/configuration.md)
