// What the dolmen-ops panel draws: one snapshot, refreshed in code and read while drawing.
export type PanelTone = 'success' | 'warning' | 'error' | 'subtle'
export type PanelRow = { label: string; value: string; tone?: PanelTone }
export type PanelSnapshot = {
  at: number
  mrs: PanelRow[]
  reviews: PanelRow[]
  bugs: PanelRow[]
  dew: PanelRow[]
  session: PanelRow[]
}

declare module 'claude-code' {
  interface PluginState {
    'dolmen-ops': { snapshot: Shaped<PanelSnapshot> }
  }
}
