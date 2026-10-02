# PaperGraph Release Readiness

## Release Candidate

- **Version:** 0.1.9
- **Review date:** 2026-10-02 (Europe/Lisbon)
- **Platform:** Windows x64, NSIS desktop application
- **Reviewed source:** `b93ecad` plus this documentation-only working-tree change
- **Version sources:** package manifest, lockfile root/package entry, standalone manifest, packaged `app.asar/package.json`, Windows executable ProductVersion `0.1.9.0`, installer name, and `latest.yml` all agree.
- **Actual tools:** Node 22.21.0; Next.js 16.3.6; Electron installed/packaged by this run 43.7.7; electron-builder 26.15.3. Semver ranges in package.json are not installed runtime versions.

Version-reference classification: current manifests, app/installer/update metadata and these three documents are **CURRENT**. Older Git release tags, archived `.next-stale-*` output and preserved `.utmp` artifacts are **HISTORICAL**, not candidate evidence. Mixed older-version/current-readiness statements in the previous report were **STALE / INCORRECT** and were removed. Dependency versions matching the same number pattern are not PaperGraph releases. No global version substitution was used.

## Decision

**NOT READY FOR RELEASE**

Three release gates remain open. The source builds, all 97 Node tests pass, and fresh desktop packaging/bundle checks succeed. Browser acceptance reproduces an overlapping-Group interaction failure. The installer/app are unsigned, and installed upgrade/update plus clean model-first-run acceptance have not been performed. Buildability and mocked tests do not close those release gates.

## Findings Summary and Release Blockers

| ID | Classification | Current evidence / required resolution |
| --- | --- | --- |
| B1 | BLOCKER: release integrity | Fresh installer and PaperGraph.exe are `NotSigned`. Define signing/release trust and validate signed artifacts before public distribution. This is a distribution risk, not a demonstrated source-code exploit. |
| B2 | BLOCKER: acceptance evidence | No clean installed lifecycle, previous-release upgrade/update, data/model preservation across upgrade/uninstall, or genuinely empty-model first run was executed. Validate these on an isolated Windows installation/staging feed. |
| B3 | BLOCKER: graph acceptance | Groups browser suite fails twice at `scripts/test-zones-browser.mjs:139`: the front Group header fails the pointer hit-test after opening/closing another overlapping Group's notes. Fix/retest before treating Group interaction acceptance as complete. |
| M1 | Major, deployment-scoped | Workspace/assets/compile HTTP routes lack complete authentication. Electron binds loopback; public Next.js deployment remains unsupported without a boundary. See security H1. |
| M2 | Major validation gap | Deployed Auth, workspace administration, RLS/Realtime integration, account cleanup, and live OpenAlex were not exercised. Local SQL/mock coverage is not production acceptance. |
| M3 | Major external-data risk | Publication-PDF route accepts private/loopback HTTP(S) destinations and lacks a body-size cap. A controlled local fixture reproduced retrieval with mocked authenticated workspace/OpenAlex fallback; see security M4. |
| N1 | Minor/operational | Root project LICENSE and environment example are absent. Project licensing needs a decision. |
| N2 | Minor/maintenance | Node tests emit MODULE_TYPELESS_PACKAGE_JSON warnings; mock graph-live browser logs also show hydration mismatch/recovery messages despite passing interaction assertions. No clean-console claim is made. |
| N3 | Minor/test harness | Existing packaged smoke requires the status card on every launch, although the UI intentionally hides it after preparation. The original suite fails on the second launch; a temporary adjusted harness checks the implemented dismissal behavior. |

Counts: **3 release blockers, 3 major findings/gaps, 3 minor/operational findings**. Validation gaps are not claims that the underlying feature necessarily fails.

## Fresh Validation Results

| Check | Result | Scope / evidence |
| --- | --- | --- |
| Version consistency | PASS | Source and fresh artifact metadata agree on 0.1.9 |
| Clean dependency install (`npm ci`) | NOT TESTED | Existing node_modules used; do not inherit the old clean-install result |
| `npm.cmd run lint` | PASS | ESLint exit 0 |
| All Node suites | PASS | 97 tests, 0 failed/skipped/cancelled; includes multi-relation layout, Groups, live graph, PDF import/highlights, avatar SQL policies, persistence, recommendations, semantics, runtime |
| `npm.cmd run build` | PASS | Fresh production build and TypeScript checks |
| `npm.cmd audit --json --cache .utmp/npm-cache` | PASS | Fresh registry response: 0 Critical/High/Moderate/Low; 715 total dependency entries |
| Full desktop command | WARNING | Build/runtime prepare succeeded; initial packaging could not download Electron within restricted network; explicit no-publish packaging retry passed |
| Desktop packaging retry | PASS | `npm.cmd exec -- electron-builder --win nsis --publish never`; fresh NSIS installer/blockmap/update metadata, no publication |
| Fresh bundle verifier | PASS | Pinned runtime/executable checksum, guardian, notices, no bundled model, no known local private-key values; 1,286 scanned files |
| Installer SHA-512 vs latest.yml | PASS | Fresh file size and base64 digest match metadata |
| Authenticode | FAIL | Installer and application `NotSigned` |
| Groups browser | FAIL | Reproduced twice, including a standalone rerun; earlier creation/movement/notes/resize/delete checks passed |
| Graph-live browser | PASS | Two-page mock collaboration, drag/cancel, Group creation/movement/resize, viewer presence, reconnect |
| PDF-highlights browser | PASS | Selection, colors, persistence/reload, zoom/resize/rotation, cross-page selections, read-only controls, failed-save recovery, replacement identity |
| Profile-avatar browser | PASS | Initials, upload, 256px WebP, validation, reopen, failed save, removal; mock storage |
| Updater mocked-event check | PASS | Temporary harness executes current main-process updater: timer, confirmation, progress mapping/clamp, completion, error/reset, destroyed-window guard, install command |
| Publication-PDF private-address probe | FAIL security boundary | Current route fetched/returned a harmless loopback PDF; Auth/database/OpenAlex mocked, actual loopback HTTP request; no cloud writes |
| Real update detection/download/install | NOT TESTED | No controlled earlier-release feed; mocked install command does not install an update |
| Original packaged smoke script | FAIL | Restricted attempt timed out; permitted run reached ready and first normal shutdown, then failed the second-launch status-card assertion |
| Adjusted packaged smoke | PASS | See packaged section; isolated existing-model profile, two launches, readiness, HTTP checks and normal shutdown |

PowerShell initially blocked `npm.ps1`; commands were rerun using npm.cmd without changing execution policy. Initial production build hit `EPERM` on a read-only OneDrive reparse point in prior output. The old `.next` tree was preserved under `.utmp/review-prior-next`, then a clean-output build passed. Previous desktop output was preserved under `.utmp/review-prior-desktop`. These are environment/output obstacles, not inherited application failures.

## Build / Packaging / Installer

The freshly generated artifact is **`desktop-dist/PaperGraph-Setup-0.1.9.exe`**, **1,533,743,856 bytes** (1.534 GB decimal; approximately 1.428 GiB). Its blockmap is **1,596,143 bytes**. `latest.yml` records 0.1.9 and the matching size/SHA-512. The installer present before review was 1,529,188,365 bytes; that is historical artifact evidence, not this run's size.

The fresh bundle contains Next.js standalone/public/static files, Tectonic, pinned Ollama 0.34.3, the guardian, and runtime notices. BGE-M3 weights are not bundled. The verifier scans known private credential values from local configuration and selected textual/asar files; it is not an exhaustive secret or provenance audit.

NSIS configuration is assisted, Windows x64, default per-user, editable install directory, desktop/Start Menu shortcuts, `papergraph://`, and `deleteAppDataOnUninstall: false`. These are **STATICALLY VERIFIED**. Clean install, reinstall, registration, shortcuts, actual uninstaller behavior, and persistence across uninstall are **NOT TESTED**. The existing NSIS test expects a separately built validation identity; running the production installer was not substituted for that fixture.

Electron-builder logs mention signtool steps; direct Windows signature checks still report `NotSigned`. Logs are not signing proof.

## Packaged Executable and First Run

The freshly packaged executable reached `starting-runtime`, `checking-model`, and `ready` using the existing isolated profile at `.utmp/packaged-profile`. Ollama validated a real 1,024-dimensional embedding. The original script's first launch shut down normally, but its second launch expected a status card that current UI hides when localStorage already records preparation.

A temporary copy, `.utmp/review-packaged-runtime.cjs`, accepts either the visible card or the preparation flag plus rendered page content. It retains both launches, runtime readiness, HTTP 200, unauthenticated academic-route 401, normal shutdown, and no second model download assertions. This is existing-model packaged smoke, **not a clean first run**. No tracked test/product code was changed.

**NOT TESTED:** empty model/profile setup, real download progress/interruption/offline retry, disk/permission failures, owner-crash cleanup, coexistence with a running user Ollama. Runtime Node mocks verify failure/retry/port/ownership logic, but do not replace these real lifecycle tests.

## Functional Coverage

| Area | Current implementation and tested boundary |
| --- | --- |
| Authentication / workspaces | Email/password, sessions, invitations, owner/editor/viewer, ownership transfer and deletion exist. PGlite validates snapshot rollback/revision/authorization and avatar/highlight policies; deployed Auth/admin workflows NOT TESTED. |
| LaTeX / PDFs | Autosave/history, Yjs editor, Tectonic preview, sequential multi-import, first-three-page text extraction, viewer/highlights exist. Node/mock browser suites pass; fresh packaged Tectonic compile, real cloud asset flow, collaborative editor and paper CRUD acceptance NOT TESTED. |
| Graph | Four relation types, remembered filters, compact multi-edge/fan-out are implemented. Six layout cases cover collapse, stable ordering, opposite directions, selected endpoints, filtering. Inline path labels and citation arrowheads are absent. Real UI multi-edge drag/zoom/selection acceptance NOT TESTED. |
| Groups | Spatial membership, overlap/blended color, notes, movement with papers, resize and deletion exist. Node/SQL checks pass; browser progresses through normal operations then fails overlap hit-testing. Later 153-node density and read-only checks in that suite were NOT TESTED. |
| Collaboration | Mock two-page graph suite passes previews, durable commit, cancel and reconnect. Hosted Supabase Realtime and real multi-account editing NOT TESTED. |
| Avatars | 5 MiB JPG/PNG/WebP input, center-crop/256px WebP, private peer-readable bucket, owner writes/removal, member RPC and account cleanup. Local policy/browser checks pass; deployed cleanup/storage NOT TESTED. |
| Highlights | Separate document-keyed table, member reads/editor mutation, five colors, column-limited recolor, cascade cleanup. SQL/browser checks pass; hosted deployment NOT TESTED. |

## Ollama / Embeddings / Discovery

**STATICALLY VERIFIED:** bundled Ollama 0.34.3, official archive/checksum pin, loopback preferred port 11435 with fallback, private `%LOCALAPPDATA%\PaperGraph\ollama\models`, no PATH/global runtime adoption, cloud disabled, token bridge, owned process guardian/shutdown, missing-model pull at window startup and retry UI. App-update/uninstall model preservation is configured, not lifecycle-tested.

BGE-M3 inference embeds title + two newlines + abstract, validates 1,024 finite non-zero dimensions, stores pgvector vectors/model/hash in articles, invalidates on metadata edits, and uses bounded caches. Semantic links require raw cosine >=0.50 by default with up to three neighbors per paper. Local mocked regression and packaged existing-model readiness pass; live pgvector deployment NOT TESTED.

OpenAlex DOI/ID enrichment and semantic discovery request up to 30 candidates, deduplicate seed/workspace papers, rerank locally in batches of four, and display up to 10. Missing local inference retains provider order. Adding saves published metadata and a graph node. Client throttling/retry/access failures are unit-tested; live OpenAlex, recommendation add flow, and available remote PDF retrieval NOT TESTED.

## Updates and External Services

Current updater: packaged-only GitHub provider, one startup check after 4,500 ms, confirmation before download, real percentage/100 clamped to taskbar progress, completion/error resets, restart/install prompt, install-on-quit enabled. There is no renderer updater bridge, numeric progress panel, byte counter, periodic scheduler, or manual button. Repeated available/downloaded events have no explicit prompt-deduplication guard; behavior on repeated events/closing during download remains NOT TESTED.

The real previous-release → 0.1.9 detection, download, taskbar progress, install/restart, model/runtime replacement and data-preservation path is **NOT TESTED**. No releases/tags/uploads/production update were created.

Cloud storage/auth/Realtime, OpenAlex queries, model downloads, GitHub updates and potentially uncached Tectonic resources require network access. Local inference does not imply fully offline operation. Controlled provider/network error behavior has unit/mock coverage; real service outages and offline packaged workflows were not tested.

README GitHub links match publisher configuration; browser fetch failed and direct HTTP checks returned 504 for both releases/issues, so public reachability is **NOT VERIFIED**. The local logo exists. No `.github/workflows` is present; remote branch/tag protections were not inspected.

## Performance

No CPU/memory/startup/FPS benchmark was measured. Group previews use batched updates and persistence occurs on commit; this is static evidence, not a performance PASS. The density test after the failed overlap assertion did not run.

## Previous Findings Re-evaluated

- Signing: still open, rechecked against fresh binaries.
- Upgrade, clean first-run and installer acceptance: NOT TESTED now; prior PASS statements removed.
- Missing update metadata/blockmap: obsolete; fresh artifacts contain both and metadata hashes match.
- Prior runtime/test/installer sizes: replaced with current command evidence.
- Private key presence: informational handling concern without demonstrated leakage; no automatic rotation/release blocker inherited.
- Old mixed release numbers/dates: removed from current-state claims.
- Root license/CI absence: still present; remote governance not inferred.

## Release Notes Draft — 0.1.9

Historical comparison baseline: the local **v0.1.8** tag. This comparison identifies source changes, not proof of what was deployed publicly.

- **Added:** profile photos, private workspace-peer avatar access/member RPC, avatar cleanup in account deletion, isolated avatar policy/browser coverage, built-in help, and notification/role controls.
- **Changed:** settings/workspace/account navigation and related app dialog/presentation helpers; Electron/undici dependencies updated. The current packaged Electron resolves to 43.7.7.
- **Fixed:** graph filter button stacking adjustment (`2553f25`); avatar storage listing support (`9457f7c`). The filter change does not close the separately reproduced Group-header overlap failure.
- **Retained capabilities:** colored document-keyed PDF highlights, overlapping Groups/notes/live previews, remembered relation filters, and multi-relation selection fan-out exist in this candidate, but are not all newly introduced by this tag diff.

Known issues: unsigned distribution; overlapping-Group header hit-test failure; publication-PDF private-address/size boundary; stale packaged smoke assertion; installed lifecycle/real update and clean model-first-run acceptance missing. No public release was made.

## Final Verification and Release Checklist

Cross-document consistency: **PASS** for current version/date/platform, runtime/model/dimensions, discovery counts, graph/Group/PDF/avatar behavior, signing, updater progress, test evidence and release gates. Final post-edit lint/build/Node-suite/audit reruns passed. Only the three requested Markdown files are tracked changes.

- [x] Source/artifact version 0.1.9 confirmed.
- [x] Fresh lint, 97 Node tests, production build and dependency audit pass.
- [x] Fresh desktop packaging, bundle validation, metadata size/hash checks.
- [x] Avatar, highlights and mock live-graph browser suites pass.
- [x] Mock updater event/progress checks; adjusted existing-model packaged smoke.
- [ ] Groups browser acceptance passes fully; dense/read-only and multi-edge UI acceptance.
- [ ] Clean dependency install, clean installer/reinstall/uninstall and registration.
- [ ] Real earlier-release upgrade/update/progress/install/data/model preservation.
- [ ] Empty-model first run/download and offline/interruption recovery.
- [ ] Deployed authentication, workspace/paper administration, compiler, cloud policies and collaboration.
- [ ] Live OpenAlex/recommendation acceptance and performance evidence.
- [ ] Valid Authenticode and documented release protection.
- [ ] No outstanding release gates.

## Recommended Next Action

Resolve the reproducible Group overlap failure, address publication-PDF private-address/size handling, and refresh the smoke harness's status-card expectation, then run the missing isolated installed lifecycle/model-first-run and staged signed update acceptance. Verify hosted migrations/account cleanup and public links before deciding to release. Keep publishing disabled during validation.
