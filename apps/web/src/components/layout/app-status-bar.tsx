import { claraBuildTitle, claraVersionLabel } from '@/lib/build-info'

/**
 * The app-wide status strip. It owns the bottom safe-area inset for the shell
 * and keeps the running surface and version at the far right on every page.
 */
export function AppStatusBar() {
  return (
    <footer
      aria-label="Clara status"
      className="flex shrink-0 items-center border-t bg-background px-3 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] text-[10px] text-muted-foreground md:text-[11px]"
    >
      <span className="ml-auto min-w-0 truncate font-mono" title={claraBuildTitle}>
        {claraVersionLabel()}
      </span>
    </footer>
  )
}
