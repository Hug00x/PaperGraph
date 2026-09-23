# Pesquisa semântica local

O fluxo é **PDF → título, DOI e abstract → OpenAlex para completar metadata → Ollama / BGE-M3 → PostgreSQL / pgvector → grafo**.
Não existe chamada à OpenAI, API paga de embeddings, classificação por LLM ou cálculo de cosine similarity em JavaScript.

## Importação automática de PDFs

A importação lê as três primeiras páginas com PDF.js. Usa posição/tamanho do texto para encontrar o título, procura o DOI na primeira página e extrai o texto entre `Abstract`/`Resumo` e o início das palavras-chave ou introdução. O nome do ficheiro só é usado quando não é encontrado um título plausível. A metadata e o texto extraídos ficam guardados na fonte importada, sem novas tabelas ou migrations.

O OpenAlex completa a informação, mas uma falha de rede, `429` ou ausência de abstract não elimina o abstract extraído localmente. Pedidos OpenAlex são espaçados e erros `429`/`503` têm uma repetição limitada, respeitando `Retry-After`; esperas longas deixam a resolução pendente para uma análise posterior. O embedding continua a usar título + abstract, nunca o PDF inteiro.

PDFs digitalizados sem camada de texto precisam de OCR, que não está implementado. Abstracts sem cabeçalho reconhecível podem não ser extraídos. A aplicação avisa quando usa apenas o título. Artigos antigos com texto extraído guardado são reprocessados automaticamente na próxima análise/backfill; os que não guardaram esse texto precisam de reimportação do PDF. Não são inventados abstracts nem escolhidos resultados OpenAlex ambíguos.

## Aplicação desktop Windows

O instalador inclui um runtime isolado e o modelo é descarregado automaticamente
na primeira utilização. Não é necessário instalar Ollama, editar `.env.local` ou
executar `ollama pull`. A instalação desktop ignora a URL Ollama do ambiente do
utilizador e utiliza exclusivamente o processo gerido pelo PaperGraph. Ver
[runtime integrado](bundled-runtime.md).

O Supabase continua a precisar da migration abaixo, aplicada uma única vez pelo
responsável pela base de dados; esta mudança de distribuição não acrescenta SQL.

## Configuração da base e desenvolvimento web sem Electron

1. Numa base nova, executar primeiro `supabase/bootstrap-workspace.sql`.
2. Executar [202609230001_semantic_search.sql](../supabase/migrations/202609230001_semantic_search.sql) no SQL Editor do Supabase ou através do processo habitual de migrations. É uma migration incremental sobre `articles`; não cria uma tabela `papers` duplicada.
3. Instalar e iniciar o Ollama na máquina do **servidor Next.js** e instalar o modelo:

   ```bash
   ollama pull bge-m3
   ollama serve
   ```

   Se a aplicação Ollama já estiver a correr, não iniciar uma segunda instância de `ollama serve`.

4. Acrescentar a `.env.local` (ver [.env.example](../.env.example)):

   ```dotenv
   OLLAMA_BASE_URL=http://localhost:11434
   OLLAMA_EMBEDDING_MODEL=bge-m3
   SEMANTIC_SIMILARITY_THRESHOLD=0.50
   OPENALEX_API_KEY=
   ```

   Preservar `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. A chave OpenAlex é apenas para metadata, quando necessária; não é uma chave de embeddings.

5. Reiniciar `npm run dev`. Num deployment exclusivamente web, `OLLAMA_BASE_URL` configura o servidor controlado por ti. Isto não se aplica ao instalador desktop, cujo runtime é sempre isolado e local. As variáveis Ollama são lidas apenas no servidor e não têm prefixo `NEXT_PUBLIC_`.

Uma Edge Function no Supabase não alcança o Ollama no teu computador através de `localhost`. Por isso, esta implementação corre no Next.js, incluindo o servidor local da aplicação Electron. Numa instalação web, `localhost` refere-se ao servidor web, não ao computador do visitante.

## Base de dados

A migration completa está no ficheiro acima. Acrescenta metadata OpenAlex, `abstract`, `embedding_model`, hashes de cache e:

```sql
create extension if not exists vector with schema extensions;
-- Na tabela existente:
-- embedding vector(1024)
create index if not exists articles_embedding_hnsw_idx
  on public.articles using hnsw (embedding vector_cosine_ops);
```

O ficheiro configura `search_path` para resolver a extensão em `extensions` ou `public`. A função `get_similar_papers` calcula `1 - (embedding <=> query_embedding)` e ordena por distância com `LIMIT`. Os vetores não são carregados para Node. Usa `security invoker`, as políticas RLS existentes e o ID de workspace; não devolve o próprio artigo ou vetores de outro modelo. Os candidatos do grafo são artigos submetidos (`Review` / `Published`). HNSW é aproximado e filtros podem devolver menos de N resultados em conjuntos grandes; afinar o índice na base se isso se tornar relevante.

A base remota inspecionada usa `articles.id` do tipo `uuid`; o bootstrap local usa `text`. A migration e o backfill aceitam ambos sem converter IDs. A migration acrescenta também um índice único `(workspace_id, id)` para suportar o upsert nos esquemas antigos com chave primária apenas em `id`.

Por defeito são pedidos ao pgvector os 3 vizinhos mais próximos de cada artigo. **Só são criadas ligações semânticas com score >= 0.50 (50%)**, sem arredondar antes da comparação e sem preencher uma quantidade mínima de ligações. Um artigo pode ficar isolado. As arestas recíprocas são deduplicadas; um artigo pode receber mais de 3 ligações por também ser vizinho de outros. Citações, wikilinks e ligações manuais não dependem deste limiar.

O mínimo pode ser alterado com `SEMANTIC_SIMILARITY_THRESHOLD` no ambiente do servidor (0 a 1; por exemplo `0.60` para 60%). Sem configuração, usa 0.50. Configurações inválidas são rejeitadas. Reiniciar o servidor após alterar a variável e usar **Recalcular ligações** para substituir as relações antigas e remover as que deixam de cumprir a regra. O painel do grafo mostra o mínimo usado na última análise. Não é necessária outra migration SQL: PostgreSQL continua a calcular/rankear os scores e a aplicação filtra apenas os candidatos devolvidos.

50% é um ponto de partida do PaperGraph, verificado nos exemplos atuais: McQuiggan–Early Prediction = 54,4%, enquanto M87–papers de aprendizagem = 40,4–40,8%. Não constitui calibração universal: outros temas ou textos podem exigir ajuste. A [documentação de algoritmos do Litmaps](https://docs.litmaps.com/en/articles/9029858-search-algorithms-in-litmaps) descreve similaridade de título/abstract, mas não publica um limiar numérico que possamos reproduzir.

O helper `getSimilarPapers(client, workspaceId, paperId, limit)` continua a permitir limites de 1 a 100 e devolve `{ paper, similarity }[]` sem o filtro do grafo, para inspeção dos candidatos. O score é cosine similarity, não uma probabilidade nem uma percentagem de conteúdo igual.

Verificação do esquema:

```sql
select extname, extversion from pg_extension where extname = 'vector';
select format_type(atttypid, atttypmod) from pg_attribute
where attrelid = 'public.articles'::regclass and attname = 'embedding';
select indexdef from pg_indexes where indexname = 'articles_embedding_hnsw_idx';
```

## Cache, submissões e falhas

- Submeter/importar um artigo guarda-o antes da análise; funciona também com apenas um artigo. Abrir um artigo não gera embeddings.
- A gravação da workspace faz upsert dos artigos existentes, preservando metadata e embeddings. Só apaga artigos efetivamente removidos.
- O texto é exatamente `title + "\n\n" + (abstract ?? "")`. DOI, autores, citações, tags e LaTeX não entram no vetor. A ausência de abstract permite usar apenas o título.
- DOI, arXiv e pesquisa por título continuam a resolver metadata OpenAlex. A pesquisa por título exige correspondência normalizada, evitando escolher um resultado irrelevante. O título OpenAlex fica em `openalex_title`; o título editável do utilizador é preservado.
- O hash do conteúdo e o nome do modelo permitem reutilizar o embedding. O trigger invalida o vetor quando título/abstract mudam, mesmo fora da aplicação. Mudanças na fonte/tags invalidam apenas a cache de metadata; se o texto do embedding não mudar, o vetor é reutilizado.
- A escrita usa condições sobre o conteúdo original, evitando guardar um resultado atrasado sobre uma edição concorrente. Pedidos simultâneos podem realizar trabalho duplicado, mas não gravam um vetor de outro texto.
- Timeouts, modelo ausente, resposta inválida e vetores de dimensão errada produzem um aviso. Uma falha do Ollama mantém a gravação do artigo e as citações disponíveis; vetores válidos já guardados continuam pesquisáveis. Os detalhes ficam no log do servidor. Não existe fallback para outra API.
- A indisponibilidade do OpenAlex permite usar o título/abstract guardados e repetir a resolução noutra análise. Uma correspondência inexistente fica em cache até a fonte/título/tags mudarem; limpar `academic_input_hash` permite pedir nova resolução.

## Backfill sem interface

Requer Node 22.6+ (o projeto foi verificado com Node 22.21). O mesmo serviço usado pela aplicação percorre os artigos em páginas de 50 e reutiliza vetores válidos:

```bash
npm run embeddings:backfill -- <workspace-uuid>
```

O script carrega `.env.local`. Usar `SUPABASE_ACCESS_TOKEN` de um utilizador editor, juntamente com a chave pública; ou `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` numa máquina de administração. Não distribuir chaves privadas no Electron. O script não modifica relações: depois, atualizar as ligações académicas na aplicação para visualizar os resultados.

Pode ser repetido após falhas. Termina com código 1 se houver avisos e lista os IDs afetados. Mudando o modelo, executar novamente em cada workspace para substituir os vetores. O modelo configurado tem de produzir 1024 dimensões. Se substituíres os pesos mantendo o mesmo nome, limpar os três campos `embedding`, `embedding_model`, `embedding_input_hash` em conjunto antes do backfill.

## Testar

Teste direto no PowerShell:

```powershell
$body = @{ model = 'bge-m3'; input = "Graph neural networks`n`nLearning representations of graphs" } | ConvertTo-Json
$result = Invoke-RestMethod -Method Post -Uri 'http://localhost:11434/api/embed' -ContentType 'application/json' -Body $body
$result.embeddings[0].Count # 1024
```

Teste completo:

1. Entrar numa workspace editável e submeter dois ou mais papers, de preferência dois relacionados e um de outro tema. Usar títulos reais e DOI na fonte para resolver os abstracts.
2. Confirmar no Supabase:

   ```sql
   select id, title, openalex_id, embedding_model,
          embedding is not null as has_embedding, embedding_input_hash
   from public.articles where workspace_id = '<workspace-uuid>';

   select * from public.get_similar_papers('<workspace-uuid>', '<article-id>', 5, 'bge-m3');
   ```

   O SQL Editor normalmente usa privilégios administrativos. Para testar RLS, chamar a mesma RPC com o cliente Supabase autenticado como membro de outra workspace: não deve devolver dados.

3. Confirmar as relações de tipo semântico no grafo e o respetivo score. Atualizar novamente: os hashes devem manter-se e o Ollama não deve receber novos pedidos para conteúdo inalterado.
4. Alterar o título de um artigo e submeter novamente: apenas os vetores cujo título/abstract mudou devem ser regenerados.
5. Parar o Ollama e submeter um artigo novo: o artigo deve ficar guardado e aparecer um aviso do serviço; as citações continuam disponíveis. Iniciar o Ollama e repetir a análise ou o backfill.

Testes locais com serviços simulados:

```bash
npm run test:semantic
npm run lint
npm run build
```

Estes testes cobrem contrato Ollama, validação dos vetores, cache, alterações de abstract/modelo, escrita concorrente, RPC, preservação de citações em falhas e correspondência OpenAlex. Não substituem executar a migration e testar o modelo real.

## Limpeza e ficheiros

| Ficheiro | Alteração |
| --- | --- |
| `src/lib/academic/embedding.ts` | Configuração centralizada, texto/hash e cliente Ollama. |
| `src/lib/academic/pdf-metadata.ts` | Extração local partilhada de título, DOI e abstract. |
| `src/lib/academic/openalex.ts` | Metadata e citações reutilizadas da implementação anterior, sem embeddings pagos. |
| `src/lib/academic/papers.ts` | Cache, enriquecimento, persistência e construção das relações. |
| `src/lib/academic/semantic-search.ts` | Único helper de procura vetorial, através da RPC. |
| `src/app/api/academic-relations/route.ts` | Substitui o proxy da Edge Function por execução no Next.js; autentica utilizador e permissões. |
| `src/lib/supabase-workspace.ts` | Conserva artigos e embeddings entre saves. |
| `src/app/page.tsx` | Guarda artigos antes da análise, envia IDs e mostra avisos parciais. |
| `src/lib/friendly-errors.ts` | Mensagens Ollama/OpenAlex/pgvector em vez de erros da chave OpenAI. |
| `src/lib/portuguese-labels.ts` | Tradução de scores também quando a cosine similarity é negativa. |
| `supabase/migrations/202609230001_semantic_search.sql` | Colunas, extensão, índice, trigger e RPC com RLS. |
| `scripts/backfill-embeddings.mjs` | Preenchimento independente da interface. |
| `tests/semantic.test.mjs` | Testes automatizados. |
| `package.json`, `tsconfig.json` | Comandos CLI/testes e imports TypeScript partilhados com Node. |
| `.env.example`, `.gitignore` | Exemplo de configuração versionável, mantendo credenciais ignoradas. |
| `README.md`, `supabase/functions/README.md`, este documento | Instruções atualizadas. |

Apagados:

- `supabase/functions/academic-relations/index.ts`: implementação antiga com chamada paga, embeddings recriados em cada análise e comparação de todos os pares em memória. A resolução OpenAlex/citações útil foi movida para o serviço partilhado.
- `supabase/functions/academic-relations/deno-shim.d.ts`: tipos exclusivos dessa função Deno, sem consumidores após a remoção.

Depois de atualizar a aplicação, remover a Edge Function antiga do projeto publicado, se existir:

```bash
npx supabase functions delete academic-relations --project-ref <project-ref>
```

Variáveis antigas removíveis: `PAPERGRAPH_OPENAI_API_KEY`, `OPENAI_API_KEY`, `PAPERGRAPH_EMBEDDING_MODEL`, `PAPERGRAPH_SEMANTIC_THRESHOLD`, `PAPERGRAPH_SEMANTIC_MAX_PER_ARTICLE`, `SUPABASE_ACADEMIC_RELATIONS_FUNCTION_URL`, `NEXT_PUBLIC_SUPABASE_ACADEMIC_RELATIONS_FUNCTION_URL`. Remover também as respetivas secrets remotas se só serviam esta funcionalidade.

Não havia dependência npm OpenAI: a chamada era feita com `fetch`. Nenhuma dependência npm foi acrescentada ou precisa de ser removida. Não ficou código OpenAI em execução nem uma segunda implementação da pesquisa semântica. A função `delete-account`, os estilos e o grafo existentes foram preservados.

Referências: [API embed do Ollama](https://docs.ollama.com/api/embed), [pgvector](https://github.com/pgvector/pgvector), [autenticação OpenAlex](https://help.openalex.org/api/authentication/).
