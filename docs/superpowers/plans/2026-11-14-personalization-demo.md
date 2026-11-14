# Personalization demonstration and varied dishes

User confirmed no real customer data; use explicitly synthetic demonstrations.

Goal: reproducible comparison of the actual LinUCB implementation against random and fixed descriptions, plus working varied RU/KK recipes and a visible demonstration in the app.

Constraints: no claims of real conversion/order uplift; no writes to live learning models; no paid provider calls; preserve edited user recipes and existing scratch directories. No new public deployment. Existing website provider remains configurable.

Tasks:

- [x] Test and add 12 compact demonstration recipes (6 RU, 6 KK), validate all three template styles and four channels.
- [x] Add authenticated, idempotent recipe import without overwrites; expose it on personalization page for old accounts.
- [x] Add reproducible simulation using actual buildContext/chooseArm/updateModel, seeded tie-breaking, multiple seeds, personalized and no-effect scenarios, raw results and assumptions.
- [x] Show synthetic comparison and real/demo event counts separately. Do not label add-to-cart events as purchases or causally attribute observational rates.
- [x] Run backend tests, frontend build/format/E2E; review and correct material findings. Document actual measured simulation results.

Review focus: reward leakage; null-control behavior; deterministic replay; live/demo isolation; idempotent import; user edits preserved; empty statistics; RU/KK source language; untested provider claims.
