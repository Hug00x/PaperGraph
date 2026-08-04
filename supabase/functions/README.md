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

Se a função ficar sem chave privada, adiciona uma secret no Supabase:

```bash
npx supabase secrets set SUPABASE_SECRET_KEY=... --project-ref gdpmlzwvfdyrgdquicyl
```

Também podes usar `SUPABASE_SERVICE_ROLE_KEY` se preferires a chave service role clássica.

Nunca coloques `SUPABASE_SECRET_KEY` ou `SUPABASE_SERVICE_ROLE_KEY` no `.exe`, em GitHub Pages, nem em variáveis `NEXT_PUBLIC_*`.
