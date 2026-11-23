#!/usr/bin/env bash
# Claude Code status line: folder (+ * when the git tree is dirty), model and effort, context gauge.
# Time and branch are left to the tmux bar right below. Colours: Everforest, as tmux and Alacritty.

input=$(cat)
model=$(jq -r '.model.display_name // empty' <<<"$input" 2>/dev/null)
cwd=$(jq -r '.workspace.current_dir // .cwd // empty' <<<"$input" 2>/dev/null)
used=$(jq -r '.context_window.used_percentage // empty' <<<"$input" 2>/dev/null)
effort=$(jq -r '.effort.level // empty' <<<"$input" 2>/dev/null)

rgb() { printf '\033[38;2;%d;%d;%dm' "0x${1:0:2}" "0x${1:2:2}" "0x${1:4:2}"; }
RESET=$'\033[0m'
BLUE=$(rgb 7fbbb3) ORANGE=$(rgb e69875) AQUA=$(rgb 83c092) GREY=$(rgb 859289)
PURPLE=$(rgb d699b6) GREEN=$(rgb a7c080) YELLOW=$(rgb dbbc7f) RED=$(rgb e67e80)

cwd=${cwd:-$PWD}
dir=${cwd/#$HOME/\~}
dirty=""
[ -n "$(git -C "$cwd" --no-optional-locks status --porcelain 2>/dev/null | head -1)" ] && dirty=" ${ORANGE}*"

out="${BLUE} ${dir}${dirty}${RESET}"
[ -n "$model" ] && out+="   ${AQUA}${model}${RESET}"
[ -n "$effort" ] && out+=" ${GREY}·${RESET} ${PURPLE}${effort}${RESET}"

# Context gauge: 8 cells, green under 50 %, yellow under 80 %, red beyond (time to /compact).
if [ -n "$used" ]; then
  pct=$(printf '%.0f' "$used" 2>/dev/null) || pct=0
  if [ "$pct" -ge 80 ]; then c=$RED; elif [ "$pct" -ge 50 ]; then c=$YELLOW; else c=$GREEN; fi
  full=$(( (pct * 8 + 50) / 100 ))
  [ "$full" -gt 8 ] && full=8
  bar=$c
  for ((i = 0; i < 8; i++)); do
    [ "$i" -eq "$full" ] && bar+=$GREY
    if [ "$i" -lt "$full" ]; then bar+="▰"; else bar+="▱"; fi
  done
  out+="   ${bar} ${c}${pct}%${RESET}"
fi

printf '%s' "$out"
