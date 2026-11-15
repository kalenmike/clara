---
title: Shared UI components
---

# Shared UI components

`packages/ui` (`@clara/ui`) is the single source of truth for the visual
primitives used by the web client, the hub panel, and Clara Lab. It is a
source-only workspace package: consumers compile its TypeScript and Tailwind
classes, and the package owns no document styles or build step.

## Layout

```text
packages/ui/
  components.json      shadcn CLI routing and aliases
  src/
    components/        shadcn/radix primitives
    lib/utils.ts       cn()
    patterns/          Clara-specific composites
```

Exports are explicit subpaths:

```text
@clara/ui/components/button
@clara/ui/components/card
@clara/ui/components/select
@clara/ui/lib/utils
@clara/ui/patterns/status-badge
@clara/ui/patterns/section-card
```

There is deliberately no package barrel. Each surface imports only the
components its route uses, so a new pattern cannot pull every primitive into a
route chunk.

## Primitives

`src/components` holds the shadcn set: alert, avatar, badge, button, card,
checkbox, collapsible, command, dialog, dropdown menu, input, input group,
label, popover, scroll area, select, separator, sheet, skeleton, slider, sonner,
switch, tabs, textarea, and tooltip. The style is the `radix-nova` preset and the
components use the web client's sizes.

The one theme-coupled component is `sonner`. The shared surface takes a `theme`
prop; the web client maps next-themes to it in
`apps/web/src/components/sonner.tsx`. Panel and lab hosts pass their own mode if
they ever mount toasts.

## Patterns

`src/patterns` holds the composites the three surfaces share:

| Pattern       | Use                                                                  |
| ------------- | -------------------------------------------------------------------- |
| `StatusBadge` | Neutral, success, warning, danger, and info badges from `--status-*` |
| `Notice`      | Inline success, warning, danger, or info message with an icon        |
| `EmptyState`  | Dashed empty panel with optional title, description, and action      |
| `KeyValue`    | Label to value row used by detail lists                              |
| `CopyButton`  | Clipboard action with Copied and Failed states                       |
| `SectionCard` | Card with title, description, icon, control, notice, and disclosure  |

`SectionCard` is built on `Card`, so panel cards, lab sections, and web cards
share the same surface, radius, and spacing. It supports `as="section"` and
`as="aside"` for semantic wrappers and `collapsible` for disclosure sections.

## Host requirements

Every host imports `@clara/theme` and scans the package from its Tailwind entry:

- Web: `apps/web/src/index.css` scans `packages/ui`, `packages/panel`, and
  `packages/lab`, because the bundled panel and desktop lab live in the web
  stylesheet.
- Served panel: `packages/panel/src/styles/standalone.css` scans the panel and
  UI packages.
- Standalone lab: `packages/lab/src/standalone.css` imports the Tailwind theme
  and utilities layers without preflight, then scans the lab and UI packages.
  Preflight is omitted because the workbench already owns its element resets.

The package must not import `tailwindcss`, style `html`/`body`, or ship a CSS
file. Those belong to the host surface.

The desktop container build copies workspace manifests and sources explicitly.
Keep `packages/ui/package.json` and `packages/ui` in
`infra/docker/desktop.Dockerfile` whenever the desktop surface uses the shared
components.

## Adding or changing a component

Add shadcn components from the app or package workspace:

```bash
cd packages/ui
pnpm dlx shadcn@latest add <name>
```

`packages/ui/components.json` and `apps/web/components.json` both point the CLI
at `@clara/ui/components` and `@clara/ui/lib/utils`, and at
`packages/theme/src/theme.css` for tokens. Keep the generated component aliases
intact.

When a second surface needs the same composition, put it in `src/patterns`
rather than copying markup into the panel or lab. Surface-specific layout,
trees, tables, segmented controls, and shell frames stay in their own package.

## Rules

- Import from `@clara/ui/components/*`, `@clara/ui/patterns/*`, or
  `@clara/ui/lib/*`; do not reach into another surface's source tree.
- Use the shared semantic tokens (`--background`, `--card`, `--border`,
  `--status-*`) instead of hardcoded palette colors.
- Keep the web sizes in every surface. Panel and lab density comes from the
  surrounding layout, not from a second set of primitives.
- Do not add a wrapper component that only renames a shared component. Extend
  the shared API instead.
