# zsh/plugins.zsh — interactive shell UX: history, completion, suggestions, fuzzy nav.
# Sourced LAST by ~/.zshrc so zsh-syntax-highlighting can wrap every widget.
[[ $- == *i* ]] || return

# Homebrew prefix without spawning `brew` at startup (ARM vs Intel).
if [[ -d /opt/homebrew ]]; then BREW=/opt/homebrew; else BREW=/usr/local; fi

# --- persistent, shared history (powers suggestions + Ctrl-R) ----------------
HISTFILE="$HOME/.zsh_history"
HISTSIZE=50000
SAVEHIST=50000
setopt SHARE_HISTORY HIST_IGNORE_ALL_DUPS HIST_IGNORE_SPACE HIST_REDUCE_BLANKS

# --- completion system -------------------------------------------------------
fpath=("$BREW/share/zsh-completions" $fpath)   # extra completions, before compinit
autoload -Uz compinit
zmodload zsh/complist
# Rebuild the completion cache at most once a day (faster startup). BSD stat (macOS).
if [[ $(date +%j) != $(stat -f '%Sm' -t '%j' "$HOME/.zcompdump" 2>/dev/null) ]]; then
  compinit -i
else
  compinit -C
fi

zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}'   # case-insensitive
zstyle ':completion:*' list-colors ${(s.:.)LS_COLORS}
zstyle ':completion:*' menu no                              # fzf-tab takes over the menu
zstyle ':completion:*:descriptions' format '[%d]'

# --- fzf-tab: fuzzy TAB completion (git branches, dirs, kill, env, …) --------
if [[ -r "$HOME/.local/share/zsh/fzf-tab/fzf-tab.plugin.zsh" ]]; then
  source "$HOME/.local/share/zsh/fzf-tab/fzf-tab.plugin.zsh"
  zstyle ':fzf-tab:complete:cd:*' fzf-preview 'eza -1 --color=always $realpath 2>/dev/null || ls -1 $realpath'
  zstyle ':fzf-tab:*' switch-group ',' '.'
fi

# --- as-you-type suggestions from history ------------------------------------
if [[ -r "$BREW/share/zsh-autosuggestions/zsh-autosuggestions.zsh" ]]; then
  source "$BREW/share/zsh-autosuggestions/zsh-autosuggestions.zsh"
  ZSH_AUTOSUGGEST_STRATEGY=(history completion)
fi

# --- zoxide: fast directory jump (`z foo` jumps · `zi` interactive picker) ----
command -v zoxide >/dev/null 2>&1 && eval "$(zoxide init zsh)"

# --- fzf: fuzzy file/dir/history (Ctrl-T files · Alt-C dirs · Ctrl-R history) --
if command -v fzf >/dev/null 2>&1; then
  if command -v fd >/dev/null 2>&1; then
    export FZF_DEFAULT_COMMAND='fd --type f --hidden --follow --exclude .git'
    export FZF_CTRL_T_COMMAND="$FZF_DEFAULT_COMMAND"
    export FZF_ALT_C_COMMAND='fd --type d --hidden --follow --exclude .git'
  fi
  export FZF_DEFAULT_OPTS='--height 45% --layout=reverse --border'
  [[ -f "$HOME/.fzf.zsh" ]] || source <(fzf --zsh)   # bindings: prefer ~/.fzf.zsh, else builtin
fi

# --- eza: nicer ls (only if installed) ---------------------------------------
if command -v eza >/dev/null 2>&1; then
  alias ls='eza --group-directories-first'
  alias ll='eza -la --group-directories-first --git --icons'
  alias lt='eza --tree --level=2 --group-directories-first'
fi

# --- macOS-style word motions (⌥←/→ jump a word, ⌥⌫ delete a word) -----------
bindkey '^[[1;3D' backward-word          # ⌥←  previous word
bindkey '^[[1;3C' forward-word           # ⌥→  next word
bindkey '^[^?'    backward-kill-word     # ⌥⌫  delete previous word

# --- command-line cheatsheet: `cheat` (pager) or Ctrl-X ? (inline peek) -------
CHEAT_SHEET="${0:A:h}/cheatsheet.txt"
[[ -r "$CHEAT_SHEET" ]] || CHEAT_SHEET="$HOME/dotfiles/zsh/cheatsheet.txt"
cheat() { less -FRX "$CHEAT_SHEET" 2>/dev/null || cat "$CHEAT_SHEET"; }
_cheat_widget() { zle -M "$(<"$CHEAT_SHEET")"; }
zle -N _cheat_widget
bindkey '^X?' _cheat_widget

# --- syntax highlighting MUST be sourced last --------------------------------
[[ -r "$BREW/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh" ]] && \
  source "$BREW/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"
