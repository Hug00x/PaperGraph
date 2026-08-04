# Supabase Edge Functions

## `delete-account`

Esta função elimina a conta autenticada e os dados associados sem colocar a chave privada dentro da app desktop.

O projeto Supabase usado pela app é:

```bash
gdpmlzwvfdyrgdquicyl
```

Deploy:

```bash
npx supabase functions deploy delete-account --project-ref gdpmlzwvfdyrgdquicyl
```

Normalmente não é preciso adicionar a chave privada manualmente: o Supabase disponibiliza as keys da função através das variáveis internas do projeto.

Se a função ficar sem chave privada, adiciona uma secret própria sem o prefixo reservado `SUPABASE_`:

```bash
npx supabase secrets set PAPERGRAPH_SERVICE_ROLE_KEY=... --project-ref gdpmlzwvfdyrgdquicyl
```

Nunca coloques `SUPABASE_SECRET_KEY` ou `SUPABASE_SERVICE_ROLE_KEY` no `.exe`, em GitHub Pages, nem em variáveis `NEXT_PUBLIC_*`.
