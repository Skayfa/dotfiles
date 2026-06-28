# dotfiles — setup dev macOS (Apple Silicon)

Config terminal complète : **Alacritty + tmux + zsh + Neovim (NvChad 2.5) + lazygit + Hammerspoon**, avec **accès base de données en terminal** (pgcli · lazysql · dadbod-ui), pensée pour un stack **Go / React-TS / Proto (buf)**.

**Docs** : [`ARCHITECTURE.md`](ARCHITECTURE.md) — schéma visuel de comment tout est câblé · [`WORKFLOW.md`](WORKFLOW.md) — la méthode de dev (challenge → livraison fidèle).

## Installation (sur un nouveau Mac)

Prérequis : **Homebrew** (https://brew.sh), les outils Xcode (`xcode-select --install`), et **Claude Code** (https://claude.com/claude-code — requis par `ccw` et la config Agent Teams).

```bash
git clone https://github.com/Skayfa/dotfiles.git ~/dotfiles
cd ~/dotfiles
./install.sh
```

Le script installe les dépendances (Brewfile), le CLI `tree-sitter`, puis pose les configs (toute config existante est sauvegardée en `*.bak.<date>`). Suis les 5 étapes finales affichées à la fin.

## Ce qu'il y a dedans

| Dossier        | Cible                                    | Contenu                                                                                                                                                                                                        |
| -------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alacritty/`   | `~/.config/alacritty/`                   | police Nerd Font, palette Everforest, fenêtre sans titre, `⌘b`→préfixe tmux, `⌘⇧clic`/`Ctrl⇧O` ouvre un fichier dans Zed (via `bin/zed-open`)                                                                  |
| `tmux/`        | `~/.tmux.conf`, `~/.config/tmux/`        | statusbar Powerline cyan, nav fluide, lazygit (`préfixe g`) + lazysql (`préfixe D`) en popup, aide-mémoire `préfixe ?`                                                                                         |
| `nvim/`        | `~/.config/nvim/`                        | NvChad 2.5 (thème catppuccin-latte) : LSP (gopls, ts_ls, jsonls, yamlls, marksman, **buf_ls** pour proto), treesitter, formatage, nav IDE, fuzzy fd+fzf, **panel SQL dadbod-ui** (`espace D`), helper `:Cheat` |
| `lazygit/`     | `~/Library/Application Support/lazygit/` | thème contraste cyan                                                                                                                                                                                           |
| `hammerspoon/` | `~/.hammerspoon/`                        | drop-down Alacritty sur `Ctrl+Alt+T`                                                                                                                                                                           |
| `bin/`         | `~/.local/bin/`                          | `ccw` (git worktree + tmux + claude), `zed-open` (ouvre un chemin dans Zed)                                                                                                                                    |
| `zsh/`         | sourcé par `~/.zshrc`                    | UX shell : autosuggestions, **fzf-tab** (TAB flou : branches git), **zoxide** (`z`), **eza**, bindings fzf+fd, historique persistant, aide-mémoire `cheat`, helper DB `db <name>` ; alias `vim`/`lg`           |
| `claude/`      | `~/.claude/`                             | Claude Code : Agent Teams (`teammateMode: tmux`) + statusline custom                                                                                                                                           |
| `starship/`    | `~/.config/`                             | prompt Starship (que la statusline Claude reprend)                                                                                                                                                             |

> Les chemins absolus sont stockés en placeholder `__HOME__` et résolus à l'install → portable quel que soit ton nom d'utilisateur.

## Raccourcis clés (mémo)

**tmux** (préfixe = `⌘b` ou `Ctrl-b`) — détail : `préfixe ?`

- `⌥←/→/↑/↓` naviguer entre panes · `Shift←/→` changer de fenêtre
- `préfixe v`/`s` split · `préfixe z` zoom · `préfixe Ctrl-hjkl` échanger un pane
- `préfixe g` lazygit (popup) · `préfixe D` lazysql (bases de données)

**neovim** (leader = `espace`) — détail : `espace ?` (`:Cheat`) ou `espace` + attendre (which-key)

- `espace f f` fichiers · `espace f w` recherche texte · `Ctrl-n` arborescence
- `gd` / `Ctrl+clic` définition · `Ctrl-o` retour · `Ctrl-i` avant · `gt`/`gT` buffers
- `espace f m` formater · `K` doc · `espace r n` renommer · `espace D` panel SQL (`:DBUI`)

**zsh** — détail : `cheat` ou `Ctrl-X ?`

- `→` accepter la suggestion · `TAB` complétion floue (branches git) · `Ctrl-R` historique
- `z <bout>` saut de dossier · `db <name>` ouvrir une base en pgcli

**bases de données** (Postgres local) : `db <name>` (pgcli CLI) · `préfixe D` (lazysql TUI) · `espace D` (dadbod-ui dans nvim)

**lazygit** : `Ctrl-b g` (popup) · `lg` (plein écran)

## Mise à jour

Édite les fichiers dans `~/dotfiles`, commit, push. Sur l'autre Mac : `git pull && ./install.sh`.

## Désinstaller / revenir en arrière

Chaque install sauvegarde l'existant en `*.bak.<date>`. Pour restaurer une config, remets le `.bak` à sa place (`mv`).
