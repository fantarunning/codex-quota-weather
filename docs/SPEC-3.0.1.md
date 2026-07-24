# SPEC v3.0.1 — Update Reliability & New-User Plan Detection

Status: implemented on branch, pending release publish.
Owner: this document is the acceptance contract. A change is "done" ONLY when
every acceptance point below is satisfied AND every command in "Minimum CI Gate"
exits 0. Do not mark a task complete on the basis of "looks right" or a partial
run. If you cannot run a gate, say so explicitly and stop; do not claim it passed.

This spec exists because two classes of shortcut previously shipped bugs:
1. A test asserted on files that the release ZIP does not contain, so the
   in-app updater failed for every user even though `npm test` was green.
2. A data source (plan/套餐) had a single happy path (live network fetch) with
   no offline fallback, so a fresh install showed "未知套餐".

Both are now fixed. This document pins the behavior so a worker or validator
cannot quietly regress it.

---

## 0. Hard rules for worker AND validator

- No skipping gates. "Minimum CI Gate" (section 4) is the floor, not a target.
  Every listed command must be executed and must exit 0 on the current OS.
- No weakening tests to make them pass. If an assertion fails, fix the code,
  not the assertion. Removing or `if (false)`-ing an assertion is a spec
  violation unless this document is updated first with a written reason.
- No claiming a command passed without pasting its real exit path. The validator
  must re-run section 4 independently and confirm exit 0, not trust the worker.
- Reversibility: committing and pushing to a branch is allowed. Publishing the
  public GitHub Release (the only irreversible, all-user-facing step) requires
  explicit human confirmation.
- Scope: only the two bugs plus their regression gates and the version bump.
  Do not refactor unrelated code, rename symbols, or restyle the renderer.

---

## 1. Bug 1 — In-app update fails at "installing" with ENOENT

### Symptom (verbatim from the field)
`Error: ENOENT: no such file or directory, open
'...\CodexQuotaWeather\versions\<v>\.github\workflows\ci.yml'` thrown from
`scripts/smoke-test.js` during the update.

### Root cause
`scripts/package-release.js` excludes developer-only top-level trees from the
shipped ZIP (`excludedTopLevel` includes `.github` and `docs`).
`update-manager.js#verifyAndStage()` extracts the downloaded ZIP and runs
`scripts/smoke-test.js` against it to verify the build. The smoke test read
`.github/workflows/ci.yml`, `docs/images/usage-demo.gif`, and asserted the
README references the docs GIF — none of which exist in the ZIP. `npm test` in
CI never caught it because the installers copy the FULL source checkout (which
still has `.github`/`docs`), not the real release ZIP.

### Required behavior
- `scripts/smoke-test.js` MUST run to completion (exit 0) against an extracted
  release ZIP that contains no `.git`, `.github`, `docs`, or `release` trees.
- Developer-only assertions (CI workflow contents, docs demo GIF presence,
  README-references-GIF) MUST run only when a full source checkout is detected,
  gated on `fs.existsSync(<ROOT>/.github/workflows/ci.yml)`.
- The release ZIP MUST NOT start shipping `.github`/`docs` to "fix" this. The
  fix is guarding the test, not fattening the artifact.

### Acceptance points (all must hold)
- A1. `node scripts/smoke-test.js` exits 0 from a full checkout (dev assertions
      run).
- A2. `npm run test:release` exits 0. This script builds the real ZIP, extracts
      it to a scratch dir with NO `.git/.github/docs/release`, asserts those
      trees are absent from the artifact, and runs the packaged smoke test
      against it. This reproduces the exact updater path.
- A3. `scripts/release-smoke.js` fails loudly (non-zero) if the ZIP ever regains
      any of `.git`, `.github`, `docs`, `release`, so the guard cannot rot.
- A4. No release-shipped file path is read unconditionally by the smoke test
      unless that path is present in the ZIP produced by `package-release.js`.

### Regression guard wired into CI
`.github/workflows/ci.yml` runs `npm run test:release` on Windows x64, macOS
Apple Silicon, and macOS Intel. `smoke-test.js` asserts (source-checkout only)
that the CI workflow contains `test:release`, so removing the gate fails the
gate.

---

## 2. Bug 2 — New install shows "未知套餐" (plan/套餐 not detected)

### Symptom
Immediately after install, before any Codex conversation, the 套餐 card reads
"未知套餐" and the weekly ring has no data.

### Root cause
`server.js#aggregateToday()` derived `plan` only from:
1. the live `/wham/usage` snapshot (`liveCache`) — needs a working proxy + auth
   and often has not returned yet on first launch, or is blocked; or
2. the freshest session-file `rate_limits` — a brand-new user has no session
   carrying `rate_limits` yet.
With neither available, `plan` stayed `null` → renderer shows `plan_unknown`.

### Key insight (the fix)
The signed-in ChatGPT plan is carried offline inside `~/.codex/auth.json`'s
`id_token` JWT, claim `chatgpt_plan_type` (under
`https://api.openai.com/auth`). It is available the instant a user logs in,
with no network and no session history.

### Required behavior
- `liveUsage.js` MUST export `readAccountPlanType(codexHome?)` that:
  - reads `<codexHome>/auth.json`, base64url-decodes the `id_token` payload,
  - returns the lowercased plan string from
    `claims["https://api.openai.com/auth"].chatgpt_plan_type`
    (falling back to top-level `chatgpt_plan_type`, then `plan_type`),
  - returns `null` on any missing file, malformed JSON, or absent claim
    (never throws).
  - Signature verification is NOT performed and NOT required: the value is used
    only for display, never for an authorization decision.
- `server.js#aggregateToday()` MUST, as a LAST resort (after live and
  session-file sources), fill `plan.planType` from `readAccountPlanType()` when
  no plan or no `planType` was resolved. When it is the only source, emit
  `plan = { planType, primary:null, secondary:null, credits:null,
  snapshotAt:null, source:"account", stale:false }`.
- The last-resort path MUST NOT invent quota-window numbers. Ring data stays
  empty until a real live/session snapshot arrives; only the plan LABEL is
  surfaced.
- `readAccountPlanType` MUST accept an override home so it is unit-testable
  without touching the real `~/.codex`.

### Acceptance points (all must hold)
- B1. `readAccountPlanType` is a function exported from `liveUsage.js`.
- B2. With no `auth.json` in the given home, it returns `null`.
- B3. Given an `auth.json` whose `id_token` payload encodes
      `{"https://api.openai.com/auth":{"chatgpt_plan_type":"Pro"}}`, it returns
      `"pro"` (case-normalized).
- B4. `aggregateToday` with no live cache and no session `rate_limits`, but a
      valid `auth.json`, returns `plan.planType` equal to the account plan and
      `plan.source === "account"`, with `plan.primary === null`.
- B5. When a live or session snapshot IS present, its `planType` wins; the
      account fallback only fills a missing `planType`, never overrides a real
      one.
- B6. No secret (token, id_token, account_id) is ever logged or returned in the
      `/quota` payload. Only the derived plan string is exposed.

Note: B2 and B3 are enforced by `scripts/smoke-test.js` today. B4/B5 SHOULD be
added as explicit assertions if this area is touched again; a validator adding
them must use a temp `codexHome` and `opts.codexHome` on `aggregateToday`.

---

## 3. Versioning & release

- `package.json` and both top-level `version` fields in `package-lock.json` MUST
  read `3.0.1`. Do not blanket-replace `3.0.0`→`3.0.1` across the lockfile: the
  transitive deps `env-paths@3.0.0` and `sumchecker@3.0.1` share those digits
  and MUST keep their real versions (guard by checking the adjacent `resolved`
  URL / `integrity`).
- The GitHub Release for `v3.0.1` MUST attach, per platform,
  `codex-quota-weather-v3.0.1-<platform>-<arch>.zip` plus `SHA256SUMS.txt`
  (the updater verifies SHA-256 against the release asset digest or that file).
- Publishing the public Release requires explicit human confirmation.

---

## 4. Minimum CI Gate (the floor — every command must exit 0)

Run from repo root on each target OS. These mirror `.github/workflows/ci.yml`.

```
npm ci
npm test               # smoke-test.js (incl. Bug1 guard + Bug2 B1..B3) + update-test.js
npm run test:release   # NEW: packaged-ZIP smoke — the exact updater path (Bug 1)
npm run test:electron  # electron-smoke.js
npm run test:app       # app-smoke.js — full Electron boot
npm audit --audit-level=high
```

Platform-specific installer gates (already in CI, must stay green):
- Windows: `install.cmd` → health check on `http://127.0.0.1:8787/health` →
  `/quota` plugin deployed → `uninstall.cmd` leaves no residue.
- macOS (incl. a path WITH spaces): `install-macos.sh` → installed
  `scripts/smoke-test.js` exits 0 → `uninstall-macos.sh` leaves no residue.

Definition of done:
- All six commands above exit 0 on Windows x64, macOS Apple Silicon, macOS Intel.
- `npm run test:release` in particular MUST pass; a green `npm test` alone is
  NOT sufficient and is the precise gap that shipped Bug 1.
- The validator re-runs section 4 independently and confirms exit 0 before sign
  off. "The worker said it passed" is not acceptance.

---

## 5. Files touched by this change (for review scope)

- `scripts/smoke-test.js` — source-checkout guard for `.github`/`docs` reads;
  offline plan-type unit assertions (B1..B3); asserts CI runs `test:release`.
- `scripts/release-smoke.js` — NEW packaged-ZIP smoke gate (A2/A3).
- `liveUsage.js` — `decodeJwtPayload` + `readAccountPlanType`, exported.
- `server.js` — import `readAccountPlanType`; last-resort plan fallback in
  `aggregateToday`; `opts.codexHome` override for testability.
- `package.json` — `version` 3.0.1; `test:release` script.
- `package-lock.json` — top-level `version` 3.0.1 (only the two project entries).
- `.github/workflows/ci.yml` — `npm run test:release` on all platforms.
