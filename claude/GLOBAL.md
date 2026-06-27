# Ma méthode de travail (global — importé dans tous les projets)

## Principe

Livrer **clean et fidèle à ce qui a été vraiment demandé**. Avant de coder : **challenger** la demande. Avant de livrer : **vérifier** que chaque critère d'acceptation est couvert.

## La boucle (par type de sujet : feature / amélioration / bug)

1. **Intake** — lire le ticket (Notion MCP : `Plan`, `Type`, `Epic`, critères). Si un subject `sillon` existe (slug ↔ ID ticket), le lire (sillon MCP `get_subject` : objectif, décisions, REX, points ouverts).
2. **Grill (challenge)** — confronter la spec à 4 sources : transcripts/décisions (sillon), l'epic (Notion), **la codebase**, insights clients. Sortir : gaps, contradictions, **critères d'acceptation manquants**, pending questions. Profondeur selon le `Type`. → skill **`grill`**.
3. **Contrat** — spec + critères d'acceptation explicites validés. Le REX (décisions) vit dans `sillon`.
4. **Build** — selon l'`AGENTS.md` du projet (« Comment tester » / « Comment livrer »).
5. **Gate de fidélité** — générer le plan de test depuis les critères, lancer les tests du projet, cocher chaque critère. **Ne pas livrer si un critère n'est pas couvert.** → skill **`verify`**.
6. **Ship** — MR/PR selon le projet ; review ; merge.

Perso : même boucle ; le contrat = l'idée qui se précise ; le grill est itératif dans le temps.

## Préférences universelles

- Code et commentaires en **anglais**, jamais en français.
- Pas de commentaires qui répètent juste le nom du type/de la méthode.
- Review dans **lazygit** avant de push ; brancher depuis `main`.
- Travail parallèle : Agent Teams (tmux) ou worktrees `ccw`.
- Backups : seulement avant une **réécriture/écrasement**, pas pour un simple ajout.

## Outils

- **sillon** MCP (lecture seule) : contexte / transcripts / décisions / REX par subject.
- **Notion** MCP : tickets & epics (`Plan` = instructions, `Type`, critères).
- Skills **`grill`** (challenge) et **`verify`** (gate de fidélité).
- Chaque repo a un **`AGENTS.md`** : Stack · Comment tester · Comment livrer · Flow par type.
