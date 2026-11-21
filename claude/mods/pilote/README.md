# pilote

Mod Claude Code : le suivi d'un projet sans GitHub. **Le fichier est la vérité, le code garde les portes, le modèle décide, le propriétaire donne les go.**

Il ne s'active que dans un dossier qui contient `pilotage/pilotage.json`. Ailleurs, il ne fait rien.

## Le fichier

`pilotage/pilotage.json`, versionné avec le code : `projet`, `jalons`, `scopes` (verdict, garder / couper / repousser), `taches` (résultat, critères, priorité, taille, risque données, dépendances, questions bloquantes, statut, notes de suivi, preuve), `questions` (options, enjeu, ce qu'elles bloquent, décision et mots du propriétaire), `journal`.

Dans `projet`, deux clés facultatives, propres au projet :
- `verification` : la gate locale, par exemple `"make check"` (des mots séparés par des espaces, sans shell) ;
- `relecteur` : le type de sous-agent qui relit une tâche qui touche aux données, par exemple celui que le projet déclare dans `.claude/agents/`.

Le backlog s'édite librement. **Les statuts, les décisions et les go ne s'éditent pas à la main** : une modification qui en change un est refusée, comme celle qui laisserait le JSON illisible. Sont refusés aussi :
- un changement des `criteres`, `risque_donnees`, `invariant`, `depend_de` ou `bloque_par` d'une tâche `en_cours` (ou sa suppression) : une tâche en cours garde ses termes jusqu'à sa fin, le message nomme le champ. Pour les changer : `tache_suspendre`, puis l'édition. `notes`, `suivi`, `titre`, `chemins` restent libres ;
- un changement de `projet.verification` ou `projet.relecteur` une fois posés (les poser la première fois passe) ;
- un changement des mouvements que le journal enregistre.

## Les portes (dans le code)

Une tâche est **prête** quand son jalon a son go, que ses dépendances sont faites et qu'aucune question ouverte ne la bloque. Sinon elle est `backlog` ou `bloque`, et le code dit ce qu'elle attend.

| Outil (modèle) | Ce qu'il fait | Refuse |
|---|---|---|
| `tache_demarrer` | passe en cours, rend la fiche ; rappelle plan + invariant si la tâche touche aux données | une tâche pas prête ; plus de `wip_max` tâches en cours (2 par défaut) |
| `tache_note` | fait / reste / suivant, pour la reprise | une note incomplète |
| `tache_terminer` | lance **lui-même** la gate (`projet.verification`) dans le checkout principal, les `chemins` de la tâche dans `PILOTE_CHEMINS` (un par ligne) ; sa sortie (commande, code, durée, fin) s'ajoute à la preuve du modèle. Pour une tâche qui touche aux données, lance **lui-même** le relecteur (`projet.relecteur`) sur le diff de la tâche et lit son verdict. Puis fait ; dit ce qui devient prêt | sans preuve ; un critère non couvert ; la gate qui échoue, dépasse 10 min ou ne se lance pas (`make` absent) ; un relecteur qui ne démarre pas, ne répond pas en 20 min, ou dont la dernière ligne n'est pas `verdict: OK` (ou qui marque un point `A_CORRIGER` / `BLOQUANT`) |
| `tache_suspendre` | remet au backlog avec la raison | |
| `tache_abandonner` | abandonne une tâche qu’une décision rend inutile ; ce qui la suit est débloqué | sans raison ; une tâche tenue par une autre session |
| `question_poser` | pose une décision au propriétaire, bloque les tâches concernées | |
| `question_trancher` | enregistre la décision avec les mots du propriétaire | sans ses mots |
| `pilotage_etat` | le résumé | |

## Plusieurs sessions en parallèle

- **Un seul fichier.** Le pilotage vit dans le checkout principal (le dossier qui tient le `.git` commun). Une session ouverte dans un worktree lit et écrit celui-là ; la copie de son worktree est refusée en édition.
- **Une tâche a un tenant.** `tache_demarrer` écrit la session dans `tenue_par`. Note, fin et suspension sont refusées à une autre session ; une session arrêtée se reprend avec `reprendre: true` (bouton *Reprendre* sur une tâche immobile).
- **`wip_max` par session** (2 par défaut).
- **Chemins verrouillés.** Chaque tâche déclare les `chemins` qu'elle écrit. Une tâche ne démarre pas si une tâche en cours écrit un même chemin. `projet.zones_liees` lie des préfixes qui verrouillent ensemble (le code généré et sa source).
- **Écritures concurrentes.** Chaque mouvement relit le fichier juste avant d'écrire et se rejoue sur ce qu'une autre session a écrit entre-temps. La fenêtre restante est celle entre la dernière lecture et l'écriture.

## La preuve et la relecture, vérifiées

`tache_terminer` vérifie d'abord ce qui ne coûte rien (tâche en cours, tenant, preuve, critères), puis lance la gate, puis le relecteur, puis écrit la fin sur une relecture fraîche du fichier.

- **Sans `projet.verification`**, la preuve reste déclarée (comportement d'avant) et le résultat le dit. **Sans `projet.relecteur`**, le verdict de relecture reste déclaré (`relecture_verdict`) et le résultat le dit.
- **Le relecteur est un sous-agent lancé par le mod** (`$.agent.spawn`, avec le type `projet.relecteur`). Son prompt porte la tâche, l'invariant et le diff de ses chemins depuis le dernier commit avant son début (les fichiers nouveaux sont nommés). Sa réponse arrive par son `turn.complete` ; le mod en lit la dernière ligne `verdict: …`, aggravée par tout point marqué `A_CORRIGER` ou `BLOQUANT`. Le champ déclaré est ignoré.
- **Alternative écartée : un rapport daté** (`pilotage/relectures/<ID>-<date>.md`, première ligne `verdict: …`, plus récent que le début de la tâche et que le dernier commit de ses chemins). Le mod ne peut pas savoir qui a écrit ce fichier : le modèle peut l'écrire lui-même, c'est le champ déclaré déplacé dans un fichier. `$.agent.spawn` est l'API documentée du moteur pour exactement ce cas (un outil du mod qui lance un sous-agent et attend sa réponse, sans budget de temps), et le verdict vient alors de la réponse même du sous-agent.

## Les statuts changés hors du mod, signalés

Chaque mouvement que fait le mod (démarrer, reprendre, terminer, suspendre, abandonner) écrit dans `journal` une entrée avec `tache` et `statut`. À chaque lecture, le mod compare : une tâche `en_cours`, `fait` ou `abandonne` que le dernier mouvement du journal n'explique pas, ou une tâche que le journal a laissée dans un de ces statuts et qui n'y est plus, est signalée (« changed outside the mod? ») en tête de la dernière ligne du panneau et dans `pilotage_etat`. Les entrées écrites avant ce mécanisme sont lues par leurs mots (« X démarrée », « X terminée »…). Les statuts dérivés (`backlog`, `pret`, `bloque`) sont recalculés par les règles et ne comptent pas. Le signalement reste tant que le propriétaire n'a pas remis le statut ou le journal d'accord, à la main.

## Le découpage, vérifié

La dernière ligne du panneau liste ce qui cloche dans le backlog : un cycle de dépendances, deux tâches sans ordre entre elles qui écrivent un même chemin, une tâche de taille L, sans critère, ou qui touche aux données sans `invariant`.

## Limites connues

- Le garde ne voit que les outils Edit et Write : une écriture par le shell (`sed`, `cat >`) n'est pas empêchée. Un statut ainsi changé est **détecté après coup** (signalé à la lecture), pas évité ; un changement par le shell des termes d'une tâche en cours, de `projet.verification` ou de `projet.relecteur` n'est ni empêché ni signalé.
- La gate tourne dans le checkout principal : le travail d'un worktree qui n'y est pas encore n'est pas ce qu'elle vérifie. Elle est bornée à 10 min (la limite de `$.process.run`).
- L'attente du relecteur vit dans le module : un rechargement du mod pendant une relecture la perd, et `tache_terminer` refuse au bout de 20 min.
- Une session qui tourne encore la 0.1.0 réécrit `projet` sans `verification` ni `relecteur` : poser ces clés seulement quand toutes les sessions ont rechargé la 0.2.0.
- Les chemins verrouillent le démarrage, pas encore chaque écriture : une session peut écrire hors des chemins de sa tâche.

## Commandes et panneau

- `/pilotage` ouvre le panneau et imprime le résumé.
- `/go <jalon>` donne le go, **tapé par toi seulement** (refusé s'il vient d'un modèle ou d'un plugin).

Le panneau, ouvert tout seul quand le fichier existe :
- **À TOI** : les questions ouvertes (triées par nombre de tâches bloquées, bouton *Trancher*), le jalon courant qui attend ton go (*Go*, avec Oui / Non), les tâches en cours immobiles depuis un jour (*Reprendre*).
- **EN COURS** : les tâches en cours, depuis quand, leur prochaine action.
- **PROCHAINES** : les 5 tâches prêtes, P0 d'abord (*Démarrer*).
- **PAR SCOPE**, **JALONS** : l'avancement, et le nombre de tâches bloquées.
- La dernière ligne dit quand le fichier a été lu, ou ses incohérences (référence vers rien, id en double).

Le fichier est relu dès qu'il change sur le disque (toutes les 3 s). Un bouton n'est pressé que par toi : *Trancher*, *Démarrer* et *Reprendre* demandent au modèle, *Go* écrit le go directement.

## Installer

Le mod vit dans la marketplace locale `skayfa` (`~/dotfiles/claude/mods`). `install.sh` l'installe à l'étape 5. À la main :

```
claude plugin marketplace list | grep -q skayfa || claude plugin marketplace add ~/dotfiles/claude/mods
claude plugin install pilote@skayfa --scope user
```

Puis `/reload-plugins` dans une session ouverte. Il est installé pour toutes les sessions, mais ne fait rien hors d'un dossier qui a `pilotage/pilotage.json`.

## Mettre à jour

L'installation est une copie, rangée sous la version de `.claude-plugin/plugin.json`. Une modification ici ne sert qu'après :

1. `claude plugin validate` et `claude plugin test` sur ce dossier ;
2. la version montée dans `plugin.json` ;
3. `claude plugin marketplace update skayfa && claude plugin update pilote@skayfa`, puis `/reload-plugins`.

## Développer

```
claude plugin validate ~/dotfiles/claude/mods/pilote
claude plugin test ~/dotfiles/claude/mods/pilote
```

Pour essayer une modification sans l'installer : `claude --plugin-dir ~/dotfiles/claude/mods/pilote`, après `claude plugin disable pilote@skayfa` pour ne pas le charger deux fois.

`hooks/rules.ts` : les règles pures (lecture, portes, mouvements, journal, gate et verdict, lignes du panneau). `hooks/register.tsx` : les hooks, les outils (dont la gate et le relecteur de `tache_terminer`), le panneau. `types/index.d.ts` : le fichier et l'état du panneau.
