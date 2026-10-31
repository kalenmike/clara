import { usePanelWidth } from '@/hooks/use-panel-width'
import {
  SIDE_PANEL_WIDTH_DEFAULT,
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_WIDTH_MIN,
  readSidePanelWidth,
  readSidebarWidth,
  saveSidePanelWidth,
} from '@/lib/storage'

const CONTENT_MIN_WIDTH = 360

export function useSidePanelWidth() {
  return usePanelWidth({
    edge: 'left',
    min: SIDE_PANEL_WIDTH_MIN,
    max: SIDE_PANEL_WIDTH_MAX,
    defaultWidth: SIDE_PANEL_WIDTH_DEFAULT,
    contentMinWidth: CONTENT_MIN_WIDTH,
    reserved: readSidebarWidth,
    read: readSidePanelWidth,
    save: saveSidePanelWidth,
  })
}
