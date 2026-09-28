// Compare only editable fields. Database timestamps and generated relation IDs
// change on snapshot writes and must never manufacture an editing conflict.
type Row = Record<string, unknown>;
export type CloudSnapshot = Record<string, unknown>;
const fields: Record<string, string[]> = {
  articles: ['id', 'title', 'author', 'status', 'source', 'abstract', 'tags'],
  article_versions: ['id', 'article_id', 'title', 'author', 'status', 'source', 'tags', 'submitted_by', 'submitted_by_name'],
  relations: ['from_article_id', 'to_article_id', 'relation_type', 'note'],
  article_positions: ['article_id', 'x', 'y'],
  assets: ['id', 'article_id', 'storage_path', 'original_name', 'mime_type', 'size_bytes'],
  ignored_unlinked_mentions: ['mention_key', 'source_article_id', 'target_article_id'],
  zones: ['id', 'name', 'color', 'notes', 'x', 'y', 'width', 'height'],
};
function key(table: string, row: Row): string {
  if (table === 'relations') return JSON.stringify([row.from_article_id, row.to_article_id, row.relation_type]);
  return String(row[table === 'article_positions' ? 'article_id' : table === 'ignored_unlinked_mentions' ? 'mention_key' : 'id']);
}
function value(field: string, row: Row) {
  const v = row[field];
  if (['x', 'y', 'width', 'height', 'size_bytes'].includes(field)) return Number(v ?? 0);
  if (field === 'tags') return v ?? [];
  return v ?? '';
}
function equal(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function same(table: string, a: Row | undefined, b: Row | undefined): boolean {
  if (!a || !b) return a === b;
  return fields[table].every((field) => equal(value(field, a), value(field, b)));
}
function rows(snapshot: CloudSnapshot, table: string): Row[] { return (snapshot[table] ?? []) as Row[]; }
function index(snapshot: CloudSnapshot, table: string) {
  const result = new Map<string, Row>();
  for (const row of rows(snapshot, table)) {
    const id = key(table, row);
    if (result.has(id)) throw new Error('workspace-save-conflict');
    result.set(id, row);
  }
  return result;
}

export function mergeWorkspace(base: CloudSnapshot, local: CloudSnapshot, remote: CloudSnapshot, articlesOnly = false): CloudSnapshot {
  const merged: CloudSnapshot = { ...remote };
  for (const table of Object.keys(fields)) {
    if (articlesOnly && table !== 'articles') continue;
    const before = index(base, table), ours = index(local, table), theirs = index(remote, table);
    // Partial article saves are upserts, never implicit deletions.
    if (articlesOnly) for (const [id, row] of before) if (!ours.has(id)) ours.set(id, row);
    const result: Row[] = [];
    for (const id of new Set([...theirs.keys(), ...ours.keys(), ...before.keys()])) {
      const b = before.get(id), l = ours.get(id), r = theirs.get(id);
      if (same(table, l, b)) { if (r) result.push(r); continue; }
      if (same(table, r, b) || same(table, l, r)) { if (l) result.push(l); continue; }
      if (!b || !l || !r) throw new Error('workspace-save-conflict');
      const row = { ...r };
      for (const field of fields[table]) {
        if (equal(value(field, l), value(field, b))) continue;
        if (!equal(value(field, r), value(field, b)) && !equal(value(field, r), value(field, l))) throw new Error('workspace-save-conflict');
        row[field] = l[field];
      }
      result.push(row);
    }
    merged[table] = result;
  }
  // Refuse a merge that would discard a collaborator's new dependent element
  // through a cascade, or resurrect a deleted article through an upsert.
  const articles = new Set(rows(merged, 'articles').map((row) => String(row.id)));
  for (const table of ['article_versions', 'relations', 'article_positions', 'assets', 'ignored_unlinked_mentions']) {
    for (const row of rows(merged, table)) {
      for (const field of ['article_id', 'from_article_id', 'to_article_id', 'source_article_id', 'target_article_id']) {
        if (row[field] && !articles.has(String(row[field]))) throw new Error('workspace-save-conflict');
      }
    }
  }
  if ('language' in local) {
    if (!('language' in base) || !('language' in remote)) merged.language = local.language;
    else if (!equal(local.language, base.language)) {
      if (!equal(remote.language, base.language) && !equal(remote.language, local.language)) throw new Error('workspace-save-conflict');
      merged.language = local.language;
    }
  }
  return merged;
}

export function advanceLocalBaseline(base: CloudSnapshot, local: CloudSnapshot, articlesOnly: boolean): CloudSnapshot {
  if (!articlesOnly) return structuredClone(local);
  const articles = index(base, 'articles');
  for (const row of rows(local, 'articles')) articles.set(key('articles', row), row);
  return structuredClone({ ...base, articles: [...articles.values()] });
}
