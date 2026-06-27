# Setup dev — sourcé par ~/.zshrc (via install.sh)

# ~/.local/bin sur le PATH (ccw, zed-open, tree-sitter)
export PATH="$HOME/.local/bin:$PATH"

# Prompt Starship
command -v starship >/dev/null 2>&1 && eval "$(starship init zsh)"

# Aliases
alias lg='lazygit'
alias vim='nvim'
alias vi='nvim'
