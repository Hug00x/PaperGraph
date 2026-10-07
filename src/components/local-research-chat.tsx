"use client";

import { useEffect, useRef, useState } from 'react';
import { boundedHistory, localPaperContext, type ChatMessage, type LocalPaper } from '@/lib/local-chat-context';
import type { WorkspaceArticle, WorkspaceImageAsset } from '@/lib/workspace-data';
import { ChatMarkdown } from './chat-markdown';

type Update = { requestId: string; phase: 'starting' | 'downloading' | 'generating'; percentage?: number | null; delta?: string };
declare global {
  interface Window {
    papergraphLocalChat?: {
      run(request: { requestId: string; language: 'pt' | 'en'; papers: LocalPaper[]; messages: ChatMessage[] }): Promise<{ requestId: string; content?: string; error?: string }>;
      cancel(requestId: string): Promise<void>;
      subscribe(callback: (update: Update) => void): () => void;
    };
  }
}

export function LocalResearchChat({ en, articles, assets, accessToken, onRunningChange }: {
  en: boolean; articles: WorkspaceArticle[]; assets: WorkspaceImageAsset[]; accessToken: string; onRunningChange: (running: boolean) => void;
}) {
  const [available, setAvailable] = useState(false);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [phase, setPhase] = useState<'idle' | 'reading' | Update['phase']>('idle');
  const [percentage, setPercentage] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [coverage, setCoverage] = useState<LocalPaper[]>([]);
  const active = useRef<{ id: string; controller: AbortController } | null>(null);
  const onRunning = useRef(onRunningChange);
  const mounted = useRef(true);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { onRunning.current = onRunningChange; }, [onRunningChange]);
  useEffect(() => {
    mounted.current = true;
    const bridge = window.papergraphLocalChat;
    void Promise.resolve(Boolean(bridge)).then(value => { if (mounted.current) setAvailable(value); });
    const unsubscribe = bridge?.subscribe(update => {
      if (update.requestId !== active.current?.id || active.current.controller.signal.aborted) return;
      setPhase(update.phase); setPercentage(update.percentage ?? null);
      if (update.delta) setDraft(text => text + update.delta);
    });
    return () => {
      mounted.current = false; unsubscribe?.();
      if (active.current) { active.current.controller.abort(); void bridge?.cancel(active.current.id).catch(() => {}); }
      onRunning.current(false);
    };
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [draft, messages, phase]);
  const busy = phase !== 'idle';
  async function send() {
    const bridge = window.papergraphLocalChat;
    const prompt = question.trim();
    if (!bridge || !prompt || !articles.length || active.current) return;
    const operation = { id: crypto.randomUUID(), controller: new AbortController() }; active.current = operation;
    setPhase('reading'); setDraft(''); setError(''); onRunning.current(true);
    try {
      const papers: LocalPaper[] = [];
      // Sequential PDF extraction limits memory when a group is selected.
      for (const article of articles) papers.push(await localPaperContext(article, assets, accessToken, prompt,
        Math.min(24000, Math.floor(36000 / articles.length)), operation.controller.signal));
      operation.controller.signal.throwIfAborted();
      if (!mounted.current) return;
      setCoverage(papers);
      const conversation: ChatMessage[] = [...boundedHistory(messages), { role: 'user', content: prompt }];
      const reply = await bridge.run({ requestId: operation.id, language: en ? 'en' : 'pt', papers, messages: conversation });
      operation.controller.signal.throwIfAborted();
      if (!mounted.current || reply.requestId !== operation.id) return;
      if (!reply.content || reply.error) throw new Error(reply.error || 'invalid-response');
      setMessages(previous => [...previous, { role: 'user', content: prompt }, { role: 'assistant', content: reply.content! }]);
      setQuestion(''); setDraft('');
    } catch (failure) {
      if (mounted.current) setError(operation.controller.signal.aborted ? 'cancelled' : failure instanceof Error ? failure.message : 'local-unavailable');
    } finally {
      if (active.current === operation) active.current = null;
      if (mounted.current) setPhase('idle');
      onRunning.current(false);
    }
  }
  function stop() {
    if (!active.current) return;
    active.current.controller.abort();
    void window.papergraphLocalChat?.cancel(active.current.id).catch(() => {});
  }
  const errorMessage = error === 'cancelled' ? (en ? 'Response stopped. You can send the question again.' : 'Resposta interrompida. Podes enviar a pergunta novamente.')
    : error === 'download-failed' || error === 'model-missing' ? (en ? 'Could not download the conversation model. Check your connection and retry.' : 'Não foi possível descarregar o modelo de conversa. Verifica a ligação e tenta novamente.')
      : error === 'invalid-response' ? (en ? 'The model did not complete its answer. Try again.' : 'O modelo não terminou a resposta. Tenta novamente.')
        : (en ? 'The local model is unavailable. Check the local engine status and retry. It may need more free memory.' : 'O modelo local está indisponível. Verifica o estado do motor local e tenta novamente. Pode ser necessária mais memória livre.');
  return <section className="space-y-4" aria-label={en ? 'Local conversation' : 'Conversa local'}>
    {!available && <p className="text-sm text-[var(--muted)]">{en ? 'Local conversations are available in the Papergraph desktop app.' : 'A conversa local está disponível na aplicação desktop Papergraph.'}</p>}
    {messages.map((message, index) => <article key={index} className={message.role === 'user' ? 'rounded-xl bg-[var(--accent-soft)] p-3' : 'rounded-xl border border-[var(--border)] p-3'}>
      <p className="mb-2 text-xs font-semibold text-[var(--muted)]">{message.role === 'user' ? (en ? 'You' : 'Tu') : 'Papergraph'}</p>
      {message.role === 'assistant' ? <ChatMarkdown text={message.content} /> : <p className="whitespace-pre-wrap text-sm">{message.content}</p>}
    </article>)}
    {draft && <article className="rounded-xl border border-[var(--border)] p-3"><p className="mb-2 text-xs font-semibold text-[var(--muted)]">Papergraph</p><ChatMarkdown text={draft} />{!busy && <p className="mt-2 text-xs text-[var(--muted)]">{en ? 'Incomplete response' : 'Resposta incompleta'}</p>}</article>}
    {coverage.length > 0 && <details className="text-xs text-[var(--muted)]"><summary>{en ? 'Sources used' : 'Fontes utilizadas'}</summary>
      {coverage.map((paper, index) => <p key={index} className="mt-2">[{index + 1}] {paper.title} — {paper.coverage}</p>)}
    </details>}
    {busy && <div role="status" className="text-sm text-[var(--muted)]">{phase === 'reading' ? (en ? 'Reading articles…' : 'A ler os artigos…')
      : phase === 'downloading' ? (en ? `Downloading conversation model${percentage === null ? '…' : `: ${percentage}%`}` : `A descarregar o modelo de conversa${percentage === null ? '…' : `: ${percentage}%`}`)
        : phase === 'starting' ? (en ? 'Preparing the local model…' : 'A preparar o modelo local…') : (en ? 'Writing response…' : 'A escrever a resposta…')}
      <button type="button" className="recommendations-action ml-2" onClick={stop}>{en ? 'Stop' : 'Parar'}</button>
    </div>}
    {error && <p role="alert" className="text-sm text-[var(--muted)]">{errorMessage}</p>}
    <div ref={end} />
    <label className="block text-sm">{messages.length ? (en ? 'Ask a follow-up' : 'Fazer uma pergunta adicional') : (en ? 'What do you want to ask?' : 'O que queres perguntar?')}
      <textarea rows={3} maxLength={4000} value={question} disabled={busy} onChange={event => setQuestion(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); void send(); } }}
        className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-sm" />
    </label>
    <div className="flex items-center gap-3">
      <button type="button" className="papergraph-ask-button" disabled={!available || busy || !question.trim() || !articles.length} onClick={() => void send()}>{en ? 'Send' : 'Enviar'}</button>
      {messages.length > 0 && <button type="button" className="text-xs underline" disabled={busy} onClick={() => { setMessages([]); setDraft(''); setCoverage([]); setError(''); }}>{en ? 'New conversation' : 'Nova conversa'}</button>}
    </div>
  </section>;
}
