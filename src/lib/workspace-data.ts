export type Article = {
  id: string;
  title: string;
  author: string;
  status: "Draft" | "Review" | "Published";
  updatedAt: string;
  tags: string[];
};

export type WorkspaceArticle = Article & {
  abstract?: string;
  source: string;
};

export type WorkspaceArticleVersion = {
  id: string;
  articleId: string;
  title: string;
  author: string;
  status: Exclude<Article["status"], "Draft">;
  source: string;
  tags: string[];
  createdAt: string;
  submittedBy?: string | null;
  submittedByName?: string | null;
};

export type WorkspaceRelation = {
  id: string;
  fromArticleId: string;
  toArticleId: string;
  note: string;
  createdAt: string;
  relationType: "citation" | "explicit" | "manual" | "semantic";
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

export type WorkspaceSnapshot = {
  selectedArticleId: string;
  articles: WorkspaceArticle[];
  relations: WorkspaceRelation[];
  articlePositions: Record<string, ArticlePosition>;
  ignoredUnlinkedMentionKeys: string[];
  imageAssets: WorkspaceImageAsset[];
  articleVersions: WorkspaceArticleVersion[];
};

export const articles: WorkspaceArticle[] = [];

export const articlePositions: Record<string, ArticlePosition> = {};

export const defaultSnapshot: WorkspaceSnapshot = {
  selectedArticleId: "",
  articles,
  relations: [],
  articlePositions,
  ignoredUnlinkedMentionKeys: [],
  imageAssets: [],
  articleVersions: [],
};
