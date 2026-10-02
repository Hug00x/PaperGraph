"use client";

import type { AppLanguage } from "@/lib/portuguese-labels";

export function HelpSection({ language }: { language: AppLanguage }) {
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
              body: "PaperGraph automatically combines independent changes when saving. Incompatible edits to the same field, or editing an element someone deleted, require resolution. Keep your local copy before reloading.",
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
              body: "O PaperGraph combina automaticamente alterações independentes ao guardar. Alterações incompatíveis ao mesmo campo, ou editar um elemento que alguém apagou, exigem resolução. Guarda a tua cópia local antes de recarregar.",
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
