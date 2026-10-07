# Contextual Deep Research

Deep Research is a temporary right-side drawer in the graph, opened from a paper's existing context menu, the multi-selection actions, or a selected Group's Research menu. Ctrl/Cmd/Shift-click adds/removes papers from selection. It is closed by default, 420px wide on desktop and an overlay on narrow windows. The graph remains available; the existing article inspector yields its space while research is open. There is no main-navigation destination, model/provider selector or persistent PaperGraph conversation history.

Actions: related research, newer research, evidence-supported contradictions, and potential research gaps (multiple papers/Groups). A free-form contextual question is supported. Presets only prepare a draft. Opening the drawer, choosing a preset, changing selection and connecting never start research. **Research** is the explicit external-data-sharing action. Draft/context are preserved across reconnect; active requests use frozen metadata. Closing hides the current session; reopening the same context restores it. Replacing a draft/result asks for confirmation. A running session must finish or stop before a different context can start.

## Official capability verification — 2026-10-03 (Europe/Lisbon)

The [official Anara MCP guide](https://docs.anara.com/guides/mcp) identifies `https://anara.com/api/mcp`, OAuth and the research-agent capability. Authenticated **live `tools/list`** was inspected using an isolated Electron profile with the existing encrypted storage configuration; credentials were never printed, and the temporary profile copy was removed. Actual schemas confirmed:

| Operation | Actual tool | Arguments used |
| --- | --- | --- |
| Start | `anara_spawn_agent` | `requestId` (required, 1–128 chars), `prompt` (required, 1–50,000 chars) |
| Status | `anara_check_agent` | `runId`; optional returned Anara `workspaceId` |
| Result | `anara_get_agent_result` | `runId`, `offset`, `limit: 16000`; optional returned workspace |
| Stop | `anara_cancel_agent` | `runId`; optional returned workspace |

The live tool description says start returns a durable `runId`, retries must reuse identical request ID/input, results are paged with `nextOffset`, and cancellation requires status confirmation. Optional `documentIds`, `modelName` and arbitrary Anara workspace selection are omitted. PaperGraph checks discovered schemas before use and never exposes tool names/arguments in preload.

The schemas expose **no outputSchema**. The adapter accepts MCP structuredContent or JSON in text content, root run/status fields, and completed answer text (`text`, string `answer`, or `answer.text`) with result offsets. Fixture tests cover these forms. A successful live response has **not** been captured; incompatible provider wrappers fail as invalid-response, rather than guessing or dumping diagnostics. Citations are accepted from the requested report's source array, returned source arrays or Markdown links in answer text. Structured paper cards depend on identifiable metadata returned in the preferred JSON report; prose-only responses still show a readable summary and extracted sources.

The connection starts with read-only scopes in Settings. Deep Research explicitly authorizes `anara:read anara:chat offline_access` through a separate fixed Connect action. `anara:write` is never requested. The chat scope is advertised by Anara's OAuth resource metadata and is selected for agent research; its exact live enforcement remains unverified. Supabase authentication remains independent. Anara may retain its durable research runs; PaperGraph stores no chat/history table.

## Data and limits

The dedicated shared contract builds a structured prompt from titles, validated DOI/OpenAlex identifiers, known publication years, available scientific authors and bounded abstracts. Group name is included for Group context. Local article IDs, full source, extracted PDF body, LaTeX, notes, positions, relations, embeddings, highlights and unrelated workspace metadata are excluded. The user question is included; follow-ups include at most 8,000 characters of the prior normalized summary from main-process memory.

Up to **12 explicitly checked papers**, 500-character titles, 3,000-character abstract excerpts, 2,000-character questions and a total 48,000-character prompt are permitted. Large Groups require reviewing/selecting a subset; unchecked papers are not silently sent. Metadata preview shows the actual bounded context. A request that still exceeds total bounds is rejected before MCP. Questions/metadata are data, never executable PaperGraph instructions.

Main caps MCP HTTP bodies at 1 MiB, accepts at most ten result pages, displays summaries up to 24,000 characters, 30 candidates and 60 sources. No token or raw MCP exception reaches the renderer. Normalized error categories include disconnected/expired, provider unavailable, rate/usage limits, malformed response, cancellation and unconfirmed stop. No reset times or progress percentages are invented.

The report is escaped React text; no raw HTML/HTML injection or Markdown execution is enabled. Candidate URLs accept only HTTP(S) without embedded credentials and reject local/IP destinations. Links use the existing Electron external-browser handling. Candidate identifiers, dates and text lengths are normalized before presentation and revalidated in the canonical-resolution route before import.

## Request lifecycle

`electron/anara-research.cjs` owns one active request and a bounded ephemeral cache. Retries reuse the original request ID and frozen prompt; known runs resume status/result retrieval without spawning another. There are no background research starts or automatic retries of expensive work. Follow-ups are capped at three per chain and use the same selection, not the current graph selection. The renderer checks generation and request identity before accepting results; a replaced session cannot receive an old result.

The SDK handles transport/auth. Periodic connection revalidation is deferred while research runs, avoiding replacement of its client. Polling is every two seconds; requests have 30-second call timeouts and a ten-minute overall tracking deadline. A deadline or closed drawer does not prove a remote run stopped. Stop calls the discovered cancellation tool and checks a terminal state; unconfirmed stop is reported honestly. Disconnect/shutdown attempt cancellation of a known run, then stop local tracking. When the start result/run ID is unknown, remote cancellation cannot be guaranteed. Provider failure guidance is not automatically interpreted as executable retry instructions.

## Returning papers to the graph

`/api/research-papers` authenticates the Supabase user, checks the existing `can_edit_workspace` permission and accessible context article, resolves the result through the existing OpenAlex client, then invokes `prepareRecommendedArticle`. Stable IDs are preferred. Title-only results require a **unique exact normalized title** (and known year when supplied); ambiguous/fuzzy results are rejected. See [official OpenAlex scoped search](https://help.openalex.org/api/searching/).

The route only prepares canonical metadata and checks duplicates. The existing `commitImportedArticle` pipeline performs placement, academic/semantic processing and workspace persistence. DOI/OpenAlex/title identity logic is shared with recommendations. No Anara relation type or new import database is introduced. A duplicate/added paper shows View in Graph, which uses existing selection and centering. A failed canonical lookup does not persist raw agent metadata. Existing recommendations and managed Ollama are unchanged.

Viewer users can research/copy/view existing papers, but cannot add or append notes. Add is guarded in the UI, page handler and server permission RPC; persistence retains existing Supabase enforcement. Group summary saving requires explicit preview and Append, preserves existing notes and refuses overflow. It uses the existing Group commit callback. Only explicit additions/notes become collaborative; drafts/questions/results are not broadcast or persisted to Supabase.

## Validation evidence

- PASS: 15 new contract/orchestration/context/resolution/permission/IPC tests; 9 connection tests; 20 existing recommendation tests.
- PASS: isolated real GraphPane/Chrome fixture covering paper/multiple/Group menus, default-closed drawer, no automatic sharing, draft preservation/reconnect, safe rendering/sources, add/duplicate/view actions, notes preview/append, Viewer restrictions, contextual follow-up, quota-style rate error/idempotent retry and 1440px/760px layouts. Import callbacks and MCP are mocked; this does not prove cloud persistence or live agent responses.
- PASS: lint, TypeScript/production build and Electron JS syntax checks. Scope is this change, not a new full security audit.
- PASS: authenticated live MCP schema discovery with existing encrypted credentials.
- **FAIL live controlled research start:** one harmless public-paper prompt was attempted; Anara returned `Invalid or expired token`. No run ID or research report was produced. Fresh research-scope OAuth consent, successful live results/citations, actual cancellation, real Anara usage limits and end-to-end cloud add are **NOT TESTED**. Mock success is not evidence of live success.
- No new dependency beyond the previously added official MCP SDK; no migrations, production database writes, release/tag/push/deployment or installer replacement. The paired download site is unchanged while live acceptance remains pending.

To test locally, restart the desktop app with `npm.cmd run desktop:dev`, open a graph context and Deep Research, reconnect to authorize research and explicitly start a harmless request. Use `npm run test:deep-research` for CI. `npm run test:deep-research:browser` requires an existing Next dev server; set `GRAPH_TEST_URL` to its base URL (default port 3015). The fixture route is created/removed by the script and never uses real workspace data. New packaged SDK/contract inclusion and deployed Supabase behavior remain separate acceptance requirements.
