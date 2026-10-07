"use client";

import { useEffect, useRef, useState } from 'react';
import { LIMITS, type ResearchAction, type ResearchCandidate, type ResearchContext, type ResearchPaper, type ResearchRequest, type ResearchResult } from '../../electron/research-contract.cjs';
import { canAddResearchPaper } from '@/lib/deep-research-context';
import { LocalResearchChat } from './local-research-chat';
import type { WorkspaceImageAsset, WorkspaceArticle } from '@/lib/workspace-data';
import './anara-settings';
import { ResearchActions, researchActionLabels } from './research-actions';
import { ResearchPaperCard } from './research-paper-card';

type Availability = { connected: boolean; permission: boolean; supported: boolean };
type Reply = { requestId: string; result?: ResearchResult; error?: string };
declare global {
  interface Window {
    papergraphResearch?: {
      getAvailability(): Promise<Availability>;
      connect(): Promise<{ status: string; error: string | null }>;
      run(request: ResearchRequest): Promise<Reply>;
      cancel(requestId: string): Promise<{ requestId: string; stopped?: boolean; error?: string }>;
    };
  }
}
export type ResearchSession = { id: string; kind: ResearchContext['kind']; groupId?: string; groupName?: string;
  papers: { id: string; metadata: ResearchPaper }[]; action: ResearchAction };
export type AddResearchPaper = (candidate: ResearchCandidate, seedId: string, signal: AbortSignal) => Promise<string>;
function errorText(code: string, en: boolean) {
  const messages: Record<string, [string, string]> = {
    'authentication-expired': ['Reconnect Anara to authorize research. Your draft is preserved.', 'Volta a ligar a Anara para autorizar a investigação. O rascunho foi preservado.'],
    'not-connected': ['Connect Anara to research this selection.', 'Liga a Anara para investigar esta seleção.'],
    'rate-limited': ['Anara is receiving too many requests. Try again later.', 'A Anara está a receber demasiados pedidos. Tenta mais tarde.'],
    'usage-limit': ['Your current Anara usage limit has been reached.', 'Foi atingido o limite de utilização da tua conta Anara.'],
    'provider-unavailable': ['Anara is temporarily unavailable. Retry when your connection is restored.', 'A Anara está temporariamente indisponível. Tenta novamente quando a ligação estiver disponível.'],
    'invalid-response': ['The research response could not be read safely.', 'Não foi possível ler o resultado da investigação em segurança.'],
    'capability-unavailable': ['This Anara connection does not expose the supported research tools. Reconnect or try later.', 'Esta ligação Anara não disponibiliza as ferramentas de investigação suportadas. Volta a ligar ou tenta mais tarde.'],
    'cancelled': ['Research stopped.', 'Investigação interrompida.'],
    'cancel-unconfirmed': ['Stopping could not be confirmed. The research may still be running in Anara.', 'Não foi possível confirmar a interrupção. A investigação pode continuar na Anara.'],
    'busy': ['Another research request is still running. Wait or stop it first.', 'Ainda está em curso outro pedido de investigação. Aguarda ou interrompe-o primeiro.'],
    'follow-up-limit': ['This session has reached its follow-up limit. Start a new contextual request.', 'Foi atingido o limite de perguntas adicionais desta sessão. Inicia um novo pedido contextual.'],
    'invalid-request': ['Select 1–12 papers and keep your question within the size limit.', 'Seleciona 1–12 artigos e respeita o limite de tamanho da pergunta.'],
    'add-failed': ['Could not resolve or add this paper. Check its DOI or try again.', 'Não foi possível identificar ou adicionar este artigo. Verifica o DOI ou tenta novamente.'],
    'notes-full': ['The combined notes exceed the Group notes limit. Copy the summary instead.', 'As notas excederiam o limite do Grupo. Copia o resumo.'],
  };
  return messages[code]?.[en ? 0 : 1] || (en ? 'Research failed. You can retry the same request.' : 'A investigação falhou. Podes repetir o mesmo pedido.');
}
export function DeepResearchDrawer({ session, open, en, articles, imageAssets = [], workspaceId, accessToken, canEdit, groupNotes,
  onClose, onView, onAdd, onSaveNotes, onRunningChange }: {
  session: ResearchSession; open: boolean; en: boolean; articles: WorkspaceArticle[]; imageAssets?: WorkspaceImageAsset[]; workspaceId: string; accessToken: string; canEdit: boolean;
  groupNotes?: string; onClose: () => void; onView: (id: string) => void; onAdd?: AddResearchPaper;
  onSaveNotes?: (summary: string) => void; onRunningChange: (running: boolean) => void;
}) {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [mode, setMode] = useState<'local' | 'deep'>('local');
  const [localBusy, setLocalBusy] = useState(false);
  const [action, setAction] = useState<ResearchAction>(session.action);
  const [question, setQuestion] = useState(session.action === 'question' ? '' : researchActionLabels[en ? 'en' : 'pt'][session.action]);
  const [selected, setSelected] = useState(session.papers.slice(0, LIMITS.papers).map(p => p.id));
  const [phase, setPhase] = useState<'idle' | 'running' | 'stopping' | 'ready' | 'error'>('idle');
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [followUps, setFollowUps] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, string>>({});
  const [notesPreview, setNotesPreview] = useState(false);
  const [notice, setNotice] = useState('');
  const request = useRef<ResearchRequest | null>(null);
  const completedId = useRef<string | null>(null);
  const generation = useRef(0);
  const locked = useRef(false);
  const addController = useRef<AbortController | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  const onRunning = useRef(onRunningChange);
  useEffect(() => { onRunning.current = onRunningChange; }, [onRunningChange]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      const bridge = window.papergraphResearch;
      if (bridge) void bridge.getAvailability().then(value => { if (active) setAvailability(value); }).catch(() => {});
    };
    refresh();
    const unsubscribe = window.papergraphAnara?.subscribe(state => { if (active) { setConnecting(state.status === 'connecting'); refresh(); } });
    const requestGeneration = generation;
    return () => { active = false; unsubscribe?.(); requestGeneration.current++; addController.current?.abort();
      if (locked.current && request.current) void window.papergraphResearch?.cancel(request.current.requestId).catch(() => {});
      onRunning.current(false); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, [open]);
  const busy = localBusy || phase === 'running' || phase === 'stopping';
  const frozen = phase !== 'idle';
  async function connect() {
    setConnecting(true); setError('');
    try { const state = await window.papergraphResearch?.connect(); setConnecting(state?.status === 'connecting'); }
    catch { setConnecting(false); setError('provider-unavailable'); }
  }
  async function research(retry = false, follow = false) {
    const bridge = window.papergraphResearch;
    if (locked.current) return;
    if (mode === 'local') return;
    if (!bridge) return;
    if (!retry) {
      const papers = session.papers.filter(p => selected.includes(p.id)).map(p => p.metadata);
      if (!papers.length || papers.length > LIMITS.papers) { setError('invalid-request'); return; }
      const original = request.current;
      request.current = { requestId: crypto.randomUUID(), action: follow ? 'question' : action,
        language: en ? 'en' : 'pt',
        question: follow ? followUp : question,
        context: follow && original ? original.context : { kind: session.kind, groupName: session.groupName, papers },
        ...(follow && completedId.current ? { previousRequestId: completedId.current } : {}) };
    }
    if (!request.current?.question.trim()) { setError('invalid-request'); return; }
    if (availability?.connected && !availability.permission) { await connect(); return; }
    locked.current = true; const id = ++generation.current;
    setPhase('running'); setError(''); onRunning.current(true);
    try {
      const response = await bridge.run(request.current);
      if (id !== generation.current || response.requestId !== request.current.requestId) return;
      if (!response.result) { setError(response.error || 'invalid-response'); setPhase('error'); }
      else { setResult(response.result); setPhase('ready'); completedId.current = response.requestId;
        if (request.current.previousRequestId) setFollowUps(count => count + 1); setFollowUp(''); }
    } catch { if (id === generation.current) { setError('provider-unavailable'); setPhase('error'); } }
    finally { if (id === generation.current) { locked.current = false; onRunning.current(false); } }
  }
  async function stop() {
    if (!request.current) return;
    setPhase('stopping');
    try { const response = await window.papergraphResearch?.cancel(request.current.requestId);
      if (!locked.current) return;
      if (response?.error) { setError(response.error); setPhase('running'); } }
    catch { if (locked.current) { setError('cancel-unconfirmed'); setPhase('running'); } }
  }
  async function add(paper: ResearchCandidate, key: string) {
    if (!onAdd || !canAddResearchPaper(canEdit, workspaceId, accessToken) || adding) return;
    const controller = new AbortController(); addController.current = controller;
    setAdding(key); setError('');
    try { const id = await onAdd(paper, session.papers[0].id, controller.signal);
      if (!controller.signal.aborted) setAdded(previous => ({ ...previous, [key]: id })); }
    catch { if (!controller.signal.aborted) setError('add-failed'); }
    finally { if (!controller.signal.aborted) setAdding(null); }
  }
  const needsConnection = Boolean(availability && !availability.connected) || error === 'authentication-expired';
  return <aside ref={panel} data-graph-control data-deep-research role="complementary" aria-labelledby="deep-research-title"
    hidden={!open} style={open ? undefined : { display: 'none' }}
    className="deep-research-drawer flex min-h-0 flex-col border-l border-[var(--border)] bg-[var(--surface-strong)] p-4 text-[var(--foreground)] shadow-xl"
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !busy && mode === 'deep') { event.preventDefault(); void research(false, Boolean(result && followUp.trim())); }
    }}>
    <header className="flex items-start justify-between gap-2">
      <div><h2 id="deep-research-title" className="text-lg font-semibold">{en ? 'Ask Papergraph' : 'Perguntar a Papergraph'}</h2><p className="text-xs text-[var(--muted)]">{mode === 'deep' ? 'Powered by Anara' : (en ? 'Local AI conversation' : 'Conversa com IA local')}</p></div>
      <button type="button" className="rounded-lg px-3 py-1" aria-label={en ? 'Close Ask Papergraph' : 'Fechar Perguntar a Papergraph'} onClick={onClose}>×</button>
    </header>
    <div className="scrollbar-hidden mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
      <section><h3 className="text-xs font-semibold uppercase tracking-wider">{en ? 'Context' : 'Contexto'}</h3>
        <p className="mt-1 text-sm">{session.kind === 'group' ? `${en ? 'Group' : 'Grupo'}: ${session.groupName}` : session.kind === 'paper' ? session.papers[0]?.metadata.title : `${session.papers.length} ${en ? 'selected papers' : 'artigos selecionados'}`}</p>
        {session.papers.length > LIMITS.papers && <p className="mt-2 text-xs text-[var(--muted)]">{en ? `Select up to ${LIMITS.papers} of these ${session.papers.length} papers. Only checked papers will be sent.` : `Seleciona até ${LIMITS.papers} destes ${session.papers.length} artigos. Só serão enviados os artigos assinalados.`}</p>}
        <details className="mt-2 text-xs"><summary>{selected.length} {en ? 'papers · review metadata' : 'artigos · rever metadata'}</summary>
          <div className="mt-2 max-h-64 space-y-3 overflow-auto">{session.papers.map(p => <div key={p.id}>
            <label className="flex items-start gap-2"><input type="checkbox" checked={selected.includes(p.id)} disabled={localBusy || (mode === 'local' ? false : frozen) || (!selected.includes(p.id) && selected.length >= LIMITS.papers)}
              onChange={() => setSelected(ids => ids.includes(p.id) ? ids.filter(id => id !== p.id) : [...ids, p.id])} />{p.metadata.title}</label>
            {selected.includes(p.id) && <p className="mt-1 whitespace-pre-wrap text-[var(--muted)]">{[p.metadata.doi, p.metadata.year, p.metadata.abstract].filter(Boolean).join('\n')}</p>}
          </div>)}</div>
        </details>
      </section>
      <div className="papergraph-research-mode" role="group" aria-label={en ? 'Research mode' : 'Modo de investigação'}>
        {(['local', 'deep'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} disabled={busy}
          onClick={() => { setMode(value); setError(''); }}>
          {value === 'local' ? 'Local' : 'Deep Research'}
        </button>)}
      </div>
      {mode === 'deep' && !availability && <p role="status" className="text-xs text-[var(--muted)]">{en ? 'Deep Research requires the desktop app and an Anara connection.' : 'O Deep Research requer a aplicação desktop e uma ligação à Anara.'}</p>}
      {mode === 'deep' && needsConnection ? <section className="rounded-xl border border-[var(--border)] p-3 text-sm">
        <p>{en ? 'Connect your Anara account to use external research.' : 'Liga a tua conta Anara para usar investigação externa.'}</p>
        <button type="button" className="recommendations-action mt-3" disabled={!availability || connecting || busy} onClick={() => void connect()}>
          {connecting ? (en ? 'Connecting…' : 'A ligar…') : availability?.connected || error === 'authentication-expired' ? (en ? 'Reconnect Anara' : 'Voltar a ligar Anara') : (en ? 'Connect Anara' : 'Ligar Anara')}</button>
        {!availability && <p className="mt-2 text-xs">{en ? 'Requires the desktop application.' : 'Requer a aplicação desktop.'}</p>}
      </section> : null}
      {mode === 'deep' && !frozen && <ResearchActions presets isEnglish={en} gaps={session.kind === 'group' || selected.length > 1} onChoose={value => { setAction(value); setQuestion(value === 'question' ? '' : researchActionLabels[en ? 'en' : 'pt'][value]); }} />}
      {mode === 'deep' && !result && <label className="block text-sm">{en ? 'What do you want to investigate?' : 'O que queres investigar?'}
        <textarea className="mt-2 w-full rounded-xl border border-[var(--border)] bg-black/10 p-3 text-sm" rows={4} maxLength={LIMITS.question}
          value={question} disabled={mode === 'deep' && frozen} onChange={event => setQuestion(event.target.value)} />
      </label>}
      <div hidden={mode !== 'local'}>
        <LocalResearchChat key={selected.join(':')} en={en} articles={articles.filter(article => selected.includes(article.id))}
          assets={imageAssets} accessToken={accessToken} onRunningChange={running => { setLocalBusy(running); onRunning.current(running || phase === 'running' || phase === 'stopping'); }} />
      </div>
      {mode === 'deep' && busy && <div role="status" aria-live="polite" className="text-sm">{phase === 'stopping' ? (en ? 'Requesting stop…' : 'A pedir interrupção…') : (en ? 'Researching external academic evidence…' : 'A investigar evidência académica externa…')}
        <button type="button" className="recommendations-action ml-3" disabled={phase === 'stopping'} onClick={() => void stop()}>{en ? 'Stop' : 'Parar'}</button>
      </div>}
      {mode === 'deep' && error && <p role="alert" className="text-sm text-[var(--muted)]">{errorText(error, en)}</p>}
      {mode === 'deep' && !busy && <div className="flex flex-col items-start gap-4">
      {frozen && <button type="button" className="text-xs underline" onClick={() => {
        request.current = null; completedId.current = null; setResult(null); setPhase('idle'); setError('');
        setFollowUps(0); setFollowUp(''); setNotesPreview(false); setNotice('');
      }}>{en ? 'New research from this context' : 'Nova investigação com este contexto'}</button>}
      {!result && <button type="button" className="papergraph-ask-button" disabled={!availability || needsConnection || !question.trim() || selected.length === 0} onClick={() => void research(phase === 'error')}>
        {phase === 'error' ? (en ? 'Retry' : 'Tentar novamente') : (en ? 'Research' : 'Investigar')}</button>}
      </div>}
      {mode === 'deep' && result && <>
        <section><h3 className="font-semibold">{en ? 'Research summary' : 'Resumo da investigação'}</h3>
          <div className="mt-2 space-y-3 text-sm leading-6">{result.summary.split(/\n\s*\n/).map((paragraph, index) => <p key={index} className="whitespace-pre-wrap break-words">{paragraph}</p>)}</div>
          {result.truncated && <p className="mt-2 text-xs text-[var(--muted)]">{en ? 'The answer exceeded the display limit.' : 'O resultado excedeu o limite de apresentação.'}</p>}
          <button type="button" className="recommendations-action mt-3" onClick={() => void navigator.clipboard.writeText(result.summary).then(() => setNotice(en ? 'Summary copied.' : 'Resumo copiado.')).catch(() => setNotice(en ? 'Could not copy.' : 'Não foi possível copiar.'))}>{en ? 'Copy summary' : 'Copiar resumo'}</button>
          {session.groupId && canEdit && onSaveNotes && <button type="button" className="recommendations-action ml-3" onClick={() => setNotesPreview(true)}>{en ? 'Save summary to Group notes' : 'Guardar resumo nas notas do Grupo'}</button>}
        </section>
        {notesPreview && <section className="rounded-xl border border-[var(--border)] p-3"><h3 className="text-sm font-semibold">{en ? 'Append preview' : 'Pré-visualização da adição'}</h3>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs">{[groupNotes, result.summary].filter(Boolean).join('\n\n')}</pre>
          <button type="button" className="recommendations-action mt-3" onClick={() => { if ((groupNotes?.length || 0) + result.summary.length + 2 > 20000) { setError('notes-full'); return; } onSaveNotes?.(result.summary); setNotesPreview(false); setNotice(en ? 'Summary appended to Group notes.' : 'Resumo adicionado às notas do Grupo.'); }}>{en ? 'Append to notes' : 'Adicionar às notas'}</button>
          <button type="button" className="ml-3 text-xs" onClick={() => setNotesPreview(false)}>{en ? 'Cancel' : 'Cancelar'}</button>
        </section>}
        {notice && <p role="status" className="text-xs">{notice}</p>}
        <section><h3 className="mb-2 font-semibold">{en ? 'Relevant papers' : 'Artigos relevantes'}</h3>
          {!result.papers.length && <p className="text-xs text-[var(--muted)]">{en ? 'No structured paper candidates were returned. Review the sources below.' : 'Não foram devolvidos artigos estruturados. Consulta as fontes abaixo.'}</p>}
          <div className="space-y-3">{result.papers.map((paper, index) => { const key = `${paper.doi || paper.openAlexId || paper.title}:${index}`;
            return <ResearchPaperCard key={key} paper={paper} articles={articles} en={en} addedId={added[key]} adding={adding === key}
              canAdd={Boolean(onAdd) && canAddResearchPaper(canEdit, workspaceId, accessToken) && !adding}
              onAdd={() => void add(paper, key)} onView={onView} />; })}</div>
        </section>
        {result.sources.length > 0 && <section><h3 className="font-semibold">{en ? 'Sources' : 'Fontes'}</h3><ol className="mt-2 space-y-2 text-xs">{result.sources.map((source, i) => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer" className="break-words underline">[{i + 1}] {source.title}</a></li>)}</ol></section>}
        {followUps < LIMITS.followUps && <label className="block text-sm">{en ? 'Ask a follow-up' : 'Fazer uma pergunta adicional'}<textarea rows={2} maxLength={LIMITS.question} className="mt-2 w-full rounded-xl border border-[var(--border)] bg-black/10 p-3" value={followUp} disabled={busy} onChange={event => setFollowUp(event.target.value)} />
          <button type="button" className="recommendations-action mt-2" disabled={needsConnection || busy || !followUp.trim()} onClick={() => void research(false, true)}>{en ? 'Research' : 'Investigar'}</button>
        </label>}
        {phase === 'error' && !busy && <button type="button" className="recommendations-action" disabled={needsConnection} onClick={() => void research(true)}>{en ? 'Retry same request' : 'Repetir o mesmo pedido'}</button>}
      </>}
    </div>
  </aside>;
}
