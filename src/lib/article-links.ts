import type { AppLanguage } from "./portuguese-labels.ts";
import type { UnlinkedMention, WorkspaceArticle, WorkspaceRelation } from "./workspace-data.ts";

export function relationPairKey(fromArticleId: string, toArticleId: string) {
  return [fromArticleId, toArticleId].sort().join("::");
}

export function unlinkedMentionKey(sourceArticleId: string, targetArticleId: string) {
  return `${sourceArticleId}->${targetArticleId}`;
}

export function unlinkedMentionToastKey(articleId: string, mentions: UnlinkedMention[]) {
  return `${articleId}:${mentions.map((mention) => mention.id).join("|")}`;
}

function normalizeLinkTarget(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.(md|tex)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseWikilinkTarget(value: string) {
  return value.split("|")[0].split("#")[0].trim();
}

function extractExplicitLinkTargets(source: string) {
  const targets = new Set<string>();
  const wikilinkPattern = /\[\[([^\]\r\n]+)\]\]/g;

  for (const match of source.matchAll(wikilinkPattern)) {
    const target = parseWikilinkTarget(match[1]);

    if (target) {
      targets.add(target);
    }
  }

  return [...targets];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getWikilinkRanges(source: string) {
  const ranges: Array<{ start: number; end: number }> = [];
  const wikilinkPattern = /\[\[[^\]\r\n]+\]\]/g;

  for (const match of source.matchAll(wikilinkPattern)) {
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return ranges;
}

function stripLatexComments(source: string) {
  return source
    .split(/\r?\n/)
    .map((line) => {
      const commentIndex = line.search(/(?<!\\)%/);

      return commentIndex >= 0 ? line.slice(0, commentIndex) : line;
    })
    .join("\n");
}

function isIndexInsideRanges(index: number, ranges: Array<{ start: number; end: number }>) {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function createMentionPreview(source: string, index: number, mentionLength: number) {
  const previewStart = Math.max(index - 58, 0);
  const previewEnd = Math.min(index + mentionLength + 58, source.length);
  const prefix = previewStart > 0 ? "..." : "";
  const suffix = previewEnd < source.length ? "..." : "";

  return `${prefix}${source.slice(previewStart, previewEnd).replace(/\s+/g, " ").trim()}${suffix}`;
}

function findUnlinkedTitleMentions(source: string, targetTitle: string) {
  if (normalizeLinkTarget(targetTitle).length < 3) {
    return [];
  }

  const searchableSource = stripLatexComments(source);
  const wikilinkRanges = getWikilinkRanges(searchableSource);
  const titlePattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeRegExp(targetTitle)}(?![\\p{L}\\p{N}_])`,
    "giu",
  );

  return [...searchableSource.matchAll(titlePattern)].filter(
    (match) => !isIndexInsideRanges(match.index, wikilinkRanges),
  );
}

export function findUnlinkedMentions(
  workspaceArticles: WorkspaceArticle[],
  relations: WorkspaceRelation[],
  ignoredMentionKeys: string[],
): UnlinkedMention[] {
  const relationPairs = new Set(
    relations
      .filter((relation) => relation.relationType === "explicit" || relation.relationType === "manual")
      .map((relation) => relationPairKey(relation.fromArticleId, relation.toArticleId)),
  );
  const ignoredMentionKeySet = new Set(ignoredMentionKeys);
  const mentions: UnlinkedMention[] = [];

  workspaceArticles.forEach((sourceArticle) => {
    if (sourceArticle.source.includes("\\includepdf")) {
      return;
    }

    workspaceArticles.forEach((targetArticle) => {
      if (sourceArticle.id === targetArticle.id) {
        return;
      }

      const mentionKey = unlinkedMentionKey(sourceArticle.id, targetArticle.id);

      if (
        ignoredMentionKeySet.has(mentionKey) ||
        relationPairs.has(relationPairKey(sourceArticle.id, targetArticle.id))
      ) {
        return;
      }

      const matches = findUnlinkedTitleMentions(sourceArticle.source, targetArticle.title);

      if (matches.length === 0) {
        return;
      }

      mentions.push({
        id: mentionKey,
        sourceArticleId: sourceArticle.id,
        targetArticleId: targetArticle.id,
        targetTitle: targetArticle.title,
        occurrenceCount: matches.length,
        preview: createMentionPreview(sourceArticle.source, matches[0].index, targetArticle.title.length),
      });
    });
  });

  return mentions;
}

export function replaceFirstUnlinkedTitleMention(source: string, targetTitle: string) {
  const firstMention = findUnlinkedTitleMentions(source, targetTitle)[0];

  if (!firstMention) {
    return source;
  }

  return `${source.slice(0, firstMention.index)}[[${targetTitle}]]${source.slice(
    firstMention.index + firstMention[0].length,
  )}`;
}

export function stripExplicitWikilinksToTarget(source: string, targetTitle: string) {
  const wikilinkPattern = /\[\[([^\]\r\n]+)\]\]/g;

  return source.replace(wikilinkPattern, (fullMatch, rawTarget: string) => {
    const linkedTarget = parseWikilinkTarget(rawTarget);

    if (normalizeLinkTarget(linkedTarget) !== normalizeLinkTarget(targetTitle)) {
      return fullMatch;
    }

    const alias = rawTarget.includes("|")
      ? rawTarget.split("|").slice(1).join("|").trim()
      : "";

    return alias || linkedTarget || targetTitle;
  });
}

function createArticleTitleIndex(workspaceArticles: WorkspaceArticle[]) {
  const articleTitleIndex = new Map<string, WorkspaceArticle>();

  workspaceArticles.forEach((article) => {
    articleTitleIndex.set(normalizeLinkTarget(article.title), article);
  });

  return articleTitleIndex;
}

export function validateExplicitLinkTargets(workspaceArticles: WorkspaceArticle[], language: AppLanguage = "pt") {
  const articleTitleIndex = new Map<string, WorkspaceArticle[]>();
  const validationIssues: string[] = [];
  const isEnglish = language === "en";

  workspaceArticles.forEach((article) => {
    const titleKey = normalizeLinkTarget(article.title);
    articleTitleIndex.set(titleKey, [...(articleTitleIndex.get(titleKey) ?? []), article]);
  });

  articleTitleIndex.forEach((matchingArticles) => {
    if (matchingArticles.length < 2) {
      return;
    }

    validationIssues.push(
      isEnglish
        ? `The title "${matchingArticles[0].title}" is duplicated and makes wikilinks ambiguous.`
        : `O título "${matchingArticles[0].title}" está duplicado e torna os wikilinks ambíguos.`,
    );
  });

  workspaceArticles.forEach((sourceArticle) => {
    extractExplicitLinkTargets(sourceArticle.source).forEach((targetTitle) => {
      const matchingArticles = articleTitleIndex.get(normalizeLinkTarget(targetTitle)) ?? [];

      if (matchingArticles.length === 0) {
        validationIssues.push(
          isEnglish
            ? `${sourceArticle.title} links to a missing article: [[${targetTitle}]].`
            : `${sourceArticle.title} liga para um artigo inexistente: [[${targetTitle}]].`,
        );
        return;
      }

      if (matchingArticles.length > 1) {
        validationIssues.push(
          isEnglish
            ? `${sourceArticle.title} links to an ambiguous article: [[${targetTitle}]].`
            : `${sourceArticle.title} liga para um artigo ambíguo: [[${targetTitle}]].`,
        );
        return;
      }

      if (matchingArticles[0].id === sourceArticle.id) {
        validationIssues.push(
          isEnglish
            ? `${sourceArticle.title} links to itself with [[${targetTitle}]].`
            : `${sourceArticle.title} liga para si próprio com [[${targetTitle}]].`,
        );
      }
    });
  });

  return validationIssues;
}

export function rebuildExplicitRelations(
  workspaceArticles: WorkspaceArticle[],
  relations: WorkspaceRelation[],
) {
  const articleIds = new Set(workspaceArticles.map((article) => article.id));
  const persistentRelations = relations.filter(
    (relation) =>
      relation.relationType !== "explicit" &&
      relation.fromArticleId !== relation.toArticleId &&
      articleIds.has(relation.fromArticleId) &&
      articleIds.has(relation.toArticleId),
  );
  const explicitPairs = new Set<string>();
  const articleTitleIndex = createArticleTitleIndex(workspaceArticles);
  const explicitRelations: WorkspaceRelation[] = [];

  workspaceArticles.forEach((sourceArticle) => {
    extractExplicitLinkTargets(sourceArticle.source).forEach((targetTitle) => {
      const targetArticle = articleTitleIndex.get(normalizeLinkTarget(targetTitle));

      if (!targetArticle || targetArticle.id === sourceArticle.id) {
        return;
      }

      const pairKey = `${sourceArticle.id}->${targetArticle.id}`;

      if (explicitPairs.has(pairKey)) {
        return;
      }

      explicitPairs.add(pairKey);
      explicitRelations.push({
        id: `explicit-${pairKey}`,
        fromArticleId: sourceArticle.id,
        toArticleId: targetArticle.id,
        note: `Wikilink explícito em ${sourceArticle.title}: [[${targetArticle.title}]]`,
        createdAt: "source",
        relationType: "explicit",
      });
    });
  });

  return [...persistentRelations, ...explicitRelations];
}

function isAcademicRelation(relation: WorkspaceRelation) {
  return relation.relationType === "citation" || relation.relationType === "semantic";
}

function academicRelationKey(relation: Pick<WorkspaceRelation, "fromArticleId" | "relationType" | "toArticleId">) {
  return `${relation.relationType}:${relation.fromArticleId}->${relation.toArticleId}`;
}

export function mergeAcademicRelations(
  baseRelations: WorkspaceRelation[],
  academicRelations: WorkspaceRelation[],
  workspaceArticles: WorkspaceArticle[],
) {
  const articleIds = new Set(workspaceArticles.map((article) => article.id));
  const existingRelations = baseRelations.filter(
    (relation) =>
      !isAcademicRelation(relation) &&
      relation.fromArticleId !== relation.toArticleId &&
      articleIds.has(relation.fromArticleId) &&
      articleIds.has(relation.toArticleId),
  );
  const nextAcademicRelations: WorkspaceRelation[] = [];
  const seenAcademicKeys = new Set<string>();

  academicRelations.forEach((relation) => {
    if (
      !isAcademicRelation(relation) ||
      relation.fromArticleId === relation.toArticleId ||
      !articleIds.has(relation.fromArticleId) ||
      !articleIds.has(relation.toArticleId)
    ) {
      return;
    }

    const key = academicRelationKey(relation);

    if (seenAcademicKeys.has(key)) {
      return;
    }

    seenAcademicKeys.add(key);
    nextAcademicRelations.push(relation);
  });

  return [...existingRelations, ...nextAcademicRelations];
}
