# Final inference and defense materials

**Goal:** Deliver the selected saved LoRA as a versioned, validated local inference model, with an honest demonstration and final presentation.

**Architecture:** Keep the frozen training protocol intact. A separate inference runtime loads the pinned base and verified adapter, validates requests before generation, and returns checked output plus model identity. A loopback-only demonstration service reuses one model instance. The existing four-channel Express application remains a separate product path.

**Tech stack:** Existing Python 3.10, torch/transformers/peft; standard-library HTTP server; existing React/Express tests.

**Scope decisions:** Use existing selected LR=0.0005 by validation NLL; no retraining or test-driven selection. RU/KK, website, neutral, 250 characters only. CPU fallback and explicit CUDA option. No paid APIs, public deployment, or Git push required. Preserve all existing local presentation scratch directories.

## Review focus
Malformed or oversized inputs must fail before expensive loading; damaged weights/config must fail closed; invalid generation must not appear as accepted text; CPU must not execute CUDA calls; demo must remain loopback-only and distinguish itself from the production app.

## Tasks
- [x] Add behavioral tests for normalization, invalid inputs, manifest integrity, rejected generation, CLI errors, HTTP request handling.
- [x] Implement final runtime, model manifest and CLI. Preserve frozen common.py/train.py/config.json.
- [x] Add local demo service, fresh RU/KK examples and reproducible benchmark; measure actual load and generation on saved weights.
- [x] Document contract, model selection, deployment, performance and limitations. Create 10-slide final presentation using recorded evidence.
- [x] Run Python suite, existing application tests/build, artifact audit; review changes and fix material findings.

Verification: unittest discovery in experiments/lora-study; npm test; npm run build; audit_artifacts.py; actual CUDA and CPU inference; HTTP smoke; visual slide review.

## Verification record

21 Python tests passed, including portable-package tests. Existing npm test passed and production build succeeded. Frozen artifact audit recomputed 108 responses with no drift. Real CUDA and CPU inference passed; browser RU/KK generation and 390px viewport checked. Fresh reviewer found three issues (ingredient case/qualifiers, missing title/control characters, idle HTTP connections): reproduced with failing tests and fixed; full Python suite passed. No public deployment or Git push performed.

Scope decision: local one-channel inference is separate from the product four-channel provider because that broader contract was not evaluated. Portable inference package omits base weights and downloads the pinned revision on first use.
