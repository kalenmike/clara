# Theme

## Summary

Clara chooses a color theme independently from light, dark, or system mode. It
ships Default, Solarized, Tokyo Night, Gruvbox, Nord, Rose Pine, Catppuccin, and
Clara, and people can add a theme from a JSON file or pasted document. Imported
themes are data, not CSS: only allowlisted color tokens are accepted, so a theme
can recolor the app but cannot inject a stylesheet.

## User flow

1. Open **Settings → Appearance** and choose **Light**, **Dark**, or **System**.
2. Pick a palette from the swatch grid.
3. Choose **Import theme**, then upload a `.json` file or paste the JSON. The
   dialog reports problems while typing and previews the light and dark result
   once the document is valid.
4. Press **Add theme**; Clara stores it, selects it, and applies it immediately.
5. Remove a custom theme with its bin button. Removing the active theme falls
   back to Default.
6. Reload Clara or return later; the selected palette and custom list are
   restored. `ctrl+x` then `t` toggles light and dark without changing palette.
7. With **Theme** sync on, the custom list and selection appear on the other
   paired devices; see [sync](sync.md).

## Core business rules

1. **Mode and palette are independent.** Every palette supplies both variants.
2. **Default is the hardcoded base.** `:root` and `.dark` in `tokens.css` define
   it, so the app has styles before JavaScript runs, before a hub is paired, and
   in standalone surfaces. Selecting Default clears every inline token. Named
   palettes live in `themes.json` and apply at runtime; `data-theme` records the
   selected id but no longer selects a CSS block.
3. **An imported theme is never CSS.** The document is versioned JSON with a
   `name`, a `light` map, and a `dark` map. Keys must be known color tokens.
   Values are hex colors, CSS color functions, or `var(--token)` pointing at
   another allowlisted token. Semicolons, braces, quotes, backslashes, `@`, `!`,
   control characters, `url()`, `attr()`, and every other CSS construct are
   rejected. Both variants are required and must set `background`, `foreground`,
   `primary`, and `primary-foreground`; other tokens fall back to Default.
4. **Limits.** A name is 48 characters, a value 120, a theme 16 KB, one device
   keeps 20 custom themes, an import file is 64 KB, and the synchronized catalog
   is 60 KB. Ids are generated once as `custom-` plus eight hex characters and
   never come from the file, so an upload cannot shadow a built-in palette.
5. **Local first, sync opt-in.** The selection and custom list are stored in
   `localStorage`. With Theme sync on, the hub stores both keys plaintext and
   wins on a pull; the catalog applies before the selection so a theme that
   arrived with the id can resolve. Applying sets allowlisted custom properties
   inline on the document root; a mode observer swaps variants when `.dark`
   changes.

## Edge cases

- **Invalid JSON or unknown token** — the dialog lists the failing paths and
  nothing is stored.
- **CSS injection or unsupported color** — values with declaration syntax,
  remote resources, unsupported references, or a color the browser rejects are
  refused before storage.
- **Oversized file or list** — the import is refused and existing themes are
  untouched.
- **Partial theme** — missing tokens use Default in both preview and app.
- **Theme removed on another device** — the next pull replaces the catalog; if
  the selected id is gone, Clara uses Default and repairs the selection on the
  next push.
- **Two devices add at once** — the catalog is one value and the hub's copy wins;
  the losing theme can be imported again.
- **Unknown stored value or unavailable storage** — Clara uses Default; an
  import reports that the browser could not store the theme.
- **Two tabs open** — a change in one tab updates the other through the storage
  event.
- **Name with control, bidi, or zero-width characters** — rejected so a theme
  cannot spoof another label.

## Out of scope

- A visual theme editor, export, or sharing from the UI.
- Importing VS Code, Neovim, or terminal schemes directly.
- Themeable radius, fonts, font size, or density.
- Per-project, per-session, or per-agent themes.
- Theming the pair terminal, diff colors, or non-notification status colors.
- A conflict-resolution UI for two devices that edit the list at once.
- Custom theme selection in the standalone panel or standalone lab; they keep
  Default, while embedded surfaces inherit the web client's theme.

## Known gaps

- The document `theme-color` and installed-app manifest background stay dark
  (`#0a0a0a`), so browser chrome may not match a light or custom palette.
- The Default palette is written twice: `tokens.css` and the `default` entry in
  `themes.json` used for previews. A test compares both variants.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Route: `/settings`; card: `src/components/settings/theme-card.tsx`; import
  dialog and preview: `custom-theme-dialog.tsx`, `use-theme-import.ts`,
  `theme-preview.tsx`
- Store and selection: `src/features/theme/color-theme.ts`; schema and tokens:
  `packages/theme/src/schema.ts`, `packages/theme/src/tokens.ts`; catalog:
  `packages/theme/src/themes.json` and `catalog.ts`
- Import document:

  ```json
  {
    "schemaVersion": 1,
    "name": "My theme",
    "light": {
      "background": "#fff",
      "foreground": "#111",
      "primary": "#05f",
      "primary-foreground": "#fff"
    },
    "dark": {
      "background": "#000",
      "foreground": "#eee",
      "primary": "#3af",
      "primary-foreground": "#000"
    }
  }
  ```

- Stored catalog: `{ "version": 1, "themes": [{ "id": "custom-…", "name", "light", "dark" }] }`
- Storage keys: `clara.theme` (mode), `clara.colorTheme` (palette id),
  `clara.customThemes` (catalog); all three are eligible for settings sync
- Root markers: `class="dark"` (mode), `data-theme="<id>"` (palette marker);
  palette values are inline `--<token>` properties, never a generated stylesheet
- Tokens: background, foreground, card, popover, primary, secondary, muted,
  accent, destructive, `status-*`, border, input, ring, `chart-1`–`chart-5`, and
  `sidebar-*`, each with `-foreground` where the palette uses one
- Mode provider: `src/providers/theme-provider.tsx` (wraps `next-themes`);
  panel/lab tokens alias the semantic tokens and inherit the web client them
- Light/dark sources: Solarized Light/Dark, Tokyo Night Day/Night, Gruvbox
  Light/Dark, Nord Light/Dark, Rosé Pine Dawn/Main, Catppuccin Latte/Mocha
- Clara is the house palette from orchid `#e066ff`, turquoise `#00ced1`, aqua
  `#7ffffd`, and medium purple `#9370db`, over logo navy `#101f3b`
- Related: [sync](sync.md), [settings](settings.md), [shortcuts](shortcuts.md),
  [capabilities](capabilities.md)

</details>
