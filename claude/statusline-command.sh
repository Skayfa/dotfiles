#!/bin/sh
# Claude Code status line — mirrors Starship config (time | dir | git | model | context)

input=$(cat)

# ── Claude context ────────────────────────────────────────────────────────────
model=$(echo "$input" | jq -r '.model.display_name // empty')
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

# ── Time ──────────────────────────────────────────────────────────────────────
time_str=$(date +%H:%M)

# ── Directory ─────────────────────────────────────────────────────────────────
if [ -n "$cwd" ]; then
  dir=$(basename "$cwd")
  parent=$(dirname "$cwd" | sed "s|$HOME|~|")
  [ "$parent" = "." ] && dir_str="$dir" || dir_str="$parent/$dir"
  dir_str=$(echo "$dir_str" | sed "s|^$HOME|~|")
else
  dir_str=$(basename "$(pwd)")
fi

# ── Git ───────────────────────────────────────────────────────────────────────
git_info=""
if git -C "${cwd:-$(pwd)}" rev-parse --git-dir > /dev/null 2>&1; then
  branch=$(git -C "${cwd:-$(pwd)}" symbolic-ref --short HEAD 2>/dev/null \
           || git -C "${cwd:-$(pwd)}" rev-parse --short HEAD 2>/dev/null)
  # status flags (no lock acquisition needed for status)
  status_flags=""
  git_status=$(git -C "${cwd:-$(pwd)}" --no-optional-locks status --porcelain 2>/dev/null)
  [ -n "$git_status" ] && status_flags="*"
  added=$(echo "$git_status" | grep -c "^[MADRC]" 2>/dev/null)
  [ "${added:-0}" -gt 0 ] && status_flags="${status_flags}+${added}"
  git_info=" on  ${branch}${status_flags:+ $status_flags}"
fi

# ── Context window ────────────────────────────────────────────────────────────
ctx_str=""
if [ -n "$used_pct" ]; then
  # Round to integer
  used_int=$(printf "%.0f" "$used_pct" 2>/dev/null || echo "$used_pct")
  ctx_str=" | ctx ${used_int}%"
fi

# ── Model ─────────────────────────────────────────────────────────────────────
model_str=""
[ -n "$model" ] && model_str=" | $model"

# ── Assemble ──────────────────────────────────────────────────────────────────
printf "\033[38;5;120m %s\033[0m  \033[38;5;75m ﱮ %s\033[0m\033[38;5;227m%s\033[0m\033[38;5;116m%s%s\033[0m" \
  "$time_str" "$dir_str" "$git_info" "$model_str" "$ctx_str"
