# Zones

Zones extend the existing HTML/SVG graph; there is no graph or animation dependency. Relation rendering and relation types are unchanged.

## Data and coordinates

`WorkspaceSnapshot.zones` stores `{ id, name, color, x, y, width, height }`. IDs are stable; names are trimmed and limited to 80 characters. Eight palette keys map to dark/light CSS colors. The graph uses 0–100 coordinates over a 3000px world, shared by Zones and article positions. Minimum size is 8×6 units (240×180 world pixels).

Membership is **derived from the article center and Zone geometry**, rather than persisting both membership and positions. A point belongs when `x >= left && x < right && y >= top && y < bottom`. Shared boundaries are unambiguous. For malformed legacy overlaps, the smallest Zone ID wins deterministically. Invalid colors, missing names, non-finite coordinates and invalid dimensions are rejected on load. The database also validates geometry, colors, duplicate IDs and overlaps.

## Interaction

The selection-based creation and free-area placement described below are historical. The current UI creates groups by drawing a rectangle, permits overlapping groups, and blends their colors. The obsolete placement helpers and their tests have been removed.

- Shift+click selects multiple articles. “Select papers” provides the same interaction without a keyboard, including touch. The active article is the default selection when no multiple selection exists.
- “Create zone” opens one name/color dialog. Bounds enclose the selection with padding. If it overlaps existing Zones, creation proposes the nearest available rectangle, explains the relocation and translates the selected articles together. Existing Zones are retained, including empty ones. If there is no room, creation reports this without changing anything. The viewport frames the new Zone.
- Article drag previews its destination color and highlights the candidate Zone. Drop commits positions once; membership then follows those positions. Leaving all Zones restores normal styling. Dropping in another Zone transfers membership.
- Dragging a Zone header moves its members from the gesture's starting snapshot by one shared delta. Nodes outside the Zone, even if selected, stay put. Existing edge rendering follows the normal node positions.
- Four corner handles appear on selection. Resize changes geometry, never article positions. Expansion includes newly enclosed centers; shrinking releases excluded centers.
- Move/resize may preview an overlap, but release reverts an invalid gesture. Pointer cancellation also reverts. Headers and handles support arrow keys; Shift uses a larger step. Controls are disabled for read-only workspaces.
- Double-click the title or use its action button to rename/change color/delete. Delete requires confirmation and preserves all papers and relations. Dialogs trap keyboard focus, support Escape and restore focus on close.
- Backgrounds remain transparent to pointer events. Nodes retain selection rings, status badges, presence and context menus. Edge colors remain relationship colors. Preview state updates are batched with requestAnimationFrame; no persistence calls occur during pointer movement.

## Persistence and deployment

Apply `supabase/migrations/202609270001_graph_zones.sql` **after the existing atomic-workspace migration and before deploying this client**. This task creates and tests the migration locally; it does not apply it to a remote Supabase project.

Zones are a validated JSONB column on `workspaces`, loaded/saved with the existing snapshot RPCs. Zone geometry and article positions commit in the same revision-checked transaction. Existing permissions, save queue, conflict recovery, local JSON mirror and error presentation are reused. Article-only writes preserve Zones. Old clients that omit Zones preserve the stored value; old workspaces start with `[]`.

The local workspace API normalizes Zones on read/write. Every snapshot builder preserves them, including imports, article edits and relation changes. Positions are no longer rounded on save or automatically redistributed on reopen: doing either could silently change membership. Only missing positions receive the existing fallback layout.

Cloud behavior matches existing graph snapshots: simultaneous stale edits report a conflict and require reload/recovery. Presence is live, but the existing application does not live-stream graph layout updates; this feature does not add a separate realtime or CRDT layer.

## Files and verification

- `src/lib/graph-zones.ts`: types, palette keys, validation, membership, drawn bounds and movement helpers.
- `src/components/graph-zone-layer.tsx`: Zone rendering, controls, dialogs and move/resize gestures.
- `src/components/graph-pane.tsx`, `src/app/globals.css`: selection, drag previews, node tinting and theme integration.
- `src/lib/workspace-data.ts`, `src/lib/supabase-workspace.ts`, `src/app/api/workspace/route.ts`, `src/app/page.tsx`: snapshot persistence and integration.
- `supabase/migrations/202609270001_graph_zones.sql`: validated storage and atomic RPC extension.
- `tests/graph-zones.test.mjs`: containment/boundaries, transfer/exit, drawn bounds, move/resize/delete, malformed data and serialization.
- `tests/workspace-persistence.test.mjs`: SQL rollback, old-client preservation, overlap/color rejection, permissions and client adapter round trip.
- `tests/fixtures/graph-zones-page.tsx`, `scripts/test-zones-browser.mjs`: real GraphPane browser fixture; no user workspace is accessed. The runner temporarily installs a test route and removes it afterwards.
- `package.json`: test commands. `eslint.config.mjs`: ignores generated `.next-stale-*` directories.

Run `npm run test:zones`, `npm run test:persistence`, `npm run lint` and `npm run build`. For browser tests, start `npm run dev`, then `npm run test:zones:browser`. The runner uses an installed Chrome/Chromium/Edge; override `BROWSER_PATH` and `GRAPH_TEST_URL` if needed. Screenshots and an isolated browser profile go into ignored `.utmp/`.

Browser coverage includes creation, in/out, transfer, group movement, resize, rename/color, deletion, serialized reopening, zoom/pan, read-only controls, no writes during preview, and drag with 153 nodes/152 edges. The fixture's reopen test uses localStorage; database round trips are independently exercised with PGlite. This is a functional density test, not a cross-device FPS benchmark.

## V1 limits

No rectangle selection, arbitrary multi-node drag, undo/redo, nested/overlapping Zones, clustering, filters or Zone search. The original graph had none of the first three mechanisms to reuse. Small-screen usability inherits the existing fixed-width library panel. Future improvements can add a shared selection rectangle and group drag, responsive graph panels, and graph-wide realtime snapshot notifications without changing the spatial membership model.
