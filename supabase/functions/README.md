# Supabase Edge Functions

O projeto Supabase usado pela app e:

```bash
gdpmlzwvfdyrgdquicyl
```

## `delete-account`

Elimina a conta autenticada e os dados associados sem colocar a chave privada dentro da app desktop.

Deploy:

```bash
npx supabase functions deploy delete-account --project-ref gdpmlzwvfdyrgdquicyl
```

Normalmente nao e preciso adicionar a chave privada manualmente: o Supabase disponibiliza as keys da funcao atraves das variaveis internas do projeto.

Se a funcao ficar sem chave privada, adiciona uma secret propria sem o prefixo reservado `SUPABASE_`:

```bash
npx supabase secrets set PAPERGRAPH_SERVICE_ROLE_KEY=... --project-ref gdpmlzwvfdyrgdquicyl
```

## Academic relations

Academic relations now run in the Next.js server, using Ollama and pgvector.
See [semantic search setup](../../docs/semantic-search.md).
The former Edge Function is obsolete and can be removed from the deployed project.
The `delete-account` function remains unchanged.
