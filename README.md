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
 - `SUPABASE_SERVICE_ROLE_KEY`: chave de serviço do Supabase para APIs protegidas (server-side).
 - `MP_ACCESS_TOKEN`: token de acesso do Mercado Pago.
 - `PUBLIC_URL`: URL pública do site (ex.: `https://SEU_DOMINIO`).
 - `MP_WEBHOOK_SECRET`: segredo do webhook (se usar validação).
 - `DISCORD_CLIENT_ID`: <seu-client-id>.
 - `DISCORD_CLIENT_SECRET`: <seu-client-secret>.
 - `DISCORD_REDIRECT_URI`: `https://SEU_DOMINIO/api/auth/discord/callback` (recomendado).

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

#### Configurações da Aplicação (app_config)
Para salvar o Access Token do Mercado Pago e outras configurações via Admin, crie também a tabela `app_config`:

```sql
create table if not exists public.app_config (
  id text primary key,
  mp_token text,
  public_url text,
  bootstrap_movies_url text,
  bootstrap_auto boolean default false,
  updated_at timestamptz default now()
);

-- Registro padrão utilizado pela aplicação
insert into public.app_config(id) values ('global')
on conflict (id) do nothing;
```

Com essa tabela criada, o Admin consegue salvar e visualizar o `mp_token` diretamente do Supabase.

#### Planos, Compras e Assinaturas
Para o sistema de pagamentos e controle de acesso, crie as tabelas abaixo:

```sql
-- Catálogo de planos
create table if not exists public.plans (
  id text primary key,         -- ex: 'mensal', 'trimestral', 'anual', 'test2min'
  name text not null,
  days integer not null,       -- duração em dias (test2min pode ser 0 para usar lógica customizada)
  price numeric not null,
  active boolean default true,
  updated_at timestamptz default now()
);

-- Compras (pagamentos)
create table if not exists public.purchases (
  id text primary key,         -- id do pagamento (Mercado Pago)
  user_id text not null,
  plan text not null,
  amount numeric,
  status text not null default 'pending', -- pending/approved/cancelled
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Assinatura atual do usuário (um registro por usuário)
create table if not exists public.subscriptions (
  user_id text primary key,
  plan text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'active', -- active/inactive
  payment_id text
);

-- Planos padrão
insert into public.plans(id, name, days, price) values
  ('mensal','Mensal',30,19.90),
  ('trimestral','Trimestral',90,49.90),
  ('anual','Anual',365,147.90)
on conflict (id) do nothing;
```

Fluxo:
- A compra é criada via `POST /api/subscription?action=create` e registrada em `purchases`.
- Quando o pagamento é aprovado (webhook Mercado Pago ou polling), o backend grava/atualiza a assinatura em `subscriptions` com `start_at`/`end_at` e `status = 'active'`.
- `GET /api/subscription?userId=...` consulta `subscriptions` e valida se `end_at > now` para liberar o acesso.
- `POST /api/subscription?action=deactivate` marca assinatura como `inactive` e expira imediatamente.

Importante: defina `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no Vercel. O `SERVICE_ROLE_KEY` é usado somente no backend.

### Passos de deploy na Vercel
1. Conecte seu repositório GitHub.
2. Defina as variáveis acima em Project Settings → Environment Variables.
3. Deploy. A função `/api/env` estará disponível e o frontend inicializa o Supabase automaticamente.

### Login via Discord (OAuth)
- No Discord Developer Portal (OAuth2 → Redirects), inclua: `https://SEU_DOMINIO/api/auth/discord/callback`.
- Scopes: `identify` e `email`.
- Rotas usadas no backend:
  - `GET /api/auth/discord/start` (inicia OAuth)
  - `GET /api/auth/discord/callback` (finaliza OAuth, cria cookie `sid`)
  - `GET /api/auth/me` (dados do usuário logado)
  - `POST /api/auth/logout` (encerra sessão)

Importante: o `vercel.json` está configurado para não reescrever `/api/*` para `index.html`, garantindo o funcionamento das APIs.

### Observações
- O `data/state.json` permanece ignorado em `.gitignore`.
- O TMDB é consumido com `TMDB_TOKEN`. Sem ele, funcionalidade de busca TMDB pode falhar.
 
#### Limite de funções no Vercel (Hobby)
- O plano Hobby da Vercel permite até 12 Serverless Functions por deploy. Referência: https://vercel.link/function-count-limit
- Para respeitar esse limite, os endpoints de fallback de estado (`/api/state/add` e `/api/state/remove`) foram removidos do deploy. Em produção, as operações de adicionar/remover itens no Admin dependem do Supabase (`gouflix_state`).
- Garanta que `SUPABASE_URL` e `SUPABASE_ANON_KEY` estejam configurados e que as políticas RLS permitam leitura e escrita para o cliente conforme necessário.
