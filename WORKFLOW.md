# Workflow de dev — selon les cas

Flux de travail avec mon setup (**Alacritty + tmux + nvim/Zed + lazygit + Claude Code**, monorepo **dolmen** Go/React/proto). Le schéma se lit de haut en bas : on entre par une tâche, on choisit le cas, tout converge sur la review → MR.

```mermaid
flowchart TD
    T(["🆕 Nouvelle tâche"]) --> SCOPE{"Quel cas ?"}

    %% Cas 1 — modif rapide
    SCOPE -->|"⚡ Modif rapide / hotfix"| Q1["nvim ou Zed<br/>édition directe"]
    Q1 --> REV

    %% Cas 2 — feature isolée
    SCOPE -->|"🌿 Feature isolée"| F1["ccw new feat<br/>worktree + tmux + Claude dédiés"]
    F1 --> F2["Dev : Claude Code + nvim<br/>LSP · Telescope"]
    F2 --> REV

    %% Cas 3 — parallèle
    SCOPE -->|"🔀 Plusieurs en parallèle"| P1{"Besoin d'isolation ?"}
    P1 -->|"Oui · branches séparées"| P2["N × ccw worktrees<br/>(1 Claude / worktree)"]
    P1 -->|"Non · 1 working tree"| P3["Agent Teams (tmux)<br/>plusieurs coéquipiers Claude"]
    P2 --> REV
    P3 --> REV

    %% Cas 4 — comprendre
    SCOPE -->|"🔍 Comprendre / explorer"| E1["Telescope : espace ff / fw<br/>LSP : gd · gr · K<br/>(ou question à Claude)"]
    E1 --> SCOPE

    %% Convergence
    REV["lazygit · Ctrl-b g<br/>review · stage par ligne · commit"] --> PUSH["git push"]
    PUSH --> MR{{"MR GitLab"}}
    MR --> MERGE{"Mergée ?"}
    MERGE -->|"oui · si worktree"| CLEAN["ccw rm feat<br/>nettoie branche + worktree + tmux"]
    MERGE -->|"oui"| DONE(["✅ Fini"])
    CLEAN --> DONE
```

## Les cas en clair

| Cas                           | Quand                          | Outils / étapes                                                                                            |
| ----------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| ⚡ **Modif rapide / hotfix**  | un seul petit changement       | édite (nvim/Zed) → **lazygit** review+commit → push                                                        |
| 🌿 **Feature isolée**         | une feature dédiée             | `ccw new <feat>` (worktree + tmux + Claude) → dev → review → MR → après merge `ccw rm <feat>`              |
| 🔀 **Plusieurs en parallèle** | bosser sur 2+ choses à la fois | **branches séparées** → N `ccw` worktrees · **même working tree** → **Agent Teams** (`teammateMode: tmux`) |
| 🔍 **Comprendre / explorer**  | lire/naviguer le code          | Telescope (`espace ff`/`fw`), LSP (`gd`/`gr`/`K`), ou questions à Claude                                   |

**Convergence commune** : `lazygit` (review + commit) → `git push` → **MR GitLab** → merge → nettoyage du worktree si besoin.

> Schéma indicatif — adapte-le si tes cas réels diffèrent (je peux le régénérer).
