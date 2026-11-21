# pilote

Mod Claude Code : le suivi d'un projet sans GitHub. **Le fichier est la vérité, le code garde les portes, le modèle décide, le propriétaire donne les go.**

Il ne s'active que dans un dossier qui contient `pilotage/pilotage.json`. Ailleurs, il ne fait rien.

## Le fichier

`pilotage/pilotage.json`, versionné avec le code : `projet`, `jalons`, `scopes` (verdict, garder / couper / repousser), `taches` (résultat, critères, priorité, taille, risque données, dépendances, questions bloquantes, statut, notes de suivi, preuve), `questions` (options, enjeu, ce qu'elles bloquent, décision et mots du propriétaire), `journal`.

Le backlog s'édite librement. **Les statuts, les décisions et les go ne s'éditent pas à la main** : une modification qui en change un est refusée, comme celle qui laisserait le JSON illisible.

## Les portes (dans le code)

Une tâche est **prête** quand son jalon a son go, que ses dépendances sont faites et qu'aucune question ouverte ne la bloque. Sinon elle est `backlog` ou `bloque`, et le code dit ce qu'elle attend.

| Outil (modèle) | Ce qu'il fait | Refuse |
|---|---|---|
| `tache_demarrer` | passe en cours, rend la fiche ; rappelle plan + invariant si la tâche touche aux données | une tâche pas prête ; plus de `wip_max` tâches en cours (2 par défaut) |
| `tache_note` | fait / reste / suivant, pour la reprise | une note incomplète |
| `tache_terminer` | fait, avec la preuve locale (pas de CI) ; dit ce qui devient prêt | sans preuve ; un critère non couvert ; une tâche qui touche aux données sans relecture locale au verdict OK |
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

## Le découpage, vérifié

La dernière ligne du panneau liste ce qui cloche dans le backlog : un cycle de dépendances, deux tâches sans ordre entre elles qui écrivent un même chemin, une tâche de taille L, sans critère, ou qui touche aux données sans `invariant`.

## Limites connues

- Le garde ne voit que les outils Edit et Write : une écriture par le shell (`sed`, `cat >`) passe à côté. Les mouvements de statut doivent passer par les outils.
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

`hooks/rules.ts` : les règles pures (lecture, portes, mouvements, lignes du panneau). `hooks/register.tsx` : les hooks, les outils, le panneau. `types/index.d.ts` : le fichier et l'état du panneau.
