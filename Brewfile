# Brewfile — dépendances du setup dev (brew bundle --file=Brewfile)

# Terminal + multiplexer + window manager
cask "alacritty"
brew "tmux"
cask "hammerspoon"

# Git TUI + recherche rapide
brew "lazygit"
brew "hunk"    # diff viewer orienté review (annotations agent inline) — complète lazygit
brew "fd"
brew "ripgrep"
brew "jq"
brew "fzf"

# Shell UX : complétion, suggestions, navigation rapide (zsh/plugins.zsh)
brew "zsh-autosuggestions"
brew "zsh-syntax-highlighting"
brew "zsh-completions"
brew "zoxide"
brew "eza"
# fzf-tab n'est pas dans brew core : cloné par install.sh dans ~/.local/share/zsh

# Accès base de données en terminal (CLI intelligent + TUI)
brew "pgcli"
brew "lazysql"
brew "libpq"   # client psql — requis par vim-dadbod (keg-only → linké dans install.sh)

# Éditeurs
brew "neovim"
cask "zed"

# Go (gopls/goimports via mason + gofmt) + proto (buf)
# (le CLI tree-sitter est installé via npm dans install.sh, pas via brew)
brew "go"
brew "buf"

# Node (requis par tree-sitter-cli, prettierd, certains LSP)
brew "node"

# Prompt + GitHub CLI
brew "starship"
brew "gh"

# Police avec icônes (pour Powerline tmux + icônes nvim)
cask "font-jetbrains-mono-nerd-font"
