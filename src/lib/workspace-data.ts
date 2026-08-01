export type Article = {
  id: string;
  title: string;
  author: string;
  status: "Draft" | "Review" | "Published";
  updatedAt: string;
  tags: string[];
};

export type WorkspaceArticle = Article & {
  source: string;
};

export type WorkspaceRelation = {
  id: string;
  fromArticleId: string;
  toArticleId: string;
  note: string;
  createdAt: string;
  relationType: "auto" | "explicit" | "manual" | "suggested";
};

export type UnlinkedMention = {
  id: string;
  sourceArticleId: string;
  targetArticleId: string;
  targetTitle: string;
  occurrenceCount: number;
  preview: string;
};

export type ArticlePosition = {
  x: number;
  y: number;
};

export type WorkspaceImageAsset = {
  id: string;
  articleId?: string;
  originalName: string;
  storedName: string;
  storagePath?: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
};

export type GraphNode = {
  id: string;
  label: string;
  type: string;
  weight: number;
};

export type ActivityItem = {
  title: string;
  description: string;
  time: string;
};

export type AppStat = {
  label: string;
  value: string;
  description: string;
};

export type WorkspaceSnapshot = {
  selectedArticleId: string;
  articles: WorkspaceArticle[];
  relations: WorkspaceRelation[];
  articlePositions: Record<string, ArticlePosition>;
  graphNodes: GraphNode[];
  workspaceTags: string[];
  activityFeed: ActivityItem[];
  appStats: AppStat[];
  ignoredUnlinkedMentionKeys: string[];
  imageAssets: WorkspaceImageAsset[];
};

export const articles: WorkspaceArticle[] = [];

export const graphNodes: GraphNode[] = [];

export const workspaceTags: string[] = [];

export const articlePositions: Record<string, ArticlePosition> = {};

export function createInitialActivityFeed(workspaceArticles: WorkspaceArticle[], relations: WorkspaceRelation[] = []): ActivityItem[] {
  const manualRelations = relations.filter((relation) => relation.relationType === "manual");
  const explicitRelations = relations.filter((relation) => relation.relationType === "explicit");
  const suggestedRelations = relations.filter(
    (relation) => relation.relationType === "auto" || relation.relationType === "suggested",
  );

  return [
    {
      title: `${workspaceArticles.length} artigos carregados`,
      description: "A área de trabalho abriu com os artigos guardados.",
      time: "agora",
    },
    {
      title: `${manualRelations.length} ligações manuais`,
      description: "As ligações guardadas ficam disponíveis no histórico interno da workspace.",
      time: "agora",
    },
    {
      title: `${explicitRelations.length} ligações explícitas`,
      description: "Ligações encontradas a partir dos wikilinks no código dos artigos.",
      time: "agora",
    },
    {
      title: `${suggestedRelations.length} ligações sugeridas`,
      description: "Ligações potenciais inferidas a partir do conteúdo da área de trabalho.",
      time: "agora",
    },
  ];
}

export function createInitialAppStats(
  workspaceArticles: WorkspaceArticle[],
  relations: WorkspaceRelation[] = [],
  selectedArticle?: WorkspaceArticle,
): AppStat[] {
  const manualRelations = relations.filter((relation) => relation.relationType === "manual");
  const explicitRelations = relations.filter((relation) => relation.relationType === "explicit");
  const suggestedRelations = relations.filter(
    (relation) => relation.relationType === "auto" || relation.relationType === "suggested",
  );
  const sourceLineCount = selectedArticle?.source.split(/\r?\n/).length ?? 0;

  return [
    {
      label: "artigos",
      value: String(workspaceArticles.length),
      description: "Documentos guardados na área de trabalho atual.",
    },
    {
      label: "ligações",
      value: String(relations.length),
      description: `${manualRelations.length} manuais, ${explicitRelations.length} explícitas e ${suggestedRelations.length} sugeridas.`,
    },
    {
      label: "código",
      value: String(sourceLineCount),
      description: selectedArticle
        ? `Linhas em ${selectedArticle.title}.`
        : "Linhas no código do artigo selecionado.",
    },
  ];
}

export const defaultSnapshot: WorkspaceSnapshot = {
  selectedArticleId: "",
  articles,
  relations: [],
  articlePositions,
  graphNodes,
  workspaceTags,
  activityFeed: createInitialActivityFeed(articles, []),
  appStats: createInitialAppStats(articles, [], undefined),
  ignoredUnlinkedMentionKeys: [],
  imageAssets: [],
};
