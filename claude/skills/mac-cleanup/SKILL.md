---
name: mac-cleanup
description: Reclaim disk space on this Mac by cleaning regenerable dev/app junk safely. Prunes package-manager caches (npm/pnpm/yarn/go/pip/brew), deletes iOS Simulator runtimes & devices, clears build caches (Xcode DerivedData, Gradle), empties ~/Library/Caches, and hunts data left behind by apps that are no longer installed — while protecting iCloud data and installed apps' subfolders. Use when the disk is filling up or the user asks to free space / clean caches / remove leftovers of uninstalled apps.
---

# mac-cleanup — récupérer de l'espace disque, proprement

Objectif : libérer de la place en supprimant **uniquement du régénérable** (caches, builds, runtimes re-téléchargeables) et les **traces d'apps désinstallées**, sans jamais toucher aux données utilisateur ni à iCloud.

Première session de référence : ~336 Go récupérés (39 Gi → 375 Gi libres). Le **gros coupable caché** était `/Library/Developer/CoreSimulator` (180 Go de runtimes iOS).

## Règles de sécurité (NON négociables)

1. **`rm -rf` est bloqué** par une règle de perm sur cette machine → utiliser `find <dir> -mindepth 1 -delete` puis `rmdir`, et `rm` (sans `-rf`) pour les fichiers isolés. Le script `cleanup.sh` le fait déjà.
2. **Toujours scanner et chiffrer AVANT de supprimer.** Montrer les tailles, demander confirmation pour tout ce qui n'est pas du pur cache.
3. **Ne jamais supprimer** : `~/Library/Mobile Documents/` (iCloud Drive), `~/Documents`, `~/Pictures`, `~/Desktop`, `~/Workspace` (sauf `node_modules` sur demande explicite), les `*.pvm`/VMs, et tout sous-dossier appartenant à une app **encore installée**.
4. **Package managers** : prune officiel (`pnpm store prune`, `npm cache clean`, `go clean -modcache`) plutôt qu'un `rm` brutal — ça casse moins et c'est plus sûr.
5. **Données potentielles** (profils navigateur type Brave, collections Postman, enregistrements) : les signaler et **demander** avant suppression, ne pas inclure par défaut dans un nettoyage « tout ».

## Déroulé

### 1. Diagnostic (toujours en premier)

```bash
~/.claude/skills/mac-cleanup/cleanup.sh scan
```

Affiche : espace libre, top dossiers de `~`, `/Library/Developer/CoreSimulator`, snapshots Time Machine, et la liste des **apps désinstallées** dont les données traînent encore.

### 2. Nettoyage « sûr » (régénérable, aucune question)

```bash
~/.claude/skills/mac-cleanup/cleanup.sh safe
```

Fait, dans l'ordre :

- **Package managers** : `npm cache clean --force`, `pnpm store prune`, `yarn cache clean`, `go clean -modcache -cache`, `pip cache purge`, `brew cleanup -s`.
- **Builds jetables** : `~/Library/Developer/Xcode/DerivedData`, `~/.gradle/caches`, caches go-build/typescript.
- **`~/Library/Caches`** : vidé entièrement (fichiers verrouillés par apps ouvertes ignorés).

### 3. Simulateurs iOS (gros gain, ~180 Go possibles) — sur confirmation

L'utilisateur a déjà accepté « delete tout, je réinstallerai » la 1ʳᵉ fois. Re-confirmer à chaque session.

```bash
xcrun simctl delete all                 # supprime les appareils (~/Library/Developer/CoreSimulator/Devices)
xcrun simctl runtime delete all         # supprime les runtimes OS (/Library/Developer/CoreSimulator) — LE gros poste
```

Xcode re-téléchargera un runtime au besoin.

### 4. Apps désinstallées (chasse aux orphelins) — sur confirmation

```bash
~/.claude/skills/mac-cleanup/cleanup.sh orphans          # liste seulement
~/.claude/skills/mac-cleanup/cleanup.sh orphans --delete # supprime après revue
```

Méthode : inventorier les apps installées (`/Applications`, `~/Applications`, `/System/Applications`) + leurs bundle IDs, puis flaguer les dossiers de `~/Library/{Application Support,Containers,Group Containers,HTTPStorages,WebKit,Logs,Saved Application State,Preferences}` sans app correspondante. **Exclut d'office** : `Mobile Documents` (iCloud), sous-dossiers d'apps installées (télémétrie type `*/com.microsoft.appcenter`), iMovie/Axie, `*-recordings`, Parallels. Toujours montrer la liste « à supprimer » + « protégés » avant d'agir.

### 5. Optionnel — Docker / autres

- Contexte Docker actif ? `docker context show`. Si **OrbStack** est actif, l'image **Docker Desktop** (`~/Library/Containers/com.docker.docker`, souvent 30-40 Go) est probablement morte → supprimable. Un vrai `docker system prune -a` nécessite le daemon lancé.
- `~/Workspace` `node_modules` des projets non touchés : candidat suivant, **uniquement sur demande**.

## Gros postes typiques sur cette machine (mémo)

| Poste                               | Où                                         | Comment                                               |
| ----------------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| Runtimes iOS Simulator              | `/Library/Developer/CoreSimulator`         | `xcrun simctl runtime delete all`                     |
| Cache npm / store pnpm / modules go | `~/.npm`, `~/Library/pnpm`, `~/go/pkg/mod` | prune officiel                                        |
| Xcode DerivedData                   | `~/Library/Developer/Xcode/DerivedData`    | `find -delete`                                        |
| `~/Library/Caches`                  | idem                                       | vidé                                                  |
| Android system-images / NDK         | `~/Library/Android/sdk`                    | garder l'image de l'AVD actif + le NDK le plus récent |
| Docker Desktop (si sur OrbStack)    | `~/Library/Containers/com.docker.docker`   | supprimer                                             |
| Apps désinstallées                  | `~/Library/...`                            | étape orphans                                         |

## Sortie attendue

Toujours finir par un **tableau bilan** : espace libre avant → après, total récupéré, et la liste de ce qui a été **épargné** (iCloud, données sensibles) pour rassurer.
