import type { AppLanguage } from "./portuguese-labels.ts";
import type { WorkspaceTab } from "./workspace-ui-state.ts";

export const settingsSections = ["general", "workspaces", "help", "account"] as const;
export type SettingsSection = (typeof settingsSections)[number];
export function getWorkspaceNavigationLabels(appLanguage: AppLanguage, shouldUseArticleViewer: boolean) {
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

  return { getTabLabel, getTabDescription, getSettingsSectionLabel, getSettingsSectionDescription };
}
