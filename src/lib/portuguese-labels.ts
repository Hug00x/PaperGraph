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

function getStoredTitleLabel(title: string) {
  const generatedDraftMatch = title.match(/^Untitled research note (\d+)$/);

  if (generatedDraftMatch) {
    return `Nota de investigação sem título ${generatedDraftMatch[1]}`;
  }

  return title;
}

export function getActivityTitleLabel(title: string) {
  const loadedArticlesMatch = title.match(/^Loaded (\d+) articles$/);

  if (loadedArticlesMatch) {
    return `${loadedArticlesMatch[1]} artigos carregados`;
  }

  const manualRelationsMatch = title.match(/^(\d+) manual relations$/);

  if (manualRelationsMatch) {
    return `${manualRelationsMatch[1]} ligações manuais`;
  }

  const explicitLinksMatch = title.match(/^(\d+) explicit links$/);

  if (explicitLinksMatch) {
    return `${explicitLinksMatch[1]} ligações explícitas`;
  }

  const suggestedRelationsMatch = title.match(/^(\d+) suggested relations$/);

  if (suggestedRelationsMatch) {
    return `${suggestedRelationsMatch[1]} ligações sugeridas`;
  }

  const createdMatch = title.match(/^Created (.+)$/);

  if (createdMatch) {
    return `Criado: ${getStoredTitleLabel(createdMatch[1])}`;
  }

  const submittedMatch = title.match(/^Submitted (.+)$/);

  if (submittedMatch) {
    return `Submetido: ${getStoredTitleLabel(submittedMatch[1])}`;
  }

  const resubmittedMatch = title.match(/^Resubmitted (.+)$/);

  if (resubmittedMatch) {
    return `Resubmetido: ${getStoredTitleLabel(resubmittedMatch[1])}`;
  }

  const linkedFromSourceMatch = title.match(/^Linked (.+) from source$/);

  if (linkedFromSourceMatch) {
    return `Ligado a partir do código: ${getStoredTitleLabel(linkedFromSourceMatch[1])}`;
  }

  const linkedMatch = title.match(/^Linked (.+) to (.+)$/);

  if (linkedMatch) {
    return `Ligação criada: ${getStoredTitleLabel(linkedMatch[1])} -> ${getStoredTitleLabel(linkedMatch[2])}`;
  }

  const removedWikilinkMatch = title.match(/^Removed wikilink from (.+) to (.+)$/);

  if (removedWikilinkMatch) {
    return `Wikilink removido: ${getStoredTitleLabel(removedWikilinkMatch[1])} -> ${getStoredTitleLabel(removedWikilinkMatch[2])}`;
  }

  const removedLinkMatch = title.match(/^Removed link between (.+) and (.+)$/);

  if (removedLinkMatch) {
    return `Ligação removida: ${getStoredTitleLabel(removedLinkMatch[1])} <-> ${getStoredTitleLabel(removedLinkMatch[2])}`;
  }

  if (title === "Created A-B-C test articles") {
    return "Artigos de teste A-B-C criados";
  }

  if (title === "2 explicit graph links") {
    return "2 ligações explícitas no mapa";
  }

  return title;
}

export function getActivityDescriptionLabel(description: string) {
  if (description === "The workspace opened with the current article set from storage.") {
    return "A área de trabalho abriu com os artigos guardados.";
  }

  if (description === "Saved links are available to browse in the Activity tab.") {
    return "As ligações guardadas ficam disponíveis no histórico interno da workspace.";
  }

  if (description === "Links discovered from wikilinks in article sources.") {
    return "Ligações encontradas a partir dos wikilinks no código dos artigos.";
  }

  if (description === "Potential links inferred from workspace content.") {
    return "Ligações potenciais inferidas a partir do conteúdo da área de trabalho.";
  }

  if (description === "Documents stored in the current workspace.") {
    return "Documentos guardados na área de trabalho atual.";
  }

  if (description === "The updated article is now reflected in the graph map.") {
    return "O artigo atualizado já está refletido no mapa.";
  }

  if (description === "A new draft was added to the workspace library.") {
    return "Foi adicionado um novo rascunho à biblioteca da área de trabalho.";
  }

  if (description === "PaperGraph refreshed explicit wikilinks after the article was saved.") {
    return "O PaperGraph atualizou os wikilinks explícitos depois de guardar o artigo.";
  }

  if (description === "PaperGraph found wikilinks while indexing the submitted article.") {
    return "O PaperGraph encontrou wikilinks ao indexar o artigo submetido.";
  }

  if (description === "An unlinked mention was converted into a source wikilink.") {
    return "Uma menção não ligada foi convertida num wikilink no código.";
  }

  if (description === "Artigo A links to Artigo B, Artigo B links to Artigo A and Artigo C, and Artigo C links to Artigo B.") {
    return "O Artigo A liga ao Artigo B; o Artigo B liga ao Artigo A e ao Artigo C; o Artigo C liga ao Artigo B.";
  }

  if (description === "The map should show A-B and B-C, with no direct A-C connection.") {
    return "O mapa deve mostrar A-B e B-C, sem ligação direta A-C.";
  }

  const sourceLinkMatch = description.match(/^The source link \[\[(.+)\]\] was converted back into plain text\.$/);

  if (sourceLinkMatch) {
    return `O wikilink [[${sourceLinkMatch[1]}]] foi convertido novamente em texto simples.`;
  }

  const relationBreakdownMatch = description.match(/^(\d+) manual, (\d+) explicit and (\d+) suggested\.$/);

  if (relationBreakdownMatch) {
    return `${relationBreakdownMatch[1]} manuais, ${relationBreakdownMatch[2]} explícitas e ${relationBreakdownMatch[3]} sugeridas.`;
  }

  const selectedArticleLinesMatch = description.match(/^Lines in (.+)\.$/);

  if (selectedArticleLinesMatch) {
    return `Linhas em ${selectedArticleLinesMatch[1]}.`;
  }

  if (description === "Lines in the selected article source.") {
    return "Linhas no código do artigo selecionado.";
  }

  return getRelationNoteLabel(description);
}
