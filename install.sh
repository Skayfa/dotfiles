#!/usr/bin/env bash
# install.sh — applique le setup dev sur un Mac (Apple Silicon).
# Idempotent : sauvegarde toute config existante en *.bak.<date> avant de la remplacer.
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# --- 0. Prérequis ---
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew est requis. Installe-le d'abord : https://brew.sh" >&2
  exit 1
fi
xcode-select -p >/dev/null 2>&1 || echo "Astuce: 'xcode-select --install' si le compilateur C manque (treesitter)."

# --- 1. Dépendances Homebrew ---
say "Installation des dépendances (brew bundle)"
brew bundle --file="$DOTFILES/Brewfile"
# libpq (psql) est keg-only : l'exposer dans le PATH pour vim-dadbod (nvim DBUI)
brew link --force libpq 2>/dev/null || true

# --- 2. CLI tree-sitter (requis par nvim-treesitter, branche main) ---
say "Installation du CLI tree-sitter (npm)"
npm install -g tree-sitter-cli || true
TS_BIN="$(npm config get prefix)/bin/tree-sitter"
mkdir -p "$HOME/.local/bin"
[ -e "$TS_BIN" ] && ln -sf "$TS_BIN" "$HOME/.local/bin/tree-sitter"

# --- 2b. fzf-tab (complétion TAB floue ; pas dans brew core) ---
say "Installation de fzf-tab"
FZF_TAB_DIR="$HOME/.local/share/zsh/fzf-tab"
if [ ! -d "$FZF_TAB_DIR" ]; then
  mkdir -p "$HOME/.local/share/zsh"
  git clone --depth 1 https://github.com/Aloxaf/fzf-tab "$FZF_TAB_DIR"
fi

# --- 2c. lazysql (TUI DB) : fallback go install si absent de brew core ---
if ! command -v lazysql >/dev/null 2>&1; then
  say "Installation de lazysql (go install — absent de brew)"
  command -v go >/dev/null 2>&1 && go install github.com/jorgerojas26/lazysql@latest || true
fi

# --- 2d. Rust : toolchain via rustup (pas brew — rustup gère composants et versions) ---
# rustup-init ajoute lui-même `. "$HOME/.cargo/env"` à ~/.zshenv (donc ~/.cargo/bin sur le PATH).
if ! command -v rustup >/dev/null 2>&1; then
  say "Installation de la toolchain Rust (rustup)"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
  export PATH="$HOME/.cargo/bin:$PATH"
fi
if command -v rustup >/dev/null 2>&1; then
  # rust-analyzer : le LSP de nvim, tenu accordé à la toolchain (jamais via mason).
  # rust-src : sans lui, rust-analyzer ne complète pas la bibliothèque standard.
  say "Composants Rust pour nvim (rust-analyzer + rust-src)"
  rustup component add rust-analyzer rust-src 2>/dev/null || true
fi

# --- helpers ---
backup() { [ -e "$1" ] && cp -R "$1" "$1.bak.$TS" && echo "  backup -> $1.bak.$TS" || true; }
# COPIE un fichier en remplaçant le placeholder __HOME__ par $HOME.
# Réservé aux cas qui ne peuvent PAS être liés : chemin absolu sans shell pour
# l'étendre (alacritty), ou fichier que l'outil réécrit lui-même (settings.json,
# lazygit). Éditer le repo n'a alors d'effet qu'après un ./install.sh.
install_file() {
  local src="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  backup "$dest"
  sed "s|__HOME__|$HOME|g" "$src" > "$dest"
  echo "  copié    -> $dest"
}
# LIE un fichier/dossier au repo : éditer ~/dotfiles est actif immédiatement,
# sans relancer ./install.sh. Interdit si le fichier contient __HOME__ (pas de
# sed sur un lien) ou si l'outil réécrit sa config (il écrirait dans le repo).
link_file() {
  local src="$1" dest="$2"
  if grep -q '__HOME__' "$src" 2>/dev/null; then
    echo "  ERREUR: $src contient __HOME__ et ne peut pas être lié" >&2; return 1
  fi
  mkdir -p "$(dirname "$dest")"
  # déjà le bon lien : ne rien faire (évite d'empiler des backups à chaque run)
  if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$DOTFILES/${src#$DOTFILES/}" ]; then
    echo "  lié      -> $dest (déjà)"; return 0
  fi
  backup "$dest"
  rm -rf "$dest"
  ln -sfn "$src" "$dest"
  echo "  lié      -> $dest"
}

# --- 3. Configs ---
say "Installation des configs"
# -- COPIÉS (impossible à lier, cf. commentaire des helpers) --
# alacritty : chemin absolu vers zed-open, lancé sans shell -> ni ~ ni $HOME ne s'étendraient
install_file "$DOTFILES/alacritty/alacritty.toml" "$HOME/.config/alacritty/alacritty.toml"
# lazygit réécrit son config.yml quand on change un réglage dans l'UI
install_file "$DOTFILES/lazygit/config.yml"       "$HOME/Library/Application Support/lazygit/config.yml"
# Claude Code réécrit settings.json (thème via /config) + contient __HOME__
install_file "$DOTFILES/claude/settings.json"     "$HOME/.claude/settings.json"

# -- LIÉS au repo (éditer ~/dotfiles est actif tout de suite) --
link_file "$DOTFILES/tmux/tmux.conf"              "$HOME/.tmux.conf"
link_file "$DOTFILES/tmux/cheatsheet.txt"         "$HOME/.config/tmux/cheatsheet.txt"
link_file "$DOTFILES/hammerspoon/init.lua"        "$HOME/.hammerspoon/init.lua"
link_file "$DOTFILES/hunk/config.toml"            "$HOME/.config/hunk/config.toml"
# config git générique (alias hdiff/hshow) : ~/.gitconfig garde l'identité, jamais touché
link_file "$DOTFILES/git/config"                  "$HOME/.config/git/config"
link_file "$DOTFILES/claude/statusline-command.sh" "$HOME/.claude/statusline-command.sh"
chmod +x "$DOTFILES/claude/statusline-command.sh"
# CLAUDE.md global (importe claude/GLOBAL.md du repo) + skills (grill/verify/hunk-review/mac-cleanup)
link_file "$DOTFILES/claude/CLAUDE.md"            "$HOME/.claude/CLAUDE.md"
link_file "$DOTFILES/claude/skills"               "$HOME/.claude/skills"
[ -f "$DOTFILES/starship/starship.toml" ] && link_file "$DOTFILES/starship/starship.toml" "$HOME/.config/starship.toml"

# scripts
link_file "$DOTFILES/bin/ccw"      "$HOME/.local/bin/ccw"
link_file "$DOTFILES/bin/zed-open" "$HOME/.local/bin/zed-open"
chmod +x "$DOTFILES/bin/ccw" "$DOTFILES/bin/zed-open"

# nvim (dossier entier)
say "Installation de la config neovim (NvChad 2.5)"
[ -e "$HOME/.config/nvim" ] && mv "$HOME/.config/nvim" "$HOME/.config/nvim.bak.$TS" || true
mkdir -p "$HOME/.config/nvim"
rsync -a "$DOTFILES/nvim/" "$HOME/.config/nvim/"

# --- 4. zsh : sourcer aliases puis plugins (plugins en DERNIER : syntax-highlighting) ---
say "Aliases + plugins zsh (suggestions, fzf-tab, zoxide)"
for f in aliases plugins; do
  LINE="source \"$DOTFILES/zsh/$f.zsh\""
  grep -qF "$LINE" "$HOME/.zshrc" 2>/dev/null || printf '\n# setup dev (%s)\n%s\n' "$f" "$LINE" >> "$HOME/.zshrc"
done

# --- Fin ---
say "Terminé ✅"
cat <<EOF

Étapes finales (à faire une fois) :
  1. Recharge le shell : source ~/.zshrc   (ou ouvre un nouveau terminal)
  2. Lance nvim : il installe plugins + LSP + parsers (~1-2 min, laisse finir)
  3. Hammerspoon : Réglages Système > Confidentialité > Accessibilité > active Hammerspoon
  4. Relance Alacritty (⌘Q puis rouvre) pour charger la police Nerd Font + le binding ⌘b
  5. Active le drop-down : icône Hammerspoon > Reload Config, puis Ctrl+Alt+T

Toutes les anciennes configs ont été sauvegardées en *.bak.$TS
EOF
