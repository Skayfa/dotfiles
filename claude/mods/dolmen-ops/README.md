# dolmen-ops

Mod Claude Code pour travailler sur Dolmen (Empowill). Le code surveille, le modèle décide. Vision complète : https://claude.ai/artifact/VRPwJaArXMFsow7onrDTUU

Il ne s'active que dans une session ouverte dans le checkout Dolmen ou un de ses worktrees. Le dossier est reconnu à `cmd/dolmen/main.go`, ou on le donne avec `DOLMEN_DIR`. Ailleurs, il ne fait rien.

## Installation

`install.sh` le fait. À la main :

```bash
claude plugin marketplace add ~/dotfiles/claude/mods
```

```bash
claude plugin install dolmen-ops@skayfa --scope user
```

Le mod est lu depuis ce dossier. Après une modification, tape `/reload-plugins` dans la session.

Il a besoin de ce que Dolmen utilise déjà :
- `task` ;
- `NOTION_TOKEN` dans `~/.dolmen/.envprivate` ;
- `glab` connecté ;
- `go`, pour compiler `mrwatch` (une fois par Mac, recompilé seulement quand ses sources changent).

Pas de `ccw` ni de tmux : les lots sont des agents de la session courante (les sous-agents natifs de Claude Code), et les worktrees sont créés et supprimés avec `git worktree`.

## Le Lead et ses lots

| Qui | Ce qu'il fait |
|---|---|
| **Session Lead** (le checkout Dolmen, sur `main`) | Elle pilote et ne code pas : le panneau, `/etat`, `/bugs`, `/ticket`, `/relire`, `/epic` |
| **Agent de lot** | Un par lot, lancé par le mod dans le worktree du lot au premier `/plan ET-…` (un sous-agent de la session Lead, avec le worktree comme dossier). Il apparaît dans tes agents Claude et dans « Lots en cours ». `/plan`, `/mr`, `/note`, `/pret` et `/detacher` lui sont envoyés, comme les fils, conflits et CI rouges de sa MR |

Le lot visé est celui dont tu donnes le ticket (`/plan ET-4236`), ou le seul ouvert. Une session Claude ouverte à la main dans le worktree d'un lot reste possible : elle tient alors ce lot, se réveille sur sa MR, et la session Lead ne touche plus à ce lot (voir « Une session, un lot »).

## Commandes

| Commande | Ce qu'elle fait |
|---|---|
| `/ticket [ET-… …] [force]` | Sans argument : le prochain ticket de ton DEW. Avec des ids : prend les tickets (`task dew-claim`) et crée **un** lot, avec la branche `ET-4449-ET-4481-<slug>` depuis `origin/main` dans son worktree, à côté du checkout (`../dolmen-worktrees/<branche>`, ou `$DOLMEN_WORKTREES`). Rien n’est poussé. Ensuite `/plan ET-…` démarre l'agent du lot |
| `/ajouter ET-…` | Ajoute un ticket au lot de ce worktree. La branche garde son nom ; l'id va dans le titre de la MR et dans sa section ticket |
| `/detacher ET-…` | L'agent sort le ticket vers sa propre branche (cherry-pick, puis un revert dans le lot), sans réécrire ce qui est poussé |
| `/plan` | Skill `grill`, contrôles readiness (`auth:`, profil, route, données showcase), puis le test plan « En tant que … → … ». Rien n'est écrit dans Notion sans ton OK |
| `/mr` | MR Draft avec le skill `open-mr-empowill` : template, un lien par ticket, section « État » |
| `/pret [iid]` | Tapé par toi seulement. Refuse une MR rouge ou en conflit. Sinon : `verify`, recette (`POST=1`), `qa-will`, puis sortie de Draft, autorisée pour cette MR pendant 2 h |
| `/note` | Met à jour la section « État » de la MR : fait, reste, prochaine commande |
| `/relire [iid]` | Relecture d'une MR d'un collègue avec `review-mr-empowill`. Rien n'est posté sans ton OK |
| `/epic <lien>` | Propose un découpage en tickets ≤ Medium avec leur Plan. Rien n'est créé sans ton OK |
| `/bugs` | Les bugs ouverts qui te sont assignés ou qui sont dans les scopes que tu leades ou maintiens, en jours ouvrés contre le SLO (Critical 3, High 15, Low 30) |
| `/etat`, `/panneau` | Tes lots en cours (agent, branche, MR), tes MR (pipeline, fils, Draft), les relectures demandées, les bugs, ton DEW, le coût du lot, le rôle de la session et le quota |
| `/menage [go]` | Liste les worktrees de lots déjà dans `main`. `go`, tapé par toi, les supprime avec `git worktree remove` puis `git branch -d` (jamais forcé : git garde un worktree modifié et une branche non mergée) |

Pour le modèle :
- l'outil `ticket_card` donne une fiche compacte (Plan et page coupée à 6 000 caractères) au lieu de la page Notion brute ;
- l'agent `dolmen-ops:runner` (Haiku) lance un test, le lint ou la recette, et lit le résultat.

## Le panneau

`/panneau` : LOTS EN COURS, MES MR, À RELIRE, BUGS DE MES SCOPES, MON DEW, SESSION. Il s'ouvre tout de suite avec ce que le Mac sait déjà, même après un `/clear`. Chaque lot et chaque MR dit **depuis quand il a bougé** ; un lot immobile depuis plus d'un jour passe en orange.

Les lignes qui attendent un geste ont leur **bouton**. Seul Younes peut appuyer, jamais un modèle. Les trois qui écrivent demandent « Oui / Non » (10 s) :

| Ligne | Bouton | Ce qu'il fait |
|---|---|---|
| MR avec des fils, une CI rouge ou un conflit | Traiter | envoie le digest à l'agent du lot (le démarre s'il n'existe pas) avec le babysit |
| MR Draft verte, sans fil | Prête · Oui / Non | comme `/pret` : verify, recette, qa-will, puis sortie de Draft autorisée 2 h |
| MR à relire | Relire | comme `/relire` : rien n'est posté sans ton OK |
| Bug que personne ne tient, ou à toi hors lot | Prendre · Oui / Non | comme `/ticket ET-…` : claim Notion, branche, worktree |
| Premier ticket du DEW | Prendre · Oui / Non | idem |
| Lot immobile depuis un jour | Reprendre | demande à son agent de relire l'État de sa MR et de reprendre, ou de dire ce qui bloque |
| À nettoyer | Nettoyer · Oui / Non | comme `/menage go` |

**Une session, un lot.** Chaque session publie pour le Mac ce qu'elle tient : sa branche (une session ouverte dans un worktree) ou les lots de ses agents (le Lead). Un bouton sur un lot n'apparaît que dans la session qui le tient ; ailleurs la ligne dit « autre session », et ses événements de MR restent à cette session.

## Ce que le code fait tout seul

- **Une lecture par Mac, pas par session.** GitLab, Notion et `task dew` sont lus une fois pour toutes les sessions du Mac, dans `~/.cache/dolmen-ops/` (un fichier par source ; une session tient un bail de 30 s pendant qu'elle lit) : MR toutes les 2 min, relectures toutes les 10 min, DEW toutes les 30 min, Notion toutes les heures (son quota d'API est petit), ménage toutes les 30 min. Supprimer le dossier ne coûte qu'une relecture.
- **MR**, avec le digest `mrwatch` en lecture seule (c'est le babysit qui fait le `-ack`). Une seule alerte par changement : l'agent du lot se réveille ; sans agent, la session Lead te notifie et « Traiter » le démarre. Quand une MR ouvre, ses tickets passent de In Progress à « Merge request ».
- **Ce qui survit à `/reload-plugins`** est dans `$.state` : les événements de MR déjà signalés (pas de second réveil sur les mêmes fils), le feu vert de `/pret`, le coût du dernier tour.
- **Garde-fous** sur les commandes Bash de l'agent :
  - pas de `git add -A` ;
  - pas de force-push ;
  - pas de `--amend` sur un commit déjà poussé ;
  - pas de `glab mr merge` ni `approve` ;
  - pas de `--ready` sans `/pret` ;
  - pas de `mr create` sans `--draft`, ni de `--description` sans le template.
- **Sorties réduites** pour `task test-pkg`, `task lint`, `task recette`, `golangci-lint` et `pnpm test` : au-delà de 150 lignes, l'agent lit le début, les erreurs, la fin, et le chemin du log complet.
- **Coût par lot** : les dollars de chaque tour sont ajoutés au lot de la branche courante, avec le nombre de pipelines de sa MR.
- **Économie de tokens** : à chaque tour, une ligne rappelle au modèle quel modèle utiliser pour quelle tâche. Au-delà de 90 % de quota, il écrit l'État de la MR.

## Code

| Fichier | Rôle |
|---|---|
| `hooks/rules.ts` | Les règles pures, sans `$` : garde-fous, lecture de `task dew` et de `mrwatch`, SLO, lots |
| `hooks/dolmen.ts` | Le seul endroit qui lance des commandes : git, `task`, `glab`, `mrwatch`, et Notion via `task notion-api` |
| `hooks/calls.ts` | Quand lire : une fois par Mac, d'après l'état partagé de `hooks/cache.ts` (repris de seammo-ops) ; qui tient quel lot |
| `hooks/lots.ts` | Ouvrir un lot, y ajouter un ticket, faire le ménage |
| `hooks/register.tsx` | Les hooks, les commandes et le panneau Everforest |
| `test/` | Les tests, sur le faux moteur de `test/world.ts` |

```bash
claude plugin test ~/dotfiles/claude/mods/dolmen-ops
```

Pas encore éprouvé contre le vrai Dolmen : les réponses de `task dew`, `mrwatch`, `glab` et l'API Notion sont simulées d'après leur code source. À vérifier au premier lancement : `/etat`, puis `/ticket` sur un ticket Simple.
