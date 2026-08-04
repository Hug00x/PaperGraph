# Supabase Edge Functions

## `delete-account`

Esta função elimina a conta autenticada e os dados associados sem colocar a service role key dentro da app desktop.

Deploy:

```bash
supabase functions deploy delete-account --project-ref gdpmlzwvfdyrgdquicyl
```

Se o projeto não expuser `SUPABASE_SERVICE_ROLE_KEY` automaticamente nas Edge Functions, adiciona-a como secret no Supabase:

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
```

Não coloques a service role key no `.exe`, no GitHub Pages, nem em variáveis `NEXT_PUBLIC_*`.
