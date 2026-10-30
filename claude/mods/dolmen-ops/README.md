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
- `go`, pour compiler `mrwatch` une fois par session ;
- `ccw`, qui est dans ces dotfiles.

## Deux sortes de sessions

| Session | Où | Ce qu'elle fait |
|---|---|---|
| **Lead** | Le checkout Dolmen, sur `main` | Elle pilote : le panneau, `/etat`, `/bugs`, `/ticket`, `/relire`, `/epic`. Elle ne code pas. Quand une MR reçoit un fil, un conflit ou une CI rouge, elle te notifie avec la commande pour y aller : `ccw attach <branche>` |
| **Lot** | `ccw new <branche>`, une session par lot | Elle code son lot : `/plan`, `/mr`, `/pret`. Elle se réveille seule sur **sa** MR et passe au babysit. Les autres MR ne la dérangent pas |

C'est la branche de la session qui décide de son rôle : une branche `ET-…` fait une session de lot, tout le reste une session Lead. Il n'y a rien à régler.

## Commandes

| Commande | Ce qu'elle fait |
|---|---|
| `/ticket [ET-… …] [force]` | Sans argument : le prochain ticket de ton DEW. Avec des ids : prend les tickets (`task dew-claim`) et crée **un** lot, avec la branche `ET-4449-ET-4481-<slug>` depuis `origin/main` dans le worktree de `ccw` (`../dolmen-worktrees/<branche>`). Rien n’est poussé. Dans tmux, ouvre la session du lot dans une fenêtre à côté (Claude lancé dans le worktree) ; sinon, `ccw new <branche>` |
| `/ajouter ET-…` | Ajoute un ticket au lot de ce worktree. La branche garde son nom ; l'id va dans le titre de la MR et dans sa section ticket |
| `/detacher ET-…` | L'agent sort le ticket vers sa propre branche (cherry-pick, puis un revert dans le lot), sans réécrire ce qui est poussé |
| `/plan` | Skill `grill`, contrôles readiness (`auth:`, profil, route, données showcase), puis le test plan « En tant que … → … ». Rien n'est écrit dans Notion sans ton OK |
| `/mr` | MR Draft avec le skill `open-mr-empowill` : template, un lien par ticket, section « État » |
| `/pret [iid]` | Tapé par toi seulement. Refuse une MR rouge ou en conflit. Sinon : `verify`, recette (`POST=1`), `qa-will`, puis sortie de Draft, autorisée pour cette MR pendant 2 h |
| `/note` | Met à jour la section « État » de la MR : fait, reste, prochaine commande |
| `/relire [iid]` | Relecture d'une MR d'un collègue avec `review-mr-empowill`. Rien n'est posté sans ton OK |
| `/epic <lien>` | Propose un découpage en tickets ≤ Medium avec leur Plan. Rien n'est créé sans ton OK |
| `/bugs` | Les bugs ouverts qui te sont assignés ou qui sont dans les scopes que tu leades ou maintiens, en jours ouvrés contre le SLO (Critical 3, High 15, Low 30) |
| `/etat`, `/panneau` | Tes MR (pipeline, fils, Draft), les relectures demandées, les bugs, ton DEW, le coût du lot, le rôle de la session et le quota |
| `/menage [go]` | Liste les worktrees de lots déjà dans `main`. `go`, tapé par toi, les supprime avec `ccw rm` (jamais forcé) |

Pour le modèle :
- l'outil `ticket_card` donne une fiche compacte (Plan et page coupée à 6 000 caractères) au lieu de la page Notion brute ;
- l'agent `dolmen-ops:runner` (Haiku) lance un test, le lint ou la recette, et lit le résultat.

## Ce que le code fait tout seul

- **MR, toutes les 2 min**, avec le digest `mrwatch` en lecture seule (c'est le babysit qui fait le `-ack`). Une seule alerte par changement : la session de lot se réveille, la session Lead notifie. Quand une MR ouvre, ses tickets passent de In Progress à « Merge request ».
- **Notion et relectures, toutes les heures**, à cause du quota d'API Notion.
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
| `hooks/lots.ts` | Ouvrir un lot, y ajouter un ticket, faire le ménage |
| `hooks/register.tsx` | Les hooks, les commandes et le panneau Everforest |
| `test/` | Les tests, sur le faux moteur de `test/world.ts` |

```bash
claude plugin test ~/dotfiles/claude/mods/dolmen-ops
```

Pas encore éprouvé contre le vrai Dolmen : les réponses de `task dew`, `mrwatch`, `glab` et l'API Notion sont simulées d'après leur code source. À vérifier au premier lancement : `/etat`, puis `/ticket` sur un ticket Simple.
