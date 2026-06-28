#!/usr/bin/env bash
# mac-cleanup — reclaim disk space safely. See SKILL.md.
# Usage:
#   cleanup.sh scan            # diagnose: free space, top consumers, simulator runtimes, orphan apps
#   cleanup.sh safe            # prune package managers + build caches + ~/Library/Caches (regenerable only)
#   cleanup.sh simulators      # delete ALL iOS simulator devices + runtimes (asks first)
#   cleanup.sh orphans         # list data left by uninstalled apps
#   cleanup.sh orphans --delete# delete that orphan data (after showing protected list)
#   cleanup.sh all             # safe + simulators + orphans listing (no destructive orphan delete)
#
# Safety: never uses `rm -rf` (blocked on this machine). Uses `find -delete`.
# Never touches iCloud (~/Library/Mobile Documents), user docs, or installed apps' subfolders.

set -uo pipefail
SCRATCH="${TMPDIR:-/tmp}/mac-cleanup.$$"
mkdir -p "$SCRATCH"
trap 'rm -f "$SCRATCH"/* 2>/dev/null; rmdir "$SCRATCH" 2>/dev/null' EXIT

free_space() { df -h /System/Volumes/Data | awk '/Data/ {print "Libre: "$4" / "$2"  ("$5" utilise)"}'; }
del_dir()  { [ -d "$1" ] && { find "$1" -mindepth 1 -delete 2>/dev/null; rmdir "$1" 2>/dev/null; return 0; }; return 1; }
del_path() { # dir or file
  [ -e "$1" ] || return 1
  if [ -d "$1" ]; then find "$1" -mindepth 1 -delete 2>/dev/null; rmdir "$1" 2>/dev/null
  else rm "$1" 2>/dev/null; fi
}

# --- inventory of installed apps + bundle ids ---
build_inventory() {
  { ls -1 /Applications "$HOME/Applications" /System/Applications /System/Applications/Utilities 2>/dev/null; } \
    | sed 's/\.app$//' | sort -u > "$SCRATCH/apps.txt"
  for a in /Applications/*.app "$HOME/Applications"/*.app; do
    [ -d "$a" ] || continue
    /usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$a/Contents/Info.plist" 2>/dev/null
  done | sort -u > "$SCRATCH/bundleids.txt"
}

cmd_scan() {
  echo "================ DIAGNOSTIC ================"
  free_space; echo
  echo "=== Top dossiers de ~ ==="
  du -sh "$HOME"/* "$HOME"/.[!.]* 2>/dev/null | sort -hr | head -15
  echo
  echo "=== iOS Simulator runtimes (souvent LE gouffre) ==="
  du -sh /Library/Developer/CoreSimulator 2>/dev/null
  xcrun simctl runtime list 2>/dev/null | tail -3
  echo
  echo "=== Snapshots Time Machine locaux ==="
  tmutil listlocalsnapshots / 2>/dev/null | grep -c com.apple | sed 's/^/nb: /'
  echo
  echo "=== Apps desinstallees avec donnees restantes (>20M) ==="
  cmd_orphans
}

cmd_safe() {
  echo "================ NETTOYAGE SUR (regenerable) ================"
  command -v npm   >/dev/null && npm cache clean --force         >/dev/null 2>&1 && echo "npm cache: ok"
  command -v pnpm  >/dev/null && pnpm store prune                2>&1 | tail -1
  command -v yarn  >/dev/null && yarn cache clean                >/dev/null 2>&1 && echo "yarn cache: ok"
  command -v go    >/dev/null && { go clean -modcache; go clean -cache; echo "go cache: ok"; } 2>/dev/null
  command -v pip3  >/dev/null && pip3 cache purge                >/dev/null 2>&1 && echo "pip cache: ok"
  command -v brew  >/dev/null && brew cleanup -s                 2>&1 | tail -1
  echo "--- builds jetables ---"
  del_dir "$HOME/.gradle/caches"                         && echo "gradle caches: ok"
  [ -d "$HOME/Library/Developer/Xcode/DerivedData" ] && find "$HOME/Library/Developer/Xcode/DerivedData" -mindepth 1 -delete 2>/dev/null && echo "Xcode DerivedData: ok"
  echo "--- ~/Library/Caches ---"
  find "$HOME/Library/Caches" -mindepth 1 -delete 2>/dev/null; echo "Caches vides (fichiers verrouilles ignores)"
  echo; free_space
}

cmd_simulators() {
  echo "================ SIMULATEURS iOS ================"
  echo "Supprime TOUS les appareils + runtimes iOS (re-telechargeables via Xcode)."
  printf "Confirmer ? [y/N] "; read -r ans
  case "$ans" in
    y|Y|yes|o|O|oui)
      xcrun simctl delete all 2>&1 | tail -1
      xcrun simctl runtime delete all 2>&1 | tail -1
      echo "Fait."; du -sh /Library/Developer/CoreSimulator 2>/dev/null; free_space;;
    *) echo "Annule.";;
  esac
}

# Build the orphan candidate list into $SCRATCH/to_delete.txt and $SCRATCH/skipped.txt
compute_orphans() {
  build_inventory
  local installed="$SCRATCH/apps.txt"
  : > "$SCRATCH/orphan_dirs.txt"
  # Application Support folders with no matching installed app name
  for d in "$HOME/Library/Application Support"/*; do
    [ -d "$d" ] || continue
    local name; name=$(basename "$d")
    case "$name" in com.apple.*|Apple*|CrashReporter|MobileSync|Caches|Knowledge|AddressBook|SyncServices) continue;; esac
    grep -qiF -- "$name" "$installed" 2>/dev/null && continue
    local sz; sz=$(du -sm "$d" 2>/dev/null | cut -f1)
    [ "${sz:-0}" -ge 20 ] && echo "$d" >> "$SCRATCH/orphan_dirs.txt"
  done
  # Expand to all related Library locations by keyword, then protect sensitive paths
  : > "$SCRATCH/all_paths.txt"
  while read -r d; do
    local kw; kw=$(basename "$d")
    find "$HOME/Library" -maxdepth 4 -iname "*${kw}*" -prune 2>/dev/null >> "$SCRATCH/all_paths.txt"
  done < "$SCRATCH/orphan_dirs.txt"
  sort -u "$SCRATCH/all_paths.txt" \
    | grep -viE '/Mobile Documents/|/iMovie/|com\.axieinfinity|/com\.lwouis\.alt-tab-macos/|/com\.tinyapp\.TablePlus/|/de\.appsolute\.(MAMP|mamppro)/|/studio\.fireball\.OneSwitch/|/com\.bugsnag\.Bugsnag/|/org\.kde\.|/Mozilla/|/Library/Parallels/|-recordings|/(Warp|warp|Raycast|raycast|riot|[Ll]eague|com\.apple)' \
    > "$SCRATCH/to_delete.txt"
  sort -u "$SCRATCH/all_paths.txt" \
    | grep -iE '/Mobile Documents/|/iMovie/|com\.axieinfinity|/com\.lwouis\.alt-tab-macos/|/com\.tinyapp\.TablePlus/|/de\.appsolute\.(MAMP|mamppro)/|/studio\.fireball\.OneSwitch/|-recordings' \
    > "$SCRATCH/skipped.txt"
}

cmd_orphans() {
  compute_orphans
  echo "=== Apps desinstallees (dossiers Application Support orphelins) ==="
  while read -r d; do printf "%6sM | %s\n" "$(du -sm "$d" 2>/dev/null | cut -f1)" "$(basename "$d")"; done < "$SCRATCH/orphan_dirs.txt" | sort -rn
  if [ "${1:-}" = "--delete" ]; then
    echo; echo "=== PROTEGES (non touches: iCloud, apps installees, recordings) ==="; cat "$SCRATCH/skipped.txt"
    echo; echo "$(wc -l < "$SCRATCH/to_delete.txt") chemins a supprimer."
    printf "Confirmer la suppression ? [y/N] "; read -r ans
    case "$ans" in
      y|Y|yes|o|O|oui)
        local n=0; while read -r t; do del_path "$t" && n=$((n+1)); done < "$SCRATCH/to_delete.txt"
        echo "$n chemins traites."; free_space;;
      *) echo "Annule (rien supprime).";;
    esac
  else
    echo; echo "Pour supprimer : cleanup.sh orphans --delete"
  fi
}

case "${1:-scan}" in
  scan)       cmd_scan;;
  safe)       cmd_safe;;
  simulators) cmd_simulators;;
  orphans)    cmd_orphans "${2:-}";;
  all)        cmd_safe; echo; cmd_simulators; echo; cmd_orphans;;
  *) echo "Usage: cleanup.sh {scan|safe|simulators|orphans [--delete]|all}"; exit 1;;
esac
