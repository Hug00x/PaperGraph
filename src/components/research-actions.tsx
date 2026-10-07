"use client";

import type { ResearchAction } from "../../electron/research-contract.cjs";

export const researchActionLabels = {
  en: { related: 'Find related research', newer: 'Find newer research', contradictions: 'Find contradictions', gaps: 'Find research gaps', question: 'Deep Research…' },
  pt: { related: 'Encontrar investigação relacionada', newer: 'Encontrar investigação mais recente', contradictions: 'Encontrar contradições', gaps: 'Encontrar lacunas de investigação', question: 'Deep Research…' },
};
export function ResearchActions({ isEnglish, gaps, onChoose, presets = false }: { isEnglish: boolean; gaps: boolean; onChoose: (action: ResearchAction) => void; presets?: boolean }) {
  if (!presets) return <button type="button" className="papergraph-ask-button w-full" onClick={() => onChoose('question')}>{isEnglish ? 'Ask Papergraph' : 'Perguntar a Papergraph'}</button>;
  return <div className="space-y-1" aria-label={isEnglish ? 'Research' : 'Investigação'}>
    {(['related', 'newer', 'contradictions', ...(gaps ? ['gaps'] : [])] as ResearchAction[]).map(action =>
      <button key={action} type="button" className="block w-full rounded-xl px-3 py-2 text-left text-xs hover:bg-[var(--accent-soft)]"
        onClick={() => onChoose(action)}>{researchActionLabels[isEnglish ? 'en' : 'pt'][action]}</button>)}
  </div>;
}
