export function extractArxivIds(value: string) {
  const matches = value.match(/\b(?:arxiv:)?\d{4}\.\d{4,5}(?:v\d+)?\b/gi) ?? [];

  return Array.from(
    new Set(
      matches
        .map((match) => match.replace(/^arxiv:/i, "").replace(/v\d+$/i, "").toLowerCase())
        .filter(Boolean),
    ),
  );
}
