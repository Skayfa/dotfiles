---
name: verify
description: Faithfulness gate before shipping. Generates a test plan from the agreed acceptance criteria, runs the project's test command (from AGENTS.md), and checks every criterion is covered by a passing test. Refuses to ship if any criterion is uncovered or failing. Use after building, before opening the MR/PR.
---

# Verify — gate de fidélité

Objectif : ne **livrer que ce qui couvre chaque critère d'acceptation** validé au `grill`.

## Étapes

1. **Récupérer les critères d'acceptation** du contrat (issus du `grill` / Notion `Plan` / `task/plans/ET-XXXX.md`).
2. **Générer le plan de test** : pour chaque critère, lister le(s) test(s) qui le prouve(nt) — unitaire / intégration / manuel.
3. **Lancer les tests du projet** : la commande définie dans l'`AGENTS.md` du repo, section « Comment tester » (ex. dolmen `task test-pkg PKG=…`, exelab `pnpm test`, proof-cast `make test`). Ne pas contourner les guards (ex. `go test` brut bloqué dans dolmen).
4. **Matrice de couverture** : `critère → test → ✅ / ❌`. Lister explicitement les critères **non couverts** (test manquant ou en échec).
5. **Verdict** :
   - Un critère non couvert / un test en échec → **NE PAS livrer** ; lister précisément ce qui manque à faire.
   - Tout couvert + tests verts → **prêt pour la MR/PR**.

Termine TOUJOURS par : la matrice de couverture + le verdict (ship / pas ship). En cas de « pas ship », donne la todo restante.
