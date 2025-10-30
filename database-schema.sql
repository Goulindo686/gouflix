-- Schema para o sistema de autenticação do Gouflix
-- Execute estes comandos no seu banco Supabase

-- Tabela de usuários
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT, -- NULL para usuários do Discord
  auth_type TEXT NOT NULL DEFAULT 'traditional', -- 'traditional' ou 'discord'
  discord_id TEXT UNIQUE, -- ID do Discord (se aplicável)
  profile_name TEXT, -- Nome do perfil escolhido pelo usuário
  avatar TEXT, -- URL do avatar
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de sessões (já existe, mas vamos garantir a estrutura)
CREATE TABLE IF NOT EXISTS public.sessions (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  avatar TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela para dados do usuário (favoritos, histórico, etc.)
CREATE TABLE IF NOT EXISTS public.user_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  data_type TEXT NOT NULL, -- 'favorites', 'history', 'watchlist', etc.
  item_id TEXT NOT NULL, -- ID do filme/série
  item_data JSONB NOT NULL DEFAULT '{}'::jsonb, -- Dados adicionais do item
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, data_type, item_id)
);

-- Índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_discord_id ON public.users(discord_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON public.sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_data_user_id ON public.user_data(user_id);
CREATE INDEX IF NOT EXISTS idx_user_data_type ON public.user_data(user_id, data_type);

-- Função para limpar sessões expiradas (opcional)
CREATE OR REPLACE FUNCTION clean_expired_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM public.sessions WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at 
  BEFORE UPDATE ON public.users 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_data_updated_at 
  BEFORE UPDATE ON public.user_data 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();