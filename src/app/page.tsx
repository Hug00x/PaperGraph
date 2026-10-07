"use client";

import { AppDialog } from "@/components/app-dialog";
import { AnaraSettings } from "@/components/anara-settings";
import type { ResearchCandidate } from '../../electron/research-contract.cjs';
import { ProfilePhotoControl } from "@/components/profile-photo-control";
import { UserAvatar } from "@/components/user-avatar";
import { useAppDialog } from "@/lib/use-app-dialog";
import { getWorkspaceNavigationLabels, settingsSections, type SettingsSection } from "@/lib/workspace-navigation";

import {
  tabs,
  type WorkspaceTab,
  getStoredActiveWorkspaceId,
  rememberActiveWorkspaceId,
  shouldKeepWorkspacesEmpty,
  rememberShouldKeepWorkspacesEmpty,
  getStoredWorkspaceUiState,
  rememberWorkspaceUiState,
  forgetWorkspaceUiState,
} from "@/lib/workspace-ui-state";
import {
  type EditableWorkspaceMemberRole,
  normalizeDisplayName,
  getAuthUserFallbackDisplayName,
  normalizeWorkspaceName,
  getStoredNameFromWorkspaceAssetPath,
  formatWorkspaceDate,
  formatWorkspaceRole,
  getEditableWorkspaceMemberRole,
  formatInviteStatus,
} from "@/lib/workspace-presentation";
import { WorkspaceRoleToggle } from "@/components/workspace-role-toggle";
import { HelpSection } from "@/components/help-section";
import { NotificationBadge } from "@/components/notification-badge";
import {
  type WorkspacePresenceMode,
  type WorkspacePresence,
  flattenPresenceState,
  getPresenceModeLabel,
  createPresenceClientId,
} from "@/lib/workspace-presence";
import {
  relationPairKey,
  unlinkedMentionKey,
  unlinkedMentionToastKey,
  findUnlinkedMentions,
  replaceFirstUnlinkedTitleMention,
  stripExplicitWikilinksToTarget,
  validateExplicitLinkTargets,
  rebuildExplicitRelations,
  mergeAcademicRelations,
} from "@/lib/article-links";
import {
  getTitleFromPdfFileName,
  getSafePdfDownloadName,
  extractPdfTextForAcademicRelations,
  createImportedPdfSource,
} from "@/lib/pdf-article";
import { calculateNextArticlePosition, normalizeArticlePositionsForArticles, mergeArticlePositions } from "@/lib/article-positions";

import { extractArxivIds } from "../lib/academic/arxiv.ts";

import { createBrowserUuid } from "../lib/browser-uuid.ts";

import type { GraphZone } from "@/lib/graph-zones";

import { isImportedPdfArticle, isViewOnlyArticle } from "@/lib/article-presentation";

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
} from "@/lib/supabase-workspace";
import { deleteArticleCollaborationStateFromSupabase } from "@/lib/supabase-collaboration";
import { getSupabaseBrowserClient } from "@/lib/supabase-client";
import { paperGraphAssetBucket, uploadWorkspaceAssetToSupabase } from "@/lib/supabase-storage";
import { useWorkspaceLive } from "@/lib/use-workspace-live";
import { getFriendlyErrorMessage, getFriendlyResponseError } from "@/lib/friendly-errors";
import Image from "next/image";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";

const apiPath = "/api/workspace";
const maxArticleVersionsPerArticle = 50;
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
function isAcademicRelationDiagnostics(value: unknown): value is AcademicRelationDiagnostics {
  return Boolean(value) && typeof value === "object";
}

function isSubmittedArticle(article: WorkspaceArticle): article is WorkspaceArticle & { status: SubmittedArticleStatus } {
  return article.status !== "Draft";
}

function articleUsesImageAsset(article: WorkspaceArticle, imageAsset: WorkspaceImageAsset) {
  return article.source.includes(imageAsset.storedName) || article.source.includes(imageAsset.originalName);
}

export default function Home() {
  useEffect(() => {
    const preventBrowserContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    document.addEventListener("contextmenu", preventBrowserContextMenu);

    return () => {
      document.removeEventListener("contextmenu", preventBrowserContextMenu);
    };
  }, []);

  const [workspace, setWorkspaceState] = useState<WorkspaceSnapshot>(defaultSnapshot);
  const workspaceRef = useRef<WorkspaceSnapshot>(defaultSnapshot);
  const setWorkspace = useCallback((snapshot: WorkspaceSnapshot) => {
    const next = { ...snapshot,
      persistenceSession: snapshot.persistenceSession === undefined ? workspaceRef.current.persistenceSession : snapshot.persistenceSession,
    };
    workspaceRef.current = next;
    setWorkspaceState(next);
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
  const {
    appDialog,
    appDialogValue,
    setAppDialogValue,
    closeAppDialog,
    requestAppConfirm,
    requestAppPrompt,
    requestAppAlert,
  } = useAppDialog();
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
  const pendingSavesRef = useRef(0);
  const isEnglish = appLanguage === "en";
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [presenceClientId] = useState(createPresenceClientId);
  const presenceChannelRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);
  const currentPresencePayloadRef = useRef<WorkspacePresence | null>(null);
  const presenceLocationKeyRef = useRef<string | null>(null);
  const presenceEnteredAtRef = useRef<string>(new Date().toISOString());
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

  useEffect(() => {
    if (activeTab !== "settings" || settingsSection !== "workspaces" || !accountWorkspace) return;
    const refresh = () => { void loadWorkspaceCollaboration(accountWorkspace); };
    refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 45 * 60 * 1000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [activeTab, settingsSection, accountWorkspace, loadWorkspaceCollaboration]);

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
  const graphLive = useWorkspaceLive({
    client: supabase, workspaceId: accountWorkspaceId, clientId: presenceClientId,
    userName: collaborationUserName, language: appLanguage, canEdit: canEditCurrentWorkspace,
    read: () => pendingSavesRef.current || isArticleSubmissionRunning || hasPendingEditorResubmission || workspaceRecovery ||
      displayedWorkspaceIdRef.current !== accountWorkspaceId ? null : workspaceRef.current,
    apply: setWorkspace,
  });

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

  const { getTabLabel, getTabDescription, getSettingsSectionLabel, getSettingsSectionDescription } =
    getWorkspaceNavigationLabels(appLanguage, shouldUseArticleViewer);

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
    pendingSavesRef.current++;

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
      } finally {
        pendingSavesRef.current--;
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
      zones: workspace.zones,
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
      zones: workspace.zones,
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
      zones: workspace.zones,
      ignoredUnlinkedMentionKeys: currentIgnoredUnlinkedMentionKeys,
      imageAssets: currentImageAssets,
      articleVersions: currentArticleVersions,
    };

    setWorkspace(snapshot);
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
      zones: workspace.zones,
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
      (existingRelation) =>
        existingRelation.relationType !== "manual" ||
        relationPairKey(existingRelation.fromArticleId, existingRelation.toArticleId) !== nextPairKey,
    );
    const nextArticles = currentArticles;
    const nextArticlePositions = currentArticlePositions;

    const snapshot: WorkspaceSnapshot = {
      selectedArticleId: fromArticleId,
      articles: nextArticles,
      relations: [relation, ...nextRelations],
      articlePositions: nextArticlePositions,
      zones: workspace.zones,
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
      zones: workspace.zones,
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
      zones: workspace.zones,
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
        zones: workspace.zones,
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
      zones: workspace.zones,
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
    const importedArxivDois = extractArxivIds(`${pdfFile.name}\n${importedArticleTitle}\n${importedAcademicText.split("\f")[0]}`).map(
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

  async function addResearchArticle(candidate: ResearchCandidate, seedId: string, signal: AbortSignal) {
    if (!canEditCurrentWorkspace || !accountWorkspaceId || !authAccessToken) throw new Error('read-only');
    const scopedWorkspace = accountWorkspaceId;
    const duplicate = currentArticles.find(article => samePaper({ ...candidate, externalId: candidate.openAlexId }, articleIdentity(article)));
    if (duplicate) return duplicate.id;
    const response = await fetch('/api/research-papers', { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authAccessToken}` },
      body: JSON.stringify({ workspaceId: scopedWorkspace, articleId: seedId, candidate }) });
    if (!response.ok) throw new Error('Could not resolve research paper');
    const payload = await response.json() as { existingId: string | null; article: WorkspaceArticle | null };
    signal.throwIfAborted();
    if (displayedWorkspaceIdRef.current !== scopedWorkspace) throw new Error('Workspace changed');
    if (payload.existingId) return payload.existingId;
    if (!payload.article) throw new Error('Missing canonical metadata');
    await commitImportedArticle(payload.article, undefined, true, signal);
    return payload.article.id;
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
      zones: workspace.zones,
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
      zones: workspace.zones,
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
      zones: workspace.zones,
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
      zones: workspace.zones,
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

  function updateArticlePositions(nextPositions: Record<string, ArticlePosition>, nextZones = workspace.zones) {
    if (!canEditCurrentWorkspace) {
      return;
    }

    const normalizedPositions = normalizeArticlePositionsForArticles(currentArticles, nextPositions);
    const snapshot: WorkspaceSnapshot = {
      selectedArticleId,
      articles: currentArticles,
      relations: currentRelations,
      articlePositions: normalizedPositions,
      zones: nextZones,
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

                  canAnnotate={canEditCurrentWorkspace}
                  imageAssets={selectedArticleImageAssets}
                  language={appLanguage}

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
                imageAssets={currentImageAssets}
                key={accountWorkspaceId}
                workspaceId={accountWorkspaceId ?? ""}
                accessToken={authAccessToken ?? ""}
                onAddRecommendation={addRecommendedArticle}
                onAddResearchPaper={addResearchArticle}
                activeArticle={activeGraphArticle}
                articles={submittedArticles}
                language={appLanguage}
                relations={currentRelations}
                unlinkedMentions={activeArticleUnlinkedMentions}
                articlePositions={currentArticlePositions}
                zones={workspace.zones}
                graphPeers={graphLive.peers}
                onGraphActivity={graphLive.updateActivity}
                onZonesChange={(zones: GraphZone[], positions: Record<string, ArticlePosition>) => updateArticlePositions(positions, zones)}
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

                {settingsSection === "anara" ? <AnaraSettings isEnglish={isEnglish} /> : null}

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
                                            <UserAvatar name={member.displayName ?? member.email ?? member.userId} url={member.avatarUrl} />
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

                            {supabase ? (
                              <ProfilePhotoControl key={authUser.id} supabase={supabase} userId={authUser.id}
                                name={visibleAccountName} language={appLanguage}
                                disabled={isAuthSubmitting || isAccountDeletionRunning}
                                onChanged={() => loadWorkspaceCollaboration(accountWorkspace)} />
                            ) : null}

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

      {appDialog ? (
        <AppDialog
          appDialog={appDialog}
          appDialogValue={appDialogValue}
          isEnglish={isEnglish}
          setAppDialogValue={setAppDialogValue}
          closeAppDialog={closeAppDialog}
        />
      ) : null}

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
