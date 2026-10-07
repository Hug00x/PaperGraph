const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { LIMITS, validateRequest, buildRequest, normalizeResult, toolData, errorCode, safeUrl } = require('../electron/research-contract.cjs');
const { AnaraResearch } = require('../electron/anara-research.cjs');
const paper = { title: 'Attention Is All You Need', doi: '10.48550/arxiv.1706.03762', openAlexId: null, year: 2017, abstract: 'A harmless public abstract.', authors: ['Public Author'] };
const request = (overrides = {}) => ({ requestId: 'fixture-request-1', action: 'related', question: 'Find relevant evidence', context: { kind: 'paper', papers: [paper] }, ...overrides });
const tool = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
const runId = '12345678-1234-4123-8123-123456789abc';
function fixture(t, handler, options = {}) {
  const calls = [];
  const names = { anara_spawn_agent: ['requestId', 'prompt'], anara_check_agent: ['runId'], anara_get_agent_result: ['runId'], anara_cancel_agent: ['runId'] };
  const connection = { state: { status: 'connected' }, record: { tokens: { scope: 'anara:read anara:chat offline_access' } },
    tools: Object.entries(names).map(([name, keys]) => ({ name, inputSchema: { type: 'object', required: keys, properties: Object.fromEntries(keys.map(key => [key, { type: 'string' }])) } })),
    client: { callTool: async (input, _, opts) => { calls.push(input); return handler(input, opts); } } };
  const research = new AnaraResearch(connection, { pollMs: 1, ...options });
  t.after(() => research.stop());
  return { research, connection, calls };
}
const report = { summary: 'Evidence-supported research summary.', papers: [{ title: 'An actual paper title', doi: '10.1234/example', year: 2024, relevanceExplanation: 'Methodological criticism, rather than direct contradiction.' }], sources: [{ title: 'Journal', url: 'https://example.org/publication' }] };

test('single, multiple and Group context are bounded and every preset has evidence-aware instructions', () => {
  for (const action of ['related', 'newer', 'contradictions', 'gaps', 'question']) {
    const built = buildRequest(request({ action, context: action === 'gaps' ? { kind: 'group', groupName: 'Public topic', papers: [paper] } : request().context }));
    assert.ok(built.prompt.includes(paper.title));
    assert.ok(built.prompt.includes('Do not invent'));
    assert.ok(!built.prompt.includes('PDF_BODY_PRIVATE'));
  }
  assert.equal(validateRequest(request({ context: { kind: 'selection', papers: [paper, { ...paper, title: 'A second paper' }] } })).context.papers.length, 2);
  const withoutYear = buildRequest(request({ action: 'newer', context: { kind: 'paper', papers: [{ ...paper, year: null }] } }));
  assert.ok(withoutYear.prompt.includes('do not invent a date boundary'));
});

test('IPC rejects unknown fields, private content, invalid identifiers and oversized inputs', () => {
  for (const malformed of [
    request({ toolName: 'anara_execute' }), request({ action: 'write-library' }), request({ question: 'x'.repeat(LIMITS.question + 1) }),
    request({ context: { kind: 'group', papers: [paper], notes: 'PRIVATE_NOTES' } }),
    request({ context: { kind: 'paper', papers: [{ ...paper, source: 'PRIVATE_SOURCE' }] } }),
    request({ context: { kind: 'paper', papers: [{ ...paper, abstract: 'x'.repeat(LIMITS.abstract + 1) }] } }),
    request({ context: { kind: 'paper', papers: [{ ...paper, doi: 'javascript:alert(1)' }] } }),
    request({ context: { kind: 'selection', papers: Array.from({ length: LIMITS.papers + 1 }, () => paper) } }),
    request({ action: 'question', question: '' }), request({ action: 'gaps' }),
  ]) assert.throws(() => validateRequest(malformed), { code: 'invalid-request' });
});

test('normalization handles text, citations, empty papers, malformed candidates and bounded output safely', () => {
  const normalized = normalizeResult({ ...report, papers: [...report.papers, ...report.papers, { title: 'Bad DOI', doi: 'not-doi' }, { title: 'Safe title-only candidate', url: 'javascript:alert(1)', year: 9999 }] });
  assert.equal(normalized.papers.length, 2);
  assert.equal(normalized.papers[1].url, '');
  assert.equal(normalized.papers[1].year, null);
  assert.equal(normalizeResult('Cited [source](https://example.org/source)').sources[0].url, 'https://example.org/source');
  assert.deepEqual(normalizeResult('A report without papers.').papers, []);
  assert.throws(() => normalizeResult('{"diagnostic":"internal provider details"}'), { code: 'invalid-response' });
  assert.equal(normalizeResult(JSON.stringify({ summary: 'x'.repeat(LIMITS.summary + 5), papers: report.papers })).summary.length, LIMITS.summary);
  assert.equal(normalizeResult({ summary: 'x'.repeat(LIMITS.summary + 5) }).truncated, true);
  assert.throws(() => toolData(tool({ text: 'x'.repeat(LIMITS.responseBytes) })), { code: 'invalid-response' });
  for (const value of ['javascript:alert(1)', 'file:///secret', 'https://user:password@example.org', 'http://127.0.0.1/test', 'https://localhost/test']) assert.equal(safeUrl(value), '');
  assert.equal(normalizeResult('<script>alert(1)</script>').summary, '<script>alert(1)</script>'); // Escaped text by React, never HTML.
});

test('extracts structured reports surrounded by prose instead of showing raw JSON', () => {
  for (const body of [JSON.stringify(report), '```json\n' + JSON.stringify(report) + '\n```']) {
    const result = normalizeResult({ text: 'Research complete.\n' + body + '\nEvidence distinctions repeated here.' });
    assert.equal(result.summary, report.summary);
    assert.equal(result.papers[0].title, report.papers[0].title);
    assert.ok(result.sources.some(s => s.url === report.sources[0].url));
  }
  assert.throws(() => normalizeResult('Research complete.\n```json\n{"summary": "unfinished'), { code: 'invalid-response' });
});

test('research requests specify concise answers in the interface language', () => {
  assert.match(buildRequest(request()).prompt, /European Portuguese/);
  assert.match(buildRequest(request({ language: 'en' })).prompt, /in English/);
  assert.match(buildRequest(request()).prompt, /80–150 words/);
  assert.throws(() => validateRequest(request({ language: 'xx' })), { code: 'invalid-request' });
});

test('agent orchestration discovers allowed tools, polls and pages results without generic commands', async t => {
  let polls = 0;
  const f = fixture(t, input => {
    if (input.name === 'anara_spawn_agent') return tool({ runId });
    if (input.name === 'anara_check_agent') return tool({ status: ++polls === 1 ? 'running' : 'completed' });
    if (input.name === 'anara_get_agent_result') return tool({ text: JSON.stringify(report), nextOffset: null });
  });
  const response = await f.research.run(request());
  assert.equal(response.result.papers[0].doi, '10.1234/example');
  assert.deepEqual(f.calls[0].arguments, { requestId: request().requestId, prompt: buildRequest(request()).prompt });
  assert.ok(f.calls.every(c => ['anara_spawn_agent', 'anara_check_agent', 'anara_get_agent_result'].includes(c.name)));
  assert.equal(f.connection.researchActive, false);
});

test('retries are idempotent; failed result retrieval resumes the same remote run', async t => {
  let retrieved = 0;
  const f = fixture(t, input => {
    if (input.name === 'anara_spawn_agent') return tool({ runId });
    if (input.name === 'anara_check_agent') return tool({ status: 'completed' });
    if (++retrieved === 1) throw Object.assign(new Error('unavailable'), { status: 503 });
    return tool({ text: JSON.stringify(report) });
  });
  assert.equal((await f.research.run(request())).error, 'provider-unavailable');
  assert.ok((await f.research.run(request())).result);
  assert.equal(f.calls.filter(c => c.name === 'anara_spawn_agent').length, 1);
  assert.ok((await f.research.run(request())).result);
  assert.equal((await f.research.run(request({ question: 'Changed prompt with same ID' }))).error, 'invalid-request');
});

test('paged result text and citations are combined and missing next offsets terminate safely', async t => {
  const f = fixture(t, input => {
    if (input.name === 'anara_spawn_agent') return tool({ runId });
    if (input.name === 'anara_check_agent') return tool({ status: 'completed' });
    return input.arguments.offset === 0 ? tool({ answer: { text: 'First report paragraph.\n\n' }, nextOffset: 24, sources: report.sources })
      : tool({ answer: { text: 'Second report paragraph.' }, nextOffset: null });
  });
  const response = await f.research.run(request());
  assert.equal(response.result.summary, 'First report paragraph.\n\nSecond report paragraph.');
  assert.equal(response.result.sources.length, 1);
  assert.equal(f.calls.filter(c => c.name === 'anara_get_agent_result').length, 2);
});

test('deadline stops local tracking without falsely claiming remote cancellation', async t => {
  const f = fixture(t, input => input.name === 'anara_spawn_agent' ? tool({ runId }) : tool({ status: 'running' }), { timeoutMs: 15 });
  assert.equal((await f.research.run(request())).error, 'provider-unavailable');
  assert.ok(!f.calls.some(c => c.name === 'anara_cancel_agent'));
});

test('not-connected, expired, quota, rate-limit and unavailable are fixed high-level errors', async t => {
  for (const [message, expected] of [['Invalid or expired token', 'authentication-expired'], ['Usage limit reached', 'usage-limit'], ['Rate limit exceeded', 'rate-limited'], ['Unexpected provider failure', 'request-failed']]) {
    const f = fixture(t, () => ({ isError: true, content: [{ type: 'text', text: message }] }));
    assert.equal((await f.research.run(request())).error, expected);
  }
  const f = fixture(t, () => { throw new Error('No calls allowed'); });
  f.connection.state.status = 'disconnected'; assert.equal((await f.research.run(request())).error, 'not-connected');
  f.connection.state.status = 'expired'; assert.equal((await f.research.run(request())).error, 'authentication-expired');
  f.connection.state.status = 'connected'; f.connection.record.tokens.scope = 'anara:read';
  assert.equal((await f.research.run(request())).error, 'authentication-expired');
  assert.equal(f.calls.length, 0);
  assert.equal(errorCode({ status: 429 }), 'rate-limited');
});

test('cancellation is reported only after a remote terminal state; stale requests cannot start a second run', async t => {
  let cancelled = false;
  const f = fixture(t, input => {
    if (input.name === 'anara_spawn_agent') return tool({ runId });
    if (input.name === 'anara_cancel_agent') { cancelled = true; return tool({ status: 'cancelling' }); }
    return tool({ status: cancelled ? 'cancelled' : 'running' });
  });
  const pending = f.research.run(request());
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await f.research.run(request({ requestId: 'fixture-request-2' }))).error, 'busy');
  assert.equal((await f.research.cancel(request().requestId)).stopped, true);
  assert.equal((await pending).error, 'cancelled');
});

test('follow-ups reuse frozen context and only a bounded previous summary; no global conversation history', async t => {
  const f = fixture(t, input => input.name === 'anara_spawn_agent' ? tool({ runId }) : input.name === 'anara_check_agent' ? tool({ status: 'completed' }) : tool({ text: JSON.stringify(report) }));
  await f.research.run(request());
  await f.research.run(request({ requestId: 'fixture-follow-1', action: 'question', previousRequestId: 'fixture-request-1', question: 'Which evidence is stronger?' }));
  assert.ok(f.calls.filter(c => c.name === 'anara_spawn_agent')[1].arguments.prompt.includes(report.summary));
  const changed = request({ requestId: 'fixture-follow-2', previousRequestId: 'fixture-follow-1', context: { kind: 'paper', papers: [{ ...paper, title: 'Another context' }] } });
  assert.equal((await f.research.run(changed)).error, 'invalid-request');
});

test('main IPC checks window, main frame and origin; preload exposes only fixed research capabilities', () => {
  const handlers = {};
  const frame = { url: 'http://127.0.0.1:34173/' };
  const contents = { mainFrame: frame };
  const fixtureWindow = { webContents: contents };
  const electron = { app: { isPackaged: false, on() {}, requestSingleInstanceLock: () => false, quit() {} }, ipcMain: { handle: (name, callback) => { handlers[name] = callback; } } };
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  vm.runInNewContext(source + '\nmainWindow = fixtureWindow; trustedAppOrigin = "http://127.0.0.1:34173"; anaraResearch = fixtureResearch;', {
    require: name => name === 'electron' ? electron : name.startsWith('./') ? {} : require(name), process, URL, fixtureWindow,
    fixtureResearch: { run: () => 'safe reply', availability: () => ({ connected: true }) },
  });
  assert.equal(handlers['research:run']({ sender: contents, senderFrame: frame }, request()), 'safe reply');
  for (const event of [{ sender: {}, senderFrame: frame }, { sender: contents, senderFrame: { url: frame.url } }, { sender: contents, senderFrame: { url: 'https://evil.example' } }]) assert.throws(() => handlers['research:run'](event, request()));
  frame.url = 'https://evil.example'; assert.throws(() => handlers['research:run']({ sender: contents, senderFrame: frame }, request()));
  const bridges = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (name, value) => { bridges[name] = value; } }, ipcRenderer: {} }) });
  assert.deepEqual(Object.keys(bridges.papergraphResearch).sort(), ['cancel', 'connect', 'getAvailability', 'run']);
  assert.ok(!source.includes('nodeIntegration: true'));
  assert.ok(source.includes('contextIsolation: true') && source.includes('sandbox: true'));
});
