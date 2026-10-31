import { usePanelWidth } from '@/hooks/use-panel-width'
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  readSidebarWidth,
  saveSidebarWidth,
} from '@/lib/storage'

const CONTENT_MIN_WIDTH = 360

export function useSidebarWidth() {
  return usePanelWidth({
    edge: 'right',
    min: SIDEBAR_WIDTH_MIN,
    max: SIDEBAR_WIDTH_MAX,
    defaultWidth: SIDEBAR_WIDTH_DEFAULT,
    contentMinWidth: CONTENT_MIN_WIDTH,
    read: readSidebarWidth,
    save: saveSidebarWidth,
  })
}
