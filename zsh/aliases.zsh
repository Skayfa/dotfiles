# Setup dev — sourcé par ~/.zshrc (via install.sh)

# ~/.local/bin sur le PATH (ccw, zed-open, tree-sitter)
export PATH="$HOME/.local/bin:$PATH"

# Prompt Starship
command -v starship >/dev/null 2>&1 && eval "$(starship init zsh)"

# Aliases
alias lg='lazygit'
# review du working tree (`hd --watch` pour suivre un agent qui édite en direct)
alias hd='hunk diff'
alias vim='nvim'
alias vi='nvim'
