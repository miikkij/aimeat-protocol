# Run 3 Status — 2026-03-28 (updated 7:30 PM)

## Models
- Reasoning: Qwen3.5 397B A17B
- Execution: Qwen3 Coder Plus

## Registered (5/14) — 1 active
1. CSM ✅
2. Memory (Oletusasetukset) ✅
3. Translation (fi) — 59 keys ✅
4. Translation (en) — 59 keys ✅
5. Extension (PRH API -integraatio) ✅ ACTIVE — 9 actions, assembly with 1 reflection retry

## Data Cortex (PRH-yritystietojen tietokerros)
- Test: ✅ (by autopilot)
- Skeleton: ✅ (by autopilot)
- Some units done by autopilot
- Autopilot stopped here — needs to be resumed

## Remaining (8 components)
- Data Cortex (resume)
- 6 Feature Cortexes
- App-Domain Cortex
- App

## Bugs Fixed This Session
1. `units.map is not a function` — FIXED: autopilot assembly pass now converts unitMap object to array
2. Extension registration — FIXED: worked after units.map fix, assembly validated after 1 reflection retry
3. `Project not found` on OpenRouter complete — FIXED: now checks both generator and foundry namespaces
4. Model fallback using wrong models — FIXED: uses reasoningModel/executionModel from settings
5. Pass Progress UI — FIXED: compact dots in sidebar instead of ugly vertical list with oversized button

## UI Improvements Made
- Pass Progress now shows compact dots in sidebar instead of ugly vertical list
- "Run with AI" button added to multi-pass component views
- Two-model routing (reasoning/execution) via OpenRouter
- Admin debug tab shows both Generator and Foundry projects
