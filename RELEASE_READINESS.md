# PaperGraph Release Readiness

## Release Candidate

- **Version:** 0.1.2
- **Date:** 2026-09-25
- **Platform:** Windows x64
- **Source of truth:** `package.json`, `package-lock.json`, and generated installer metadata

## Decision

# NOT READY FOR RELEASE

The application source, production build, packaged executable smoke test, runtime bundle, automated tests, and isolated NSIS lifecycle test passed. The release is not ready for public distribution because the generated installer and main application executable are not Authenticode-signed, and a real upgrade from the previous public version was not executed. First-run model download from an empty user profile was also not exercised in this validation run.

## Executive Summary

PaperGraph 0.1.2 is a Windows Electron application with a Next.js renderer/server, Supabase authentication and persistence, OpenAlex discovery, Tectonic LaTeX compilation, PDF import/rendering, a graph UI, and a managed Ollama/BGE-M3 embedding runtime.

The current candidate is technically buildable and the main automated coverage is healthy:

- Fresh `npm ci`: PASS after stopping stale PaperGraph development processes.
- `npm run lint`: PASS.
- All repository tests: PASS, 60 tests total.
- `npm run build`: PASS.
- `npm run desktop:build`: PASS; generated a 1.529 GB NSIS installer.
- Packaged executable smoke test: PASS twice, including normal shutdown and no repeated model download.
- Bundle verifier: PASS; runtime checksum, guardian, licenses and secret exclusion verified.
- Isolated NSIS install/reinstall/uninstall acceptance: PASS.
- `npm audit --audit-level=high`: PASS, 0 vulnerabilities.

The candidate still fails the public-release bar because release trust and upgrade evidence are incomplete.

## Release Blockers

### BLOCKER-001: Public application and installer are unsigned

- **Severity:** BLOCKER
- **Area:** Installer / distribution trust
- **Description:** `Get-AuthenticodeSignature` reported `NotSigned` for:
  - `desktop-dist/PaperGraph-Setup-0.1.2.exe`
  - `desktop-dist/win-unpacked/PaperGraph.exe`
- **Expected:** The public installer and application executable should be signed with the project's protected Authenticode certificate before distribution.
- **Actual:** Electron-builder logged signing attempts, but no valid signature is present on the application or installer. The bundled Ollama executable did report `Valid`.
- **Impact:** Windows SmartScreen/user trust, tamper detection and update authenticity are weakened. A compromised distribution path is materially harder to detect.
- **Fix:** Configure a protected signing certificate/provider in the release environment, fail the release if the installer or app signature is absent/invalid, and verify signatures on the final published files.
- **Status:** OPEN. No certificate was invented or added during this audit.

### BLOCKER-002: Upgrade from the previous public version not tested

- **Severity:** BLOCKER
- **Area:** Update / migration
- **Description:** The repository contains an existing 0.1.2 release artifact, but no controlled upgrade from a prior public installation to this candidate was executed. The generated local build does not produce `latest.yml` or a blockmap unless the publish/update flow is used.
- **Expected:** A previous version is installed, the new installer/update is applied, the app starts, user data remains accessible, and the managed model is preserved.
- **Actual:** Only the isolated installer-validation package was installed, reinstalled and uninstalled. This is not evidence of a real upgrade path.
- **Impact:** Release can still fail for existing users through updater metadata, resource replacement, data migration, or preserved model paths.
- **Fix:** Install the previous public version in an isolated Windows profile, publish candidate metadata to a staging update location, execute the update, and verify startup, workspace persistence, model preservation and rollback behavior.
- **Status:** OPEN / NOT TESTED.

### BLOCKER-003: Empty-profile first-run model setup not tested

- **Severity:** BLOCKER
- **Area:** First execution / BGE-M3
- **Description:** The packaged smoke test used a profile where the BGE-M3 model was already present. It verified the `starting-runtime -> checking-model -> ready` path twice and confirmed no repeated download, but did not verify a clean profile with no model and a real download.
- **Expected:** A new user without an Ollama installation or model sees progress, completes setup, can retry a failed download, and reaches a usable application state.
- **Actual:** The model-download path was not executed in this release pass.
- **Impact:** First-run is a required part of the product architecture and can still fail due to download size, permissions, disk space, network interruption, or model registry behavior.
- **Fix:** Run the packaged smoke test with a new isolated profile and record download progress, successful embedding, interrupted download recovery, offline failure/retry and disk-space/error messaging.
- **Status:** OPEN / NOT TESTED.

## Findings Summary

| ID | Severity | Area | Finding | Status |
|---|---|---|---|---|
| BLOCKER-001 | Blocker | Installer | Main app and installer are unsigned | Open |
| BLOCKER-002 | Blocker | Update | Real upgrade path not tested | Open / not tested |
| BLOCKER-003 | Blocker | First run | Empty-profile BGE-M3 download not tested | Open / not tested |
| MAJOR-001 | Major | Release artifacts | Local `desktop:build` does not create `latest.yml`/blockmap; publish flow remains unvalidated | Open |
| MAJOR-002 | Major | Dependencies | Clean install initially failed with `EPERM` because stale dev processes held `lightningcss`; succeeded after cleanup | Environment-specific warning |
| MINOR-001 | Minor | Test quality | Node test runs emit `MODULE_TYPELESS_PACKAGE_JSON` warnings | Open |
| MINOR-002 | Minor | Documentation | No changelog/release-notes draft was found for 0.1.2 | Open |
| POLISH-001 | Polish | Packaging | Installer is approximately 1.529 GB because it includes the bundled Ollama runtime | Documented |

## Functional Testing

| Area | Result | Evidence |
|---|---|---|
| Application startup | PASS (packaged smoke) | `test-packaged-runtime.cjs` launched `PaperGraph.exe` twice |
| Authentication | NOT TESTED live | Requires a controlled Supabase test account and packaged UI flow |
| Workspaces | PASS at persistence/RLS level; UI end-to-end NOT TESTED | 9 persistence tests passed |
| Paper CRUD | NOT TESTED packaged UI | Static/unit coverage exists but no full packaged CRUD run |
| LaTeX editor | NOT TESTED packaged UI | Build and route validation passed; interactive compile not executed here |
| PDF compilation/preview | NOT TESTED packaged UI | PDF import tests passed; live compile/preview not executed here |
| Graph | NOT TESTED packaged UI | Graph-related automated semantic tests passed |
| Persistence | PASS at RPC/client level | Conflict, rollback, isolation and revision tests passed |
| Embeddings | PASS contract/runtime | Semantic and runtime tests passed |
| Ollama lifecycle | PASS packaged smoke | Runtime reached ready twice and shut down normally |
| BGE-M3 first download | NOT TESTED | Existing model was reused |
| Recommendations | PASS automated; live UI NOT TESTED | 20 recommendation tests passed |
| OpenAlex failure handling | PASS automated | Offline, malformed, retry and rate-limit tests passed |
| Updates | NOT TESTED | No previous-version upgrade run |
| Installer lifecycle | PASS isolated validation | Install, reinstall, model preservation and uninstall passed |
| Uninstaller data policy | PASS isolated validation | Runtime removed; model and original installation preserved |
| Offline full app | NOT TESTED | No complete offline packaged session was run |

## First Run

- Packaged runtime startup with an existing model: PASS.
- New profile with no model: NOT TESTED.
- No global Ollama installation interference: code path is designed to use the bundled runtime, but a clean-machine test was not performed.
- Runtime missing/corrupt: automated lifecycle coverage exists; packaged user-facing path not tested.
- Interrupted download and retry: unit/runtime behavior is covered by tests, real packaged download interruption is not tested.

## Upgrade Testing

- Previous public version installed: NOT TESTED.
- Update metadata generation and hosted update: NOT TESTED.
- Update preserving user data: NOT TESTED.
- Update preserving BGE-M3 model: isolated reinstall preservation PASS, real version upgrade NOT TESTED.
- Downgrade/rollback: NOT TESTED.

## Installer / Uninstaller

- Production NSIS build: PASS.
- Validation NSIS build: PASS.
- Validation clean install: PASS.
- Validation reinstall: PASS; model hash unchanged.
- Validation uninstall: PASS; runtime removed and existing installation registration preserved.
- Per-user configuration: confirmed in effective builder output (`perMachine=false`).
- Production installer signature: FAIL; `NotSigned`.
- Production installer on a clean external machine: NOT TESTED.
- Install path with spaces: static paths are quoted/validated; full production installer test not performed.

## LaTeX / PDF

- Tectonic executable is packaged and unpacked: PASS via bundle verifier.
- Compile source/asset limits and path safety: present in source and covered by lint/build.
- Valid interactive compile and PDF preview: NOT TESTED in this release pass.
- Syntax-error recovery: NOT TESTED interactively.
- Repeated compile cleanup: source uses temporary directories and cleanup; runtime evidence not captured.
- PDF import queue: PASS, 3 tests.
- Corrupt PDF UI handling: NOT TESTED.
- Scanned PDF OCR limitation is documented in README and is not implemented.

## Research Graph

- Persistence and workspace isolation: PASS through 9 database/client tests.
- Semantic graph calculations: PASS through semantic tests.
- Empty/large graph rendering: NOT TESTED in packaged UI.
- Drag/move/select/delete/relationship interactions: NOT TESTED in packaged UI.
- Position persistence after UI restart: not verified in this run.

## Ollama / Embeddings

- Bundled runtime checksum: PASS.
- Runtime guardian included: PASS.
- Runtime listener/bridge ownership: PASS through runtime tests and packaged smoke.
- Loopback binding: PASS by configuration/static verification.
- Existing model reuse: PASS; second packaged run reported `downloaded: false`.
- First model download: NOT TESTED.
- Offline/retry/disk-full packaged UX: NOT TESTED.
- Model preservation across validation reinstall/uninstall: PASS.

## Network / External Services

- OpenAlex bounded retries/rate limits/malformed responses: PASS automated.
- Recommendations do not send private notes/full PDFs: PASS automated.
- Supabase live auth/sync: NOT TESTED in this release pass.
- Offline complete app behavior: NOT TESTED.
- Timeout/retry code paths: covered for OpenAlex/runtime contracts, not all packaged UI flows.

## Authentication / Sync

- Database RLS, conflicts and ownership protections: PASS automated.
- Packaged login/logout/session persistence: NOT TESTED.
- Realtime collaboration lifecycle: NOT TESTED.
- Session expiry and refresh: NOT TESTED.
- Account deletion UI flow: NOT TESTED.

## Performance

- Build and packaged startup completed successfully.
- Runtime readiness completed twice within the smoke-test timeout.
- 100/500-node graph performance: NOT TESTED.
- Memory/CPU idle measurements: NOT TESTED.
- Large PDF/LaTeX/resource exhaustion behavior: NOT TESTED.
- Installer size warning: the generated installer is approximately 1.529 GB.

## Build / Packaging

- Version consistency: PASS; `package.json`, lockfile and generated installer are 0.1.2.
- Clean dependency install: PASS after stopping stale PaperGraph dev processes; initial attempt failed with Windows `EPERM` on a locked native file.
- Production build: PASS.
- Lint: PASS.
- Automated tests: PASS, 60/60.
- Dependency audit: PASS, 0 vulnerabilities.
- Desktop NSIS build: PASS.
- Bundle verifier: PASS (`runtimeChecksum`, guardian, licenses and no private build secrets).
- Authenticode: FAIL for app and installer; Ollama binary valid.
- GitHub Actions CI/release workflow: NOT FOUND.
- Published `latest.yml`/blockmap flow: NOT TESTED; local `desktop:build` removes old generated metadata and does not recreate it.

## Known Issues

1. The public app and installer require Authenticode signing before distribution.
2. The real upgrade flow from the previous public version has not been validated.
3. First-run BGE-M3 download from an empty profile has not been validated.
4. The package is approximately 1.529 GB, which may make download and first installation burdensome.
5. Automated Node tests emit `MODULE_TYPELESS_PACKAGE_JSON` warnings.
6. Full packaged UI testing of authentication, workspace/paper CRUD, LaTeX/PDF interaction, graph manipulation and collaboration remains outstanding.
7. No GitHub Actions workflow was found, so CI/release permissions, artifact publication and update metadata generation are manual/unverified.

## Release Notes Draft

### Added

- Managed Ollama runtime packaging and lifecycle validation for Windows x64.
- Local semantic search and recommendation support using BGE-M3 when the model is available.

### Changed

- Workspace persistence uses atomic snapshots and revision checks.
- The installer is per-user and preserves application data on uninstall.

### Fixed

- Runtime bundle integrity, model reuse and installer lifecycle checks are covered by acceptance scripts.

### Known Issues

- Public distribution still requires valid Authenticode signing and a staged upgrade test.
- First-run BGE-M3 download has not yet been validated for this release candidate.

## Fixes Applied During This Review

No source changes were required by this release-readiness pass. Existing security edits and pre-existing working-tree changes were preserved. The main output is this evidence report and the newly generated local build artifacts.

## Final Verification

| Check | Result |
|---|---|
| `npm ci` | PASS after stale process cleanup |
| `npm run lint` | PASS |
| `npm run test:semantic` | PASS, 22 tests |
| `npm run test:recommendations` | PASS, 20 tests |
| `npm run test:persistence` | PASS, 9 tests |
| `npm run test:pdf-import` | PASS, 3 tests |
| `npm run test:runtime` | PASS, 6 tests |
| `npm audit --audit-level=high` | PASS, 0 vulnerabilities |
| `npm run build` | PASS |
| `npm run desktop:build` | PASS |
| `node scripts/verify-desktop-bundle.cjs` | PASS, 1,285 files checked |
| `node scripts/test-packaged-runtime.cjs desktop-dist/win-unpacked/PaperGraph.exe` | PASS twice; ready and normal shutdown |
| Validation NSIS installer build | PASS |
| `scripts/test-nsis-install.ps1` | PASS: install/reinstall/uninstall |
| Authenticode app/installer | FAIL: `NotSigned` |
| Real public-version upgrade | NOT TESTED |
| Empty-profile BGE-M3 first run | NOT TESTED |

## Release Checklist

- [x] Version correct (`0.1.2`)
- [x] Clean dependency install completed after process cleanup
- [x] Production build passed
- [x] Lint passed
- [x] Automated tests passed
- [x] Dependency audit passed
- [x] Installer generated
- [x] Packaged app launched twice
- [x] Runtime reached ready state
- [x] Normal shutdown verified
- [x] Bundle integrity and secret exclusion verified
- [x] Validation install tested
- [x] Validation reinstall tested
- [x] Validation uninstall tested
- [ ] Authenticode signing verified for installer and app
- [ ] Clean install of the production installer on a separate profile
- [ ] Upgrade from previous public version
- [ ] Authentication flow in packaged app
- [ ] Workspace/paper UI flows in packaged app
- [ ] LaTeX compile/PDF preview in packaged app
- [ ] Graph interactions and position persistence in packaged app
- [ ] BGE-M3 first-run download
- [ ] Offline packaged behavior
- [ ] Published update metadata and update flow
- [ ] No release blockers

## Recommended Next Action

Do not publish 0.1.2 yet. First configure and verify Authenticode signing, then perform a staged upgrade from the previous public installer and a clean first-run test with no BGE-M3 model. Repeat the packaged smoke, installer lifecycle, and data-preservation checks after those changes. Do not create a tag or publish an update from this workspace as part of this review.
