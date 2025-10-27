# CineFlix — site estilo Netflix
Site estático moderno inspirado na Netflix.

## Recursos
- Layout com hero/banner e navbar fixa
- Carrossel horizontal de filmes
- Busca dinâmica
- Modal de detalhes do filme

## Como rodar
1. Extraia o ZIP.
2. Abra `index.html` no navegador.
3. Ou sirva localmente com: `python -m http.server`

Feito por ChatGPT — demonstração educacional.

## Deploy na Vercel + Supabase

Este projeto agora suporta hospedagem na Vercel e persistência de estado no Supabase.

### Variáveis de ambiente (Vercel)
- `SUPABASE_URL`: URL do seu projeto Supabase.
- `SUPABASE_ANON_KEY`: chave pública (anon) do Supabase.
- `TMDB_BASE`: opcional (default `https://api.themoviedb.org/3`).
- `TMDB_IMG`: opcional (default `https://image.tmdb.org/t/p/w500`).
- `TMDB_TOKEN`: token Bearer do TMDB.

Uma função serverless (`/api/env`) expõe essas variáveis de forma segura ao frontend.

### Banco de dados (Supabase)
Crie a tabela para persistir o estado dos itens adicionados/removidos:

```sql
create table if not exists public.gouflix_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb
);
```

- O app usa o registro com `id = 'global'` para armazenar `{ added: [], removed: [] }`.
- Caso o Supabase não esteja configurado, o app usa os endpoints locais (`/api/state/*`) como fallback.

### Passos de deploy na Vercel
1. Conecte seu repositório GitHub.
2. Defina as variáveis acima em Project Settings → Environment Variables.
3. Deploy. A função `/api/env` estará disponível e o frontend inicializa o Supabase automaticamente.

### Observações
- O `data/state.json` permanece ignorado em `.gitignore`.
- O TMDB é consumido com `TMDB_TOKEN`. Sem ele, funcionalidade de busca TMDB pode falhar.
