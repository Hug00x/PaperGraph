"use client";

import { isViewOnlyArticle } from "@/lib/article-presentation";

import { extractPdfMetadata, titleFromPdfItems, type PdfMetadata, type PdfTextItem } from "@/lib/academic/pdf-metadata";
import type { PdfImportResult } from "@/lib/pdf-import-queue";
import { ArticleLibrary } from "@/components/article-library";
import { ArticleViewerPane } from "@/components/article-viewer-pane";
import { AuthLanding } from "@/components/auth-landing";
import { EditorPane } from "@/components/editor-pane";
import { GraphPane } from "@/components/graph-pane";
import { articleIdentity, samePaper } from "@/lib/academic/discovery/identity";
import type { RecommendedPaper } from "@/lib/academic/discovery/types";
import deleteButtonImage from "@/imagens/Delete_button.png";
import deleteButtonImageInverted from "@/imagens/Delete_button_inverted.png";
import paperGraphLogoText from "@/imagens/PapergraghTexto.png";
import type { AppLanguage } from "@/lib/portuguese-labels";
import {
  defaultSnapshot,
  type ArticlePosition,
  type UnlinkedMention,
  type WorkspaceSnapshot,
  type WorkspaceArticle,
  type WorkspaceArticleVersion,
  type WorkspaceImageAsset,
  type WorkspaceRelation,
} from "@/lib/workspace-data";
import {
  acceptWorkspaceInviteInSupabase,
  createUserWorkspaceInSupabase,
  createWorkspaceInviteInSupabase,
  declineWorkspaceInviteInSupabase,
  deleteWorkspaceInSupabase,
  ensureUserWorkspace,
  listWorkspaceAssetStoragePathsFromSupabase,
  listMyPendingWorkspaceInvitesFromSupabase,
  listUserWorkspacesFromSupabase,
  listWorkspaceInvitesFromSupabase,
  listWorkspaceMembersFromSupabase,
  loadWorkspaceSnapshotFromSupabase,
  removeWorkspaceMemberFromSupabase,
  renameWorkspaceInSupabase,
  revokeWorkspaceInviteInSupabase,
  saveWorkspaceSnapshotToSupabase,
  saveWorkspaceArticles,
  transferWorkspaceOwnerInSupabase,
  updateWorkspaceMemberRoleInSupabase,
  type AccountWorkspace,
  type WorkspaceInvite,
  type WorkspaceMember,
  type WorkspaceMemberRole,
} from "@/lib/supabase-workspace";
import { deleteArticleCollaborationStateFromSupabase } from "@/lib/supabase-collaboration";
import { getSupabaseBrowserClient } from "@/lib/supabase-client";
import { paperGraphAssetBucket, uploadWorkspaceAssetToSupabase } from "@/lib/supabase-storage";
import { getFriendlyErrorMessage, getFriendlyResponseError } from "@/lib/friendly-errors";
import Image from "next/image";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";

const apiPath = "/api/workspace";
const activeWorkspaceStorageKey = "papergraph-active-workspace-id";
const emptyWorkspacesStorageKeyPrefix = "papergraph-empty-workspaces";
const localWorkspaceUiStorageId = "local";
const workspaceUiStorageKeyPrefix = "papergraph-workspace-ui";
const maxArticleVersionsPerArticle = 50;
const tabs = ["drafts", "editor", "graph", "settings"] as const;
const settingsSections = ["general", "workspaces", "help", "account"] as const;
const editableWorkspaceMemberRoles = ["editor", "viewer"] as const;
type WorkspaceTab = (typeof tabs)[number];
type SettingsSection = (typeof settingsSections)[number];
type EditableWorkspaceMemberRole = (typeof editableWorkspaceMemberRoles)[number];
type SubmittedArticleStatus = Exclude<WorkspaceArticle["status"], "Draft">;
type PendingEditorResubmission = {
  abstract: string;
  articleId: string;
  source: string;
  status: SubmittedArticleStatus;
  tags: string[];
  title: string;
};
type PendingEditorNavigation = { type: "tab"; tab: WorkspaceTab };
type AppDialogTone = "default" | "danger" | "warning";
type AppDialogState = {
  body?: string;
  cancelLabel?: string;
  confirmLabel?: string;
  confirmationValue?: string;
  eyebrow?: string;
  inputDefaultValue?: string;
  inputLabel?: string;
  kind: "alert" | "confirm" | "prompt";
  title: string;
  tone?: AppDialogTone;
};
type AppDialogResult = {
  confirmed: boolean;
  value?: string;
};
type ArticleSubmission = {
  abstract: string;
  articleId?: string;
  source: string;
  status: SubmittedArticleStatus;
  tags: string[];
  title: string;
};
type ArticleSubmissionResult = {
  cancelled?: boolean;
  issue?: string;
  pdfBuffer?: ArrayBuffer;
  submitted: boolean;
};
type AcademicRelationDiagnostics = {
  articleCount?: number;
  citationRelationCount?: number;
  doiArticleCount?: number;
  openAlexArticleCount?: number;
  semanticCandidateCount?: number;
  semanticRelationCount?: number;
  semanticThreshold?: number;
  semanticTopScore?: number | null;
};
type AcademicRelationRefreshResult = {
  diagnostics?: AcademicRelationDiagnostics | null;
  issue?: string;
  relations: WorkspaceRelation[];
  status?: string;
};
type AuthMode = "sign-in" | "sign-up";
type AppTheme = "dark" | "light";
type UserProfileRow = {
  display_name: string | null;
};
type WorkspacePresenceMode = "editing" | "viewing" | "browsing" | "settings";
type WorkspacePresence = {
  articleId: string | null;
  articleTitle: string | null;
  clientId: string;
  enteredAt: string;
  email: string | null;
  mode: WorkspacePresenceMode;
  selectionEnd?: number | null;
  selectionStart?: number | null;
  tab: WorkspaceTab;
  updatedAt: string;
  userId: string;
  userName: string;
};

type WorkspaceUiState = {
  activeTab?: WorkspaceTab;
  graphSelectedArticleId?: string | null;
  selectedArticleId?: string;
};
function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function getAuthUserFallbackDisplayName(user: User | null) {
  if (!user) {
    return null;
  }

  const userMetadata = user.user_metadata as Record<string, unknown>;
  const metadataName =
    typeof userMetadata.display_name === "string"
      ? userMetadata.display_name
      : typeof userMetadata.full_name === "string"
        ? userMetadata.full_name
        : typeof userMetadata.name === "string"
          ? userMetadata.name
          : "";
  const normalizedMetadataName = normalizeDisplayName(metadataName);

  if (normalizedMetadataName) {
    return normalizedMetadataName;
  }

  return user.email?.split("@")[0] ?? null;
}

function formatNotificationCount(count: number) {
  return count > 999 ? "999+" : String(count);
}

function isAcademicRelationDiagnostics(value: unknown): value is AcademicRelationDiagnostics {
  return Boolean(value) && typeof value === "object";
}

function NotificationBadge({ className = "", count }: { className?: string; count: number }) {
  if (count <= 0) {
    return null;
  }

  return (
    <span
      className={`pointer-events-none inline-flex min-w-7 items-center justify-center rounded-full border border-white/25 bg-[#ff6b38] px-2 py-1 text-xs font-black leading-none text-white shadow-[0_10px_28px_rgba(255,107,56,0.38)] ${className}`}
    >
      {formatNotificationCount(count)}
    </span>
  );
}

function getStoredActiveWorkspaceId() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(activeWorkspaceStorageKey);
}

function rememberActiveWorkspaceId(workspaceId: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (workspaceId) {
    window.localStorage.setItem(activeWorkspaceStorageKey, workspaceId);
    return;
  }

  window.localStorage.removeItem(activeWorkspaceStorageKey);
}

function getEmptyWorkspacesStorageKey(userId: string) {
  return `${emptyWorkspacesStorageKeyPrefix}:${userId}`;
}

function shouldKeepWorkspacesEmpty(userId: string) {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(getEmptyWorkspacesStorageKey(userId)) === "true";
}

function rememberShouldKeepWorkspacesEmpty(userId: string, shouldKeepEmpty: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  if (shouldKeepEmpty) {
    window.localStorage.setItem(getEmptyWorkspacesStorageKey(userId), "true");
    return;
  }

  window.localStorage.removeItem(getEmptyWorkspacesStorageKey(userId));
}

function isWorkspaceTab(value: string | null): value is WorkspaceTab {
  return tabs.some((tab) => tab === value);
}

function getWorkspaceUiStorageKey(workspaceId: string | null) {
  return `${workspaceUiStorageKeyPrefix}:${workspaceId ?? localWorkspaceUiStorageId}`;
}

function getStoredWorkspaceUiState(workspaceId: string | null): WorkspaceUiState {
  if (typeof window === "undefined") {
    return {};
  }

  const rawState = window.localStorage.getItem(getWorkspaceUiStorageKey(workspaceId));

  if (!rawState) {
    return {};
  }

  try {
    const parsedState = JSON.parse(rawState) as Partial<WorkspaceUiState>;

    return {
      activeTab: isWorkspaceTab(parsedState.activeTab ?? null) ? parsedState.activeTab : undefined,
      graphSelectedArticleId:
        typeof parsedState.graphSelectedArticleId === "string"
          ? parsedState.graphSelectedArticleId
          : parsedState.graphSelectedArticleId === null
            ? null
            : undefined,
      selectedArticleId:
        typeof parsedState.selectedArticleId === "string" && parsedState.selectedArticleId
          ? parsedState.selectedArticleId
          : undefined,
    };
  } catch {
    return {};
  }
}

function rememberWorkspaceUiState(workspaceId: string | null, updates: WorkspaceUiState) {
  if (typeof window === "undefined") {
    return;
  }

  const currentState = getStoredWorkspaceUiState(workspaceId);
  const nextState = { ...currentState, ...updates };

  window.localStorage.setItem(getWorkspaceUiStorageKey(workspaceId), JSON.stringify(nextState));
}

function forgetWorkspaceUiState(workspaceId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(getWorkspaceUiStorageKey(workspaceId));
}

function normalizeWorkspaceName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function getStoredNameFromWorkspaceAssetPath(storagePath: string) {
  return storagePath.split("/").filter(Boolean).at(-1) ?? storagePath;
}

function formatWorkspaceDate(value: string | null, language: AppLanguage) {
  if (!value) {
    return language === "en" ? "No date yet" : "Sem data";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return language === "en" ? "No date yet" : "Sem data";
  }

  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "pt-PT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatWorkspaceRole(role: string, language: AppLanguage) {
  if (role === "owner") {
    return language === "en" ? "Owner" : "Dono";
  }

  if (role === "editor" || role === "member") {
    return language === "en" ? "Editor" : "Editor";
  }

  if (role === "viewer") {
    return language === "en" ? "Viewer" : "Visualizador";
  }

  return language === "en" ? "Member" : "Membro";
}

function getEditableWorkspaceMemberRole(role: WorkspaceMemberRole): EditableWorkspaceMemberRole {
  return role === "viewer" ? "viewer" : "editor";
}

function WorkspaceRoleToggle({
  className = "",
  disabled = false,
  language,
  onChange,
  size = "md",
  value,
}: {
  className?: string;
  disabled?: boolean;
  language: AppLanguage;
  onChange: (role: EditableWorkspaceMemberRole) => void;
  size?: "sm" | "md";
  value: EditableWorkspaceMemberRole;
}) {
  const selectedIndex = editableWorkspaceMemberRoles.indexOf(value);
  const buttonClassName =
    size === "sm" ? "px-3 py-1.5 text-[11px]" : "px-5 py-2.5 text-sm";

  return (
    <div
      className={`relative grid grid-cols-2 rounded-full border border-[var(--border)] bg-black/20 p-1 ${className}`}
    >
      <span
        aria-hidden
        className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-[var(--accent)] shadow-[0_10px_24px_rgba(142,231,255,0.18)] transition-transform duration-200 ease-out ${
          selectedIndex === 1 ? "translate-x-full" : "translate-x-0"
        }`}
      />
      {editableWorkspaceMemberRoles.map((role) => {
        const isSelectedRole = value === role;

        return (
          <button
            key={role}
            type="button"
            aria-pressed={isSelectedRole}
            disabled={disabled}
            onClick={() => {
              if (!isSelectedRole) {
                onChange(role);
              }
            }}
            className={`relative z-10 rounded-full font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${buttonClassName} ${
              isSelectedRole ? "text-[#041016]" : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {formatWorkspaceRole(role, language)}
          </button>
        );
      })}
    </div>
  );
}

function HelpSection({ language }: { language: AppLanguage }) {
  const isEnglish = language === "en";
  const quickSteps = isEnglish
    ? [
        {
          title: "Create or open a workspace",
          body: "A workspace is a separate research map. Use one workspace per project, course, dissertation chapter or group.",
        },
        {
          title: "Add articles",
          body: "Write a LaTeX draft, submit it to the map, or import an external PDF directly from the map tab.",
        },
        {
          title: "Connect ideas",
          body: "Use wikilinks, unlinked mention suggestions or manual links to build the article network.",
        },
      ]
    : [
        {
          title: "Cria ou abre uma workspace",
          body: "Uma workspace é um mapa de investigação separado. Usa uma por projeto, cadeira, capítulo da dissertação ou grupo.",
        },
        {
          title: "Adiciona artigos",
          body: "Escreve um rascunho em LaTeX, submete-o para o mapa ou importa um PDF externo diretamente na tab Mapa.",
        },
        {
          title: "Liga ideias",
          body: "Usa wikilinks, sugestões de menções não ligadas ou ligações manuais para construir a rede de artigos.",
        },
      ];
  const helpGroups = isEnglish
    ? [
        {
          eyebrow: "Workspaces",
          title: "Maps, members and roles",
          description: "Workspaces keep articles, files, links and graph layout separated from each other.",
          cards: [
            {
              title: "Available maps",
              body: "The Workspaces section lists every map you own or were invited to. Opening a map changes the active articles, files and graph layout.",
            },
            {
              title: "Invites",
              body: "Owners invite people by email. The invite appears when that person signs in with the same email address.",
            },
            {
              title: "Roles",
              body: "Owners manage members and workspaces. Editors can write, import and link articles. Viewers can inspect articles and the graph without changing data.",
            },
            {
              title: "Ownership and deletion",
              body: "Workspace deletion is permanent. Ownership transfer asks for confirmation and makes another member the owner.",
            },
          ],
        },
        {
          eyebrow: "Articles",
          title: "Drafts, submitted articles and viewing",
          description: "PaperGraph separates the writing stage from the article version that appears on the map.",
          cards: [
            {
              title: "Drafts",
              body: "New articles start as drafts. Drafts stay in the Drafts tab and do not appear on the map until submitted.",
            },
            {
              title: "Review and Published",
              body: "Review and Published are editorial states. Both appear on the map; the label simply tells collaborators how mature the article is.",
            },
            {
              title: "Edit vs view",
              body: "Editable LaTeX articles open in the editor. Imported PDFs and viewer-only accounts open in article viewing mode.",
            },
            {
              title: "Resubmit",
              body: "After editing an article that is already on the map, changes only affect links, keywords and preview after resubmitting.",
            },
          ],
        },
        {
          eyebrow: "Editor",
          title: "LaTeX, preview and files",
          description: "The editor is for writing source text and preparing the PDF version of an article.",
          cards: [
            {
              title: "Compile PDF",
              body: "Compile refreshes the PDF preview only. It does not publish the article to the map and does not change graph relations.",
            },
            {
              title: "Submit article",
              body: "Submit sends the current version to the map, validates wikilinks, detects unlinked mentions and stores the chosen status and keywords.",
            },
            {
              title: "Uploads",
              body: "Uploaded images and PDFs belong to the article where they were uploaded. A file is inserted into the source only when you click Insert.",
            },
            {
              title: "Imported PDFs",
              body: "Imported PDFs are external documents. They appear on the map, can be linked and exported, but their internal text is not edited in PaperGraph.",
            },
          ],
        },
        {
          eyebrow: "Map",
          title: "Graph navigation and relations",
          description: "The map is the visual workspace where submitted articles become nodes.",
          cards: [
            {
              title: "Library panel",
              body: "The left library lists submitted articles. Search by title, tag or status; click an item to move the camera smoothly to that node.",
            },
            {
              title: "Zoom and focus",
              body: "Zoom follows the mouse position. Focusing an article moves the camera to it without changing the saved node position.",
            },
            {
              title: "Manual links",
              body: "Select an article, click Manual link, then click another article. Manual links stay editable from the details panel.",
            },
            {
              title: "Right click actions",
              body: "Right click a node to edit, export, remove existing relations or delete the article after confirmation.",
            },
          ],
        },
        {
          eyebrow: "Connections",
          title: "Wikilinks and unlinked mentions",
          description: "Connections can come from the source text, from suggestions or from manual graph actions.",
          cards: [
            {
              title: "Basic wikilink",
              body: "Use [[Article name]] in LaTeX to create an explicit connection to another submitted article.",
            },
            {
              title: "Visible alias",
              body: "Use [[Article name|visible text]] when the graph should link to the article, but the PDF should show only readable text.",
            },
            {
              title: "Unlinked mentions",
              body: "If an article mentions another article title without a wikilink, PaperGraph can suggest turning that mention into a real link.",
            },
            {
              title: "Citations and semantic links",
              body: "After submitting, PaperGraph can create citation links from OpenAlex and semantic links from embeddings automatically.",
            },
            {
              title: "Validation",
              body: "When submitting or resubmitting, PaperGraph checks whether wikilinks point to existing submitted articles.",
            },
          ],
        },
        {
          eyebrow: "Discovery",
          title: "Imported papers and recommendations",
          description: "External papers are useful map context, but they are not editable LaTeX projects.",
          cards: [
            {
              title: "Import a PDF",
              body: "From the map, choose Import PDFs. Files are processed one at a time, and each result shows whether it was imported, skipped as a duplicate or failed.",
            },
            {
              title: "PDF viewer mode",
              body: "Imported PDFs open in the article viewer. They can be read, linked, exported and annotated with metadata, but they do not show LaTeX history or PDF compilation controls.",
            },
            {
              title: "Related articles",
              body: "Recommendations come from OpenAlex and are ranked locally with semantic similarity when the local embedding runtime is ready.",
            },
            {
              title: "Add to map",
              body: "Adding a recommendation stores its bibliographic metadata as a published, view-only article. It is not converted into an editable LaTeX draft.",
            },
          ],
        },
        {
          eyebrow: "Semantic search",
          title: "Local embeddings and academic links",
          description: "Semantic features use the managed local runtime to compare article titles and abstracts.",
          cards: [
            {
              title: "First use",
              body: "The Windows app starts its isolated Ollama runtime and downloads the BGE-M3 model the first time semantic processing is needed. You can continue writing while it prepares.",
            },
            {
              title: "What is embedded",
              body: "PaperGraph embeds the article title and abstract, not the full PDF or LaTeX source. The resulting vector is stored with the article in the connected workspace.",
            },
            {
              title: "Academic scan",
              body: "After submission, PaperGraph can enrich metadata through OpenAlex and recalculate citation and semantic links. Missing metadata or an unavailable runtime produces a warning instead of deleting the article.",
            },
            {
              title: "When it is unavailable",
              body: "If the local runtime or network is unavailable, citation links and the rest of the workspace remain usable. Retry the semantic preparation or run the academic scan again later.",
            },
          ],
        },
        {
          eyebrow: "Recovery",
          title: "Imports, saves and conflicts",
          description: "PaperGraph keeps partial failures visible and protects shared workspaces from stale saves.",
          cards: [
            {
              title: "PDF import failures",
              body: "Invalid, empty or oversized files are rejected individually. Retryable failures can be retried without repeating successful imports; a workspace conflict stops the remaining queue.",
            },
            {
              title: "Shared workspace conflict",
              body: "If another device saves first, PaperGraph blocks the stale save instead of overwriting newer work. Reload the workspace before continuing.",
            },
            {
              title: "Model download problems",
              body: "Check the internet connection and use Try again in the semantic status panel. The model is kept locally after a successful download and is not downloaded on every launch.",
            },
            {
              title: "LaTeX errors",
              body: "Compilation errors show the source line and a contextual hint when possible. Check missing files, package names and LaTeX syntax, then compile again.",
            },
          ],
        },
        {
          eyebrow: "Collaboration",
          title: "Working with other people",
          description: "Collaboration is workspace-based, so members share the same map and articles.",
          cards: [
            {
              title: "Live editing",
              body: "When someone is editing an article, other members can see that presence before overwriting or submitting changes.",
            },
            {
              title: "Simultaneous editing",
              body: "The LaTeX editor supports collaborative text editing for members with editing access.",
            },
            {
              title: "Viewer mode",
              body: "Viewers can read PDFs, navigate the map and inspect relations, but cannot edit source, upload files or change links.",
            },
            {
              title: "Account data",
              body: "Your visible name is stored in the profile table. Deleting an account removes personal data and handles owned collaborative workspaces.",
            },
          ],
        },
      ]
    : [
        {
          eyebrow: "Workspaces",
          title: "Mapas, membros e cargos",
          description: "As workspaces mantêm artigos, ficheiros, ligações e layout do mapa separados entre si.",
          cards: [
            {
              title: "Mapas disponíveis",
              body: "A secção Workspaces lista todos os mapas que criaste ou onde foste convidado. Abrir um mapa troca os artigos, ficheiros e layout ativos.",
            },
            {
              title: "Convites",
              body: "O dono convida pessoas por email. O convite aparece quando essa pessoa entra com o mesmo endereço de email.",
            },
            {
              title: "Cargos",
              body: "O dono gere membros e workspaces. Editores podem escrever, importar e ligar artigos. Visualizadores podem ver artigos e o mapa sem alterar dados.",
            },
            {
              title: "Propriedade e eliminação",
              body: "Eliminar uma workspace é permanente. Transferir dono pede confirmação e passa a propriedade para outro membro.",
            },
          ],
        },
        {
          eyebrow: "Artigos",
          title: "Rascunhos, artigos submetidos e visualização",
          description: "O PaperGraph separa a fase de escrita da versão do artigo que aparece no mapa.",
          cards: [
            {
              title: "Rascunhos",
              body: "Artigos novos começam como rascunhos. Ficam na tab Rascunhos e não aparecem no mapa até serem submetidos.",
            },
            {
              title: "Revisão e Publicado",
              body: "Revisão e Publicado são estados editoriais. Ambos aparecem no mapa; a etiqueta só indica a maturidade do artigo.",
            },
            {
              title: "Editar vs visualizar",
              body: "Artigos LaTeX editáveis abrem no editor. PDFs importados e contas visualizadoras abrem em modo de visualização do artigo.",
            },
            {
              title: "Resubmeter",
              body: "Depois de editar um artigo que já está no mapa, as mudanças só afetam ligações, palavras-chave e preview depois de resubmeter.",
            },
          ],
        },
        {
          eyebrow: "Editor",
          title: "LaTeX, preview e ficheiros",
          description: "O editor serve para escrever o código fonte e preparar a versão PDF de um artigo.",
          cards: [
            {
              title: "Compilar PDF",
              body: "Compilar atualiza apenas a preview do PDF. Não publica o artigo no mapa e não altera as relações do grafo.",
            },
            {
              title: "Submeter artigo",
              body: "Submeter envia a versão atual para o mapa, valida wikilinks, deteta menções não ligadas e guarda o estado e as palavras-chave escolhidas.",
            },
            {
              title: "Uploads",
              body: "Imagens e PDFs carregados pertencem ao artigo onde foram enviados. Um ficheiro só entra no código quando clicas em Inserir.",
            },
            {
              title: "PDFs importados",
              body: "PDFs importados são documentos externos. Aparecem no mapa, podem ser ligados e exportados, mas o texto interno não é editado no PaperGraph.",
            },
          ],
        },
        {
          eyebrow: "Mapa",
          title: "Navegação e ligações",
          description: "O mapa é a área visual onde artigos submetidos passam a nodes.",
          cards: [
            {
              title: "Biblioteca",
              body: "A biblioteca à esquerda lista artigos submetidos. Pesquisa por título, tag ou estado; clicar num artigo move suavemente a câmara até ao node.",
            },
            {
              title: "Zoom e foco",
              body: "O zoom acompanha a posição do rato. Focar um artigo move a câmara até ele sem alterar a posição guardada do node.",
            },
            {
              title: "Ligações manuais",
              body: "Seleciona um artigo, clica em Ligação manual e depois clica noutro artigo. Ligações manuais continuam editáveis no painel de detalhes.",
            },
            {
              title: "Ações com botão direito",
              body: "Clica com o botão direito num node para editar, exportar, remover relações existentes ou eliminar o artigo depois de confirmação.",
            },
          ],
        },
        {
          eyebrow: "Conexões",
          title: "Wikilinks e menções não ligadas",
          description: "As conexões podem vir do texto fonte, de sugestões ou de ações manuais no mapa.",
          cards: [
            {
              title: "Wikilink básico",
              body: "Usa [[Nome do artigo]] no LaTeX para criar uma ligação explícita para outro artigo submetido.",
            },
            {
              title: "Alias visível",
              body: "Usa [[Nome do artigo|texto visível]] quando o mapa deve ligar ao artigo, mas o PDF deve mostrar apenas texto legível.",
            },
            {
              title: "Menções não ligadas",
              body: "Se um artigo mencionar o título de outro artigo sem wikilink, o PaperGraph pode sugerir transformar essa menção numa ligação real.",
            },
            {
              title: "Citações e semântica",
              body: "Depois de submeter, o PaperGraph pode criar automaticamente ligações por citação via OpenAlex e por similaridade semântica via embeddings.",
            },
            {
              title: "Validação",
              body: "Ao submeter ou resubmeter, o PaperGraph verifica se os wikilinks apontam para artigos submetidos existentes.",
            },
          ],
        },
        {
          eyebrow: "Descoberta",
          title: "Artigos importados e recomendações",
          description: "Artigos externos são contexto útil para o mapa, mas não são projetos LaTeX editáveis.",
          cards: [
            {
              title: "Importar um PDF",
              body: "No mapa, escolhe Importar PDFs. Os ficheiros são processados um de cada vez e cada resultado indica se foi importado, ignorado por duplicado ou se falhou.",
            },
            {
              title: "Modo de visualização",
              body: "PDFs importados abrem no visualizador do artigo. Podem ser lidos, ligados, exportados e ter metadata editada, mas não mostram histórico LaTeX nem controlos de compilação PDF.",
            },
            {
              title: "Artigos relacionados",
              body: "As recomendações vêm do OpenAlex e são ordenadas localmente por similaridade semântica quando o motor local de embeddings está pronto.",
            },
            {
              title: "Adicionar ao mapa",
              body: "Adicionar uma recomendação guarda a metadata bibliográfica como um artigo publicado e apenas para visualização. Não é convertido num rascunho LaTeX editável.",
            },
          ],
        },
        {
          eyebrow: "Pesquisa semântica",
          title: "Embeddings locais e ligações académicas",
          description: "As funcionalidades semânticas usam o motor local gerido para comparar títulos e abstracts.",
          cards: [
            {
              title: "Primeira utilização",
              body: "A aplicação Windows inicia o runtime Ollama isolado e descarrega o modelo BGE-M3 quando o processamento semântico é necessário pela primeira vez. Podes continuar a escrever enquanto prepara.",
            },
            {
              title: "O que é processado",
              body: "O PaperGraph cria embeddings do título e do abstract, não do PDF ou do código LaTeX completo. O vetor fica guardado com o artigo na workspace ligada.",
            },
            {
              title: "Análise académica",
              body: "Depois da submissão, o PaperGraph pode completar a metadata através do OpenAlex e recalcular ligações por citação e semântica. Metadata em falta ou um runtime indisponível gera um aviso sem eliminar o artigo.",
            },
            {
              title: "Quando fica indisponível",
              body: "Se o runtime local ou a rede estiverem indisponíveis, as ligações por citação e o resto da workspace continuam utilizáveis. Tenta novamente a preparação semântica ou a análise académica mais tarde.",
            },
          ],
        },
        {
          eyebrow: "Recuperação",
          title: "Importações, gravações e conflitos",
          description: "O PaperGraph mantém as falhas parciais visíveis e protege workspaces partilhadas contra gravações desatualizadas.",
          cards: [
            {
              title: "Falhas na importação",
              body: "Ficheiros inválidos, vazios ou demasiado grandes são rejeitados individualmente. Falhas recuperáveis podem ser repetidas sem repetir importações bem-sucedidas; um conflito interrompe a fila restante.",
            },
            {
              title: "Conflito numa workspace",
              body: "Se outro dispositivo guardar primeiro, o PaperGraph bloqueia a gravação desatualizada em vez de apagar trabalho mais recente. Recarrega a workspace antes de continuar.",
            },
            {
              title: "Problemas no download do modelo",
              body: "Confirma a ligação à Internet e usa Tentar novamente no painel de estado semântico. Depois de descarregado, o modelo fica guardado localmente e não é transferido em cada arranque.",
            },
            {
              title: "Erros LaTeX",
              body: "Os erros de compilação mostram a linha do código e uma sugestão contextual quando possível. Confirma ficheiros em falta, nomes de pacotes e sintaxe LaTeX, e compila novamente.",
            },
          ],
        },
        {
          eyebrow: "Colaboração",
          title: "Trabalhar com outras pessoas",
          description: "A colaboração é feita por workspace, por isso os membros partilham o mesmo mapa e os mesmos artigos.",
          cards: [
            {
              title: "Edição em tempo real",
              body: "Quando alguém está a editar um artigo, os outros membros conseguem ver essa presença antes de sobrescrever ou submeter alterações.",
            },
            {
              title: "Edição simultânea",
              body: "O editor LaTeX suporta edição colaborativa de texto para membros com acesso de editor.",
            },
            {
              title: "Modo visualizador",
              body: "Visualizadores podem ler PDFs, navegar no mapa e consultar relações, mas não podem editar código, carregar ficheiros ou alterar ligações.",
            },
            {
              title: "Dados da conta",
              body: "O nome visível fica guardado na tabela de perfil. Eliminar a conta remove dados pessoais e trata workspaces colaborativas onde és dono.",
            },
          ],
        },
      ];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
          {isEnglish ? "Help" : "Ajuda"}
        </p>
        <h2 className="mt-2 text-xl font-semibold text-[var(--foreground)]">
          {isEnglish ? "PaperGraph guide" : "Guia do PaperGraph"}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
          {isEnglish
            ? "A practical reference for the main workflows: writing articles, building the map, collaborating and managing data."
            : "Uma referência prática para os fluxos principais: escrever artigos, construir o mapa, colaborar e gerir dados."}
        </p>
      </div>

      <section className="rounded-[24px] border border-[var(--border)] bg-black/15 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
              {isEnglish ? "Start here" : "Começa aqui"}
            </p>
            <h3 className="mt-2 text-lg font-semibold text-[var(--foreground)]">
              {isEnglish ? "First useful path" : "Primeiro caminho útil"}
            </h3>
          </div>
          <span className="rounded-full border border-[var(--border)] bg-white/5 px-3 py-1 text-xs font-semibold text-[var(--muted)]">
            {isEnglish ? "3 steps" : "3 passos"}
          </span>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {quickSteps.map((step, index) => (
            <article key={step.title} className="rounded-[20px] border border-[var(--border)] bg-white/[0.03] p-4">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--accent)] bg-[rgba(142,231,255,0.12)] text-xs font-semibold text-[var(--accent)]">
                {index + 1}
              </span>
              <h4 className="mt-3 text-sm font-semibold text-[var(--foreground)]">{step.title}</h4>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      {helpGroups.map((group) => (
        <section key={group.title} className="rounded-[24px] border border-[var(--border)] bg-black/15 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{group.eyebrow}</p>
          <h3 className="mt-2 text-lg font-semibold text-[var(--foreground)]">{group.title}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">{group.description}</p>

          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {group.cards.map((card) => (
              <article key={card.title} className="rounded-[18px] border border-[var(--border)] bg-white/[0.03] p-4">
                <h4 className="text-sm font-semibold text-[var(--foreground)]">{card.title}</h4>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{card.body}</p>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function formatInviteStatus(status: WorkspaceInvite["status"], language: AppLanguage) {
  if (status === "accepted") {
    return language === "en" ? "Accepted" : "Aceite";
  }

  if (status === "revoked") {
    return language === "en" ? "Revoked" : "Revogado";
  }

  return language === "en" ? "Pending" : "Pendente";
}

function getDisplayInitials(value: string | null | undefined) {
  const normalizedValue = normalizeDisplayName(value ?? "");

  if (!normalizedValue) {
    return "PG";
  }

  const initials = normalizedValue
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return initials.toUpperCase();
}

function isWorkspacePresence(value: unknown): value is WorkspacePresence {
  if (!value || typeof value !== "object") {
    return false;
  }

  const presence = value as Partial<WorkspacePresence>;

  return (
    typeof presence.clientId === "string" &&
    typeof presence.userId === "string" &&
    typeof presence.userName === "string" &&
    typeof presence.tab === "string" &&
    typeof presence.mode === "string"
  );
}

function flattenPresenceState(presenceState: Record<string, unknown>, currentClientId: string) {
  const presenceByClientId = new Map<string, WorkspacePresence>();

  Object.values(presenceState).forEach((presenceItems) => {
    if (!Array.isArray(presenceItems)) {
      return;
    }

    presenceItems.forEach((presenceItem) => {
      if (!isWorkspacePresence(presenceItem) || presenceItem.clientId === currentClientId) {
        return;
      }

      presenceByClientId.set(presenceItem.clientId, presenceItem);
    });
  });

  return [...presenceByClientId.values()].sort((firstPresence, secondPresence) =>
    firstPresence.userName.localeCompare(secondPresence.userName),
  );
}

function getPresenceModeLabel(mode: WorkspacePresenceMode, language: AppLanguage) {
  switch (mode) {
    case "editing":
      return language === "en" ? "Editing" : "A editar";
    case "viewing":
      return language === "en" ? "Viewing" : "A visualizar";
    case "settings":
      return language === "en" ? "Settings" : "Definições";
    case "browsing":
      return language === "en" ? "Browsing" : "A navegar";
  }
}

function createBrowserUuid() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hexBytes = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));

  return [
    hexBytes.slice(0, 4).join(""),
    hexBytes.slice(4, 6).join(""),
    hexBytes.slice(6, 8).join(""),
    hexBytes.slice(8, 10).join(""),
    hexBytes.slice(10, 16).join(""),
  ].join("-");
}

function createPresenceClientId() {
  return createBrowserUuid();
}

function relationPairKey(fromArticleId: string, toArticleId: string) {
  return [fromArticleId, toArticleId].sort().join("::");
}

function unlinkedMentionKey(sourceArticleId: string, targetArticleId: string) {
  return `${sourceArticleId}->${targetArticleId}`;
}

function unlinkedMentionToastKey(articleId: string, mentions: UnlinkedMention[]) {
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

function extractArxivIdsFromText(value: string) {
  const matches = value.match(/\b(?:arxiv:)?\d{4}\.\d{4,5}(?:v\d+)?\b/gi) ?? [];

  return Array.from(
    new Set(
      matches
        .map((match) => match.replace(/^arxiv:/i, "").replace(/v\d+$/i, "").toLowerCase())
        .filter(Boolean),
    ),
  );
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

function findUnlinkedMentions(
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

function replaceFirstUnlinkedTitleMention(source: string, targetTitle: string) {
  const firstMention = findUnlinkedTitleMentions(source, targetTitle)[0];

  if (!firstMention) {
    return source;
  }

  return `${source.slice(0, firstMention.index)}[[${targetTitle}]]${source.slice(
    firstMention.index + firstMention[0].length,
  )}`;
}

function stripExplicitWikilinksToTarget(source: string, targetTitle: string) {
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

function validateExplicitLinkTargets(workspaceArticles: WorkspaceArticle[], language: AppLanguage = "pt") {
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

function isSubmittedArticle(article: WorkspaceArticle): article is WorkspaceArticle & { status: SubmittedArticleStatus } {
  return article.status !== "Draft";
}

function isImportedPdfArticle(article: { source?: string; tags: string[] }) {
  const normalizedTags = article.tags.map((tag) => tag.toLowerCase());

  return (
    article.source?.includes("papergraph-import-text:") === true ||
    article.source?.includes("\\includepdf") === true ||
    (normalizedTags.includes("pdf") && (normalizedTags.includes("importado") || normalizedTags.includes("imported")))
  );
}

function articleUsesImageAsset(article: WorkspaceArticle, imageAsset: WorkspaceImageAsset) {
  return article.source.includes(imageAsset.storedName) || article.source.includes(imageAsset.originalName);
}

function getTitleFromPdfFileName(fileName: string, language: AppLanguage = "pt") {
  return fileName
    .replace(/\.[^/.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || (language === "en" ? "Imported PDF" : "PDF importado");
}

function getSafePdfDownloadName(title: string) {
  const safeName =
    title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "papergraph-artigo";

  return `${safeName}.pdf`;
}

function encodeImportedPdfText(value: string) {
  if (!value.trim()) {
    return null;
  }

  return btoa(unescape(encodeURIComponent(value.trim().slice(0, 12000))));
}

async function extractPdfTextForAcademicRelations(pdfFile: File) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await pdfFile.arrayBuffer()) });
  try {
    const pdfDocument = await loadingTask.promise;
    const pageTexts: string[] = [];
    let title: string | null = null;
    for (let pageNumber = 1; pageNumber <= Math.min(pdfDocument.numPages, 3); pageNumber++) {
      const page = await pdfDocument.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.filter((item): item is PdfTextItem & typeof item => "str" in item);
      if (pageNumber === 1) title = titleFromPdfItems(items);
      pageTexts.push(items.map((item) => item.str + (item.hasEOL ? "\n" : " ")).join(""));
    }
    const text = pageTexts.join("\n\f\n").slice(0, 12000);
    return { text, metadata: extractPdfMetadata(text, title) };
  } finally {
    await loadingTask.destroy();
  }
}

function createImportedPdfSource(pdfAsset: WorkspaceImageAsset, academicText?: string, metadata?: PdfMetadata) {
  const encodedAcademicText = encodeImportedPdfText(academicText ?? "");

  return [
    "\\documentclass[12pt]{article}",
    "\\usepackage{pdfpages}",
    encodedAcademicText ? `% papergraph-import-text:${encodedAcademicText}` : "",
    metadata ? `% papergraph-import-metadata:${btoa(unescape(encodeURIComponent(JSON.stringify(metadata))))}` : "",
    "\\begin{document}",
    "\\includepdf[",
    "    pages=-,",
    "    pagecommand={\\thispagestyle{empty}}",
    `]{papergraph-images/${pdfAsset.storedName}}`,
    "\\end{document}",
  ].filter(Boolean).join("\n");
}

function createFallbackPositions(workspaceArticles: WorkspaceArticle[]) {
  const fallbackPositions: Record<string, ArticlePosition> = {};
  const totalArticles = Math.max(workspaceArticles.length, 1);

  workspaceArticles.forEach((article, index) => {
    const angle = (index / totalArticles) * Math.PI * 2;
    const radius = 18 + index * 5;

    fallbackPositions[article.id] = {
      x: clamp(50 + Math.cos(angle) * radius, 10, 90),
      y: clamp(50 + Math.sin(angle) * radius, 10, 90),
    };
  });

  return fallbackPositions;
}

function spreadOverlappingPositions(
  workspaceArticles: WorkspaceArticle[],
  positions: Record<string, ArticlePosition>,
) {
  const nextPositions: Record<string, ArticlePosition> = { ...positions };
  const buckets = new Map<string, WorkspaceArticle[]>();

  workspaceArticles.forEach((article) => {
    const position = nextPositions[article.id];

    if (!position) {
      return;
    }

    const key = `${position.x.toFixed(1)}::${position.y.toFixed(1)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), article]);
  });

  buckets.forEach((bucket) => {
    if (bucket.length < 2) {
      return;
    }

    const basePosition = nextPositions[bucket[0].id];
    const centerX = clamp(basePosition.x, 28, 72);
    const centerY = clamp(basePosition.y, 28, 72);
    const radius = 18 + bucket.length * 3;

    bucket.forEach((article, index) => {
      const angle = (index / bucket.length) * Math.PI * 2;

      nextPositions[article.id] = {
        x: clamp(centerX + Math.cos(angle) * radius, 8, 92),
        y: clamp(centerY + Math.sin(angle) * radius, 8, 92),
      };
    });
  });

  return nextPositions;
}

function calculateNextArticlePosition(workspaceArticles: WorkspaceArticle[]) {
  const totalArticles = workspaceArticles.length + 1;
  const angle = (totalArticles / Math.max(totalArticles, 6)) * Math.PI * 2;
  const radius = 18 + totalArticles * 4;

  return {
    x: clamp(50 + Math.cos(angle) * radius, 10, 90),
    y: clamp(50 + Math.sin(angle) * radius, 10, 90),
  };
}

function roundPositionValue(value: number) {
  return Math.round(clamp(value, 2, 98) * 10) / 10;
}

function normalizeArticlePositionsForArticles(
  workspaceArticles: WorkspaceArticle[],
  positions: Record<string, ArticlePosition>,
) {
  const articleIds = new Set(workspaceArticles.map((article) => article.id));
  const nextPositions: Record<string, ArticlePosition> = {};

  Object.entries(positions).forEach(([articleId, position]) => {
    if (
      !articleIds.has(articleId) ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    ) {
      return;
    }

    nextPositions[articleId] = {
      x: roundPositionValue(position.x),
      y: roundPositionValue(position.y),
    };
  });

  return nextPositions;
}

function rebuildExplicitRelations(
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

function mergeAcademicRelations(
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

function mergeArticlePositions(
  workspaceArticles: WorkspaceArticle[],
  currentPositions: Record<string, ArticlePosition> | undefined,
  nextArticleId?: string,
) {
  const basePositions = currentPositions ?? {};
  const mergedPositions: Record<string, ArticlePosition> = { ...basePositions };
  const fallbackPositions = createFallbackPositions(workspaceArticles);

  workspaceArticles.forEach((article) => {
    if (!mergedPositions[article.id]) {
      mergedPositions[article.id] = fallbackPositions[article.id];
    }
  });

  if (nextArticleId && !mergedPositions[nextArticleId]) {
    mergedPositions[nextArticleId] = calculateNextArticlePosition(workspaceArticles);
  }

  return normalizeArticlePositionsForArticles(
    workspaceArticles,
    spreadOverlappingPositions(workspaceArticles, mergedPositions),
  );
}

export default function Home() {
  const [workspace, setWorkspaceState] = useState<WorkspaceSnapshot>(defaultSnapshot);
  const setWorkspace = useCallback((snapshot: WorkspaceSnapshot) => {
    setWorkspaceState((previous) => ({ ...snapshot,
      persistenceSession: snapshot.persistenceSession === undefined ? previous.persistenceSession : snapshot.persistenceSession,
    }));
  }, []);
  const [workspaceRecovery, setWorkspaceRecovery] = useState<{ workspaceId: string; snapshot: WorkspaceSnapshot } | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState(defaultSnapshot.selectedArticleId);
  const [graphSelectedArticleId, setGraphSelectedArticleId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(() => getStoredWorkspaceUiState(null).activeTab ?? "graph");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [appLanguage, setAppLanguage] = useState<AppLanguage>(() => {
    if (typeof window === "undefined") {
      return "pt";
    }

    const savedLanguage = window.localStorage.getItem("papergraph-language");

    return savedLanguage === "pt" || savedLanguage === "en" ? savedLanguage : "pt";
  });
  const [appTheme, setAppTheme] = useState<AppTheme>(() => {
    if (typeof window === "undefined") {
      return "dark";
    }

    const savedTheme = window.localStorage.getItem("papergraph-theme");

    return savedTheme === "light" ? "light" : "dark";
  });
  const [pendingEditorResubmission, setPendingEditorResubmission] = useState<PendingEditorResubmission | null>(null);
  const [restoredEditorVersion, setRestoredEditorVersion] = useState<WorkspaceArticleVersion | null>(null);
  const [pendingEditorNavigation, setPendingEditorNavigation] = useState<PendingEditorNavigation | null>(null);
  const [appDialog, setAppDialog] = useState<AppDialogState | null>(null);
  const [appDialogValue, setAppDialogValue] = useState("");
  const [isArticleSubmissionRunning, setIsArticleSubmissionRunning] = useState(false);
  const [isAcademicRelationsRunning, setIsAcademicRelationsRunning] = useState(false);
  const [connectionValidationError, setConnectionValidationError] = useState<string | null>(null);
  const [dismissedUnlinkedToastKey, setDismissedUnlinkedToastKey] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("sign-in");
  const [authName, setAuthName] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState<string | null>(null);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authAccessToken, setAuthAccessToken] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isAccountDeletionRunning, setIsAccountDeletionRunning] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [accountWorkspace, setAccountWorkspace] = useState<AccountWorkspace | null>(null);
  const [accountWorkspaces, setAccountWorkspaces] = useState<AccountWorkspace[]>([]);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [isWorkspaceActionRunning, setIsWorkspaceActionRunning] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [workspaceInvites, setWorkspaceInvites] = useState<WorkspaceInvite[]>([]);
  const [pendingWorkspaceInvites, setPendingWorkspaceInvites] = useState<WorkspaceInvite[]>([]);
  const [workspaceInviteEmail, setWorkspaceInviteEmail] = useState("");
  const [workspaceInviteRole, setWorkspaceInviteRole] = useState<EditableWorkspaceMemberRole>("editor");
  const [isInviteActionRunning, setIsInviteActionRunning] = useState(false);
  const [memberActionUserId, setMemberActionUserId] = useState<string | null>(null);
  const [memberActionKind, setMemberActionKind] = useState<"remove" | "role" | "transfer" | null>(null);
  const [workspacePresence, setWorkspacePresence] = useState<WorkspacePresence[]>([]);
  const [editorSelection, setEditorSelection] = useState<{ articleId: string; end: number; start: number } | null>(
    null,
  );
  const saveRequestIdRef = useRef(0);
  const saveQueueRef = useRef(Promise.resolve());
  const isEnglish = appLanguage === "en";
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [presenceClientId] = useState(createPresenceClientId);
  const presenceChannelRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);
  const currentPresencePayloadRef = useRef<WorkspacePresence | null>(null);
  const presenceLocationKeyRef = useRef<string | null>(null);
  const presenceEnteredAtRef = useRef<string>(new Date().toISOString());
  const appDialogResolverRef = useRef<((result: AppDialogResult) => void) | null>(null);

  const openAppDialog = useCallback((dialog: AppDialogState) => {
    appDialogResolverRef.current?.({ confirmed: false });
    setAppDialog(dialog);
    setAppDialogValue(dialog.inputDefaultValue ?? "");

    return new Promise<AppDialogResult>((resolve) => {
      appDialogResolverRef.current = resolve;
    });
  }, []);

  const closeAppDialog = useCallback((result: AppDialogResult) => {
    appDialogResolverRef.current?.(result);
    appDialogResolverRef.current = null;
    setAppDialog(null);
    setAppDialogValue("");
  }, []);

  const requestAppConfirm = useCallback(
    async (dialog: Omit<AppDialogState, "kind">) => {
      const result = await openAppDialog({ ...dialog, kind: "confirm" });
      return result.confirmed;
    },
    [openAppDialog],
  );

  const requestAppPrompt = useCallback(
    async (dialog: Omit<AppDialogState, "kind">) => {
      const result = await openAppDialog({ ...dialog, kind: "prompt" });
      return result.confirmed ? result.value ?? "" : null;
    },
    [openAppDialog],
  );

  const requestAppAlert = useCallback(
    async (dialog: Omit<AppDialogState, "kind">) => {
      await openAppDialog({ ...dialog, kind: "alert" });
    },
    [openAppDialog],
  );

  useEffect(() => {
    return () => {
      appDialogResolverRef.current?.({ confirmed: false });
      appDialogResolverRef.current = null;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("papergraph-language", appLanguage);
    window.dispatchEvent(new Event("papergraph-language-changed"));
  }, [appLanguage]);

  useEffect(() => {
    window.localStorage.setItem("papergraph-theme", appTheme);
    document.documentElement.dataset.papergraphTheme = appTheme;

    return () => {
      delete document.documentElement.dataset.papergraphTheme;
    };
  }, [appTheme]);

  const applyWorkspaceSnapshot = useCallback((
    snapshot: WorkspaceSnapshot,
    workspaceId: string | null = null,
    restoreUiState = true,
  ) => {
    const storedUiState = restoreUiState ? getStoredWorkspaceUiState(workspaceId) : {};
    const storedSelectedArticle = storedUiState.selectedArticleId
      ? snapshot.articles.find((article) => article.id === storedUiState.selectedArticleId) ?? null
      : null;
    const snapshotSelectedArticle = snapshot.selectedArticleId
      ? snapshot.articles.find((article) => article.id === snapshot.selectedArticleId) ?? null
      : null;
    const selectedArticle = storedSelectedArticle ?? snapshotSelectedArticle;
    const storedGraphSelectedArticle =
      storedUiState.graphSelectedArticleId === undefined || storedUiState.graphSelectedArticleId === null
        ? null
        : snapshot.articles.find(
            (article) => article.id === storedUiState.graphSelectedArticleId && isSubmittedArticle(article),
          ) ?? null;
    const normalizedSnapshot = {
      ...snapshot,
      selectedArticleId: selectedArticle?.id ?? "",
    };

    setWorkspace(normalizedSnapshot);
    setSelectedArticleId(normalizedSnapshot.selectedArticleId);
    setGraphSelectedArticleId(storedGraphSelectedArticle?.id ?? null);
    setEditorSelection(null);

    if (restoreUiState && storedUiState.activeTab) {
      setActiveTab(storedUiState.activeTab);
    }
  }, [setWorkspace]);

  const mirrorWorkspaceLocally = useCallback(async (snapshot: WorkspaceSnapshot) => {
    const response = await fetch(apiPath, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(snapshot),
    });
    if (!response.ok) throw new Error("Could not preserve local workspace copy.");
  }, []);

  const loadCloudWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!supabase) {
        return;
      }

      setLoadError(null);

      try {
        const snapshot = await loadWorkspaceSnapshotFromSupabase(supabase, workspaceId);
        applyWorkspaceSnapshot(snapshot, workspaceId);
        await mirrorWorkspaceLocally(snapshot);
      } catch (error) {
        setLoadError(
          getFriendlyErrorMessage(error, appLanguage, {
            context: "workspace",
            fallback: isEnglish ? "Could not load the cloud workspace." : "Não foi possível carregar a workspace cloud.",
          }),
        );
      }
    },
    [appLanguage, applyWorkspaceSnapshot, isEnglish, mirrorWorkspaceLocally, supabase],
  );

  const loadAuthProfile = useCallback(
    async (currentUser: User | null) => {
      if (!supabase || !currentUser) {
        setAuthDisplayName(null);
        return;
      }

      const fallbackDisplayName = getAuthUserFallbackDisplayName(currentUser);
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", currentUser.id)
        .maybeSingle();
      const profile = data as UserProfileRow | null;

      if (error) {
        setAuthDisplayName(fallbackDisplayName);
        setProfileNameDraft(fallbackDisplayName ?? "");
        return;
      }

      const nextDisplayName = normalizeDisplayName(profile?.display_name ?? "") || fallbackDisplayName;
      setAuthDisplayName(nextDisplayName);
      setProfileNameDraft(nextDisplayName ?? "");
    },
    [supabase],
  );

  const saveAuthProfileDisplayName = useCallback(
    async (currentUser: User, displayName: string) => {
      if (!supabase) {
        return;
      }

      const normalizedDisplayName = normalizeDisplayName(displayName);

      if (!normalizedDisplayName) {
        return;
      }

      const { error } = await supabase.from("profiles").upsert(
        {
          id: currentUser.id,
          display_name: normalizedDisplayName,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

      if (error) {
        throw error;
      }

      setAuthDisplayName(normalizedDisplayName);
      setProfileNameDraft(normalizedDisplayName);
    },
    [supabase],
  );

  const loadWorkspaceCollaboration = useCallback(
    async (currentWorkspace: AccountWorkspace | null) => {
      if (!supabase) {
        setWorkspaceMembers([]);
        setWorkspaceInvites([]);
        setPendingWorkspaceInvites([]);
        setWorkspacePresence([]);
        setEditorSelection(null);
        return;
      }

      try {
        const [pendingInvites, members, invites] = await Promise.all([
          listMyPendingWorkspaceInvitesFromSupabase(supabase),
          currentWorkspace
            ? listWorkspaceMembersFromSupabase(supabase, currentWorkspace.id)
            : Promise.resolve([]),
          currentWorkspace?.role === "owner"
            ? listWorkspaceInvitesFromSupabase(supabase, currentWorkspace.id)
            : Promise.resolve([]),
        ]);

        setPendingWorkspaceInvites(pendingInvites);
        setWorkspaceMembers(members);
        setWorkspaceInvites(invites);
      } catch (error) {
        setWorkspaceMembers([]);
        setWorkspaceInvites([]);
        setPendingWorkspaceInvites([]);
        setAuthError(
          getFriendlyErrorMessage(error, appLanguage, {
            context: "workspace",
            fallback: isEnglish
              ? "Could not load workspace collaboration data."
              : "Não foi possível carregar os dados de colaboração da workspace.",
          }),
        );
      }
    },
    [appLanguage, isEnglish, supabase],
  );

  const syncAccountWorkspace = useCallback(
    async (currentUser: User | null, preferredWorkspaceId?: string | null) => {
      if (!supabase || !currentUser) {
        setAccountWorkspace(null);
        setAccountWorkspaces([]);
        setWorkspaceMembers([]);
        setWorkspaceInvites([]);
        setPendingWorkspaceInvites([]);
        setWorkspacePresence([]);
        setEditorSelection(null);
        return;
      }

      setAuthStatus(isEnglish ? "Preparing cloud workspace..." : "A preparar workspace cloud...");
      setAuthError(null);

      try {
        const loadedWorkspacesBeforeEnsure = await listUserWorkspacesFromSupabase(supabase);
        const shouldCreateInitialWorkspace =
          loadedWorkspacesBeforeEnsure.length === 0 && !shouldKeepWorkspacesEmpty(currentUser.id);
        const ensuredWorkspace = shouldCreateInitialWorkspace ? await ensureUserWorkspace(supabase) : null;
        const loadedWorkspaces = ensuredWorkspace
          ? await listUserWorkspacesFromSupabase(supabase)
          : loadedWorkspacesBeforeEnsure;
        const nextWorkspaces =
          ensuredWorkspace && !loadedWorkspaces.some((workspaceItem) => workspaceItem.id === ensuredWorkspace.id)
            ? [ensuredWorkspace, ...loadedWorkspaces]
            : loadedWorkspaces;
        const storedWorkspaceId = preferredWorkspaceId ?? getStoredActiveWorkspaceId();
        const nextAccountWorkspace =
          nextWorkspaces.find((workspaceItem) => workspaceItem.id === storedWorkspaceId) ??
          nextWorkspaces[0] ??
          ensuredWorkspace;

        if (!nextAccountWorkspace) {
          setAccountWorkspace(null);
          setAccountWorkspaces(nextWorkspaces);
          rememberActiveWorkspaceId(null);
          applyWorkspaceSnapshot(defaultSnapshot, null, false);
          setSettingsSection("workspaces");
          setActiveTab("settings");
          rememberWorkspaceUiState(null, { activeTab: "settings", graphSelectedArticleId: null });
          await loadAuthProfile(currentUser);
          await loadWorkspaceCollaboration(null);
          setAuthStatus(isEnglish ? "Account connected." : "Conta ligada.");
          return;
        }

        setAccountWorkspaces(nextWorkspaces);
        setAccountWorkspace(nextAccountWorkspace);
        rememberShouldKeepWorkspacesEmpty(currentUser.id, false);
        rememberActiveWorkspaceId(nextAccountWorkspace.id);
        await loadAuthProfile(currentUser);
        await loadCloudWorkspace(nextAccountWorkspace.id);
        await loadWorkspaceCollaboration(nextAccountWorkspace);
        setAuthStatus(null);
      } catch (error) {
        setAccountWorkspace(null);
        setAccountWorkspaces([]);
        setAuthStatus(null);
        setAuthError(
          isEnglish
            ? `Account connected, but the cloud workspace could not be prepared: ${getFriendlyErrorMessage(error, appLanguage, {
                context: "workspace",
                fallback: "Run supabase/bootstrap-workspace.sql in the SQL Editor.",
              })}`
            : `Conta ligada, mas não foi possível preparar a workspace cloud: ${getFriendlyErrorMessage(error, appLanguage, {
                context: "workspace",
                fallback: "Corre supabase/bootstrap-workspace.sql no SQL Editor.",
              })}`,
        );
      }
    },
    [appLanguage, applyWorkspaceSnapshot, isEnglish, loadAuthProfile, loadCloudWorkspace, loadWorkspaceCollaboration, supabase],
  );

  useEffect(() => {
    if (!supabase) {
      return undefined;
    }

    let isMounted = true;
    const sessionCheckTimeout = window.setTimeout(() => {
      if (isMounted) {
        setIsAuthLoading(false);
      }
    }, 1800);

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!isMounted) {
          return;
        }

        window.clearTimeout(sessionCheckTimeout);
        const currentUser = data.session?.user ?? null;
        setAuthUser(currentUser);
        setAuthAccessToken(data.session?.access_token ?? null);
        setIsAuthLoading(false);

        if (currentUser) {
          void syncAccountWorkspace(currentUser);
        }
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        window.clearTimeout(sessionCheckTimeout);
        setIsAuthLoading(false);
        setAuthError(
          getFriendlyErrorMessage(error, appLanguage, {
            context: "auth",
            fallback: isEnglish ? "Could not check the saved session." : "Não foi possível confirmar a sessão guardada.",
          }),
        );
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null;

      setAuthUser(currentUser);
      setAuthAccessToken(session?.access_token ?? null);
      setIsAuthLoading(false);

      if (currentUser) {
        void syncAccountWorkspace(currentUser);
        return;
      }

      setAccountWorkspace(null);
      setAccountWorkspaces([]);
      setWorkspaceMembers([]);
      setWorkspaceInvites([]);
      setPendingWorkspaceInvites([]);
      setWorkspacePresence([]);
      setEditorSelection(null);
      setWorkspaceInviteEmail("");
      setWorkspaceInviteRole("editor");
      rememberActiveWorkspaceId(null);
      setAuthDisplayName(null);
      setNewWorkspaceName("");
      setProfileNameDraft("");
      setAuthStatus(null);
    });

    return () => {
      isMounted = false;
      window.clearTimeout(sessionCheckTimeout);
      listener.subscription.unsubscribe();
    };
  }, [appLanguage, isEnglish, supabase, syncAccountWorkspace]);

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setAuthError(
        isEnglish
          ? "Supabase is not configured. Check .env.local."
          : "O Supabase não está configurado. Confirma o .env.local.",
      );
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);
    setAuthStatus(null);

    try {
      const normalizedAuthName = normalizeDisplayName(authName);

      if (authMode === "sign-up" && normalizedAuthName.length < 2) {
        throw new Error(isEnglish ? "Write your name to create the account." : "Escreve o teu nome para criar a conta.");
      }

      const credentials = {
        email: authEmail.trim(),
        password: authPassword,
      };
      const emailConfirmationUrl =
        process.env.NEXT_PUBLIC_AUTH_CONFIRMATION_URL ??
        (typeof window === "undefined" ? undefined : window.location.origin);
      const result =
        authMode === "sign-in"
          ? await supabase.auth.signInWithPassword(credentials)
          : await supabase.auth.signUp({
              ...credentials,
              options: {
                data: {
                  display_name: normalizedAuthName,
                  full_name: normalizedAuthName,
                  name: normalizedAuthName,
                },
                emailRedirectTo: emailConfirmationUrl,
              },
            });

      if (result.error) {
        throw result.error;
      }

      const nextUser = result.data.session?.user ?? null;
      setAuthUser(nextUser);
      setAuthAccessToken(result.data.session?.access_token ?? null);
      setAuthPassword("");

      if (nextUser) {
        await syncAccountWorkspace(nextUser);

        if (authMode === "sign-up") {
          await saveAuthProfileDisplayName(nextUser, normalizedAuthName);
          setAuthName("");
        }
      }

      if (authMode === "sign-up" && !result.data.session) {
        setAuthName("");
        setAuthStatus(
          isEnglish
            ? "Account created. Check your email to confirm the login."
            : "Conta criada. Confirma o login no teu email.",
        );
      }
    } catch (error) {
      setAuthError(
        getFriendlyErrorMessage(error, appLanguage, {
          context: "auth",
          fallback: isEnglish ? "Authentication failed." : "A autenticação falhou.",
        }),
      );
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handleProfileNameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!authUser) {
      return;
    }

    const normalizedProfileName = normalizeDisplayName(profileNameDraft);

    if (normalizedProfileName.length < 2) {
      setAuthError(isEnglish ? "Write a display name." : "Escreve um nome visível.");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);
    setAuthStatus(null);

    try {
      await saveAuthProfileDisplayName(authUser, normalizedProfileName);
      setAuthStatus(isEnglish ? "Profile name saved." : "Nome de perfil guardado.");
    } catch (error) {
      setAuthError(
        getFriendlyErrorMessage(error, appLanguage, {
          context: "auth",
          fallback: isEnglish ? "Could not save the profile name." : "Não foi possível guardar o nome de perfil.",
        }),
      );
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  function clearAccountSessionState(nextStatus: string) {
    setAuthUser(null);
    setAuthAccessToken(null);
    setAuthDisplayName(null);
    setAuthName("");
    setProfileNameDraft("");
    setAccountWorkspace(null);
    setAccountWorkspaces([]);
    setNewWorkspaceName("");
    setWorkspaceMembers([]);
    setWorkspaceInvites([]);
    setPendingWorkspaceInvites([]);
    setWorkspacePresence([]);
    setEditorSelection(null);
    setWorkspaceInviteEmail("");
    setPendingEditorNavigation(null);
    setPendingEditorResubmission(null);
    setRestoredEditorVersion(null);
    setConnectionValidationError(null);
    rememberActiveWorkspaceId(null);
    applyWorkspaceSnapshot(defaultSnapshot, null, false);
    setAuthStatus(nextStatus);
  }

  async function handleSignOut() {
    if (!supabase) {
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);

    const { error } = await supabase.auth.signOut();

    if (error) {
      setAuthError(
        getFriendlyErrorMessage(error, appLanguage, {
          context: "auth",
          fallback: isEnglish ? "Could not sign out." : "Não foi possível terminar sessão.",
        }),
      );
    } else {
      setAuthUser(null);
      setAuthAccessToken(null);
      setAuthDisplayName(null);
      setAuthName("");
      setProfileNameDraft("");
      setAccountWorkspace(null);
      setAccountWorkspaces([]);
      setNewWorkspaceName("");
      setWorkspaceMembers([]);
      setWorkspaceInvites([]);
      setPendingWorkspaceInvites([]);
      setWorkspacePresence([]);
      setEditorSelection(null);
      setWorkspaceInviteEmail("");
      setPendingEditorNavigation(null);
      setPendingEditorResubmission(null);
      setRestoredEditorVersion(null);
      rememberActiveWorkspaceId(null);
      applyWorkspaceSnapshot(defaultSnapshot, null, false);
      setAuthStatus(isEnglish ? "Signed out." : "Sessão terminada.");
    }

    setIsAuthSubmitting(false);
  }

  async function handleDeleteAccount() {
    if (!supabase || !authUser || !authAccessToken) {
      setAuthError(isEnglish ? "Sign in before deleting the account." : "Inicia sessão antes de eliminar a conta.");
      return;
    }

    const accountDeletionConfirmation = isEnglish ? "CONFIRM" : "CONFIRMAR";
    const confirmation = await requestAppPrompt({
      body: isEnglish
        ? "This permanently deletes your account. Workspaces where you are the only owner are deleted with their articles, links, PDFs and images. If you own a collaborative workspace, ownership is transferred to the oldest member. In workspaces owned by others, you are removed from the member list."
        : "Isto elimina permanentemente a tua conta. Workspaces onde és o único dono são apagadas com os respetivos artigos, ligações, PDFs e imagens. Se fores dono de uma workspace colaborativa, a propriedade passa para o membro mais antigo. Em workspaces de outras pessoas, desapareces da lista de membros.",
      cancelLabel: isEnglish ? "Cancel" : "Cancelar",
      confirmationValue: accountDeletionConfirmation,
      confirmLabel: isEnglish ? "Delete account" : "Eliminar conta",
      eyebrow: isEnglish ? "Danger zone" : "Zona de perigo",
      inputLabel: isEnglish ? "Confirmation" : "Confirmação",
      title: isEnglish ? "Delete your account?" : "Eliminar a tua conta?",
      tone: "danger",
    });

    if (confirmation !== accountDeletionConfirmation) {
      return;
    }

    setIsAccountDeletionRunning(true);
    setAuthError(null);
    setAuthStatus(isEnglish ? "Deleting account..." : "A eliminar conta...");

    try {
      const response = await fetch("/api/account/delete", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${authAccessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(
          await getFriendlyResponseError(response, appLanguage, {
            context: "delete",
            fallback: isEnglish ? "Could not delete the account." : "Não foi possível eliminar a conta.",
          }),
        );
      }

      await supabase.auth.signOut().catch(() => undefined);
      clearAccountSessionState(isEnglish ? "Account deleted." : "Conta eliminada.");
      setAuthEmail("");
      setAuthPassword("");
    } catch (error) {
      setAuthError(
        getFriendlyErrorMessage(error, appLanguage, {
          context: "delete",
          fallback: isEnglish ? "Could not delete the account." : "Não foi possível eliminar a conta.",
        }),
      );
      setAuthStatus(null);
    } finally {
      setIsAccountDeletionRunning(false);
    }
  }

  useEffect(() => {
    if (supabase) {
      return undefined;
    }

    const controller = new AbortController();

    async function loadWorkspace() {
      try {
        const response = await fetch(apiPath, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(
            await getFriendlyResponseError(response, appLanguage, {
              context: "workspace",
              fallback: isEnglish ? "Could not load the workspace state." : "Não foi possível carregar a workspace.",
            }),
          );
        }

        const snapshot = (await response.json()) as WorkspaceSnapshot;
        applyWorkspaceSnapshot(snapshot, null);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setLoadError(
            getFriendlyErrorMessage(error, appLanguage, {
              context: "workspace",
              fallback: isEnglish
                ? "Could not load the workspace state from the API."
                : "Não foi possível carregar o estado da área de trabalho a partir da API.",
            }),
          );
        }
      }
    }

    void loadWorkspace();

    return () => controller.abort();
  }, [appLanguage, applyWorkspaceSnapshot, isEnglish, supabase]);

  const selectedArticle = useMemo(
    () =>
      workspace.articles.find(
        (article) => article.id === selectedArticleId,
      ) ?? null,
    [selectedArticleId, workspace.articles],
  );

  const currentArticles = workspace.articles;
  const currentArticleVersions = useMemo(
    () => workspace.articleVersions,
    [workspace.articleVersions],
  );
  const canEditCurrentWorkspace =
    !accountWorkspace || accountWorkspace.role === "owner" || accountWorkspace.role === "editor" || accountWorkspace.role === "member";
  const isWorkspaceOwner = accountWorkspace?.role === "owner";
  const currentIgnoredUnlinkedMentionKeys = useMemo(
    () => workspace.ignoredUnlinkedMentionKeys,
    [workspace.ignoredUnlinkedMentionKeys],
  );
  const currentImageAssets = useMemo(
    () => workspace.imageAssets,
    [workspace.imageAssets],
  );
  const selectedArticleImageAssets = useMemo(
    () =>
      selectedArticle
        ? currentImageAssets.filter(
            (imageAsset) =>
              imageAsset.articleId === selectedArticle.id ||
              (!imageAsset.articleId && articleUsesImageAsset(selectedArticle, imageAsset)),
          )
        : [],
    [currentImageAssets, selectedArticle],
  );
  const draftArticles = useMemo(
    () => currentArticles.filter((article) => !isSubmittedArticle(article)),
    [currentArticles],
  );
  const submittedArticles = useMemo(
    () => currentArticles.filter(isSubmittedArticle),
    [currentArticles],
  );
  const selectedDraftArticle =
    draftArticles.find((article) => article.id === selectedArticleId) ?? draftArticles[0] ?? null;
  const activeGraphArticle =
    submittedArticles.find((article) => article.id === graphSelectedArticleId) ?? null;
  const selectedArticleVersions = useMemo(
    () =>
      selectedArticle
        ? currentArticleVersions
            .filter((version) => version.articleId === selectedArticle.id)
            .sort(
              (firstVersion, secondVersion) =>
                new Date(secondVersion.createdAt).getTime() - new Date(firstVersion.createdAt).getTime(),
            )
        : [],
    [currentArticleVersions, selectedArticle],
  );
  const currentRelations = useMemo(
    () => rebuildExplicitRelations(submittedArticles, workspace.relations),
    [submittedArticles, workspace.relations],
  );
  const currentUnlinkedMentions = useMemo(
    () => findUnlinkedMentions(submittedArticles, currentRelations, currentIgnoredUnlinkedMentionKeys),
    [currentIgnoredUnlinkedMentionKeys, currentRelations, submittedArticles],
  );
  const activeArticleUnlinkedMentions = useMemo(
    () =>
      activeGraphArticle
        ? currentUnlinkedMentions.filter((mention) => mention.sourceArticleId === activeGraphArticle.id)
        : [],
    [activeGraphArticle, currentUnlinkedMentions],
  );
  const activeUnlinkedToastKey = activeGraphArticle
    ? unlinkedMentionToastKey(activeGraphArticle.id, activeArticleUnlinkedMentions)
    : "";
  const shouldShowUnlinkedToast =
    activeTab === "graph" &&
    canEditCurrentWorkspace &&
    Boolean(activeGraphArticle) &&
    activeArticleUnlinkedMentions.length > 0 &&
    dismissedUnlinkedToastKey !== activeUnlinkedToastKey;
  const currentArticlePositions = useMemo(
    () => mergeArticlePositions(currentArticles, workspace.articlePositions),
    [currentArticles, workspace.articlePositions],
  );
  const hasPendingEditorResubmission =
    activeTab === "editor" && pendingEditorResubmission?.articleId === selectedArticleId;
  const selectedArticleIsImportedPdf = selectedArticle ? isImportedPdfArticle(selectedArticle) : false;
  const selectedArticleCanBeEdited =
    canEditCurrentWorkspace && selectedArticle ? !isViewOnlyArticle(selectedArticle) : false;
  const shouldUseArticleViewer = !canEditCurrentWorkspace || Boolean(selectedArticle && isViewOnlyArticle(selectedArticle));
  const canOpenArticleWorkArea = Boolean(selectedArticle) && (shouldUseArticleViewer || selectedArticleCanBeEdited);
  const visibleAccountName = authDisplayName ?? getAuthUserFallbackDisplayName(authUser);
  const authUserId = authUser?.id ?? null;
  const authUserEmail = authUser?.email ?? null;
  const accountWorkspaceId = accountWorkspace?.id ?? null;
  const displayedWorkspaceIdRef = useRef(accountWorkspaceId);
  useEffect(() => { displayedWorkspaceIdRef.current = accountWorkspaceId; }, [accountWorkspaceId]);
  const isWorkspaceSetupRequired = Boolean(authUser && !accountWorkspace);
  const currentPresenceArticle = activeTab === "editor" && !shouldUseArticleViewer ? selectedArticle : null;
  const currentEditorSelection =
    currentPresenceArticle && editorSelection?.articleId === currentPresenceArticle.id ? editorSelection : null;
  const currentPresenceMode: WorkspacePresenceMode =
    activeTab === "editor"
      ? shouldUseArticleViewer
        ? "viewing"
        : "editing"
      : activeTab === "settings"
        ? "settings"
        : "browsing";
  const articlePresence = useMemo(
    () =>
      selectedArticle
        ? workspacePresence.filter(
            (presence) => presence.mode === "editing" && presence.articleId === selectedArticle.id,
          )
        : [],
    [selectedArticle, workspacePresence],
  );
  const workspacePresenceByUserId = useMemo(() => {
    const presenceByUserId = new Map<string, WorkspacePresence>();

    workspacePresence.forEach((presence) => {
      presenceByUserId.set(presence.userId, presence);
    });

    return presenceByUserId;
  }, [workspacePresence]);
  const workspacePresenceByArticleId = useMemo(() => {
    const presenceByArticleId: Record<string, WorkspacePresence[]> = {};

    workspacePresence.forEach((presence) => {
      if (presence.mode !== "editing" || !presence.articleId) {
        return;
      }

      presenceByArticleId[presence.articleId] = [
        ...(presenceByArticleId[presence.articleId] ?? []),
        presence,
      ];
    });

    return presenceByArticleId;
  }, [workspacePresence]);
  const pendingWorkspaceInviteCount = pendingWorkspaceInvites.length;
  const onlinePresenceCount = workspacePresence.length + (authUserId && accountWorkspaceId ? 1 : 0);

  const getPresenceClientId = useCallback(() => {
    return presenceClientId;
  }, [presenceClientId]);
  const collaborationClientId = authUserId && accountWorkspaceId ? presenceClientId : undefined;
  const collaborationUserName = visibleAccountName ?? authUserEmail ?? (isEnglish ? "Collaborator" : "Colaborador");

  useEffect(() => {
    if (!supabase || !authUserId || !accountWorkspaceId) {
      presenceChannelRef.current = null;
      currentPresencePayloadRef.current = null;
      return undefined;
    }

    const clientId = getPresenceClientId();
    const channel = supabase.channel(`papergraph:workspace:${accountWorkspaceId}:presence`, {
      config: {
        presence: {
          key: clientId,
        },
      },
    });
    const syncPresence = () => {
      setWorkspacePresence(flattenPresenceState(channel.presenceState() as Record<string, unknown>, clientId));
    };

    presenceChannelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, syncPresence)
      .on("presence", { event: "join" }, syncPresence)
      .on("presence", { event: "leave" }, syncPresence)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (currentPresencePayloadRef.current) {
            void channel.track(currentPresencePayloadRef.current);
          }

          syncPresence();
        }
      });

    return () => {
      if (presenceChannelRef.current === channel) {
        presenceChannelRef.current = null;
      }

      void channel.untrack();
      void supabase.removeChannel(channel);
    };
  }, [accountWorkspaceId, authUserId, getPresenceClientId, supabase]);

  useEffect(() => {
    if (!authUserId || !accountWorkspaceId) {
      currentPresencePayloadRef.current = null;
      return;
    }

    const presenceLocationKey = [
      accountWorkspaceId,
      activeTab,
      currentPresenceMode,
      currentPresenceArticle?.id ?? "workspace",
    ].join(":");
    const now = new Date().toISOString();

    if (presenceLocationKeyRef.current !== presenceLocationKey) {
      presenceLocationKeyRef.current = presenceLocationKey;
      presenceEnteredAtRef.current = now;
    }

    const payload: WorkspacePresence = {
      articleId: currentPresenceArticle?.id ?? null,
      articleTitle: currentPresenceArticle?.title ?? null,
      clientId: getPresenceClientId(),
      enteredAt: presenceEnteredAtRef.current,
      email: authUserEmail,
      mode: currentPresenceMode,
      selectionEnd: currentEditorSelection?.end ?? null,
      selectionStart: currentEditorSelection?.start ?? null,
      tab: activeTab,
      updatedAt: now,
      userId: authUserId,
      userName: collaborationUserName,
    };

    currentPresencePayloadRef.current = payload;

    if (presenceChannelRef.current) {
      void presenceChannelRef.current.track(payload);
    }
  }, [
    accountWorkspaceId,
    activeTab,
    authUserEmail,
    authUserId,
    currentPresenceArticle?.id,
    currentPresenceArticle?.title,
    editorSelection?.articleId,
    currentEditorSelection?.end,
    currentEditorSelection?.start,
    currentPresenceMode,
    getPresenceClientId,
    collaborationUserName,
  ]);

  useEffect(() => {
    if (!hasPendingEditorResubmission) {
      return undefined;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasPendingEditorResubmission]);

  function getTabLabel(tab: WorkspaceTab) {
    if (appLanguage === "en") {
      switch (tab) {
        case "drafts":
          return "Drafts";
        case "editor":
          return shouldUseArticleViewer ? "View" : "Editor";
        case "graph":
          return "Map";
        case "settings":
          return "Settings";
      }
    }

    switch (tab) {
      case "drafts":
        return "Rascunhos";
      case "editor":
        return shouldUseArticleViewer ? "Visualização" : "Editor";
      case "graph":
        return "Mapa";
      case "settings":
        return "Definições";
    }
  }

  function getTabDescription(tab: WorkspaceTab) {
    if (appLanguage === "en") {
      switch (tab) {
        case "drafts":
          return "Review drafts before submitting";
        case "editor":
          return shouldUseArticleViewer ? "Read the article PDF" : "Write LaTeX with autosave";
        case "graph":
          return "See how ideas connect";
        case "settings":
          return "Language, help and account";
      }
    }

    switch (tab) {
      case "drafts":
        return "Rever rascunhos por submeter";
      case "editor":
        return shouldUseArticleViewer ? "Ver o PDF do artigo" : "Escrever LaTeX com autosave";
      case "graph":
        return "Ver como as ideias se ligam";
      case "settings":
        return "Idioma, ajuda e conta";
    }
  }

  function getSettingsSectionLabel(section: SettingsSection) {
    if (appLanguage === "en") {
      switch (section) {
        case "general":
          return "General";
        case "workspaces":
          return "Workspaces";
        case "help":
          return "Help";
        case "account":
          return "Account";
      }
    }

    switch (section) {
      case "general":
        return "Geral";
      case "workspaces":
        return "Workspaces";
      case "help":
        return "Ajuda";
      case "account":
        return "Conta";
    }
  }

  function getSettingsSectionDescription(section: SettingsSection) {
    if (appLanguage === "en") {
      switch (section) {
        case "general":
          return "Interface preferences";
        case "workspaces":
          return "Maps and collaboration";
        case "help":
          return "How PaperGraph works";
        case "account":
          return "Session and future sync";
      }
    }

    switch (section) {
      case "general":
        return "Preferências da interface";
      case "workspaces":
        return "Mapas e colaboração";
      case "help":
        return "Como o PaperGraph funciona";
      case "account":
        return "Perfil e sessão";
    }
  }

  function getReadOnlyWorkspaceMessage() {
    return isEnglish
      ? "This workspace is read-only for your account."
      : "Esta workspace está em modo só leitura para a tua conta.";
  }

  function showReadOnlyWorkspaceError() {
    setLoadError(getReadOnlyWorkspaceMessage());
  }

  function createArticleVersion(article: WorkspaceArticle): WorkspaceArticleVersion | null {
    if (!isSubmittedArticle(article)) {
      return null;
    }

    return {
      id: createBrowserUuid(),
      articleId: article.id,
      title: article.title,
      author: article.author,
      status: article.status,
      source: article.source,
      tags: [...article.tags],
      createdAt: new Date().toISOString(),
      submittedBy: authUser?.id ?? null,
      submittedByName: visibleAccountName ?? authUser?.email ?? null,
    };
  }

  function addArticleVersion(
    versions: WorkspaceArticleVersion[],
    article: WorkspaceArticle,
  ): WorkspaceArticleVersion[] {
    const nextVersion = createArticleVersion(article);

    if (!nextVersion) {
      return versions;
    }

    const articleVersions = [
      nextVersion,
      ...versions.filter((version) => version.articleId === article.id),
    ].slice(0, maxArticleVersionsPerArticle);
    const otherVersions = versions.filter((version) => version.articleId !== article.id);

    return [...articleVersions, ...otherVersions].sort(
      (firstVersion, secondVersion) =>
        new Date(secondVersion.createdAt).getTime() - new Date(firstVersion.createdAt).getTime(),
    );
  }

  function saveWorkspace(snapshot: WorkspaceSnapshot, throwOnError = false) {
    // Bind asynchronous operations and queued saves to the workspace load that
    // produced them, so a reload cannot authorize an older snapshot.
    snapshot = { ...snapshot, persistenceSession: workspace.persistenceSession };
    if (!canEditCurrentWorkspace) {
      setWorkspace(snapshot);
      setLoadError(null);
      return Promise.resolve();
    }

    const saveRequestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = saveRequestId;

    const runSave = async () => {
      try {
        await mirrorWorkspaceLocally(snapshot);

        if (supabase && accountWorkspace) {
          await saveWorkspaceSnapshotToSupabase(
            supabase,
            {
              id: accountWorkspace.id,
              language: appLanguage,
            },
            snapshot,
          );
        }

        if (saveRequestId === saveRequestIdRef.current && displayedWorkspaceIdRef.current === accountWorkspace?.id) {
          setWorkspace(snapshot);
          setLoadError(null);
          setWorkspaceRecovery(null);
        }
      } catch (error) {
        if (accountWorkspace && displayedWorkspaceIdRef.current === accountWorkspace.id) {
          setWorkspaceRecovery({ workspaceId: accountWorkspace.id, snapshot });
        }
        if (saveRequestId === saveRequestIdRef.current) {
          setLoadError(
            getFriendlyErrorMessage(error, appLanguage, {
              context: "workspace",
              fallback: isEnglish ? "Could not save the workspace." : "Não foi possível guardar a workspace.",
            }),
          );
        }
        if (throwOnError) throw error;
      }
    };

    saveQueueRef.current = saveQueueRef.current.catch(() => undefined).then(runSave);

    return saveQueueRef.current;
  }

  function completePendingEditorNavigation(navigation: PendingEditorNavigation | null) {
    if (navigation?.type === "tab") {
      activateTab(navigation.tab);
    }
  }

  function activateTab(tab: WorkspaceTab) {
    setActiveTab(tab);
    rememberWorkspaceUiState(accountWorkspaceId, { activeTab: tab });
  }

  function rememberSelectedArticle(articleId: string) {
    if (!articleId) {
      return;
    }

    rememberWorkspaceUiState(accountWorkspaceId, { selectedArticleId: articleId });
  }

  function selectGraphArticle(articleId: string | null) {
    setGraphSelectedArticleId(articleId);
    rememberWorkspaceUiState(accountWorkspaceId, { graphSelectedArticleId: articleId });
  }

  function isMainTabDisabled(tab: WorkspaceTab) {
    if (isWorkspaceSetupRequired && tab !== "settings") {
      return true;
    }

    return tab === "editor" && !canOpenArticleWorkArea;
  }

  function getMainTabDisabledTitle(tab: WorkspaceTab) {
    if (isWorkspaceSetupRequired && tab !== "settings") {
      return isEnglish
        ? "Create or open a workspace first."
        : "Cria ou abre uma workspace primeiro.";
    }

    if (tab !== "editor" || canOpenArticleWorkArea) {
      return undefined;
    }

    if (!selectedArticle) {
      return isEnglish ? "Select an article first." : "Seleciona primeiro um artigo.";
    }

    return isEnglish ? "Imported PDFs are not editable." : "PDFs importados não são editáveis.";
  }

  function requestTabChange(tab: WorkspaceTab) {
    if (tab === activeTab) {
      return;
    }

    if (isMainTabDisabled(tab)) {
      return;
    }

    if (hasPendingEditorResubmission) {
      setPendingEditorNavigation({ type: "tab", tab });
      return;
    }

    setConnectionValidationError(null);
    activateTab(tab);
  }

  async function confirmWorkspaceChange() {
    if (!hasPendingEditorResubmission) {
      return true;
    }

    return requestAppConfirm({
      body: isEnglish
        ? "The current article has edits that have not been resubmitted to the map."
        : "O artigo atual tem alterações que ainda não foram resubmetidas para o mapa.",
      cancelLabel: isEnglish ? "Stay here" : "Ficar aqui",
      confirmLabel: isEnglish ? "Continue without resubmitting" : "Continuar sem resubmeter",
      eyebrow: isEnglish ? "Pending changes" : "Alterações pendentes",
      title: isEnglish ? "Switch workspace anyway?" : "Mudar de workspace na mesma?",
      tone: "warning",
    });
  }

  async function switchAccountWorkspace(nextWorkspace: AccountWorkspace) {
    if (!authUser || !supabase || nextWorkspace.id === accountWorkspace?.id) {
      return;
    }

    if (!(await confirmWorkspaceChange())) {
      return;
    }

    setIsWorkspaceActionRunning(true);
    setAuthError(null);
    setAuthStatus(isEnglish ? "Opening workspace..." : "A abrir workspace...");

    try {
      await saveQueueRef.current.catch(() => undefined);
      setPendingEditorResubmission(null);
      setRestoredEditorVersion(null);
      setPendingEditorNavigation(null);
      setConnectionValidationError(null);
      setAccountWorkspace(nextWorkspace);
      rememberActiveWorkspaceId(nextWorkspace.id);
      await loadCloudWorkspace(nextWorkspace.id);
      await loadWorkspaceCollaboration(nextWorkspace);
      activateTab("graph");
      setAuthStatus(
        isEnglish
          ? `Workspace "${nextWorkspace.name}" opened.`
          : `Workspace "${nextWorkspace.name}" aberta.`,
      );
    } catch (error) {
      setAuthError(
        getFriendlyErrorMessage(error, appLanguage, {
          context: "workspace",
          fallback: isEnglish ? "Could not open the workspace." : "Não foi possível abrir a workspace.",
        }),
      );
    } finally {
      setIsWorkspaceActionRunning(false);
    }
  }

  async function handleCreateAccountWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!authUser || !supabase) {
      setAuthError(isEnglish ? "Sign in before creating a workspace." : "Inicia sessão antes de criar uma workspace.");
      return;
    }

    if (!(await confirmWorkspaceChange())) {
      return;
    }

    const workspaceName = normalizeWorkspaceName(newWorkspaceName);

    if (workspaceName.length < 2) {
      setAuthError(isEnglish ? "Write a workspace name." : "Escreve um nome para a workspace.");
      return;
    }

    setIsWorkspaceActionRunning(true);
    setAuthError(null);
    setAuthStatus(isEnglish ? "Creating workspace..." : "A criar workspace...");

    try {
      await saveQueueRef.current.catch(() => undefined);
      const createdWorkspace = await createUserWorkspaceInSupabase(supabase, workspaceName);
      const refreshedWorkspaces = await listUserWorkspacesFromSupabase(supabase);
      const nextWorkspaces = refreshedWorkspaces.some((workspaceItem) => workspaceItem.id === createdWorkspace.id)
        ? refreshedWorkspaces
        : [createdWorkspace, ...refreshedWorkspaces];

      setAccountWorkspaces(nextWorkspaces);
      setAccountWorkspace(createdWorkspace);
      rememberShouldKeepWorkspacesEmpty(authUser.id, false);
      rememberActiveWorkspaceId(createdWorkspace.id);
      setNewWorkspaceName("");
      setPendingEditorResubmission(null);
      setRestoredEditorVersion(null);
      setPendingEditorNavigation(null);
      setConnectionValidationError(null);
      await loadCloudWorkspace(createdWorkspace.id);
      await loadWorkspaceCollaboration(createdWorkspace);
      activateTab("graph");
      setAuthStatus(
        isEnglish
          ? `Workspace "${createdWorkspace.name}" created.`
          : `Workspace "${createdWorkspace.name}" criada.`,
      );
    } catch (error) {
      setAuthError(
        getFriendlyErrorMessage(error, appLanguage, {
          context: "workspace",
          fallback: isEnglish ? "Could not create the workspace." : "Não foi possível criar a workspace.",
        }),
      );
    } finally {
      setIsWorkspaceActionRunning(false);
    }
  }

  async function handleRenameAccountWorkspace(workspaceItem: AccountWorkspace) {
    if (!authUser || !supabase) {
      setAuthError(isEnglish ? "Sign in before renaming a workspace." : "Inicia sessão antes de renomear uma workspace.");
      return;
    }

    if (workspaceItem.role !== "owner") {
      setAuthError(isEnglish ? "Only the workspace owner can rename it." : "Só o dono da workspace pode mudar o nome.");
      return;
    }

    const nextWorkspaceName = normalizeWorkspaceName(
      (await requestAppPrompt({
        body: isEnglish
          ? "Choose a short, recognizable name for this map."
          : "Escolhe um nome curto e reconhecível para este mapa.",
        cancelLabel: isEnglish ? "Cancel" : "Cancelar",
        confirmLabel: isEnglish ? "Rename workspace" : "Mudar nome",
        eyebrow: isEnglish ? "Workspace" : "Workspace",
        inputDefaultValue: workspaceItem.name,
        inputLabel: isEnglish ? "New name" : "Novo nome",
        title: isEnglish ? `Rename "${workspaceItem.name}"` : `Mudar nome de "${workspaceItem.name}"`,
      })) ?? "",
    );

    if (!nextWorkspaceName || nextWorkspaceName === workspaceItem.name) {
      return;
    }

    if (nextWorkspaceName.length < 2) {
      setAuthError(isEnglish ? "Write a workspace name." : "Escreve um nome para a workspace.");
      return;
    }

    setIsWorkspaceActionRunning(true);
    setAuthError(null);
    setAuthStatus(isEnglish ? "Renaming workspace..." : "A mudar nome da workspace...");

    try {
      const renamedWorkspace = await renameWorkspaceInSupabase(supabase, workspaceItem.id, nextWorkspaceName);
      const refreshedWorkspaces = await listUserWorkspacesFromSupabase(supabase);
      const nextWorkspaces = refreshedWorkspaces.some((refreshedWorkspace) => refreshedWorkspace.id === renamedWorkspace.id)
        ? refreshedWorkspaces
        : [renamedWorkspace, ...refreshedWorkspaces];

      setAccountWorkspaces(nextWorkspaces);

      if (accountWorkspace?.id === renamedWorkspace.id) {
        setAccountWorkspace(
          nextWorkspaces.find((refreshedWorkspace) => refreshedWorkspace.id === renamedWorkspace.id) ?? renamedWorkspace,
        );
      }

      setAuthStatus(
        isEnglish
          ? `Workspace renamed to "${renamedWorkspace.name}".`
          : `Workspace renomeada para "${renamedWorkspace.name}".`,
      );
    } catch (error) {
      setAuthError(
        getFriendlyErrorMessage(error, appLanguage, {
          context: "workspace",
          fallback: isEnglish ? "Could not rename the workspace." : "Não foi possível mudar o nome da workspace.",
        }),
      );
      setAuthStatus(null);
    } finally {
      setIsWorkspaceActionRunning(false);
    }
  }

  async function handleDeleteAccountWorkspace(workspaceItem: AccountWorkspace) {
    if (!authUser || !supabase) {
      setAuthError(isEnglish ? "Sign in before deleting a workspace." : "Inicia sessão antes de eliminar uma workspace.");
      return;
    }

    if (workspaceItem.role !== "owner") {
      setAuthError(isEnglish ? "Only the workspace owner can delete it." : "Só o dono da workspace pode eliminá-la.");
      return;
    }

    if (!(await confirmWorkspaceChange())) {
      return;
    }

    const confirmation = await requestAppPrompt({
      body: isEnglish
        ? "Articles, relations, invites and uploaded files will be removed permanently. Type the workspace name to confirm."
        : "Artigos, ligações, convites e ficheiros carregados serão removidos permanentemente. Escreve o nome da workspace para confirmar.",
      cancelLabel: isEnglish ? "Cancel" : "Cancelar",
      confirmationValue: workspaceItem.name,
      confirmLabel: isEnglish ? "Delete workspace" : "Eliminar workspace",
      eyebrow: isEnglish ? "Danger zone" : "Zona de perigo",
      inputLabel: isEnglish ? "Workspace name" : "Nome da workspace",
      title: isEnglish ? `Delete "${workspaceItem.name}"?` : `Eliminar "${workspaceItem.name}"?`,
      tone: "danger",
    });

    if (confirmation?.trim() !== workspaceItem.name) {
      return;
    }

    const wasActiveWorkspace = workspaceItem.id === accountWorkspace?.id;

    setIsWorkspaceActionRunning(true);
    setAuthError(null);
    setAuthStatus(isEnglish ? "Deleting workspace..." : "A eliminar workspace...");

    try {
      await saveQueueRef.current.catch(() => undefined);
      await deleteWorkspaceAssetFiles(workspaceItem.id);
      await deleteWorkspaceInSupabase(supabase, workspaceItem.id);
      forgetWorkspaceUiState(workspaceItem.id);

      const refreshedWorkspaces = await listUserWorkspacesFromSupabase(supabase);
      setAccountWorkspaces(refreshedWorkspaces);
      rememberShouldKeepWorkspacesEmpty(authUser.id, refreshedWorkspaces.length === 0);
      setPendingEditorResubmission(null);
      setRestoredEditorVersion(null);
      setPendingEditorNavigation(null);
      setConnectionValidationError(null);

      if (wasActiveWorkspace) {
        const nextWorkspace = refreshedWorkspaces[0] ?? null;

        if (nextWorkspace) {
          setAccountWorkspace(nextWorkspace);
          rememberActiveWorkspaceId(nextWorkspace.id);
          await loadCloudWorkspace(nextWorkspace.id);
          await loadWorkspaceCollaboration(nextWorkspace);
          setActiveTab("graph");
          rememberWorkspaceUiState(nextWorkspace.id, { activeTab: "graph" });
          setAuthStatus(
            isEnglish
              ? `Workspace "${workspaceItem.name}" deleted. "${nextWorkspace.name}" opened.`
              : `Workspace "${workspaceItem.name}" eliminada. "${nextWorkspace.name}" aberta.`,
          );
        } else {
          setAccountWorkspace(null);
          rememberActiveWorkspaceId(null);
          applyWorkspaceSnapshot(defaultSnapshot, null, false);
          await mirrorWorkspaceLocally(defaultSnapshot);
          await loadWorkspaceCollaboration(null);
          setSettingsSection("workspaces");
          setActiveTab("settings");
          rememberWorkspaceUiState(null, { activeTab: "settings", graphSelectedArticleId: null });
          setAuthStatus(
            isEnglish
              ? `Workspace "${workspaceItem.name}" deleted. Create a new workspace to continue.`
              : `Workspace "${workspaceItem.name}" eliminada. Cria uma nova workspace para continuar.`,
          );
        }
      } else {
        setAccountWorkspace((currentWorkspace) =>
          currentWorkspace
            ? refreshedWorkspaces.find((refreshedWorkspace) => refreshedWorkspace.id === currentWorkspace.id) ??
              currentWorkspace
            : null,
        );
        setAuthStatus(
          isEnglish
            ? `Workspace "${workspaceItem.name}" deleted.`
            : `Workspace "${workspaceItem.name}" eliminada.`,
        );
      }
    } catch (error) {
      setAuthError(
        getFriendlyErrorMessage(error, appLanguage, {
          context: "delete",
          fallback: isEnglish ? "Could not delete the workspace." : "Não foi possível eliminar a workspace.",
        }),
      );
      setAuthStatus(null);
    } finally {
      setIsWorkspaceActionRunning(false);
    }
  }

  async function handleCreateWorkspaceInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!authUser || !supabase || !accountWorkspace) {
      setAuthError(isEnglish ? "Open a workspace before inviting members." : "Abre uma workspace antes de convidar membros.");
      return;
    }

    if (accountWorkspace.role !== "owner") {
      setAuthError(isEnglish ? "Only workspace owners can invite members." : "Só o dono da workspace pode convidar membros.");
      return;
    }

    const invitedEmail = workspaceInviteEmail.trim().toLowerCase();

    if (!invitedEmail) {
      setAuthError(isEnglish ? "Write the email to invite." : "Escreve o email a convidar.");
      return;
    }

    setIsInviteActionRunning(true);
    setAuthError(null);
    setAuthStatus(isEnglish ? "Sending invite..." : "A enviar convite...");

    try {
      await createWorkspaceInviteInSupabase(supabase, accountWorkspace.id, invitedEmail, workspaceInviteRole);
      setWorkspaceInviteEmail("");
      await loadWorkspaceCollaboration(accountWorkspace);
      setAuthStatus(
        isEnglish
          ? `Invite created for ${invitedEmail} as ${formatWorkspaceRole(workspaceInviteRole, appLanguage)}.`
          : `Convite criado para ${invitedEmail} como ${formatWorkspaceRole(workspaceInviteRole, appLanguage)}.`,
      );
    } catch (error) {
      setAuthError(
        getFriendlyErrorMessage(error, appLanguage, {
          context: "workspace",
          fallback: isEnglish ? "Could not create the invite." : "Não foi possível criar o convite.",
        }),
      );
      setAuthStatus(null);
    } finally {
      setIsInviteActionRunning(false);
    }
  }

  async function handleWorkspaceMemberRoleChange(
    member: WorkspaceMember,
    nextRole: EditableWorkspaceMemberRole,
  ) {
    if (!supabase || !accountWorkspace || accountWorkspace.role !== "owner" || member.role === "owner") {
      return;
    }

    setMemberActionUserId(member.userId);
    setMemberActionKind("role");
    setAuthError(null);
    setAuthStatus(isEnglish ? "Updating member role..." : "A atualizar cargo do membro...");

    try {
      await updateWorkspaceMemberRoleInSupabase(supabase, accountWorkspace.id, member.userId, nextRole);
      await loadWorkspaceCollaboration(accountWorkspace);
      setAuthStatus(
        isEnglish
          ? `${member.displayName ?? member.email ?? "Member"} is now ${formatWorkspaceRole(nextRole, appLanguage)}.`
          : `${member.displayName ?? member.email ?? "Membro"} agora é ${formatWorkspaceRole(nextRole, appLanguage)}.`,
      );
    } catch (error) {
      setAuthError(
        getFriendlyErrorMessage(error, appLanguage, {
          context: "workspace",
          fallback: isEnglish ? "Could not update the member role." : "Não foi possível atualizar o cargo do membro.",
        }),
      );
      setAuthStatus(null);
    } finally {
      setMemberActionUserId(null);
      setMemberActionKind(null);
    }
  }

  async function handleRemoveWorkspaceMember(member: WorkspaceMember) {
    if (!supabase || !accountWorkspace || accountWorkspace.role !== "owner" || member.role === "owner") {
      return;
    }

    const memberName = member.displayName ?? member.email ?? (isEnglish ? "this member" : "este membro");
    const confirmed = await requestAppConfirm({
      body: isEnglish
        ? "This person will lose access to this map."
        : "Esta pessoa vai perder acesso a este mapa.",
      cancelLabel: isEnglish ? "Cancel" : "Cancelar",
      confirmLabel: isEnglish ? "Remove member" : "Remover membro",
      eyebrow: isEnglish ? "Members" : "Membros",
      title: isEnglish ? `Remove ${memberName}?` : `Remover ${memberName}?`,
      tone: "danger",
    });

    if (!confirmed) {
      return;
    }

    setMemberActionUserId(member.userId);
    setMemberActionKind("remove");
    setAuthError(null);
    setAuthStatus(isEnglish ? "Removing member..." : "A remover membro...");

    try {
      await removeWorkspaceMemberFromSupabase(supabase, accountWorkspace.id, member.userId);
      await loadWorkspaceCollaboration(accountWorkspace);
      setAuthStatus(
        isEnglish
          ? `${memberName} was removed from the workspace.`
          : `${memberName} foi removido da workspace.`,
      );
    } catch (error) {
      setAuthError(
        getFriendlyErrorMessage(error, appLanguage, {
          context: "delete",
          fallback: isEnglish ? "Could not remove the member." : "Não foi possível remover o membro.",
        }),
      );
      setAuthStatus(null);
    } finally {
      setMemberActionUserId(null);
      setMemberActionKind(null);
    }
  }

  async function handleTransferWorkspaceOwnership(member: WorkspaceMember) {
    if (!supabase || !accountWorkspace || accountWorkspace.role !== "owner" || member.role === "owner") {
      return;
    }

    const memberName = member.displayName ?? member.email ?? (isEnglish ? "this member" : "este membro");
    const confirmation = await requestAppPrompt({
      body: isEnglish
        ? `${memberName} will become the workspace owner. Type the workspace name to confirm.`
        : `${memberName} passa a ser dono da workspace. Escreve o nome da workspace para confirmar.`,
      cancelLabel: isEnglish ? "Cancel" : "Cancelar",
      confirmationValue: accountWorkspace.name,
      confirmLabel: isEnglish ? "Transfer owner" : "Transferir dono",
      eyebrow: isEnglish ? "Ownership" : "Propriedade",
      inputLabel: isEnglish ? "Workspace name" : "Nome da workspace",
      title: isEnglish ? `Transfer "${accountWorkspace.name}"?` : `Transferir "${accountWorkspace.name}"?`,
      tone: "warning",
    });

    if (confirmation?.trim() !== accountWorkspace.name) {
      return;
    }

    setMemberActionUserId(member.userId);
    setMemberActionKind("transfer");
    setAuthError(null);
    setAuthStatus(isEnglish ? "Transferring ownership..." : "A transferir propriedade...");

    try {
      await transferWorkspaceOwnerInSupabase(supabase, accountWorkspace.id, member.userId);
      const refreshedWorkspaces = await listUserWorkspacesFromSupabase(supabase);
      const refreshedCurrentWorkspace =
        refreshedWorkspaces.find((workspaceItem) => workspaceItem.id === accountWorkspace.id) ??
        {
          ...accountWorkspace,
          role: "editor" as const,
        };

      setAccountWorkspaces(refreshedWorkspaces);
      setAccountWorkspace(refreshedCurrentWorkspace);
      await loadWorkspaceCollaboration(refreshedCurrentWorkspace);
      setAuthStatus(
        isEnglish
          ? `${memberName} is now the workspace owner. Your role is now editor.`
          : `${memberName} agora é dono da workspace. O teu cargo passou a editor.`,
      );
    } catch (error) {
      setAuthError(
        getFriendlyErrorMessage(error, appLanguage, {
          context: "workspace",
          fallback: isEnglish
            ? "Could not transfer workspace ownership."
            : "Não foi possível transferir a propriedade da workspace.",
        }),
      );
      setAuthStatus(null);
    } finally {
      setMemberActionUserId(null);
      setMemberActionKind(null);
    }
  }

  async function handleAcceptWorkspaceInvite(invite: WorkspaceInvite) {
    if (!authUser || !supabase) {
      return;
    }

    if (!(await confirmWorkspaceChange())) {
      return;
    }

    setIsInviteActionRunning(true);
    setAuthError(null);
    setAuthStatus(isEnglish ? "Accepting invite..." : "A aceitar convite...");

    try {
      await saveQueueRef.current.catch(() => undefined);
      const acceptedWorkspace = await acceptWorkspaceInviteInSupabase(supabase, invite.id);
      rememberShouldKeepWorkspacesEmpty(authUser.id, false);
      await syncAccountWorkspace(authUser, acceptedWorkspace.id);
      setPendingEditorResubmission(null);
      setRestoredEditorVersion(null);
      setPendingEditorNavigation(null);
      setConnectionValidationError(null);
      activateTab("graph");
      setAuthStatus(
        isEnglish
          ? `Invite accepted. Workspace "${acceptedWorkspace.name}" opened.`
          : `Convite aceite. Workspace "${acceptedWorkspace.name}" aberta.`,
      );
    } catch (error) {
      setAuthError(
        getFriendlyErrorMessage(error, appLanguage, {
          context: "workspace",
          fallback: isEnglish ? "Could not accept the invite." : "Não foi possível aceitar o convite.",
        }),
      );
      setAuthStatus(null);
    } finally {
      setIsInviteActionRunning(false);
    }
  }

  async function handleDeclineWorkspaceInvite(invite: WorkspaceInvite) {
    if (!authUser || !supabase) {
      return;
    }

    const confirmed = await requestAppConfirm({
      body: isEnglish
        ? "The invite will disappear from your pending workspaces."
        : "O convite desaparece das tuas workspaces pendentes.",
      cancelLabel: isEnglish ? "Keep invite" : "Manter convite",
      confirmLabel: isEnglish ? "Decline invite" : "Recusar convite",
      eyebrow: isEnglish ? "Invite" : "Convite",
      title: isEnglish ? `Decline "${invite.workspaceName}"?` : `Recusar "${invite.workspaceName}"?`,
      tone: "danger",
    });

    if (!confirmed) {
      return;
    }

    setIsInviteActionRunning(true);
    setAuthError(null);
    setAuthStatus(isEnglish ? "Declining invite..." : "A recusar convite...");

    try {
      await declineWorkspaceInviteInSupabase(supabase, invite.id);
      await loadWorkspaceCollaboration(accountWorkspace);
      setAuthStatus(
        isEnglish
          ? `Invite to "${invite.workspaceName}" declined.`
          : `Convite para "${invite.workspaceName}" recusado.`,
      );
    } catch (error) {
      setAuthError(
        getFriendlyErrorMessage(error, appLanguage, {
          context: "workspace",
          fallback: isEnglish ? "Could not decline the invite." : "Não foi possível recusar o convite.",
        }),
      );
      setAuthStatus(null);
    } finally {
      setIsInviteActionRunning(false);
    }
  }

  async function handleRevokeWorkspaceInvite(invite: WorkspaceInvite) {
    if (!supabase || !accountWorkspace) {
      return;
    }

    setIsInviteActionRunning(true);
    setAuthError(null);
    setAuthStatus(isEnglish ? "Revoking invite..." : "A revogar convite...");

    try {
      await revokeWorkspaceInviteInSupabase(supabase, invite.id);
      await loadWorkspaceCollaboration(accountWorkspace);
      setAuthStatus(
        isEnglish
          ? `Invite to ${invite.invitedEmail} revoked.`
          : `Convite para ${invite.invitedEmail} revogado.`,
      );
    } catch (error) {
      setAuthError(
        getFriendlyErrorMessage(error, appLanguage, {
          context: "workspace",
          fallback: isEnglish ? "Could not revoke the invite." : "Não foi possível revogar o convite.",
        }),
      );
      setAuthStatus(null);
    } finally {
      setIsInviteActionRunning(false);
    }
  }

  function leaveEditorWithoutResubmitting() {
    const navigation = pendingEditorNavigation;

    setPendingEditorResubmission(null);
    setRestoredEditorVersion(null);
    setPendingEditorNavigation(null);
    setConnectionValidationError(null);
    completePendingEditorNavigation(navigation);
  }

  async function resubmitEditorAndContinue() {
    if (!pendingEditorResubmission) {
      setPendingEditorNavigation(null);
      return;
    }

    const navigation = pendingEditorNavigation;
    const nextTab = navigation?.type === "tab" ? navigation.tab : "graph";

    setPendingEditorNavigation(null);
    await submitArticle(pendingEditorResubmission, nextTab);
  }

  const updatePendingEditorResubmission = useCallback((nextPendingResubmission: PendingEditorResubmission | null) => {
    setPendingEditorResubmission(nextPendingResubmission);

    if (nextPendingResubmission) {
      setConnectionValidationError(null);
    }
  }, []);

  function updateSelectedArticle(articleId: string) {
    setConnectionValidationError(null);
    setPendingEditorNavigation(null);
    setSelectedArticleId(articleId);
    rememberSelectedArticle(articleId);

    void saveWorkspace({
      selectedArticleId: articleId,
      articles: currentArticles,
      relations: currentRelations,
      articlePositions: currentArticlePositions,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
      articleVersions: currentArticleVersions,
    });
  }

  function updateGraphSelectedArticle(articleId: string | null) {
    setConnectionValidationError(null);
    setPendingEditorNavigation(null);
    selectGraphArticle(articleId);

    if (articleId) {
      updateSelectedArticle(articleId);
    }
  }

  function createNewArticle() {
    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    const workspaceArticles = currentArticles;
    const nextIndex = workspaceArticles.length + 1;
    const nextArticleTitle = isEnglish
      ? `Untitled research note ${nextIndex}`
      : `Nota de investigação sem título ${nextIndex}`;
    const nextArticle: WorkspaceArticle = {
      id: createBrowserUuid(),
      title: nextArticleTitle,
      author: "PaperGraph",
      abstract: "",
      status: "Draft",
      updatedAt: "agora",
      tags: [],
      source: [
        "\\documentclass[12pt]{article}",
        "\\usepackage{amsmath, amssymb}",
        "\\begin{document}",
        `\\section{${nextArticleTitle}}`,
        isEnglish ? "Start writing your idea here." : "Começa a escrever a tua ideia aqui.",
        "",
        "\\end{document}",
      ].join("\n"),
    };
    const nextArticles = [...workspaceArticles, nextArticle];
    const nextArticlePositions = {
      ...currentArticlePositions,
      [nextArticle.id]: calculateNextArticlePosition(workspaceArticles),
    };

    const snapshot: WorkspaceSnapshot = {
      selectedArticleId: nextArticle.id,
      articles: nextArticles,
      relations: currentRelations,
      articlePositions: nextArticlePositions,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
      articleVersions: currentArticleVersions,
    };

    setWorkspace(snapshot);
    setConnectionValidationError(null);
    setPendingEditorNavigation(null);
    setSelectedArticleId(nextArticle.id);
    rememberSelectedArticle(nextArticle.id);
    selectGraphArticle(null);
    activateTab("editor");
    void saveWorkspace(snapshot);
  }

  function updateArticleDetails(nextArticle: { abstract: string; source: string; tags: string[]; title: string }) {
    if (!selectedArticle) return;

    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    const updatedArticle: WorkspaceArticle = {
      ...selectedArticle,
      abstract: nextArticle.abstract,
      title: nextArticle.title,
      source: nextArticle.source,
      tags: nextArticle.tags,
      updatedAt: "agora",
    };

    const nextArticles = currentArticles.map((article) =>
      article.id === updatedArticle.id ? updatedArticle : article,
    );
    const nextRelations = rebuildExplicitRelations(nextArticles, currentRelations);
    const nextArticlePositions = currentArticlePositions;

    const snapshot: WorkspaceSnapshot = {
      selectedArticleId,
      articles: nextArticles,
      relations: nextRelations,
      articlePositions: nextArticlePositions,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
      articleVersions: currentArticleVersions,
    };

    setWorkspace(snapshot);
    void saveWorkspace(snapshot);
  }

  async function updateArticleMetadata(nextArticle: {
    articleId: string;
    status: Exclude<WorkspaceArticle["status"], "Draft">;
    tags: string[];
    title: string;
  }) {
    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    const articleToUpdate = currentArticles.find((article) => article.id === nextArticle.articleId);

    if (!articleToUpdate) {
      return;
    }

    const updatedArticle: WorkspaceArticle = {
      ...articleToUpdate,
      title: nextArticle.title,
      status: nextArticle.status,
      tags: nextArticle.tags,
      updatedAt: "agora",
    };

    const nextArticles = currentArticles.map((article) =>
      article.id === updatedArticle.id ? updatedArticle : article,
    );
    const nextSubmittedArticles = nextArticles.filter(isSubmittedArticle);
    const academicRefresh = await refreshAcademicRelations(nextSubmittedArticles, currentRelations);
    const nextRelations = academicRefresh.relations;
    const nextArticleVersions = addArticleVersion(currentArticleVersions, updatedArticle);
    const snapshot: WorkspaceSnapshot = {
      selectedArticleId: updatedArticle.id,
      articles: nextArticles,
      relations: nextRelations,
      articlePositions: currentArticlePositions,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
      articleVersions: nextArticleVersions,
    };

    setWorkspace(snapshot);
    setConnectionValidationError(academicRefresh.issue ?? null);
    setSelectedArticleId(updatedArticle.id);
    rememberSelectedArticle(updatedArticle.id);
    selectGraphArticle(updatedArticle.id);
    void saveWorkspace(snapshot);
  }

  function restoreArticleVersion(versionId: string) {
    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    const versionToRestore = currentArticleVersions.find((version) => version.id === versionId);

    if (!versionToRestore) {
      setConnectionValidationError(
        isEnglish
          ? "Could not find that saved version."
          : "NÃ£o foi possÃ­vel encontrar essa versÃ£o guardada.",
      );
      return;
    }

    const articleToRestore = currentArticles.find((article) => article.id === versionToRestore.articleId);

    if (!articleToRestore || isViewOnlyArticle(articleToRestore)) {
      setConnectionValidationError(
        isEnglish
          ? "This article cannot be restored in the editor."
          : "Este artigo nÃ£o pode ser restaurado no editor.",
      );
      return;
    }

    setRestoredEditorVersion(versionToRestore);
    setConnectionValidationError(null);
    setPendingEditorNavigation(null);
    setSelectedArticleId(versionToRestore.articleId);
    rememberSelectedArticle(versionToRestore.articleId);
    selectGraphArticle(versionToRestore.articleId);
    activateTab("editor");
  }

  async function compileArticleForSubmission(article: WorkspaceArticle) {
    const articleImageAssets = currentImageAssets.filter(
      (imageAsset) =>
        imageAsset.articleId === article.id ||
        (!imageAsset.articleId && articleUsesImageAsset(article, imageAsset)),
    );
    const response = await fetch("/api/compile", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authAccessToken ? { Authorization: `Bearer ${authAccessToken}` } : {}),
      },
      body: JSON.stringify({
        articleId: article.id,
        imageAssets: articleImageAssets,
        title: article.title,
        source: article.source,
      }),
    });

    if (!response.ok) {
      throw new Error(
        await getFriendlyResponseError(response, appLanguage, {
          context: "compile",
          fallback: isEnglish ? "Compilation failed." : "A compilação falhou.",
        }),
      );
    }

    return response.arrayBuffer();
  }

  async function refreshAcademicRelations(
    nextSubmittedArticles: WorkspaceArticle[],
    baseRelations: WorkspaceRelation[],
  ): Promise<AcademicRelationRefreshResult> {
    const rebuiltRelations = rebuildExplicitRelations(nextSubmittedArticles, baseRelations);

    if (nextSubmittedArticles.length === 0) {
      return {
        relations: mergeAcademicRelations(rebuiltRelations, [], nextSubmittedArticles),
        status: isEnglish
          ? "No submitted articles to scan."
          : "Não existem artigos submetidos para analisar.",
      };
    }

    if (!authAccessToken || !supabase || !accountWorkspaceId) {
      const issue = isEnglish
        ? "Academic relations need an active Supabase session."
        : "As relações académicas precisam de uma sessão Supabase ativa.";

      return {
        issue: isEnglish
          ? "Academic relations need an active Supabase session."
          : "As relações académicas precisam de uma sessão Supabase ativa.",
        relations: mergeAcademicRelations(rebuiltRelations, [], nextSubmittedArticles),
        status: issue,
      };
    }

    setIsAcademicRelationsRunning(true);

    try {
      await saveQueueRef.current;
      await saveWorkspaceArticles(supabase, accountWorkspaceId, nextSubmittedArticles, workspace.persistenceSession);
      const response = await fetch("/api/academic-relations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          articleIds: nextSubmittedArticles.map((article) => article.id),
          language: appLanguage,
          workspaceId: accountWorkspaceId,
        }),
      });

      if (!response.ok) {
        throw new Error(
          await getFriendlyResponseError(response, appLanguage, {
            context: "workspace",
            fallback: isEnglish
              ? "Could not update citation and semantic links."
              : "Não foi possível atualizar ligações por citação e semântica.",
          }),
        );
      }

      const payload = (await response.json()) as {
        diagnostics?: unknown;
        warnings?: string[];
        relations?: WorkspaceRelation[];
      };
      const academicRelations = Array.isArray(payload.relations) ? payload.relations : [];
      const diagnostics = isAcademicRelationDiagnostics(payload.diagnostics) ? payload.diagnostics : null;
      const nextRelations = mergeAcademicRelations(rebuiltRelations, academicRelations, nextSubmittedArticles);

      return {
        diagnostics,
        relations: nextRelations,
        issue: payload.warnings?.length ? payload.warnings.map((warning) => getFriendlyErrorMessage(warning, appLanguage)).join(" ") : undefined,
      };
    } catch (error) {
      const issue = getFriendlyErrorMessage(error, appLanguage, {
        context: "workspace",
        fallback: isEnglish
          ? "Could not update citation and semantic links."
          : "Não foi possível atualizar ligações por citação e semântica.",
      });

      return {
        issue,
        relations: rebuiltRelations,
        status: issue,
      };
    } finally {
      setIsAcademicRelationsRunning(false);
    }
  }

  async function submitArticle(
    nextArticle: ArticleSubmission,
    nextActiveTab: WorkspaceTab = "graph",
  ): Promise<ArticleSubmissionResult> {
    if (isArticleSubmissionRunning) {
      return { cancelled: true, submitted: false };
    }

    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return { issue: getReadOnlyWorkspaceMessage(), submitted: false };
    }

    const articleToSubmit = nextArticle.articleId
      ? currentArticles.find((article) => article.id === nextArticle.articleId)
      : selectedArticle;

    if (!articleToSubmit) {
      return {
        issue: isEnglish ? "Could not find the article to submit." : "Não foi possível encontrar o artigo para submeter.",
        submitted: false,
      };
    }

    if (!nextArticle.source.trim()) {
      const issue = isEnglish ? "The article source is empty." : "O código do artigo está vazio.";

      setConnectionValidationError(issue);
      setPendingEditorNavigation(null);
      setSelectedArticleId(articleToSubmit.id);
      rememberSelectedArticle(articleToSubmit.id);
      activateTab("editor");
      return { issue, submitted: false };
    }

    const otherEditors = workspacePresence.filter(
      (presence) => presence.mode === "editing" && presence.articleId === articleToSubmit.id,
    );

    if (otherEditors.length > 0) {
      const editorNames = otherEditors.map((presence) => presence.userName).join(", ");
      const shouldContinue = await requestAppConfirm({
        body: isEnglish
          ? `${editorNames} ${otherEditors.length === 1 ? "is" : "are"} editing this article right now.`
          : `${editorNames} ${otherEditors.length === 1 ? "está" : "estão"} a editar este artigo neste momento.`,
        cancelLabel: isEnglish ? "Cancel submission" : "Cancelar submissão",
        confirmLabel: isEnglish ? "Submit anyway" : "Submeter na mesma",
        eyebrow: isEnglish ? "Live editing" : "Edição em tempo real",
        title: isEnglish ? "Submit current version?" : "Submeter a versão atual?",
        tone: "warning",
      });

      if (!shouldContinue) {
        return { cancelled: true, submitted: false };
      }
    }

    const submittedArticle: WorkspaceArticle = {
      ...articleToSubmit,
      abstract: nextArticle.abstract,
      title: nextArticle.title,
      source: nextArticle.source,
      status: nextArticle.status,
      tags: nextArticle.tags,
      updatedAt: "agora",
    };

    const nextArticles = currentArticles.map((article) =>
      article.id === submittedArticle.id ? submittedArticle : article,
    );
    const nextSubmittedArticles = nextArticles.filter(isSubmittedArticle);
    const nextArticlePositions = {
      ...currentArticlePositions,
      [submittedArticle.id]: currentArticlePositions[submittedArticle.id] ?? calculateNextArticlePosition(nextSubmittedArticles),
    };
    const validationIssues = validateExplicitLinkTargets(nextSubmittedArticles, appLanguage);

    if (validationIssues.length > 0) {
      const issue = validationIssues.join(" ");

      setConnectionValidationError(issue);
      setPendingEditorNavigation(null);
      setSelectedArticleId(submittedArticle.id);
      rememberSelectedArticle(submittedArticle.id);
      activateTab("editor");
      return { issue, submitted: false };
    }

    let submittedPdfBuffer: ArrayBuffer;

    setIsArticleSubmissionRunning(true);
    setConnectionValidationError(null);

    try {
      submittedPdfBuffer = await compileArticleForSubmission(submittedArticle);
    } catch (error) {
      const issue = getFriendlyErrorMessage(error, appLanguage, {
        context: "compile",
        fallback: isEnglish
          ? "Could not compile the article before submitting."
          : "Não foi possível compilar o artigo antes de submeter.",
      });

      setConnectionValidationError(issue);
      setPendingEditorNavigation(null);
      setSelectedArticleId(submittedArticle.id);
      rememberSelectedArticle(submittedArticle.id);
      activateTab("editor");
      return { issue, submitted: false };
    } finally {
      setIsArticleSubmissionRunning(false);
    }

    const academicRefresh = await refreshAcademicRelations(nextSubmittedArticles, currentRelations);
    const nextRelations = academicRefresh.relations;
    const nextUnlinkedMentions = findUnlinkedMentions(
      nextSubmittedArticles,
      nextRelations,
      currentIgnoredUnlinkedMentionKeys,
    );
    const submittedArticleUnlinkedMentions = nextUnlinkedMentions.filter(
      (mention) => mention.sourceArticleId === submittedArticle.id,
    );
    const submittedArticleUnlinkedToastKey = unlinkedMentionToastKey(
      submittedArticle.id,
      submittedArticleUnlinkedMentions,
    );
    const nextArticleVersions = addArticleVersion(currentArticleVersions, submittedArticle);

    const snapshot: WorkspaceSnapshot = {
      selectedArticleId: submittedArticle.id,
      articles: nextArticles,
      relations: nextRelations,
      articlePositions: nextArticlePositions,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
      articleVersions: nextArticleVersions,
    };

    setWorkspace(snapshot);
    setConnectionValidationError(academicRefresh.issue ?? null);
    setPendingEditorResubmission(null);
    setRestoredEditorVersion(null);
    setSelectedArticleId(submittedArticle.id);
    rememberSelectedArticle(submittedArticle.id);
    selectGraphArticle(submittedArticle.id);
    if (submittedArticleUnlinkedMentions.length > 0) {
      setDismissedUnlinkedToastKey((currentDismissedKey) =>
        currentDismissedKey === submittedArticleUnlinkedToastKey ? null : currentDismissedKey,
      );
    }
    activateTab(nextActiveTab);
    void saveWorkspace(snapshot);

    return { pdfBuffer: submittedPdfBuffer, submitted: true };
  }

  function createRelationBetweenArticles(fromArticleId: string, toArticleId: string, note?: string) {
    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    if (fromArticleId === toArticleId) {
      return;
    }

    const fromArticle = currentArticles.find((article) => article.id === fromArticleId);
    const targetArticle = currentArticles.find((article) => article.id === toArticleId);

    if (!fromArticle || !targetArticle) {
      return;
    }

    const relation: WorkspaceRelation = {
      id: createBrowserUuid(),
      fromArticleId,
      toArticleId,
      note:
        note?.trim() ||
        (isEnglish
          ? `Related by shared theme: ${fromArticle.tags[0] ?? "idea"}`
          : `Relacionado por tema partilhado: ${fromArticle.tags[0] ?? "ideia"}`),
      createdAt: "agora",
      relationType: "manual",
    };

    const nextPairKey = relationPairKey(fromArticleId, toArticleId);
    const nextRelations = currentRelations.filter(
      (existingRelation) => relationPairKey(existingRelation.fromArticleId, existingRelation.toArticleId) !== nextPairKey,
    );
    const nextArticles = currentArticles;
    const nextArticlePositions = currentArticlePositions;

    const snapshot: WorkspaceSnapshot = {
      selectedArticleId: fromArticleId,
      articles: nextArticles,
      relations: [relation, ...nextRelations],
      articlePositions: nextArticlePositions,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
      articleVersions: currentArticleVersions,
    };

    setWorkspace(snapshot);
    selectGraphArticle(fromArticleId);
    void saveWorkspace(snapshot);
  }

  function createWikilinkFromUnlinkedMention(mentionId: string) {
    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    const mention = currentUnlinkedMentions.find((currentMention) => currentMention.id === mentionId);

    if (!mention) {
      return;
    }

    const sourceArticle = currentArticles.find((article) => article.id === mention.sourceArticleId);

    if (!sourceArticle) {
      return;
    }

    const nextSource = replaceFirstUnlinkedTitleMention(sourceArticle.source, mention.targetTitle);

    if (nextSource === sourceArticle.source) {
      return;
    }

    const updatedArticle: WorkspaceArticle = {
      ...sourceArticle,
      source: nextSource,
      updatedAt: "agora",
    };
    const nextArticles = currentArticles.map((article) =>
      article.id === updatedArticle.id ? updatedArticle : article,
    );
    const nextSubmittedArticles = nextArticles.filter(isSubmittedArticle);
    const validationIssues = validateExplicitLinkTargets(nextSubmittedArticles, appLanguage);

    if (validationIssues.length > 0) {
      setConnectionValidationError(validationIssues.join(" "));
      setSelectedArticleId(updatedArticle.id);
      rememberSelectedArticle(updatedArticle.id);
      selectGraphArticle(updatedArticle.id);
      activateTab("editor");
      return;
    }

    const nextRelations = rebuildExplicitRelations(nextSubmittedArticles, currentRelations);
    const nextIgnoredUnlinkedMentionKeys = currentIgnoredUnlinkedMentionKeys.filter(
      (ignoredKey) => ignoredKey !== mention.id,
    );
    const snapshot: WorkspaceSnapshot = {
      selectedArticleId: updatedArticle.id,
      articles: nextArticles,
      relations: nextRelations,
      articlePositions: currentArticlePositions,
      ignoredUnlinkedMentionKeys: nextIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
      articleVersions: currentArticleVersions,
    };

    setWorkspace(snapshot);
    setConnectionValidationError(null);
    setSelectedArticleId(updatedArticle.id);
    rememberSelectedArticle(updatedArticle.id);
    selectGraphArticle(updatedArticle.id);
    activateTab("graph");
    void saveWorkspace(snapshot);
  }

  function ignoreUnlinkedMention(mentionId: string) {
    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    if (currentIgnoredUnlinkedMentionKeys.includes(mentionId)) {
      return;
    }

    const nextIgnoredUnlinkedMentionKeys = [...currentIgnoredUnlinkedMentionKeys, mentionId];
    const snapshot: WorkspaceSnapshot = {
      selectedArticleId,
      articles: currentArticles,
      relations: currentRelations,
      articlePositions: currentArticlePositions,
      ignoredUnlinkedMentionKeys: nextIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
      articleVersions: currentArticleVersions,
    };

    setWorkspace(snapshot);
    void saveWorkspace(snapshot);
  }

  function removeRelationBetweenArticles(
    fromArticleId: string,
    toArticleId: string,
    relationType: WorkspaceRelation["relationType"] = "manual",
  ) {
    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    if (fromArticleId === toArticleId) {
      return;
    }

    if (relationType === "explicit") {
      const sourceArticle = currentArticles.find((article) => article.id === fromArticleId);
      const targetArticle = currentArticles.find((article) => article.id === toArticleId);

      if (!sourceArticle || !targetArticle) {
        return;
      }

      const nextSource = stripExplicitWikilinksToTarget(sourceArticle.source, targetArticle.title);

      if (nextSource === sourceArticle.source) {
        return;
      }

      const updatedArticle: WorkspaceArticle = {
        ...sourceArticle,
        source: nextSource,
        updatedAt: "agora",
      };
      const nextArticles = currentArticles.map((article) =>
        article.id === updatedArticle.id ? updatedArticle : article,
      );
      const nextSubmittedArticles = nextArticles.filter(isSubmittedArticle);
      const nextRelations = rebuildExplicitRelations(nextSubmittedArticles, currentRelations);
      const mentionKey = unlinkedMentionKey(sourceArticle.id, targetArticle.id);
      const nextIgnoredUnlinkedMentionKeys = currentIgnoredUnlinkedMentionKeys.includes(mentionKey)
        ? currentIgnoredUnlinkedMentionKeys
        : [...currentIgnoredUnlinkedMentionKeys, mentionKey];
      const snapshot: WorkspaceSnapshot = {
        selectedArticleId: updatedArticle.id,
        articles: nextArticles,
        relations: nextRelations,
        articlePositions: currentArticlePositions,
        ignoredUnlinkedMentionKeys: nextIgnoredUnlinkedMentionKeys,
        imageAssets: currentImageAssets,
        articleVersions: currentArticleVersions,
      };

      setWorkspace(snapshot);
      setSelectedArticleId(updatedArticle.id);
      rememberSelectedArticle(updatedArticle.id);
      selectGraphArticle(updatedArticle.id);
      void saveWorkspace(snapshot);
      return;
    }

    const relationPair =
      relationType === "manual"
        ? relationPairKey(fromArticleId, toArticleId)
        : `${fromArticleId}->${toArticleId}`;
    const removedRelation = currentRelations.find(
      (relation) =>
        relation.relationType === relationType &&
        (relationType === "manual"
          ? relationPairKey(relation.fromArticleId, relation.toArticleId) === relationPair
          : `${relation.fromArticleId}->${relation.toArticleId}` === relationPair),
    );

    if (!removedRelation) {
      return;
    }

    const nextRelations = currentRelations.filter(
      (relation) =>
        relation.relationType !== relationType ||
        (relationType === "manual"
          ? relationPairKey(relation.fromArticleId, relation.toArticleId) !== relationPair
          : `${relation.fromArticleId}->${relation.toArticleId}` !== relationPair),
    );

    const snapshot: WorkspaceSnapshot = {
      selectedArticleId,
      articles: currentArticles,
      relations: nextRelations,
      articlePositions: currentArticlePositions,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
      articleVersions: currentArticleVersions,
    };

    setWorkspace(snapshot);
    void saveWorkspace(snapshot);
  }

  function openArticleEditor(articleId: string) {
    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    const articleToEdit = currentArticles.find((article) => article.id === articleId);

    if (!articleToEdit || isViewOnlyArticle(articleToEdit)) {
      return;
    }

    selectGraphArticle(articleId);
    updateSelectedArticle(articleId);
    activateTab("editor");
  }

  function openArticleViewer(articleId: string) {
    const articleToView = currentArticles.find((article) => article.id === articleId);

    if (!articleToView) {
      return;
    }

    selectGraphArticle(articleId);
    updateSelectedArticle(articleId);
    activateTab("editor");
  }

  async function exportArticlePdf(articleId: string) {
    const articleToExport = currentArticles.find((article) => article.id === articleId);

    if (!articleToExport) {
      await requestAppAlert({
        body: isEnglish
          ? "Could not find the article to export."
          : "Não foi possível encontrar o artigo para exportar.",
        confirmLabel: "OK",
        eyebrow: isEnglish ? "Export" : "Exportação",
        title: isEnglish ? "PDF export failed" : "A exportação falhou",
        tone: "danger",
      });
      return;
    }

    if (isViewOnlyArticle(articleToExport) && !isImportedPdfArticle(articleToExport)) {
      openArticleViewer(articleId);
      return;
    }

    try {
      const articleImageAssets = currentImageAssets.filter(
        (imageAsset) =>
          imageAsset.articleId === articleToExport.id ||
          (!imageAsset.articleId && articleUsesImageAsset(articleToExport, imageAsset)),
      );
      const response = await fetch("/api/compile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authAccessToken ? { Authorization: `Bearer ${authAccessToken}` } : {}),
        },
        body: JSON.stringify({
          articleId: articleToExport.id,
          imageAssets: articleImageAssets,
          title: articleToExport.title,
          source: articleToExport.source,
        }),
      });

      if (!response.ok) {
        throw new Error(
          await getFriendlyResponseError(response, appLanguage, {
            context: "compile",
            fallback: isEnglish ? "Could not export the PDF." : "Não foi possível exportar o PDF.",
          }),
        );
      }

      const pdfBlob = await response.blob();
      const downloadUrl = URL.createObjectURL(pdfBlob);
      const downloadLink = document.createElement("a");

      downloadLink.href = downloadUrl;
      downloadLink.download = getSafePdfDownloadName(articleToExport.title);
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (error) {
      await requestAppAlert({
        body: getFriendlyErrorMessage(error, appLanguage, {
          context: "compile",
          fallback: isEnglish ? "Could not export the PDF." : "Não foi possível exportar o PDF.",
        }),
        confirmLabel: "OK",
        eyebrow: isEnglish ? "Export" : "Exportação",
        title: isEnglish ? "PDF export failed" : "A exportação falhou",
        tone: "danger",
      });
    }
  }

  async function importPdfArticle(pdfFile: File): Promise<PdfImportResult> {
    if (!canEditCurrentWorkspace) {
      throw new Error("pdf-import-read-only");
    }

    const digest = await crypto.subtle.digest("SHA-256", await pdfFile.arrayBuffer());
    const fingerprint = `% papergraph-pdf-sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (currentArticles.some((article) => article.source.includes(fingerprint))) return { status: "skipped" };
    const importedArticleId = createBrowserUuid();
    const extractedPdf = await extractPdfTextForAcademicRelations(pdfFile);
    const importedArticleTitle = extractedPdf.metadata.title ?? getTitleFromPdfFileName(pdfFile.name, appLanguage);
    const importedAcademicText = extractedPdf.text;
    const importedPdfDois = extractedPdf.metadata.doi ? [extractedPdf.metadata.doi] : [];
    const importedArxivDois = extractArxivIdsFromText(`${pdfFile.name}\n${importedArticleTitle}\n${importedAcademicText.split("\f")[0]}`).map(
      (arxivId) => `10.48550/arXiv.${arxivId}`,
    );
    const identity = { title: extractedPdf.metadata.title ?? "", doi: importedPdfDois[0] ?? importedArxivDois[0] };
    if (currentArticles.some((article) => samePaper(identity, articleIdentity(article)))) return { status: "skipped" };
    if (displayedWorkspaceIdRef.current !== accountWorkspaceId) throw new Error("Workspace changed");
    const formData = new FormData();

    formData.append("asset", pdfFile);
    formData.append("articleId", importedArticleId);

    const response = await fetch("/api/images", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(
        await getFriendlyResponseError(response, appLanguage, {
          context: "import",
          fallback: isEnglish ? "Could not import the PDF." : "Não foi possível importar o PDF.",
        }),
      );
    }

    let uploadedPdfAsset: WorkspaceImageAsset = {
      ...((await response.json()) as WorkspaceImageAsset),
      articleId: importedArticleId,
    };

    if (supabase && authUser && accountWorkspace) {
      uploadedPdfAsset = await uploadWorkspaceAssetToSupabase(supabase, accountWorkspace.id, uploadedPdfAsset, pdfFile);
    }

    const importedArticle: WorkspaceArticle = {
      id: importedArticleId,
      title: importedArticleTitle,
      abstract: extractedPdf.metadata.abstract ?? "",
      author: "PaperGraph",
      status: "Published",
      updatedAt: "agora",
      tags: Array.from(new Set([isEnglish ? "imported" : "importado", ...importedPdfDois, ...importedArxivDois])),
      source: `${fingerprint}\n${createImportedPdfSource(uploadedPdfAsset, importedAcademicText, extractedPdf.metadata)}`,
    };
    const warning = await commitImportedArticle(importedArticle, uploadedPdfAsset);
    return { status: "imported", warning };
  }

  async function addRecommendedArticle(paper: RecommendedPaper, signal: AbortSignal) {
    if (!canEditCurrentWorkspace || !accountWorkspaceId || !authAccessToken || !activeGraphArticle) throw new Error("read-only");
    if (currentArticles.some((article) => samePaper(paper, articleIdentity(article)))) return;
    const response = await fetch("/api/recommendations", { method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authAccessToken}` },
      body: JSON.stringify({ action: "prepare-add", workspaceId: accountWorkspaceId, articleId: activeGraphArticle.id, externalId: paper.externalId }) });
    if (!response.ok) throw new Error("Could not prepare article import");
    const payload = await response.json() as { existingId: string | null; article: WorkspaceArticle | null };
    signal.throwIfAborted();
    if (payload.existingId) return;
    if (!payload.article) throw new Error("Missing article metadata");
    await commitImportedArticle(payload.article, undefined, true, signal);
  }

  async function commitImportedArticle(importedArticle: WorkspaceArticle, uploadedPdfAsset?: WorkspaceImageAsset, keepSelection = false, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (displayedWorkspaceIdRef.current !== accountWorkspaceId) throw new Error("Workspace changed");
    if (currentArticles.some((article) => article.id === importedArticle.id || (keepSelection && samePaper(articleIdentity(article), articleIdentity(importedArticle))))) return;
    const nextArticles = [...currentArticles, importedArticle];
    const nextImageAssets = uploadedPdfAsset ? [
      uploadedPdfAsset,
      ...currentImageAssets.filter((imageAsset) => imageAsset.id !== uploadedPdfAsset.id),
    ] : currentImageAssets;
    const nextArticlePositions = {
      ...currentArticlePositions,
      [importedArticle.id]: calculateNextArticlePosition(currentArticles),
    };
    const nextArticleVersions = addArticleVersion(currentArticleVersions, importedArticle);
    const nextSubmittedArticles = nextArticles.filter(isSubmittedArticle);
    const academicRefresh = await refreshAcademicRelations(nextSubmittedArticles, currentRelations);
    const snapshot: WorkspaceSnapshot = {
      selectedArticleId: keepSelection ? selectedArticleId : importedArticle.id,
      articles: nextArticles,
      relations: academicRefresh.relations,
      articlePositions: nextArticlePositions,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: nextImageAssets,
      articleVersions: nextArticleVersions,
    };

    await saveWorkspace(snapshot, true);
    if (displayedWorkspaceIdRef.current !== accountWorkspaceId) return;
    setWorkspace(snapshot);
    setConnectionValidationError(academicRefresh.issue ?? null);
    setPendingEditorNavigation(null);
    if (!keepSelection) {
      setSelectedArticleId(importedArticle.id);
      rememberSelectedArticle(importedArticle.id);
      selectGraphArticle(importedArticle.id);
    }
    if (!keepSelection) activateTab("graph");
    return academicRefresh.issue;
  }

  function addImageAsset(imageAsset: WorkspaceImageAsset) {
    if (!canEditCurrentWorkspace) {
      showReadOnlyWorkspaceError();
      return;
    }

    const scopedImageAsset = {
      ...imageAsset,
      articleId: imageAsset.articleId ?? selectedArticleId,
    };
    const nextImageAssets = [
      scopedImageAsset,
      ...currentImageAssets.filter((currentImageAsset) => currentImageAsset.id !== scopedImageAsset.id),
    ];
    const snapshot: WorkspaceSnapshot = {
      selectedArticleId,
      articles: currentArticles,
      relations: currentRelations,
      articlePositions: currentArticlePositions,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: nextImageAssets,
      articleVersions: currentArticleVersions,
    };

    setWorkspace(snapshot);
    void saveWorkspace(snapshot);
  }

  async function deleteLocalWorkspaceAssetMirror(storagePath: string) {
    const storedName = getStoredNameFromWorkspaceAssetPath(storagePath);
    const response = await fetch(
      `/api/images/${encodeURIComponent(storedName)}?path=${encodeURIComponent(storagePath)}`,
      {
        method: "DELETE",
        headers: authAccessToken
          ? {
              Authorization: `Bearer ${authAccessToken}`,
            }
          : undefined,
      },
    );

    if (!response.ok && response.status !== 404) {
      throw new Error(
        await getFriendlyResponseError(response, appLanguage, {
          context: "delete",
          fallback: isEnglish ? "Could not remove the file." : "Não foi possível remover o ficheiro.",
        }),
      );
    }
  }

  async function deleteWorkspaceAssetFiles(workspaceId: string) {
    if (!supabase || !authUser) {
      return;
    }

    const storagePaths = [...new Set(await listWorkspaceAssetStoragePathsFromSupabase(supabase, workspaceId))];

    if (storagePaths.length === 0) {
      return;
    }

    for (let index = 0; index < storagePaths.length; index += 100) {
      const batch = storagePaths.slice(index, index + 100);
      const { error } = await supabase.storage.from(paperGraphAssetBucket).remove(batch);

      if (error) {
        throw new Error(
          getFriendlyErrorMessage(error, appLanguage, {
            context: "delete",
            fallback: isEnglish ? "Could not remove workspace files." : "Não foi possível remover os ficheiros da workspace.",
          }),
        );
      }
    }

    await Promise.all(storagePaths.map(deleteLocalWorkspaceAssetMirror));
  }

  async function deleteStoredImageAssetFile(imageAsset: WorkspaceImageAsset) {
    if (imageAsset.storagePath && supabase && authUser) {
      const { error } = await supabase.storage.from(paperGraphAssetBucket).remove([imageAsset.storagePath]);

      if (error) {
        throw new Error(
          getFriendlyErrorMessage(error, appLanguage, {
            context: "delete",
            fallback: isEnglish ? "Could not remove the file." : "Não foi possível remover o ficheiro.",
          }),
        );
      }
    }

    await deleteLocalWorkspaceAssetMirror(imageAsset.storagePath ?? imageAsset.storedName);
  }

  async function deleteImageAsset(imageAsset: WorkspaceImageAsset) {
    if (!canEditCurrentWorkspace) {
      throw new Error(getReadOnlyWorkspaceMessage());
    }

    await deleteStoredImageAssetFile(imageAsset);

    const nextImageAssets = currentImageAssets.filter((currentImageAsset) => currentImageAsset.id !== imageAsset.id);
    const snapshot: WorkspaceSnapshot = {
      selectedArticleId,
      articles: currentArticles,
      relations: currentRelations,
      articlePositions: currentArticlePositions,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: nextImageAssets,
      articleVersions: currentArticleVersions,
    };

    setWorkspace(snapshot);
    void saveWorkspace(snapshot);
  }

  async function deleteArticle(articleId: string) {
    if (!canEditCurrentWorkspace) {
      throw new Error(getReadOnlyWorkspaceMessage());
    }

    const articleToDelete = currentArticles.find((article) => article.id === articleId);

    if (!articleToDelete) {
      throw new Error(
        isEnglish
          ? "Could not find the article to remove."
          : "Não foi possível encontrar o artigo para remover.",
      );
    }

    const articleImageAssets = currentImageAssets.filter(
      (imageAsset) =>
        imageAsset.articleId === articleId ||
        (!imageAsset.articleId && articleUsesImageAsset(articleToDelete, imageAsset)),
    );

    await Promise.all(articleImageAssets.map(deleteStoredImageAssetFile));

    const nextArticles = currentArticles.filter((article) => article.id !== articleId);
    const nextSubmittedArticles = nextArticles.filter(isSubmittedArticle);
    const nextPersistentRelations = currentRelations.filter(
      (relation) =>
        relation.fromArticleId !== articleId &&
        relation.toArticleId !== articleId,
    );
    const nextRelations = rebuildExplicitRelations(nextSubmittedArticles, nextPersistentRelations);
    const nextArticlePositions = Object.fromEntries(
      Object.entries(currentArticlePositions).filter(([currentArticleId]) => currentArticleId !== articleId),
    ) as Record<string, ArticlePosition>;
    const nextIgnoredUnlinkedMentionKeys = currentIgnoredUnlinkedMentionKeys.filter((ignoredKey) => {
      const [sourceArticleId, targetArticleId] = ignoredKey.split("->");

      return sourceArticleId !== articleId && targetArticleId !== articleId;
    });
    const nextSelectedArticleId =
      selectedArticleId === articleId
        ? nextSubmittedArticles[0]?.id ?? nextArticles[0]?.id ?? ""
        : selectedArticleId;
    const nextGraphSelectedArticleId =
      graphSelectedArticleId === articleId
        ? null
        : graphSelectedArticleId;
    const nextImageAssets = currentImageAssets.filter((imageAsset) => imageAsset.articleId !== articleId);
    const nextArticleVersions = currentArticleVersions.filter((version) => version.articleId !== articleId);
    const snapshot: WorkspaceSnapshot = {
      selectedArticleId: nextSelectedArticleId,
      articles: nextArticles,
      relations: nextRelations,
      articlePositions: nextArticlePositions,
      ignoredUnlinkedMentionKeys: nextIgnoredUnlinkedMentionKeys,
      imageAssets: nextImageAssets,
      articleVersions: nextArticleVersions,
    };

    setWorkspace(snapshot);
    setConnectionValidationError(null);
    setPendingEditorNavigation(null);
    setPendingEditorResubmission(null);
    setRestoredEditorVersion((currentVersion) =>
      currentVersion?.articleId === articleId ? null : currentVersion,
    );
    setEditorSelection((currentSelection) =>
      currentSelection?.articleId === articleId ? null : currentSelection,
    );
    setSelectedArticleId(nextSelectedArticleId);
    rememberSelectedArticle(nextSelectedArticleId);
    selectGraphArticle(nextGraphSelectedArticleId);
    if (supabase && accountWorkspaceId) {
      void deleteArticleCollaborationStateFromSupabase(supabase, accountWorkspaceId, articleId).catch(() => undefined);
    }
    void saveWorkspace(snapshot);
  }

  function updateArticlePositions(nextPositions: Record<string, ArticlePosition>) {
    if (!canEditCurrentWorkspace) {
      return;
    }

    const normalizedPositions = normalizeArticlePositionsForArticles(currentArticles, nextPositions);
    const snapshot: WorkspaceSnapshot = {
      selectedArticleId,
      articles: currentArticles,
      relations: currentRelations,
      articlePositions: normalizedPositions,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
      articleVersions: currentArticleVersions,
    };

    setWorkspace(snapshot);
    void saveWorkspace(snapshot);
  }

  if (!authUser) {
    return (
      <AuthLanding
        authMode={authMode}
        email={authEmail}
        name={authName}
        password={authPassword}
        error={authError}
        isLoading={isAuthLoading}
        isSubmitting={isAuthSubmitting}
        language={appLanguage}
        status={authStatus}
        supabaseConfigured={Boolean(supabase)}
        onEmailChange={setAuthEmail}
        onLanguageChange={setAppLanguage}
        onModeChange={(mode) => {
          setAuthMode(mode);
          setAuthError(null);
          setAuthStatus(null);
        }}
        onNameChange={setAuthName}
        onPasswordChange={setAuthPassword}
        onSubmit={handleAuthSubmit}
      />
    );
  }

  return (
    <div data-theme={appTheme} className="papergraph-app h-screen overflow-hidden text-[var(--foreground)]">
      <main className="flex h-full min-h-0 w-full flex-col overflow-hidden border border-transparent bg-[var(--surface)] shadow-[var(--shadow)] backdrop-blur-xl">
        <header className="flex flex-col gap-4 border-b border-[var(--border)] px-6 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="relative h-[4.4rem] w-[17rem] overflow-hidden" aria-label="PaperGraph">
            <Image
              src={paperGraphLogoText}
              alt="PaperGraph"
              priority
              className="absolute left-[-5.95rem] top-[-6.28rem] h-auto w-[28rem] max-w-none"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setSettingsSection("workspaces");
              requestTabChange("settings");
            }}
            className="w-full rounded-[18px] border border-[var(--border)] bg-white/5 px-4 py-3 text-left transition-colors hover:bg-white/10 sm:w-auto sm:min-w-[16rem]"
          >
            <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
              {isEnglish ? "Active workspace" : "Workspace ativa"}
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-white">
              {accountWorkspace?.name ?? (isEnglish ? "Local workspace" : "Workspace local")}
            </p>
            {accountWorkspace ? (
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                {onlinePresenceCount <= 1
                  ? isEnglish
                    ? "Only you online"
                    : "Só tu online"
                  : isEnglish
                    ? `${onlinePresenceCount} online now`
                    : `${onlinePresenceCount} online agora`}
              </p>
            ) : null}
          </button>
        </header>

        <div className="border-b border-[var(--border)] px-4 py-4 lg:px-5">
          <div className="grid gap-3 md:grid-cols-4">
            {tabs.map((tab) => {
              const isActive = activeTab === tab;
              const isDisabled = isMainTabDisabled(tab);
              const disabledTitle = getMainTabDisabledTitle(tab);

              return (
                <button
                  key={tab}
                  type="button"
                  disabled={isDisabled}
                  title={disabledTitle}
                  onClick={() => requestTabChange(tab)}
                  className={`relative rounded-[24px] border px-4 py-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                    isActive
                      ? "border-[var(--accent)] bg-[rgba(142,231,255,0.14)]"
                      : "border-[var(--border)] bg-white/5 hover:bg-white/10"
                  }`}
                >
                  {tab === "settings" && activeTab !== "settings" ? (
                    <NotificationBadge
                      count={pendingWorkspaceInviteCount}
                      className="absolute -right-2 -top-2"
                    />
                  ) : null}
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                    {getTabLabel(tab)}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-white">
                    {getTabDescription(tab)}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {loadError ? (
          <div className="border-b border-[var(--border)] bg-red-500/10 px-6 py-3 text-sm text-red-200 lg:px-8">
            {loadError}
            {workspaceRecovery?.workspaceId === accountWorkspaceId && workspaceRecovery ? (
              <button type="button" className="ml-3 underline" onClick={() => {
                const recovery = workspaceRecovery;
                const url = URL.createObjectURL(new Blob([JSON.stringify(recovery.snapshot, null, 2)], { type: "application/json" }));
                const link = document.createElement("a");
                link.href = url; link.download = `papergraph-recovery-${recovery.workspaceId}-${Date.now()}.json`;
                link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
                void loadCloudWorkspace(recovery.workspaceId);
              }}>
                {isEnglish ? "Download local copy and reload" : "Descarregar cópia local e recarregar"}
              </button>
            ) : null}
          </div>
        ) : null}

        <section
          className={`flex min-h-0 flex-1 flex-col ${
            activeTab === "graph" ? "p-0" : "gap-5 px-4 py-4 lg:px-6 lg:py-6"
          }`}
        >
          {activeTab === "drafts" ? (
            <div className="flex min-h-0 flex-1">
              <aside className="flex min-h-0 flex-1 flex-col gap-5 rounded-[28px] border border-[var(--border)] bg-[var(--surface-strong)] p-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                    {isEnglish ? "Drafts" : "Rascunhos"}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <h2 className="text-xl font-semibold text-white">
                      {isEnglish ? "Articles to submit" : "Artigos por submeter"}
                    </h2>
                    <button
                      type="button"
                      disabled={!canEditCurrentWorkspace}
                      onClick={createNewArticle}
                      className="rounded-full border border-[var(--border)] bg-white/5 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {isEnglish ? "New article" : "Novo artigo"}
                    </button>
                  </div>
                </div>

                {draftArticles.length > 0 ? (
                  <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto pr-1">
                    <ArticleLibrary
                      articles={draftArticles}
                      language={appLanguage}
                      selectedArticleId={selectedDraftArticle?.id ?? ""}
                      onSelectArticle={updateSelectedArticle}
                      renderArticleActions={(article) => (
                        <button
                          type="button"
                          disabled={!canEditCurrentWorkspace}
                          onClick={() => openArticleEditor(article.id)}
                          className="rounded-full border border-[var(--border)] bg-[var(--accent)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isEnglish ? "Edit draft" : "Editar rascunho"}
                        </button>
                      )}
                    />
                  </div>
                ) : (
                  <div className="rounded-[24px] border border-[var(--border)] bg-black/15 p-5 text-sm leading-6 text-[var(--muted)]">
                    {isEnglish
                      ? "No drafts are waiting for submission."
                      : "Não há rascunhos à espera de submissão."}
                  </div>
                )}
              </aside>
            </div>
          ) : null}

          {activeTab === "editor" ? (
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {selectedArticle && shouldUseArticleViewer ? (
                <ArticleViewerPane
                  workspaceId={accountWorkspaceId ?? undefined}
                  key={`viewer-${selectedArticle.id}-${selectedArticle.status}-${selectedArticle.title}-${selectedArticle.tags.join("|")}`}
                  article={selectedArticle}
                  articleCollaborators={articlePresence}
                  authAccessToken={authAccessToken}
                  articleVersions={selectedArticleVersions}
                  canEditMetadata={canEditCurrentWorkspace && selectedArticleIsImportedPdf}
                  imageAssets={selectedArticleImageAssets}
                  language={appLanguage}
                  onSaveArticleMetadata={updateArticleMetadata}
                />
              ) : selectedArticle ? (
                <EditorPane
                  key={selectedArticle.id}
                  article={selectedArticle}
                  articleCollaborators={articlePresence}
                  articleVersions={selectedArticleVersions}
                  canRestoreArticleVersion={selectedArticleCanBeEdited}
                  collaborationClientId={collaborationClientId}
                  collaborationUserName={collaborationUserName}
                  onSaveArticle={updateArticleDetails}
                  onSubmitArticle={submitArticle}
                  onRestoreArticleVersion={restoreArticleVersion}
                  isAcademicRelationsRunning={isAcademicRelationsRunning}
                  isSubmissionRunning={isArticleSubmissionRunning}
                  submissionIssue={connectionValidationError}
                  language={appLanguage}
                  onSubmissionIssueClear={() => setConnectionValidationError(null)}
                  onPendingResubmissionChange={updatePendingEditorResubmission}
                  imageAssets={selectedArticleImageAssets}
                  onImageUploaded={addImageAsset}
                  onImageDeleted={deleteImageAsset}
                  onEditorSelectionChange={setEditorSelection}
                  authAccessToken={authAccessToken}
                  restoredVersion={
                    restoredEditorVersion?.articleId === selectedArticle.id ? restoredEditorVersion : null
                  }
                  workspaceId={accountWorkspace?.id ?? null}
                />
              ) : (
                <div className="flex flex-1 items-center justify-center rounded-[28px] border border-[var(--border)] bg-[var(--surface-strong)] p-6 text-center">
                  <div className="max-w-md">
                    <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                      {isEnglish ? "Editor" : "Editor"}
                    </p>
                    <h2 className="mt-2 text-xl font-semibold text-white">
                      {isEnglish ? "No article selected" : "Nenhum artigo selecionado"}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                      {isEnglish
                        ? "Create a draft to start writing in the workspace."
                        : "Cria um rascunho para começar a escrever na workspace."}
                    </p>
                    <button
                      type="button"
                      disabled={!canEditCurrentWorkspace}
                      onClick={createNewArticle}
                      className="mt-5 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isEnglish ? "New article" : "Novo artigo"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {activeTab === "graph" ? (
            <div className="relative flex min-h-0 flex-1 overflow-hidden">
              <GraphPane
                key={accountWorkspaceId}
                workspaceId={accountWorkspaceId ?? ""}
                accessToken={authAccessToken ?? ""}
                onAddRecommendation={addRecommendedArticle}
                activeArticle={activeGraphArticle}
                articles={submittedArticles}
                language={appLanguage}
                relations={currentRelations}
                unlinkedMentions={activeArticleUnlinkedMentions}
                articlePositions={currentArticlePositions}
                articlePresenceByArticleId={workspacePresenceByArticleId}
                canEdit={canEditCurrentWorkspace}
                isAcademicRelationsRunning={isAcademicRelationsRunning}
                onSelectArticle={updateGraphSelectedArticle}
                onArticlePositionsChange={updateArticlePositions}
                onCreateRelation={(fromArticleId, toArticleId) => {
                  createRelationBetweenArticles(fromArticleId, toArticleId);
                }}
                onRemoveRelation={removeRelationBetweenArticles}
                onCreateWikilinkFromMention={createWikilinkFromUnlinkedMention}
                onIgnoreUnlinkedMention={ignoreUnlinkedMention}
                onEditArticle={openArticleEditor}
                onViewArticle={openArticleViewer}
                onExportArticlePdf={exportArticlePdf}
                onImportPdfArticle={importPdfArticle}
                onDeleteArticle={deleteArticle}
              />
            </div>
          ) : null}

          {activeTab === "settings" ? (
            <div className="scrollbar-hidden grid min-h-0 flex-1 gap-5 overflow-y-auto lg:grid-cols-[20rem_minmax(0,1fr)]">
              <aside className="flex flex-col gap-5 rounded-[28px] border border-[var(--border)] bg-[var(--surface-strong)] p-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                    {isEnglish ? "Settings" : "Definições"}
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-white">PaperGraph</h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                    {isEnglish
                      ? "Manage language, theme, workspaces, help and account."
                      : "Gere idioma, tema, workspaces, ajuda e conta."}
                  </p>
                </div>

                <div className="space-y-2">
                  {settingsSections.map((section) => {
                    const isActiveSection = settingsSection === section;

                    return (
                      <button
                        key={section}
                        type="button"
                        onClick={() => setSettingsSection(section)}
                        className={`relative w-full rounded-[18px] border p-3 text-left transition-colors ${
                          isActiveSection
                            ? "border-[var(--accent)] bg-[rgba(142,231,255,0.14)]"
                            : "border-[var(--border)] bg-black/15 hover:bg-white/8"
                        }`}
                      >
                        {section === "workspaces" ? (
                          <NotificationBadge
                            count={pendingWorkspaceInviteCount}
                            className="absolute -right-2 -top-2"
                          />
                        ) : null}
                        <p className="text-sm font-semibold text-white">{getSettingsSectionLabel(section)}</p>
                        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                          {getSettingsSectionDescription(section)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <section className="scrollbar-hidden min-h-0 overflow-y-auto rounded-[28px] border border-[var(--border)] bg-[var(--surface-strong)] p-5">
                {settingsSection === "general" ? (
                  <div className="space-y-5">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                        {isEnglish ? "General" : "Geral"}
                      </p>
                      <h2 className="mt-2 text-xl font-semibold text-white">
                        {isEnglish ? "Interface language" : "Idioma da interface"}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                        {isEnglish
                          ? "The setting is saved in this browser and updates the workspace interface."
                          : "A escolha fica guardada neste browser e atualiza a interface da workspace."}
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {(["pt", "en"] as const).map((language) => {
                        const isActiveLanguage = appLanguage === language;

                        return (
                          <button
                            key={language}
                            type="button"
                            onClick={() => setAppLanguage(language)}
                            className={`rounded-[20px] border p-4 text-left transition-colors ${
                              isActiveLanguage
                                ? "border-[var(--accent)] bg-[rgba(142,231,255,0.14)]"
                                : "border-[var(--border)] bg-black/15 hover:bg-white/8"
                            }`}
                          >
                            <p className="text-sm font-semibold text-white">
                              {language === "pt" ? "Português" : "English"}
                            </p>
                            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                              {language === "pt"
                                ? "Interface principal em português."
                                : "Main interface in English."}
                            </p>
                          </button>
                        );
                      })}
                    </div>

                    <section className="space-y-3 rounded-[22px] border border-[var(--border)] bg-black/15 p-4">
                      <div>
                        <h3 className="text-base font-semibold text-white">
                          {isEnglish ? "Theme" : "Tema"}
                        </h3>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        {(["dark", "light"] as const).map((theme) => {
                          const isActiveTheme = appTheme === theme;

                          return (
                            <button
                              key={theme}
                              type="button"
                              onClick={() => setAppTheme(theme)}
                              className={`rounded-[20px] border p-4 text-left transition-colors ${
                                isActiveTheme
                                  ? "border-[var(--accent)] bg-[rgba(142,231,255,0.14)]"
                                  : "border-[var(--border)] bg-white/5 hover:bg-white/8"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-semibold text-white">
                                  {theme === "dark"
                                    ? isEnglish
                                      ? "Dark"
                                      : "Escuro"
                                    : isEnglish
                                      ? "Light"
                                      : "Claro"}
                                </p>
                                <span
                                  className={`h-4 w-4 rounded-full border ${
                                    theme === "dark"
                                      ? "border-slate-400 bg-[#0a0f14]"
                                      : "border-sky-300 bg-[#edf5fb]"
                                  }`}
                                />
                              </div>
                              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                                {theme === "dark"
                                  ? isEnglish
                                    ? "Current default theme for graph-heavy work."
                                    : "Tema padrao atual para trabalho focado no mapa."
                                  : isEnglish
                                    ? "Brighter theme for reading and review."
                                    : "Tema mais claro para leitura e revisao."}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  </div>
                ) : null}

                {settingsSection === "workspaces" ? (
                  <div className="space-y-5">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                        {isEnglish ? "Workspaces" : "Workspaces"}
                      </p>
                      <h2 className="mt-2 text-xl font-semibold text-white">
                        {isEnglish ? "Your article maps" : "Os teus mapas de artigos"}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                        {isEnglish
                          ? "Each workspace has its own articles, files, relations, graph layout and members."
                          : "Cada workspace tem os seus próprios artigos, ficheiros, ligações, layout do mapa e membros."}
                      </p>
                    </div>

                    {!supabase ? (
                      <div className="rounded-[20px] border border-red-300/30 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
                        {isEnglish
                          ? "Supabase is not configured, so cloud workspaces are not available."
                          : "O Supabase não está configurado, por isso as workspaces cloud não estão disponíveis."}
                      </div>
                    ) : null}

                    {!authUser ? (
                      <div className="rounded-[20px] border border-[var(--border)] bg-black/15 p-4 text-sm leading-6 text-[var(--muted)]">
                        {isEnglish
                          ? "Sign in to create and switch between cloud workspaces."
                          : "Inicia sessão para criar e alternar entre workspaces cloud."}
                      </div>
                    ) : (
                      <>
                        {pendingWorkspaceInvites.length > 0 ? (
                          <section className="space-y-3 rounded-[22px] border border-[var(--accent)] bg-[rgba(142,231,255,0.08)] p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                                  {isEnglish ? "Received invites" : "Convites recebidos"}
                                </p>
                                <h3 className="mt-2 text-lg font-semibold text-white">
                                  {isEnglish ? "Workspaces waiting for you" : "Workspaces à tua espera"}
                                </h3>
                              </div>
                              <NotificationBadge count={pendingWorkspaceInviteCount} />
                            </div>

                            <div className="grid gap-3 xl:grid-cols-2">
                              {pendingWorkspaceInvites.map((invite) => (
                                <article
                                  key={invite.id}
                                  className="relative rounded-[18px] border border-[var(--border)] bg-black/15 p-4 pr-12"
                                >
                                  <button
                                    type="button"
                                    disabled={isInviteActionRunning}
                                    aria-label={isEnglish ? "Decline invite" : "Recusar convite"}
                                    title={isEnglish ? "Decline invite" : "Recusar convite"}
                                    onClick={() => {
                                      void handleDeclineWorkspaceInvite(invite);
                                    }}
                                    className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-red-300/30 bg-red-500/15 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <span className="relative h-5 w-5 overflow-hidden">
                                      <Image
                                        src={deleteButtonImage}
                                        alt=""
                                        aria-hidden
                                        className="papergraph-delete-icon-dark absolute left-1/2 top-1/2 h-[2.7rem] w-[4rem] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain"
                                      />
                                      <Image
                                        src={deleteButtonImageInverted}
                                        alt=""
                                        aria-hidden
                                        className="papergraph-delete-icon-light absolute left-1/2 top-1/2 h-[2.7rem] w-[4rem] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain"
                                      />
                                    </span>
                                  </button>
                                  <p className="text-base font-semibold text-white">{invite.workspaceName}</p>
                                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                                    {isEnglish ? "Invited by" : "Convite de"}{" "}
                                    {invite.invitedByName ?? invite.invitedByEmail ?? "PaperGraph"}
                                  </p>
                                  <p className="mt-1 text-xs text-[var(--muted)]">
                                    {isEnglish ? "Expires" : "Expira"}: {formatWorkspaceDate(invite.expiresAt, appLanguage)}
                                  </p>
                                  <button
                                    type="button"
                                    disabled={isInviteActionRunning}
                                    onClick={() => {
                                      void handleAcceptWorkspaceInvite(invite);
                                    }}
                                    className="mt-4 w-full rounded-full border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {isEnglish ? "Accept invite" : "Aceitar convite"}
                                  </button>
                                </article>
                              ))}
                            </div>
                          </section>
                        ) : null}

                        {accountWorkspace ? (
                          <div className="grid gap-3 xl:grid-cols-2">
                            <section className="space-y-3 rounded-[22px] border border-[var(--border)] bg-black/15 p-4">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                                    {isEnglish ? "Members" : "Membros"}
                                  </p>
                                  <h3 className="mt-2 text-lg font-semibold text-white">
                                    {isEnglish ? "Current workspace" : "Workspace ativa"}
                                  </h3>
                                </div>
                                <span className="rounded-full border border-[var(--border)] bg-black/20 px-3 py-1 text-xs text-[var(--muted)]">
                                  {workspaceMembers.length}
                                </span>
                              </div>

                              {workspaceMembers.length > 0 ? (
                                <div className="max-h-[18rem] space-y-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                  {workspaceMembers.map((member) => {
                                    const canManageMember =
                                      isWorkspaceOwner && member.role !== "owner" && member.userId !== authUser?.id;
                                    const isMemberActionRunning = memberActionUserId === member.userId;
                                    const isRemovingMember = isMemberActionRunning && memberActionKind === "remove";
                                    const isTransferringOwnership = isMemberActionRunning && memberActionKind === "transfer";
                                    const memberPresence = workspacePresenceByUserId.get(member.userId);
                                    const isMemberOnline = member.userId === authUser?.id || Boolean(memberPresence);

                                    return (
                                      <article
                                        key={member.userId}
                                        className="rounded-[18px] border border-white/10 bg-white/[0.04] p-3.5 shadow-[0_12px_30px_rgba(0,0,0,0.12)]"
                                      >
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                          <div className="flex min-w-0 items-center gap-3">
                                            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[rgba(142,231,255,0.28)] bg-[rgba(142,231,255,0.12)] text-sm font-semibold text-[var(--accent)]">
                                              {getDisplayInitials(member.displayName ?? member.email ?? member.userId)}
                                            </div>
                                            <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-white">
                                              {member.displayName ?? member.email ?? member.userId}
                                            </p>
                                            {member.email ? (
                                              <p className="mt-1 truncate text-xs text-[var(--muted)]">{member.email}</p>
                                            ) : null}
                                            <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
                                              <span
                                                className={`inline-flex h-2 w-2 rounded-full ${
                                                  isMemberOnline ? "bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.65)]" : "bg-white/20"
                                                }`}
                                              />
                                              <span>
                                                {isMemberOnline
                                                  ? isEnglish
                                                    ? "Online"
                                                    : "Online"
                                                  : isEnglish
                                                    ? "Offline"
                                                    : "Offline"}
                                              </span>
                                              {memberPresence ? (
                                                <span className="truncate">
                                                  · {getPresenceModeLabel(memberPresence.mode, appLanguage)}
                                                  {memberPresence.articleTitle ? `: ${memberPresence.articleTitle}` : ""}
                                                </span>
                                              ) : null}
                                            </p>
                                            </div>
                                          </div>

                                          {canManageMember ? (
                                            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                                              <WorkspaceRoleToggle
                                                disabled={Boolean(memberActionUserId)}
                                                language={appLanguage}
                                                onChange={(role) => {
                                                  void handleWorkspaceMemberRoleChange(member, role);
                                                }}
                                                size="sm"
                                                value={getEditableWorkspaceMemberRole(member.role)}
                                              />
                                              <button
                                                type="button"
                                                disabled={Boolean(memberActionUserId)}
                                                onClick={() => {
                                                  void handleTransferWorkspaceOwnership(member);
                                                }}
                                                className="rounded-full border border-amber-200/35 bg-amber-400/12 px-3.5 py-2 text-[11px] font-semibold text-amber-100 transition-colors hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50 darkmode-safe-transfer-button"
                                              >
                                                {isTransferringOwnership
                                                  ? isEnglish
                                                    ? "Transferring..."
                                                    : "A transferir..."
                                                  : isEnglish
                                                    ? "Transfer owner"
                                                    : "Transferir dono"}
                                              </button>
                                              <button
                                                type="button"
                                                disabled={Boolean(memberActionUserId)}
                                                onClick={() => {
                                                  void handleRemoveWorkspaceMember(member);
                                                }}
                                                className="rounded-full border border-red-300/30 bg-red-500/15 px-3.5 py-2 text-[11px] font-semibold text-red-100 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                                              >
                                                {isRemovingMember
                                                  ? isEnglish
                                                    ? "Removing..."
                                                    : "A remover..."
                                                  : isEnglish
                                                    ? "Remove"
                                                    : "Remover"}
                                              </button>
                                            </div>
                                          ) : (
                                            <span className="shrink-0 rounded-full border border-[var(--border)] bg-white/5 px-3 py-1 text-[11px] font-semibold text-[var(--muted)]">
                                              {formatWorkspaceRole(member.role, appLanguage)}
                                            </span>
                                          )}
                                        </div>
                                      </article>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="rounded-[16px] border border-[var(--border)] bg-white/[0.03] p-3 text-sm leading-6 text-[var(--muted)]">
                                  {isEnglish ? "No members loaded yet." : "Ainda não há membros carregados."}
                                </p>
                              )}
                            </section>

                            <section className="space-y-3 rounded-[22px] border border-[var(--border)] bg-black/15 p-4">
                              <div>
                                <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                                  {isEnglish ? "Invites" : "Convites"}
                                </p>
                                <h3 className="mt-2 text-lg font-semibold text-white">
                                  {isEnglish ? "Invite by email" : "Convidar por email"}
                                </h3>
                                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                                  {accountWorkspace.role === "owner"
                                    ? isEnglish
                                      ? "The invite appears when that person signs in with the same email."
                                      : "O convite aparece quando essa pessoa entrar com o mesmo email."
                                    : isEnglish
                                      ? "Only the workspace owner can invite new members."
                                      : "Só o dono da workspace pode convidar novos membros."}
                                </p>
                              </div>

                              {accountWorkspace.role === "owner" ? (
                                <>
                                  <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end" onSubmit={handleCreateWorkspaceInvite}>
                                    <label className="min-w-0">
                                      <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                                        Email
                                      </span>
                                      <input
                                        type="email"
                                        value={workspaceInviteEmail}
                                        onChange={(event) => setWorkspaceInviteEmail(event.target.value)}
                                        placeholder={isEnglish ? "friend@example.com" : "amigo@example.com"}
                                        className="mt-2 w-full rounded-[16px] border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
                                      />
                                    </label>
                                    <fieldset className="min-w-0 lg:col-span-2">
                                      <legend className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                                        {isEnglish ? "Role" : "Cargo"}
                                      </legend>
                                      <WorkspaceRoleToggle
                                        className="mt-2 w-full sm:w-[18rem]"
                                        language={appLanguage}
                                        onChange={(role) => setWorkspaceInviteRole(role)}
                                        value={workspaceInviteRole}
                                      />
                                    </fieldset>
                                    <button
                                      type="submit"
                                      disabled={isInviteActionRunning}
                                      className="self-end rounded-full border border-[var(--accent)] bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 lg:col-start-2 lg:row-start-1"
                                    >
                                      {isInviteActionRunning
                                        ? isEnglish
                                          ? "Sending..."
                                          : "A enviar..."
                                        : isEnglish
                                          ? "Invite"
                                          : "Convidar"}
                                    </button>
                                  </form>

                                  {workspaceInvites.length > 0 ? (
                                    <div className="max-h-[16rem] space-y-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                      {workspaceInvites.map((invite) => (
                                        <article
                                          key={invite.id}
                                          className="rounded-[18px] border border-white/10 bg-white/[0.04] p-3.5 shadow-[0_12px_30px_rgba(0,0,0,0.12)]"
                                        >
                                          <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                              <p className="truncate text-sm font-semibold text-white">{invite.invitedEmail}</p>
                                              <p className="mt-1 text-xs text-[var(--muted)]">
                                                {formatInviteStatus(invite.status, appLanguage)} ·{" "}
                                                {isEnglish ? "expires" : "expira"}{" "}
                                                {formatWorkspaceDate(invite.expiresAt, appLanguage)}
                                              </p>
                                              <p className="mt-1 text-xs text-[var(--muted)]">
                                                {isEnglish ? "Role" : "Cargo"}: {formatWorkspaceRole(invite.role, appLanguage)}
                                              </p>
                                            </div>
                                            {invite.status === "pending" ? (
                                              <button
                                                type="button"
                                                disabled={isInviteActionRunning}
                                                onClick={() => {
                                                  void handleRevokeWorkspaceInvite(invite);
                                                }}
                                                className="shrink-0 rounded-full border border-red-300/30 bg-red-500/15 px-3 py-1 text-[11px] font-semibold text-red-100 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                                              >
                                                {isEnglish ? "Revoke" : "Revogar"}
                                              </button>
                                            ) : null}
                                          </div>
                                        </article>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="rounded-[16px] border border-[var(--border)] bg-white/[0.03] p-3 text-sm leading-6 text-[var(--muted)]">
                                      {isEnglish ? "No invites yet." : "Ainda não há convites."}
                                    </p>
                                  )}
                                </>
                              ) : null}
                            </section>
                          </div>
                        ) : null}

                        <form
                          className="grid gap-3 rounded-[22px] border border-[var(--border)] bg-black/15 p-4 md:grid-cols-[minmax(0,1fr)_auto]"
                          onSubmit={handleCreateAccountWorkspace}
                        >
                          <label className="min-w-0">
                            <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                              {isEnglish ? "New workspace" : "Nova workspace"}
                            </span>
                            <input
                              type="text"
                              value={newWorkspaceName}
                              onChange={(event) => setNewWorkspaceName(event.target.value)}
                              placeholder={isEnglish ? "e.g. Dissertation papers" : "ex. Artigos da dissertação"}
                              className="mt-2 w-full rounded-[16px] border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
                            />
                          </label>
                          <button
                            type="submit"
                            disabled={isWorkspaceActionRunning}
                            className="self-end rounded-full border border-[var(--accent)] bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isWorkspaceActionRunning
                              ? isEnglish
                                ? "Working..."
                                : "A processar..."
                              : isEnglish
                                ? "Create workspace"
                                : "Criar workspace"}
                          </button>
                        </form>

                        <section className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                              {isEnglish ? "Available maps" : "Mapas disponíveis"}
                            </p>
                            <span className="rounded-full border border-[var(--border)] bg-black/20 px-3 py-1 text-xs text-[var(--muted)]">
                              {accountWorkspaces.length}
                            </span>
                          </div>

                          {accountWorkspaces.length > 0 ? (
                            <div className="grid gap-3 xl:grid-cols-2">
                              {accountWorkspaces.map((workspaceItem) => {
                                const isActiveWorkspace = workspaceItem.id === accountWorkspace?.id;

                                return (
                                  <article
                                    key={workspaceItem.id}
                                    className={`rounded-[22px] border p-4 transition-colors ${
                                      isActiveWorkspace
                                        ? "border-[var(--accent)] bg-[rgba(142,231,255,0.1)]"
                                        : "border-[var(--border)] bg-black/15"
                                    }`}
                                  >
                                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                      <div className="min-w-0">
                                        <p className="truncate text-lg font-semibold text-white">{workspaceItem.name}</p>
                                        <p className="mt-2 text-sm text-[var(--muted)]">
                                          {isEnglish ? "Role" : "Cargo"}: {formatWorkspaceRole(workspaceItem.role, appLanguage)}
                                        </p>
                                        <p className="mt-1 text-xs text-[var(--muted)]">
                                          {isEnglish ? "Updated" : "Atualizada"}:{" "}
                                          {formatWorkspaceDate(workspaceItem.updatedAt, appLanguage)}
                                        </p>
                                        <p className="mt-1 truncate text-xs text-[var(--muted)]">ID: {workspaceItem.id}</p>
                                      </div>
                                      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                                        {workspaceItem.role === "owner" ? (
                                          <>
                                            <button
                                              type="button"
                                              disabled={isWorkspaceActionRunning}
                                              onClick={() => {
                                                void handleRenameAccountWorkspace(workspaceItem);
                                              }}
                                              className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                              {isEnglish ? "Rename" : "Renomear"}
                                            </button>
                                            <button
                                              type="button"
                                              disabled={isWorkspaceActionRunning}
                                              onClick={() => {
                                                void handleDeleteAccountWorkspace(workspaceItem);
                                              }}
                                              className="rounded-full border border-red-300/30 bg-red-500/15 px-4 py-2 text-xs font-semibold text-red-100 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                              {isEnglish ? "Delete" : "Eliminar"}
                                            </button>
                                          </>
                                        ) : null}
                                        <button
                                          type="button"
                                          disabled={isWorkspaceActionRunning || isActiveWorkspace}
                                          onClick={() => {
                                            void switchAccountWorkspace(workspaceItem);
                                          }}
                                          className={`rounded-full border px-4 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                                            isActiveWorkspace
                                              ? "border-[var(--accent)] bg-[rgba(142,231,255,0.12)] text-[var(--accent)]"
                                              : "border-[var(--border)] bg-white/5 text-white hover:bg-white/10"
                                          }`}
                                        >
                                          {isActiveWorkspace
                                            ? isEnglish
                                              ? "Current"
                                              : "Atual"
                                            : isEnglish
                                              ? "Open"
                                              : "Abrir"}
                                        </button>
                                      </div>
                                    </div>
                                  </article>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="rounded-[20px] border border-[var(--border)] bg-black/15 p-4 text-sm leading-6 text-[var(--muted)]">
                              {isEnglish
                                ? "No workspaces were returned by Supabase yet. Refresh after running the bootstrap SQL."
                                : "O Supabase ainda não devolveu workspaces. Atualiza depois de correr o SQL de bootstrap."}
                            </div>
                          )}
                        </section>
                      </>
                    )}

                    {authStatus ? (
                      <p className="rounded-[18px] border border-[rgba(142,231,255,0.25)] bg-[rgba(142,231,255,0.08)] px-4 py-3 text-sm leading-6 text-[var(--accent)]">
                        {authStatus}
                      </p>
                    ) : null}

                    {authError ? (
                      <p className="rounded-[18px] border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100">
                        {authError}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {settingsSection === "help" ? (
                  <HelpSection language={appLanguage} />
                ) : null}

                {settingsSection === "account" ? (
                  <div className="space-y-5">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                        {isEnglish ? "Profile and session" : "Perfil e sessão"}
                      </p>
                      <h2 className="mt-2 text-xl font-semibold text-white">
                        {isEnglish ? "Account" : "Conta"}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                        {isEnglish
                          ? "Manage your session and public display name."
                          : "Gere a tua sessão e o nome visível do perfil."}
                      </p>
                    </div>

                    {!supabase ? (
                      <div className="rounded-[20px] border border-red-300/30 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
                        {isEnglish
                          ? "Supabase is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local."
                          : "O Supabase não está configurado. Confirma NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY no .env.local."}
                      </div>
                    ) : null}

                    <div className="max-w-4xl">
                      <section className="rounded-[20px] border border-[var(--border)] bg-black/15 p-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                          {isEnglish ? "Current session" : "Sessão atual"}
                        </p>

                        {isAuthLoading ? (
                          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                            {isEnglish ? "Checking session..." : "A confirmar sessão..."}
                          </p>
                        ) : authUser ? (
                          <div className="mt-3 space-y-3">
                            <div>
                              <p className="text-base font-semibold text-white">
                                {visibleAccountName ?? (isEnglish ? "Connected account" : "Conta ligada")}
                              </p>
                              {authUser.email ? (
                                <p className="mt-1 truncate text-sm text-[var(--muted)]">{authUser.email}</p>
                              ) : null}
                              <p className="mt-1 truncate text-xs text-[var(--muted)]">{authUser.id}</p>
                            </div>

                            <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={handleProfileNameSubmit}>
                              <label className="min-w-0">
                                <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                                  {isEnglish ? "Display name" : "Nome visível"}
                                </span>
                                <input
                                  type="text"
                                  value={profileNameDraft}
                                  onChange={(event) => setProfileNameDraft(event.target.value)}
                                  minLength={2}
                                  className="mt-2 w-full rounded-[16px] border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
                                />
                              </label>
                              <button
                                type="submit"
                                disabled={isAuthSubmitting}
                                className="self-end rounded-full border border-[var(--border)] bg-white/5 px-4 py-3 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isEnglish ? "Save name" : "Guardar nome"}
                              </button>
                            </form>

                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={isAuthSubmitting || isAccountDeletionRunning}
                                onClick={() => {
                                  void handleSignOut();
                                }}
                                className="rounded-full border border-red-300/30 bg-red-500/15 px-4 py-2 text-xs font-semibold text-red-100 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isAuthSubmitting
                                  ? isEnglish
                                    ? "Signing out..."
                                    : "A sair..."
                                  : isEnglish
                                    ? "Sign out"
                                    : "Terminar sessão"}
                              </button>
                              <button
                                type="button"
                                disabled={isAuthSubmitting || isAccountDeletionRunning}
                                onClick={() => {
                                  void handleDeleteAccount();
                                }}
                                className="rounded-full border border-red-300/40 bg-red-600/20 px-4 py-2 text-xs font-semibold text-red-100 transition-colors hover:bg-red-600/30 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isAccountDeletionRunning
                                  ? isEnglish
                                    ? "Deleting..."
                                    : "A apagar..."
                                  : isEnglish
                                    ? "Delete account"
                                    : "Eliminar conta"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <form className="mt-3 space-y-3" onSubmit={handleAuthSubmit}>
                            <div className="grid grid-cols-2 gap-2">
                              {(["sign-in", "sign-up"] as const).map((mode) => {
                                const isActiveMode = authMode === mode;

                                return (
                                  <button
                                    key={mode}
                                    type="button"
                                    onClick={() => {
                                      setAuthMode(mode);
                                      setAuthError(null);
                                      setAuthStatus(null);
                                    }}
                                    className={`rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${
                                      isActiveMode
                                        ? "border-[var(--accent)] bg-[rgba(142,231,255,0.14)] text-white"
                                        : "border-[var(--border)] bg-white/5 text-[var(--muted)] hover:bg-white/10 hover:text-white"
                                    }`}
                                  >
                                    {mode === "sign-in"
                                      ? isEnglish
                                        ? "Sign in"
                                        : "Entrar"
                                      : isEnglish
                                        ? "Create account"
                                        : "Criar conta"}
                                  </button>
                                );
                              })}
                            </div>

                            <label className="block">
                              <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                                Email
                              </span>
                              <input
                                type="email"
                                value={authEmail}
                                onChange={(event) => setAuthEmail(event.target.value)}
                                required
                                placeholder={isEnglish ? "you@example.com" : "tu@example.com"}
                                className="mt-2 w-full rounded-[16px] border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
                              />
                            </label>

                            <label className="block">
                              <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                                {isEnglish ? "Password" : "Password"}
                              </span>
                              <input
                                type="password"
                                value={authPassword}
                                onChange={(event) => setAuthPassword(event.target.value)}
                                required
                                minLength={6}
                                placeholder={isEnglish ? "At least 6 characters" : "Pelo menos 6 caracteres"}
                                className="mt-2 w-full rounded-[16px] border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
                              />
                            </label>

                            <button
                              type="submit"
                              disabled={isAuthSubmitting || !supabase}
                              className="w-full rounded-full border border-[var(--accent)] bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isAuthSubmitting
                                ? isEnglish
                                  ? "Working..."
                                  : "A processar..."
                                : authMode === "sign-in"
                                  ? isEnglish
                                    ? "Sign in"
                                    : "Entrar"
                                  : isEnglish
                                    ? "Create account"
                                    : "Criar conta"}
                            </button>
                          </form>
                        )}
                      </section>
                    </div>

                    {authStatus ? (
                      <p className="rounded-[18px] border border-[rgba(142,231,255,0.25)] bg-[rgba(142,231,255,0.08)] px-4 py-3 text-sm leading-6 text-[var(--accent)]">
                        {authStatus}
                      </p>
                    ) : null}

                    {authError ? (
                      <p className="rounded-[18px] border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100">
                        {authError}
                      </p>
                    ) : null}
                  </div>
                ) : null}

              </section>
            </div>
          ) : null}
        </section>
      </main>

      {shouldShowUnlinkedToast && activeGraphArticle ? (
        <div className="fixed right-6 top-6 z-[120] flex w-[min(24rem,calc(100%_-_3rem))] items-stretch overflow-hidden rounded-[22px] border border-[rgba(142,231,255,0.36)] bg-[rgba(9,19,29,0.92)] shadow-[0_20px_55px_rgba(0,0,0,0.35)] backdrop-blur-xl [animation:papergraph-toast-in_220ms_ease-out]">
          <button
            type="button"
            onClick={() => {
              activateTab("graph");
              selectGraphArticle(activeGraphArticle.id);
              setDismissedUnlinkedToastKey(activeUnlinkedToastKey);
            }}
            className="min-w-0 flex-1 px-4 py-3 text-left"
          >
            <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--accent)]">
              {isEnglish ? "Unlinked mentions" : "Menções não ligadas"}
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              {activeArticleUnlinkedMentions.length}{" "}
              {activeArticleUnlinkedMentions.length === 1
                ? isEnglish
                  ? "possible connection found"
                  : "possível conexão encontrada"
                : isEnglish
                  ? "possible connections found"
                  : "possíveis conexões encontradas"}
            </p>
            <p className="mt-1 truncate text-xs text-[var(--muted)]">
              {isEnglish ? "In" : "Em"} {activeGraphArticle.title}
            </p>
          </button>
          <button
            type="button"
            aria-label={isEnglish ? "Close unlinked mentions notification" : "Fechar notificação de menções não ligadas"}
            onClick={() => setDismissedUnlinkedToastKey(activeUnlinkedToastKey)}
            className="border-l border-[var(--border)] px-3 text-sm font-semibold text-[var(--muted)] transition-colors hover:bg-white/8 hover:text-white"
          >
            ×
          </button>
        </div>
      ) : null}

      {appDialog
        ? (() => {
            const isPrompt = appDialog.kind === "prompt";
            const isAlert = appDialog.kind === "alert";
            const isConfirmDisabled =
              isPrompt && appDialog.confirmationValue
                ? appDialogValue.trim() !== appDialog.confirmationValue
                : false;
            const confirmButtonClassName =
              appDialog.tone === "danger"
                ? "border-red-300/30 bg-red-500/18 text-red-50 hover:bg-red-500/26"
                : appDialog.tone === "warning"
                  ? "border-amber-200/30 bg-amber-300/18 text-amber-50 hover:bg-amber-300/26"
                  : "border-[var(--accent)] bg-[var(--accent)] text-[#041016] hover:-translate-y-0.5";

            return (
              <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
                <form
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="app-dialog-title"
                  className="w-full max-w-md rounded-[24px] border border-[var(--border)] bg-[var(--surface-strong)] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.45)]"
                  onSubmit={(event) => {
                    event.preventDefault();

                    if (isConfirmDisabled) {
                      return;
                    }

                    closeAppDialog({ confirmed: true, value: isPrompt ? appDialogValue : undefined });
                  }}
                >
                  {appDialog.eyebrow ? (
                    <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">{appDialog.eyebrow}</p>
                  ) : null}
                  <h2 id="app-dialog-title" className="mt-2 text-xl font-semibold text-white">
                    {appDialog.title}
                  </h2>
                  {appDialog.body ? (
                    <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{appDialog.body}</p>
                  ) : null}

                  {isPrompt ? (
                    <label className="mt-5 block">
                      <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                        {appDialog.inputLabel ?? (isEnglish ? "Confirmation" : "Confirmação")}
                      </span>
                      <input
                        autoFocus
                        type="text"
                        value={appDialogValue}
                        onChange={(event) => setAppDialogValue(event.target.value)}
                        placeholder={appDialog.confirmationValue ?? appDialog.inputDefaultValue}
                        className="mt-2 w-full rounded-[16px] border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[var(--accent)]"
                      />
                      {appDialog.confirmationValue ? (
                        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                          {isEnglish ? "Type exactly" : "Escreve exatamente"}{" "}
                          <span className="font-semibold text-white">&quot;{appDialog.confirmationValue}&quot;</span>.
                        </p>
                      ) : null}
                    </label>
                  ) : null}

                  <div className={`mt-5 grid gap-3 ${isAlert ? "" : "sm:grid-cols-2"}`}>
                    {!isAlert ? (
                      <button
                        type="button"
                        onClick={() => closeAppDialog({ confirmed: false })}
                        className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                      >
                        {appDialog.cancelLabel ?? (isEnglish ? "Cancel" : "Cancelar")}
                      </button>
                    ) : null}
                    <button
                      type="submit"
                      disabled={isConfirmDisabled}
                      className={`rounded-full border px-4 py-3 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${confirmButtonClassName}`}
                    >
                      {appDialog.confirmLabel ?? (isAlert ? "OK" : isEnglish ? "Confirm" : "Confirmar")}
                    </button>
                  </div>
                </form>
              </div>
            );
          })()
        : null}

      {pendingEditorNavigation && pendingEditorResubmission ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pending-resubmission-title"
            className="w-full max-w-md rounded-[24px] border border-[var(--border)] bg-[rgba(9,19,29,0.96)] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.45)]"
          >
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
              {isEnglish ? "Pending changes" : "Alterações pendentes"}
            </p>
            <h2 id="pending-resubmission-title" className="mt-2 text-xl font-semibold text-white">
              {isEnglish ? "Leave without resubmitting?" : "Sair sem resubmeter?"}
            </h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              {isEnglish
                ? "The changes made to this article have not been applied to the graph yet."
                : "As mudanças feitas neste artigo ainda não foram aplicadas ao mapa."}
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={isArticleSubmissionRunning}
                onClick={leaveEditorWithoutResubmitting}
                className="rounded-full border border-[var(--border)] bg-white/5 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isEnglish ? "Leave without resubmitting" : "Sair sem resubmeter"}
              </button>
              <button
                type="button"
                disabled={isArticleSubmissionRunning}
                onClick={resubmitEditorAndContinue}
                className="rounded-full border border-[var(--accent)] bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[#041016] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isArticleSubmissionRunning
                  ? isEnglish
                    ? "Compiling..."
                    : "A compilar..."
                  : isEnglish
                    ? "Resubmit article"
                    : "Resubmeter artigo"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
