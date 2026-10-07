import { Fragment, type ReactNode } from 'react';

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => part.startsWith('**')
    ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith('`')
      ? <code key={index} className="rounded bg-[var(--accent-soft)] px-1">{part.slice(1, -1)}</code> : part);
}
// React escapes all model output. No raw HTML or executable links are accepted.
export function ChatMarkdown({ text }: { text: string }) {
  const lines = text.split('\n'); const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.startsWith('```')) {
      const content: string[] = [];
      while (++i < lines.length && !lines[i].startsWith('```')) content.push(lines[i]);
      blocks.push(<pre key={i} className="overflow-x-auto rounded-xl bg-[var(--background)] p-3 text-xs"><code>{content.join('\n')}</code></pre>);
    } else if (/^#{1,6}\s/.test(line)) {
      blocks.push(<h4 key={i} className="pt-2 font-semibold">{inline(line.replace(/^#{1,6}\s+/, ''))}</h4>);
    } else if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line); const items: ReactNode[] = [];
      const pattern = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
      while (i < lines.length && pattern.test(lines[i])) { items.push(<li key={i}>{inline(lines[i].replace(pattern, ''))}</li>); i++; }
      i--; blocks.push(ordered ? <ol key={i} className="list-decimal space-y-1 pl-5">{items}</ol> : <ul key={i} className="list-disc space-y-1 pl-5">{items}</ul>);
    } else if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      const cells = (value: string) => value.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
      const headings = cells(line); const rows: string[][] = []; i += 2;
      while (i < lines.length && lines[i].includes('|')) rows.push(cells(lines[i++]));
      i--; blocks.push(<div key={i} className="overflow-x-auto"><table className="w-full border-collapse text-xs"><thead><tr>{headings.map((cell, j) => <th key={j} className="border border-[var(--border)] p-2 text-left">{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, j) => <tr key={j}>{row.map((cell, k) => <td key={k} className="border border-[var(--border)] p-2">{inline(cell)}</td>)}</tr>)}</tbody></table></div>);
    } else {
      blocks.push(<p key={i} className="whitespace-pre-wrap break-words">{inline(line)}</p>);
    }
  }
  return <div className="space-y-3 text-sm leading-6">{blocks.map((block, index) => <Fragment key={index}>{block}</Fragment>)}</div>;
}
