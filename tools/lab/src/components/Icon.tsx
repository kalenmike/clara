export type IconName =
  | 'review'
  | 'runs'
  | 'traffic'
  | 'console'
  | 'settings'
  | 'refresh'
  | 'play'
  | 'stop'
  | 'copy'
  | 'folder'
  | 'search'
  | 'alert'
  | 'check'
  | 'close'

const paths: Record<IconName, string> = {
  review:
    'M6 3v6a4 4 0 0 0 4 4h8M6 15V9m0 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm12-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  runs: 'M8 5.5v13l10-6.5-10-6.5Z',
  traffic: 'M3 12h4l2.5-7 4 14 2.5-7H21',
  console: 'M4 6h16v12H4zM7 10l2.5 2L7 14m5 0h4',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5a8 8 0 0 0-.12-1.4l2-1.55-2-3.46-2.44.98a8 8 0 0 0-2.42-1.4L14.7 2h-4l-.32 2.67a8 8 0 0 0-2.42 1.4L5.5 5.1l-2 3.46 2 1.55A8 8 0 0 0 5.38 12c0 .48.04.94.12 1.4l-2 1.55 2 3.46 2.44-.98a8 8 0 0 0 2.42 1.4L10.7 22h4l.32-2.67a8 8 0 0 0 2.42-1.4l2.44.98 2-3.46-2-1.55c.08-.46.12-.92.12-1.4Z',
  refresh: 'M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7',
  play: 'M8 5.5v13l10-6.5-10-6.5Z',
  stop: 'M6 6h12v12H6z',
  copy: 'M8 8h10v12H8zM6 16H4V4h12v2',
  folder: 'M3 6h7l2 2h9v11H3z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 5 5',
  alert: 'M12 3 2.5 20h19L12 3Zm0 6v4m0 3v.01',
  check: 'm5 12 4.5 4.5L19 7',
  close: 'm6 6 12 12M18 6 6 18',
}

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  )
}
