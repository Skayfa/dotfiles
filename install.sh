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

# --- 2. CLI tree-sitter (requis par nvim-treesitter, branche main) ---
say "Installation du CLI tree-sitter (npm)"
npm install -g tree-sitter-cli || true
TS_BIN="$(npm config get prefix)/bin/tree-sitter"
mkdir -p "$HOME/.local/bin"
[ -e "$TS_BIN" ] && ln -sf "$TS_BIN" "$HOME/.local/bin/tree-sitter"

# --- helpers ---
backup() { [ -e "$1" ] && cp -R "$1" "$1.bak.$TS" && echo "  backup -> $1.bak.$TS" || true; }
# installe un fichier en remplaçant le placeholder __HOME__ par $HOME
install_file() {
  local src="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  backup "$dest"
  sed "s|__HOME__|$HOME|g" "$src" > "$dest"
  echo "  installé -> $dest"
}

# --- 3. Configs ---
say "Installation des configs"
install_file "$DOTFILES/alacritty/alacritty.toml" "$HOME/.config/alacritty/alacritty.toml"
install_file "$DOTFILES/tmux/tmux.conf"           "$HOME/.tmux.conf"
install_file "$DOTFILES/tmux/cheatsheet.txt"      "$HOME/.config/tmux/cheatsheet.txt"
install_file "$DOTFILES/hammerspoon/init.lua"     "$HOME/.hammerspoon/init.lua"
install_file "$DOTFILES/lazygit/config.yml"       "$HOME/Library/Application Support/lazygit/config.yml"

# Claude Code (Agent Teams tmux + statusline) + Starship (prompt)
install_file "$DOTFILES/claude/settings.json"          "$HOME/.claude/settings.json"
install_file "$DOTFILES/claude/statusline-command.sh"  "$HOME/.claude/statusline-command.sh"
chmod +x "$HOME/.claude/statusline-command.sh"
# CLAUDE.md global (importe claude/GLOBAL.md du repo) + skills grill/verify
install_file "$DOTFILES/claude/CLAUDE.md"              "$HOME/.claude/CLAUDE.md"
mkdir -p "$HOME/.claude/skills"
rsync -a "$DOTFILES/claude/skills/" "$HOME/.claude/skills/"
[ -f "$DOTFILES/starship/starship.toml" ] && install_file "$DOTFILES/starship/starship.toml" "$HOME/.config/starship.toml"

# scripts
install_file "$DOTFILES/bin/ccw"      "$HOME/.local/bin/ccw"
install_file "$DOTFILES/bin/zed-open" "$HOME/.local/bin/zed-open"
chmod +x "$HOME/.local/bin/ccw" "$HOME/.local/bin/zed-open"

# nvim (dossier entier)
say "Installation de la config neovim (NvChad 2.5)"
[ -e "$HOME/.config/nvim" ] && mv "$HOME/.config/nvim" "$HOME/.config/nvim.bak.$TS" || true
mkdir -p "$HOME/.config/nvim"
rsync -a "$DOTFILES/nvim/" "$HOME/.config/nvim/"

# --- 4. zsh : sourcer nos aliases ---
say "Aliases zsh (vim->nvim, lg->lazygit)"
LINE="source \"$DOTFILES/zsh/aliases.zsh\""
grep -qF "$LINE" "$HOME/.zshrc" 2>/dev/null || printf '\n# setup dev\n%s\n' "$LINE" >> "$HOME/.zshrc"

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
