// The tracking file (pilotage/pilotage.json) and the pane's state.

export type Statut = 'backlog' | 'pret' | 'en_cours' | 'bloque' | 'fait' | 'abandonne'

export type Note = { date: string; fait: string; reste: string; suivant: string }

export type Tache = {
  id: string
  scope: string
  jalon: string
  titre: string
  resultat: string
  criteres: string[]
  priorite: 'P0' | 'P1' | 'P2'
  taille: 'S' | 'M' | 'L'
  risque_donnees: boolean
  depend_de: string[]
  bloque_par: string[]
  statut: Statut
  depuis: string
  notes?: string
  suivi?: Note[]
  debut?: string
  fini_le?: string
  preuve?: string
  relecture?: string
  // The paths the task writes: two tasks with no dependency path between them never share one.
  chemins?: string[]
  // The invariant its property test checks, when it touches user data.
  invariant?: string
  // contracts/conformance/<regle>/ when it adds or changes a business rule.
  regle?: string
  // The session that holds it while it is in progress.
  tenue_par?: string
}

export type Jalon = { id: string; titre: string; resultat: string; statut: 'a_venir' | 'en_cours' | 'fait'; go?: string }

export type Scope = { id: string; titre: string; verdict: string; garder: string[]; couper: string[]; repousser: string[] }

export type Question = {
  id: string
  question: string
  enjeu: string
  options: string[]
  bloque: string[]
  statut: 'ouverte' | 'tranchee'
  decision: string
  date: string
  mots?: string
}

// One line of the journal. The mod writes `tache` and `statut` on every status move it makes,
// so a status the journal does not explain was changed outside the mod.
export type Entree = { date: string; texte: string; tache?: string; statut?: Statut }

export type Projet = {
  nom: string
  promesse: string
  maj: string
  // Tasks one session may hold at once.
  wip_max?: number
  // Prefixes that lock together (generated code with its source): a path in one counts as a path in all.
  zones_liees?: string[][]
  // The project's local gate, run by tache_terminer in the main checkout with the task's paths in
  // PILOTE_CHEMINS (one per line). Words split on spaces, no shell: "make check".
  verification?: string
  // The agent type tache_terminer spawns to review a task that touches user data.
  relecteur?: string
}

export type Pilotage = {
  version: 1
  projet: Projet
  jalons: Jalon[]
  scopes: Scope[]
  taches: Tache[]
  questions: Question[]
  journal: Entree[]
}

// What the pane draws from: the file as last read.
export type Snapshot = { isFound: boolean; mtimeMs: number; readAt: number; data: Pilotage | null; errors: string[] }

// A button that asks « Oui / Non » first, armed until `at` + 10 s.
export type Armed = { id: string; at: number } | null

declare module 'claude-code' {
  interface PluginState {
    pilote: { snap: Shaped<Snapshot>; armed: Shaped<Armed> }
  }
}
