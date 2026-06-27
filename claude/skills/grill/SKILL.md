---
name: grill
description: Challenge a subject/spec/ticket before building, by confronting it to 4 sources (sillon transcripts & decisions, the Notion epic, the codebase, client insights). Surfaces gaps, contradictions, missing acceptance criteria, and pending questions, and produces an explicit testable acceptance-criteria checklist. Use right after intake of a feature/improvement/bug, before writing any code.
---

# Grill — challenge multi-source d'un sujet

Objectif : confronter la compréhension du sujet à la réalité pour livrer **fidèle à ce qui a été vraiment demandé**. On ne code pas ici — on cadre.

## Entrées (à récupérer)

- **Le ticket / epic** — Notion MCP (`notion-fetch` / recherche) : champs `Plan` (instructions), `Type`, `Epic`, critères.
- **Le subject sillon** s'il existe — sillon MCP `get_subject` (slug ↔ ID ticket) : objectif, **décisions**, **REX/log**, points ouverts.
- **La codebase** du repo courant (lis le code concerné).
- **Insights / retours clients** — via sillon / Notion.

## Profondeur selon le `Type`

- **Feature** → grill profond (périmètre, edge cases, critères complets).
- **Amélioration** → cadrer « avant → après » + critères du delta.
- **Bug** → repro + cause racine + critère « corrigé quand… ».

## Confronter aux 4 sources

1. **Transcripts / décisions (sillon)** — ce qui a été _dit / tranché_ contredit-il ou précise-t-il le ticket ?
2. **L'epic (Notion)** — le sujet sert-il l'objectif de l'epic ? quelque chose hors-périmètre ?
3. **La codebase** — faisabilité, patterns existants à réutiliser, conflits, impact, dette induite.
4. **Insights clients** — le besoin réel correspond-il à la demande écrite ?

## Sortie (structurée, en français)

- **Critères d'acceptation** explicites = une checklist **testable** (c'est LE livrable du grill).
- **Gaps / ambiguïtés / contradictions** entre les 4 sources.
- **Pending questions** à trancher (et avec qui).
- **Risques codebase** (conflits, refactor nécessaire, impact).
- **Verdict** : prêt à coder ? ou questions bloquantes d'abord ?

Termine TOUJOURS par : la checklist de critères d'acceptation + les questions ouvertes. Ne propose pas d'implémentation.
