import type { AppLanguage } from "@/lib/portuguese-labels";

export type FriendlyErrorContext =
  | "auth"
  | "compile"
  | "delete"
  | "import"
  | "preview"
  | "storage"
  | "upload"
  | "workspace"
  | "generic";

type FriendlyErrorOptions = {
  context?: FriendlyErrorContext;
  fallback?: string;
  status?: number;
};

function text(language: AppLanguage, pt: string, en: string) {
  return language === "en" ? en : pt;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }

  return "";
}

function normalizeMessage(message: string) {
  return message.replace(/\s+/g, " ").trim();
}

function shortenTechnicalMessage(message: string, maxLength = 520) {
  const cleaned = normalizeMessage(
    message
      .replace(/Command failed:\s*[^:]+tectonic\.exe\s*/i, "")
      .replace(/C:\\[^\s]+/gi, "[ficheiro local]")
      .replace(/\/[^\s]+/g, "[ficheiro local]")
      .replace(/warning:\s*/gi, "")
      .replace(/error:\s*/gi, "Erro: "),
  );

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, maxLength).trim()}...`;
}

function getCompileErrorMessage(rawMessage: string, language: AppLanguage) {
  if (/^Erro LaTeX na linha \d+:/i.test(rawMessage)) {
    return rawMessage;
  }

  const latexErrorMatch = rawMessage.match(/article\.tex:(\d+):\s*([^\r\n.]+)/i);

  if (latexErrorMatch) {
    return text(
      language,
      `Erro LaTeX na linha ${latexErrorMatch[1]}: ${latexErrorMatch[2].trim()}.`,
      `LaTeX error on line ${latexErrorMatch[1]}: ${latexErrorMatch[2].trim()}.`,
    );
  }

  if (/tectonic.*(not found|não foi encontrado)|executável tectonic/i.test(rawMessage)) {
    return text(
      language,
      "O compilador LaTeX não está instalado. Reinstala as dependências do projeto e tenta compilar novamente.",
      "The LaTeX compiler is not installed. Reinstall the project dependencies and try compiling again.",
    );
  }

  if (/report\.cls|fullyjustified|failure fetching|failed to download|network/i.test(rawMessage)) {
    return text(
      language,
      "O compilador LaTeX tentou descarregar pacotes e não conseguiu. Confirma a ligação à internet ou usa uma classe/pacote já disponível localmente.",
      "The LaTeX compiler tried to download packages and could not. Check the internet connection or use a class/package already available locally.",
    );
  }

  if (/Missing \$ inserted/i.test(rawMessage)) {
    return text(
      language,
      "Erro LaTeX: falta um símbolo `$` ou há conteúdo matemático fora de modo matemático.",
      "LaTeX error: a `$` is missing or mathematical content is outside math mode.",
    );
  }

  if (/file .* not found|no such file|cannot find/i.test(rawMessage)) {
    return text(
      language,
      "O LaTeX não encontrou um ficheiro referenciado. Confirma se a imagem/PDF foi carregado neste artigo e se o nome está correto.",
      "LaTeX could not find a referenced file. Check that the image/PDF was uploaded to this article and that the name is correct.",
    );
  }

  return shortenTechnicalMessage(rawMessage) || text(language, "A compilação LaTeX falhou.", "LaTeX compilation failed.");
}

export function getFriendlyErrorMessage(
  error: unknown,
  language: AppLanguage,
  { context = "generic", fallback, status }: FriendlyErrorOptions = {},
) {
  const rawMessage = getErrorMessage(error);
  const normalizedMessage = normalizeMessage(rawMessage);

  if (/^HTTP \d+$/i.test(normalizedMessage)) {
    return fallback ?? text(language, "O servidor não conseguiu concluir o pedido.", "The server could not complete the request.");
  }

  if (status === 401 || /invalid jwt|jwt expired|refresh token|auth session missing|session missing|sessão supabase inválida|invalid session|not authenticated/i.test(normalizedMessage)) {
    return text(
      language,
      "A sessão expirou. Termina sessão e volta a entrar.",
      "Your session expired. Sign out and sign back in.",
    );
  }

  if (/account email unavailable/i.test(normalizedMessage)) {
    return text(
      language,
      "Não conseguimos confirmar o email desta conta. Termina sessão e volta a entrar.",
      "Could not confirm this account's email. Sign out and sign back in.",
    );
  }

  if (/invalid email/i.test(normalizedMessage)) {
    return text(language, "Escreve um email válido.", "Enter a valid email.");
  }

  if (/you are already a member|user is already a member/i.test(normalizedMessage)) {
    return text(
      language,
      "Esse email já pertence a esta workspace.",
      "That email is already a member of this workspace.",
    );
  }

  if (/invite not available|invite not found/i.test(normalizedMessage)) {
    return text(
      language,
      "Este convite já não está disponível. Atualiza a lista e tenta novamente.",
      "This invite is no longer available. Refresh the list and try again.",
    );
  }

  if (/member not found/i.test(normalizedMessage)) {
    return text(
      language,
      "Esse membro já não está nesta workspace. Atualiza a lista.",
      "That member is no longer in this workspace. Refresh the list.",
    );
  }

  if (/you already own this workspace/i.test(normalizedMessage)) {
    return text(language, "Já és dono desta workspace.", "You already own this workspace.");
  }

  if (/target user is required/i.test(normalizedMessage)) {
    return text(
      language,
      "Não foi possível identificar a conta. Termina sessão e volta a entrar.",
      "Could not identify the account. Sign out and sign back in.",
    );
  }

  if (/user not found/i.test(normalizedMessage)) {
    return text(
      language,
      "Esta conta já não existe ou deixou de estar disponível.",
      "This account no longer exists or is no longer available.",
    );
  }

  if (/workspace owners cannot|workspace owner cannot|owner role cannot|owner can only be changed/i.test(normalizedMessage)) {
    return text(
      language,
      "A propriedade da workspace precisa de ser gerida pela opção de transferir dono.",
      "Workspace ownership must be managed with the transfer owner option.",
    );
  }

  if (/invalid member role|member_role_check/i.test(normalizedMessage)) {
    return text(language, "Esse cargo não é válido para esta workspace.", "That role is not valid for this workspace.");
  }

  if (/only workspace owners/i.test(normalizedMessage)) {
    return text(
      language,
      "Só o dono da workspace pode fazer esta ação.",
      "Only the workspace owner can perform this action.",
    );
  }

  if (status === 403 || /row-level|row level|permission denied|not authorized|unauthorized|not allowed|rls|violates row-level/i.test(normalizedMessage)) {
    return text(
      language,
      "Não tens permissões para fazer esta alteração nesta workspace.",
      "You do not have permission to make this change in this workspace.",
    );
  }

  if (/fetch failed|failed to fetch|networkerror|network request failed|load failed|econnrefused|econnreset|etimedout|enotfound|getaddrinfo|tcp connect|socket/i.test(normalizedMessage)) {
    if (context === "compile" || context === "preview") {
      return text(
        language,
        "Não foi possível contactar o servidor de compilação. Confirma a ligação e tenta novamente.",
        "Could not reach the compilation server. Check the connection and try again.",
      );
    }

    return text(
      language,
      "Não foi possível ligar ao servidor. Confirma a internet e tenta novamente.",
      "Could not connect to the server. Check the internet connection and try again.",
    );
  }

  if (/email rate limit exceeded|rate limit/i.test(normalizedMessage)) {
    return text(
      language,
      "Foram enviados demasiados emails em pouco tempo. Espera uns minutos e tenta novamente.",
      "Too many emails were sent in a short time. Wait a few minutes and try again.",
    );
  }

  if (/invalid login credentials/i.test(normalizedMessage)) {
    return text(language, "Email ou password incorretos.", "Incorrect email or password.");
  }

  if (/email not confirmed|confirm your email/i.test(normalizedMessage)) {
    return text(
      language,
      "Confirma o teu email antes de entrar.",
      "Confirm your email before signing in.",
    );
  }

  if (/already registered|user already registered|already exists/i.test(normalizedMessage) && context === "auth") {
    return text(
      language,
      "Já existe uma conta com esse email. Experimenta entrar em vez de registar.",
      "An account with this email already exists. Try signing in instead of registering.",
    );
  }

  if (/password.*(six|6|weak|short)|weak password/i.test(normalizedMessage)) {
    return text(
      language,
      "A password precisa de ter pelo menos 6 caracteres.",
      "The password must have at least 6 characters.",
    );
  }

  if (/could not find the function|schema cache|relation .* does not exist|column .* does not exist|ambiguous|structure of query does not match function result type|member_role_check/i.test(normalizedMessage)) {
    return text(
      language,
      "A base de dados parece estar desatualizada. Corre o bootstrap SQL no Supabase e atualiza a app.",
      "The database looks out of date. Run the bootstrap SQL in Supabase and refresh the app.",
    );
  }

  if (/bucket.*not found|storage.*not found|papergraph-assets|invalid mime type|mime/i.test(normalizedMessage)) {
    return text(
      language,
      "O armazenamento de ficheiros não está pronto. Confirma o bucket papergraph-assets e os tipos de ficheiro permitidos no Supabase.",
      "File storage is not ready. Check the papergraph-assets bucket and allowed file types in Supabase.",
    );
  }

  if (/resource already exists|duplicate key|23505/i.test(normalizedMessage)) {
    return text(
      language,
      "Já existe um registo igual. Atualiza a lista ou usa outro nome.",
      "A matching record already exists. Refresh the list or use another name.",
    );
  }

  if (context === "compile" || context === "preview") {
    return getCompileErrorMessage(normalizedMessage, language);
  }

  if (normalizedMessage) {
    const friendlyTechnicalMessage = shortenTechnicalMessage(normalizedMessage, 360);

    if (!/[\\{}]|select |insert |update |delete |rpc\(|\.tsx|\.ts|node_modules/i.test(friendlyTechnicalMessage)) {
      return friendlyTechnicalMessage;
    }
  }

  return fallback ?? text(language, "Algo falhou. Tenta novamente.", "Something went wrong. Try again.");
}

export async function getFriendlyResponseError(
  response: Response,
  language: AppLanguage,
  options: FriendlyErrorOptions = {},
) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;

  return getFriendlyErrorMessage(payload?.error ?? `HTTP ${response.status}`, language, {
    ...options,
    status: response.status,
  });
}
