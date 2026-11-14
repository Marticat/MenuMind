# Local LoRA website integration

Goal: the existing website calls the saved local model instead of a paid API, with no changes to frozen Python weights/inference or fabricated capability claims.

Design: add `local-lora` provider in Express. POST minimal recipe data to loopback `/generate`, pin expected model version/hash from final_model.json, accept only validated model output. Mirror the same unchanged website/neutral text across the four channel fields, enforcing each channel limit. One actual neutral option in personalization; no fake multi-style learning claims. No fallback and no repair retries for deterministic LoRA. Use a CPU-appropriate timeout and corresponding frontend request timeout. Keep secrets local.

- [x] Add failing contract tests for configuration, exact HTTP payload, actual response propagation, errors, limits, deterministic output and single-call personalization.
- [x] Implement isolated local adapter, integrate generation and personalization cache/version metadata.
- [x] Update UI provider labels, neutral controls, identical-channel/one-option explanation and regeneration behavior; test through browser.
- [x] Document Windows setup and configuration, update local/private copied env, regenerate synthetic report hashes without changing outcomes.
- [x] Run backend/build/E2E and real saved-model RU/KK site smoke test. Review and fix findings.

Verification: 57 backend tests; 10 existing browser tests and one local-provider browser test; production build and formatting check. Live CPU smoke through the website button accepted RU and KK (approximately 13 and 12 seconds in this run). Outputs and screenshot are local `.cache` artifacts, not benchmark claims. Review fixes cover metadata refresh, manual-edit provenance and byte-for-byte local text preservation. The existing repair-budget test now controls time to avoid its former 50 ms scheduling margin; the separate real HTTP cancellation test remains.

Review focus: no paid API calls/secret forwarding; fixed inference contract preserved; timeout/network/busy errors; no silent text trimming or mock generation; stale cache/model identity; no unsupported style/translation claims; unrelated scratch files preserved.
