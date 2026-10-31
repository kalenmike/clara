# Theme

## Summary

Clara lets people choose a color theme independently from light, dark, or system
mode. The existing Clara palette remains available as Default, and every other
theme has a matching light and dark variant. This is for people who want the
workspace to match their editor, terminal, or personal taste without giving up
automatic appearance changes.

## User flow

1. Open **Settings** and find the **Appearance** card.
2. Choose **Light**, **Dark**, or **System** for the mode. System follows the
   operating system and changes automatically.
3. Pick one of the color themes from the swatch grid: Default, Solarized, Tokyo
   Night, Gruvbox, Nord, Rose Pine, or Catppuccin.
4. The sidebar, chat, panels, dialogs, menus, and toasts update immediately.
5. Reload Clara or return later; the same color theme and mode are restored.
6. Press `ctrl+x` then `t` to switch between light and dark without changing the
   selected color theme.
7. Open Clara in another tab; a theme change made there is reflected as well.
8. If the saved value cannot be read, Clara falls back to the Default palette.

## Core business rules

1. Mode and color theme are independent. Mode controls light, dark, or system;
   color theme controls the palette. Every palette supports both light and dark.
2. Default is the palette Clara already used before color themes existed, so
   existing users see no change until they choose another theme.
3. The color theme is stored locally in `clara.colorTheme`; the mode remains
   stored under `clara.theme` by `next-themes`. Neither is sent to the OpenCode
   server.
4. The selected palette is applied as `data-theme` on the document root, while
   the mode is applied as the existing `.dark` class. Theme tokens are CSS
   custom properties, so choosing a theme does not remount the app.
5. Semantic status colors (for example green for working, amber for warnings,
   and rose for failures) and the deliberately dark pair terminal do not change
   between color themes.

## Edge cases

- **Unknown or missing stored value** — Clara uses Default and repairs the
  stored value the next time a theme is selected.
- **Storage unavailable** — private browsing or blocked storage keeps the choice
  in memory for the current tab and falls back to Default after a reload.
- **System mode** — when the operating system switches appearance, Clara swaps
  to the light or dark variant of the selected palette without a reload.
- **Two tabs open** — changing the theme in one tab updates the other through
  the browser storage event.
- **Before React mounts** — a small startup read applies the stored palette
  before the main application renders, avoiding a flash of the wrong theme.
- **Invalid or removed theme** — a stale local value never breaks the UI; CSS
  simply falls back to the Default tokens.
- **Disconnected from the server** — theme selection still works because it is
  entirely local.
- **Preview swatches** — the two chips on each option show the light and dark
  background and primary accent, not a full application preview.
- **Mode changed while a menu or dialog is open** — the open surface updates in
  place because the tokens change on the root element.

## Out of scope

- A theme editor or user-defined palettes.
- Per-project, per-session, or per-agent themes.
- Syncing appearance settings to the OpenCode server or across devices.
- Importing VS Code, Neovim, or terminal color schemes.
- Theming the pair terminal, diff colors, or semantic status colors.
- Changing the font family, font size, or density.
- Updating the browser toolbar color to match the palette.

## Known gaps

- The document's `theme-color` metadata stays dark, so browser chrome may not
  match a light or custom palette.
- Native form controls follow the light or dark `color-scheme`, not the accent
  colors of the selected palette.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Settings route: `/settings`
- Appearance card: `src/components/settings/theme-card.tsx`
- Theme catalog and local store: `src/features/theme/color-theme.ts`
- React binding: `src/features/theme/use-color-theme.ts`
- Palette CSS: `src/styles/color-themes.css`, imported by `src/index.css`
- Default palette: `:root` and `.dark` in `src/index.css`
- Mode provider: `src/providers/theme-provider.tsx` (wraps `next-themes`)
- Storage keys: `clara.theme` (mode), `clara.colorTheme` (palette)
- Root markers: `class="dark"` (mode), `data-theme="<value>"` (palette)
- Theme values: `default`, `solarized`, `tokyo-night`, `gruvbox`, `nord`,
  `rose-pine`, `catppuccin`
- Light/dark sources: Solarized Light/Dark, Tokyo Night Day/Night, Gruvbox
  Light/Dark, Nord Light/Dark, Rosé Pine Dawn/Main, Catppuccin Latte/Mocha
- Related: [shortcuts](shortcuts.md), [capabilities](capabilities.md)

</details>
