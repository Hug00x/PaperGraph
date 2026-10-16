# Maintaining the in-app Help Center

The Help content targets source version 0.1.10. `src/lib/help/content.ts` is the bilingual feature/workflow inventory: each guide has a stable ID, category, search keywords, ordered instructions, requirements, limitations, related IDs and implementation source references. Source references are for maintainers and are not displayed to users. Update both languages together and verify changes against implementation rather than copying release documentation.

The registry contains 35 guides across 10 categories. Validation of this rework: all 139 Node tests passed (including five new Help tests); production build and TypeScript passed; lint passed; the subsequent code cleanup removed the unused import in `scripts/test-local-chat-browser.mjs`. The Help browser acceptance passed against the production components in an isolated source copy, including contextual graph navigation, unsaved Group notes, English/Portuguese, dark/light rendering, 390/760/1440 px widths and loaded Help with network disabled. Screenshots were inspected locally. This is component/browser acceptance, not an authenticated end-to-end desktop acceptance run.

| Category | Coverage |
| --- | --- |
| Getting started | Account → workspace → PDF/draft → map → links → Groups |
| Workspaces & collaboration | Create/open/switch, rename/delete, invitations/expiry/revoke/decline, ownership transfer, Editor/Viewer, presence, remote cursors, live graph previews, reconnect and save conflicts |
| Papers & PDFs | Draft/Review/Published, editable versus view-only papers, title/abstract/keywords, bibliographic enrichment, sequential multi-import, duplicate identity, 50 MiB limit, metadata/OCR limitations, viewer/zoom/export, highlight colors/navigation/recolor/delete/persistence, permanent article deletion |
| Research graph | Library search/focus, pan/zoom, paper movement and persistence, modifier multi-selection, context actions, Manual/Wikilink/Citation/Semantic types, direction versus visual representation, removal, bundles/fan-out, persisted type filters, unlinked mentions |
| Groups & notes | Draw/name/color, spatial membership, overlaps/blended colors, move/resize, delete preserving papers, explicit note save/discard, role and sync behavior |
| LaTeX | Source syntax/basic editor tools, autosave versus submission, compilation/preview, image/PDF asset upload and insertion, history/diff/restore, bibliography versus Wikilinks, compiler failures |
| Discovery & AI | OpenAlex enrichment/recommendations/add/duplicates/fallback ranking, startup BGE-M3 preparation and retry, local conversations/PDF coverage, Anara connect/disconnect/reconnect, Deep Research contexts/presets/questions/sources/add/notes/follow-ups/limits/privacy |
| Settings & account | Sign-up/email confirmation/saved session, display name/profile photo/remove/sign-out, deletion consequences, English/Portuguese and dark/light preferences, packaged startup updater/download/taskbar/install-on-quit, network requirements |
| Troubleshooting | Account/invites, save conflicts and recovery download, PDF import/render/highlights, compile/submission, semantic/conversation model, OpenAlex/Anara failures and usage limits |
| Keyboard & gestures | App handlers and selected verified CodeMirror basicSetup bindings, with focus context; Help search keyboard controls |

## Content corrections versus the previous Help

- Semantic preparation begins at desktop startup; the prior Help implied first feature use.
- Groups, overlapping membership, explicit Group-note saves, PDF highlights, profile photos, updater details, Anara and Local/Deep Research were absent.
- No password-recovery UI, article/workspace trash, manual update button, command palette, OCR or annotated-PDF export was found; none is advertised.
- README/release readiness contain historical acceptance evidence, not proof of current live-provider or packaged behavior. Release readiness points to `docs/releases/0.1.10.md`, which was absent in this checkout. This rework does not close the existing overlapping-Group, signing, installed-upgrade or provider-acceptance gates.

## Integration and validation

`HelpSection` takes a controlled location retained in the app shell, with local back history while mounted. Reopening retains the last guide/category for the current app session; it does not track reading progress or searches. Entry points use stable guide IDs in the app header and Settings. The header Help icon opens the graph-navigation guide; Settings links open their section-specific guides. The browser fixture uses the shared Help button and separately verifies the Group-notes close guard. Return uses the existing tab navigation. "Show me where" navigates only; it never imports, deletes, authorizes, compiles or sends research. Editor tab changes continue to use the existing pending-resubmission gate.

Search pre-indexes packaged text, FAQ and shortcuts locally, normalizes accents/case, expands a small synonym dictionary and ranks title/keywords/summary/content. There are no search requests, analytics, HTML injection, new dependencies, IPC methods or backend changes. Support anchors reuse Electron's existing external-URL checks.

Run `npm run test:help`, `npm run lint`, and `npm run build`. For browser validation, run a local Next development server and `npm run test:help:browser`; `HELP_TEST_URL` defaults to `http://127.0.0.1:3015`. The script installs/removes a temporary fixture route and saves screenshots under ignored `.utmp/help-*.png`. `HELP_TEST_APP_ROOT` can target an isolated app copy using the same source when an existing development server is unavailable. The browser fixture renders the production Help and Graph components with local data; it does not authenticate against or mutate production workspaces. Network-off tests cover already-loaded Help rather than a cold offline application launch. Real Anara consent/research, cloud synchronization, installer upgrades and desktop updater delivery require separate acceptance testing.
