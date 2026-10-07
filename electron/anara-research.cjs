const { buildRequest, validateRequest, normalizeResult, toolData, errorCode, LIMITS } = require('./research-contract.cjs');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const delay = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(done, ms);
  function done() { signal.removeEventListener('abort', abort); resolve(); }
  function abort() { clearTimeout(timer); reject(signal.reason || Object.assign(new Error('cancelled'), { code: 'cancelled' })); }
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
});
class AnaraResearch {
  constructor(connection, { pollMs = 2000, timeoutMs = 600000 } = {}) {
    this.connection = connection; this.pollMs = pollMs; this.timeoutMs = timeoutMs;
    this.requests = new Map(); this.active = null;
  }
  availability() {
    return { connected: this.connection.state.status === 'connected',
      permission: this.connection.record.tokens?.scope?.split(' ').includes('anara:chat') || false,
      supported: this.supported() };
  }
  supported() {
    const specs = { anara_spawn_agent: ['requestId', 'prompt'], anara_check_agent: ['runId'], anara_get_agent_result: ['runId'] };
    return Object.entries(specs).every(([name, keys]) => {
      const schema = this.connection.tools?.find(t => t.name === name)?.inputSchema;
      return schema?.type === 'object' && keys.every(k => schema.properties?.[k]?.type === 'string') &&
        (schema.required || []).every(k => keys.includes(k));
    });
  }
  async run(raw) {
    let requestId = typeof raw?.requestId === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(raw.requestId) ? raw.requestId : '';
    try {
      const request = validateRequest(raw); requestId = request.requestId;
      const existing = this.requests.get(requestId);
      if (existing && existing.signature !== JSON.stringify(request)) fail('invalid-request');
      if (existing?.pending) return existing.pending;
      if (existing?.result) return { requestId, result: existing.result };
      if (this.active) fail('busy');
      if (this.connection.state.status !== 'connected') fail(this.connection.state.status === 'expired' ? 'authentication-expired' : 'not-connected');
      if (!this.supported()) fail('capability-unavailable');
      if (!this.availability().permission) fail('authentication-expired');
      const previous = request.previousRequestId ? this.requests.get(request.previousRequestId) : null;
      if (request.previousRequestId && (!previous?.result || JSON.stringify(previous.request.context) !== JSON.stringify(request.context))) fail('invalid-request');
      if (previous?.followUps >= LIMITS.followUps) fail('follow-up-limit');
      const built = buildRequest(request, previous?.result.summary);
      const promptLimit = this.connection.tools.find(t => t.name === 'anara_spawn_agent').inputSchema.properties.prompt.maxLength;
      if (promptLimit && built.prompt.length > promptLimit) fail('invalid-request');
      const entry = existing || { signature: JSON.stringify(request), request, prompt: built.prompt,
        followUps: previous ? previous.followUps + 1 : 0 };
      this.requests.set(requestId, entry);
      while (this.requests.size > 8) this.requests.delete(this.requests.keys().next().value);
      const controller = new AbortController(); entry.controller = controller;
      this.active = entry; this.connection.researchActive = true;
      entry.pending = this.execute(entry, controller.signal).then(result => {
        entry.result = result; return { requestId, result };
      }).catch(error => {
        const code = errorCode(error);
        if (code === 'authentication-expired') this.connection.setState?.('expired', 'connection-failed');
        return { requestId, error: code };
      }).finally(() => {
        entry.pending = null;
        if (this.active === entry) { this.active = null; this.connection.researchActive = false; }
      });
      return entry.pending;
    } catch (error) { return { requestId, error: errorCode(error) }; }
  }
  async call(name, args, signal) {
    if (signal.aborted) throw signal.reason;
    const result = await this.connection.client.callTool({ name, arguments: args }, undefined, { signal, timeout: 30000 });
    return toolData(result);
  }
  async execute(entry, localSignal) {
    const signal = AbortSignal.any([localSignal, AbortSignal.timeout(this.timeoutMs)]);
    if (!entry.runId) {
      const started = await this.call('anara_spawn_agent', { requestId: entry.request.requestId, prompt: entry.prompt }, signal);
      if (!UUID.test(started?.runId || '')) fail('invalid-response');
      entry.runId = started.runId;
      if (typeof started.workspaceId === 'string' && started.workspaceId.length <= 128) entry.workspaceId = started.workspaceId;
    }
    const args = { runId: entry.runId, ...(entry.workspaceId ? { workspaceId: entry.workspaceId } : {}) };
    while (true) {
      const status = await this.call('anara_check_agent', args, signal);
      const phase = status?.status;
      if (phase === 'completed') break;
      if (phase === 'cancelled' || phase === 'canceled') fail('cancelled');
      if (phase === 'failed') fail(errorCode({ message: status.failure?.message || status.error?.message || 'request-failed' }));
      if (!['queued', 'running', 'pending', 'cancelling', 'canceling'].includes(phase)) fail('invalid-response');
      await delay(this.pollMs, signal);
    }
    let offset = 0, report = '', sourceData = null;
    for (let page = 0; page < 10; page++) {
      const data = await this.call('anara_get_agent_result', { ...args, offset, limit: 16000 }, signal);
      const chunk = typeof data?.text === 'string' ? data.text : typeof data?.answer === 'string' ? data.answer : data?.answer?.text;
      if (typeof chunk !== 'string') {
        if (typeof data?.summary === 'string') return normalizeResult(data);
        fail('invalid-response');
      }
      report += chunk;
      sourceData = { sources: [...(sourceData?.sources || []), ...(Array.isArray(data.sources) ? data.sources : [])].slice(0, LIMITS.sources),
        papers: Array.isArray(data.papers) ? data.papers : sourceData?.papers || [] };
      if (report.length > LIMITS.responseBytes) fail('invalid-response');
      if (data.nextOffset === null || data.nextOffset === undefined) return normalizeResult({ ...sourceData, text: report });
      if (!Number.isSafeInteger(data.nextOffset) || data.nextOffset <= offset) fail('invalid-response');
      offset = data.nextOffset;
    }
    fail('invalid-response');
  }
  async cancel(requestId) {
    const entry = this.active;
    if (!entry || entry.request.requestId !== requestId) return { requestId, stopped: true };
    // Do not abort a start while its remote runId is unknown: idempotent retries can recover it.
    if (!entry.runId) return { requestId, error: 'cancel-unconfirmed' };
    const schema = this.connection.tools?.find(t => t.name === 'anara_cancel_agent')?.inputSchema;
    if (!schema?.properties?.runId || (schema.required || []).some(k => k !== 'runId')) return { requestId, error: 'cancel-unconfirmed' };
    try {
      const signal = AbortSignal.timeout(10000);
      const args = { runId: entry.runId, ...(entry.workspaceId ? { workspaceId: entry.workspaceId } : {}) };
      await this.call('anara_cancel_agent', args, signal);
      for (let i = 0; i < 4; i++) {
        const status = await this.call('anara_check_agent', args, signal);
        if (status?.status === 'completed') return { requestId, stopped: false };
        if (['cancelled', 'canceled', 'failed'].includes(status?.status)) {
          entry.controller.abort(); return { requestId, stopped: true };
        }
        await delay(1000, signal);
      }
    } catch { /* No false promise of remote cancellation. */ }
    return { requestId, error: 'cancel-unconfirmed' };
  }
  async stop(remote = false) {
    const active = this.active;
    if (remote && active?.runId) await this.cancel(active.request.requestId);
    active?.controller.abort(); this.requests.clear();
  }
}
module.exports = { AnaraResearch };
