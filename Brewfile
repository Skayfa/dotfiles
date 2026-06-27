# Brewfile — dépendances du setup dev (brew bundle --file=Brewfile)

# Terminal + multiplexer + window manager
cask "alacritty"
brew "tmux"
cask "hammerspoon"

# Git TUI + recherche rapide
brew "lazygit"
brew "fd"
brew "ripgrep"
brew "jq"

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
