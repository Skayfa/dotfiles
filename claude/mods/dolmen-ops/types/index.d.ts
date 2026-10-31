// What the dolmen-ops panel draws: one snapshot, refreshed in code and read while drawing.
export type PanelTone = 'success' | 'warning' | 'error' | 'subtle'
// A button on a row. `id` names what it does (register.tsx `act`); `confirm` asks once more first.
export type PanelAction = { id: string; label: string; confirm?: string }
export type PanelRow = { label: string; value: string; tone?: PanelTone; href?: string; action?: PanelAction }
export type PanelSnapshot = {
  at: number
  lots: PanelRow[]
  mrs: PanelRow[]
  reviews: PanelRow[]
  bugs: PanelRow[]
  dew: PanelRow[]
  session: PanelRow[]
}
// The action waiting for its second press, and since when.
export type Armed = { id: string; at: number } | null

declare module 'claude-code' {
  interface PluginState {
    'dolmen-ops': {
      snapshot: Shaped<PanelSnapshot>
      armed: Armed
      // Kept in $.state, which a /reload-plugins keeps (module variables start over):
      told: Record<string, string> // MR iid → the events last told, so one wake per change
      ready: Record<string, number> // MR iid → until when /pret allows leaving Draft
      lastUsd: number // the session's cost at the last turn (-1: none yet)
    }
  }
}
