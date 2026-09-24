type ArticleStatus = "Draft" | "Review" | "Published";
export type AppLanguage = "pt" | "en";

export function getArticleStatusLabel(status: ArticleStatus, language: AppLanguage = "pt") {
  if (language === "en") {
    switch (status) {
      case "Draft":
        return "Draft";
      case "Review":
        return "Review";
      case "Published":
        return "Published";
    }
  }

  switch (status) {
    case "Draft":
      return "Rascunho";
    case "Review":
      return "Revisão";
    case "Published":
      return "Publicado";
  }
}

export function getArticleTagLabel(tag: string, language: AppLanguage = "pt") {
  const normalizedTag = tag
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalizedTag === "pdf") {
    return "PDF";
  }

  if (normalizedTag === "importado" || normalizedTag === "imported") {
    return language === "en" ? "imported" : "importado";
  }

  if (normalizedTag === "novo" || normalizedTag === "new") {
    return language === "en" ? "new" : "novo";
  }

  if (normalizedTag === "rascunho" || normalizedTag === "draft") {
    return language === "en" ? "draft" : "rascunho";
  }

  return tag;
}

export function getRelativeTimeLabel(value: string, language: AppLanguage = "pt") {
  if (value === "just now" || value === "agora") {
    return language === "en" ? "now" : "agora";
  }

  const minutesAgo = value.match(/^(\d+)m ago$/);

  if (minutesAgo) {
    return language === "en" ? `${minutesAgo[1]} min ago` : `há ${minutesAgo[1]} min`;
  }

  const hoursAgo = value.match(/^(\d+)h ago$/);

  if (hoursAgo) {
    return language === "en" ? `${hoursAgo[1]} h ago` : `há ${hoursAgo[1]} h`;
  }

  const daysAgo = value.match(/^(\d+)d ago$/);

  if (daysAgo) {
    return language === "en" ? `${daysAgo[1]} d ago` : `há ${daysAgo[1]} d`;
  }

  return value;
}

export function getRelationNoteLabel(note: string, language: AppLanguage = "pt") {
  const explicitLinkMatch = note.match(/^Explicit wikilink in (.+): \[\[(.+)\]\]$/);

  if (explicitLinkMatch) {
    if (language === "en") {
      return `Explicit wikilink in ${explicitLinkMatch[1]}: [[${explicitLinkMatch[2]}]]`;
    }

    return `Wikilink explícito em ${explicitLinkMatch[1]}: [[${explicitLinkMatch[2]}]]`;
  }

  const portugueseExplicitLinkMatch = note.match(/^Wikilink explícito em (.+): \[\[(.+)\]\]$/);

  if (portugueseExplicitLinkMatch) {
    if (language === "en") {
      return `Explicit wikilink in ${portugueseExplicitLinkMatch[1]}: [[${portugueseExplicitLinkMatch[2]}]]`;
    }

    return note;
  }

  const sharedThemeMatch = note.match(/^Related by shared theme: (.+)$/);

  if (sharedThemeMatch) {
    if (language === "en") {
      return `Related by shared theme: ${sharedThemeMatch[1]}`;
    }

    return `Relacionado por tema partilhado: ${sharedThemeMatch[1]}`;
  }

  const portugueseSharedThemeMatch = note.match(/^Relacionado por tema partilhado: (.+)$/);

  if (portugueseSharedThemeMatch) {
    if (language === "en") {
      return `Related by shared theme: ${portugueseSharedThemeMatch[1]}`;
    }

    return note;
  }

  const openAlexCitationMatch = note.match(/^OpenAlex citation: (.+) references (.+)\.$/);

  if (openAlexCitationMatch) {
    return language === "en"
      ? note
      : `Citação OpenAlex: ${openAlexCitationMatch[1]} referencia ${openAlexCitationMatch[2]}.`;
  }

  const portugueseOpenAlexCitationMatch = note.match(/^Citação OpenAlex: (.+) referencia (.+)\.$/);

  if (portugueseOpenAlexCitationMatch) {
    return language === "en"
      ? `OpenAlex citation: ${portugueseOpenAlexCitationMatch[1]} references ${portugueseOpenAlexCitationMatch[2]}.`
      : note;
  }

  const semanticSimilarityMatch = note.match(/^Semantic similarity: (-?\d+)%\.$/);

  if (semanticSimilarityMatch) {
    return language === "en"
      ? note
      : `Similaridade semântica: ${semanticSimilarityMatch[1]}%.`;
  }

  const portugueseSemanticSimilarityMatch = note.match(/^Similaridade semântica: (-?\d+)%\.$/);

  if (portugueseSemanticSimilarityMatch) {
    return language === "en"
      ? `Semantic similarity: ${portugueseSemanticSimilarityMatch[1]}%.`
      : note;
  }

  return note;
}
