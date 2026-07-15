---
name: mac-cleanup
description: Reclaim disk space on this Mac by cleaning regenerable dev/app junk safely. Prunes package-manager caches (npm/pnpm/yarn/go/pip/brew), deletes iOS Simulator runtimes & devices, clears build caches (Xcode DerivedData, Gradle), empties ~/Library/Caches, and hunts data left behind by apps that are no longer installed — while protecting iCloud data and installed apps' subfolders. Use when the disk is filling up or the user asks to free space / clean caches / remove leftovers of uninstalled apps.
---

# mac-cleanup

Free disk space by deleting **only regenerable data** (caches, builds, re-downloadable runtimes) and leftovers of uninstalled apps. Never touch user data or iCloud.

Reference run: ~336 GB reclaimed (39 Gi → 375 Gi free). The hidden culprit was `/Library/Developer/CoreSimulator` — 180 GB of iOS runtimes.

## Safety rules (non-negotiable)

1. **`rm -rf` is blocked** by a permission rule on this machine. Use `find <dir> -mindepth 1 -delete` then `rmdir`, and plain `rm` for single files. `cleanup.sh` already does this.
2. **Scan and size before deleting.** Show sizes; ask before anything that is not pure cache.
3. **Never delete**: `~/Library/Mobile Documents/` (iCloud Drive), `~/Documents`, `~/Pictures`, `~/Desktop`, `~/Workspace` (except `node_modules`, on explicit request), `*.pvm` / VMs, and any subfolder owned by a **still-installed** app.
4. **Package managers**: use the official prune (`pnpm store prune`, `npm cache clean`, `go clean -modcache`), never a brutal `rm`.
5. **Possible user data** (browser profiles like Brave, Postman collections, recordings): flag it and **ask**. Never include it in a "clean everything" pass.

## Steps

### 1. Scan — always first

```bash
~/.claude/skills/mac-cleanup/cleanup.sh scan
```

Shows free space, top folders in `~`, `/Library/Developer/CoreSimulator`, Time Machine snapshots, and leftovers of uninstalled apps.

### 2. Safe clean — regenerable, no questions

```bash
~/.claude/skills/mac-cleanup/cleanup.sh safe
```

In order: package-manager caches (`npm cache clean --force`, `pnpm store prune`, `yarn cache clean`, `go clean -modcache -cache`, `pip cache purge`, `brew cleanup -s`) → throwaway builds (Xcode DerivedData, `~/.gradle/caches`, go-build/typescript caches) → `~/Library/Caches` emptied (files locked by open apps are skipped).

### 3. iOS simulators — confirm first, ~180 GB

```bash
xcrun simctl delete all              # devices
xcrun simctl runtime delete all      # OS runtimes — the big one
```

Xcode re-downloads a runtime when needed. The user already accepted "delete everything, I'll reinstall" once — still re-confirm every session.

### 4. Uninstalled apps — confirm first

```bash
~/.claude/skills/mac-cleanup/cleanup.sh orphans           # list only
~/.claude/skills/mac-cleanup/cleanup.sh orphans --delete  # after review
```

Inventories installed apps (`/Applications`, `~/Applications`, `/System/Applications`) and their bundle IDs, then flags folders under `~/Library/{Application Support,Containers,Group Containers,HTTPStorages,WebKit,Logs,Saved Application State,Preferences}` with no matching app. Always excluded: `Mobile Documents` (iCloud), subfolders of installed apps (telemetry such as `*/com.microsoft.appcenter`), iMovie/Axie, `*-recordings`, Parallels. Show the "to delete" and "protected" lists before acting.

### 5. Optional

- Docker: check `docker context show`. If **OrbStack** is active, the Docker Desktop image (`~/Library/Containers/com.docker.docker`, often 30-40 GB) is likely dead and deletable. A real `docker system prune -a` needs the daemon running.
- `node_modules` of untouched `~/Workspace` projects — **on request only**.

## Usual big offenders

| What                          | Where                                      | How                                            |
| ----------------------------- | ------------------------------------------ | ---------------------------------------------- |
| iOS Simulator runtimes        | `/Library/Developer/CoreSimulator`         | `xcrun simctl runtime delete all`              |
| npm / pnpm / go caches        | `~/.npm`, `~/Library/pnpm`, `~/go/pkg/mod` | official prune                                 |
| Xcode DerivedData             | `~/Library/Developer/Xcode/DerivedData`    | `find -delete`                                 |
| `~/Library/Caches`            | —                                          | emptied                                        |
| Android system-images / NDK   | `~/Library/Android/sdk`                    | keep the active AVD's image + the newest NDK   |
| Docker Desktop (on OrbStack)  | `~/Library/Containers/com.docker.docker`   | delete                                         |
| Uninstalled apps              | `~/Library/…`                              | orphans step                                   |

Always end with: a summary table — free space before → after, total reclaimed, and what was **spared** (iCloud, sensitive data).
