-- ─────────────────────────────────────────────────────────────────────────────
-- SimpleTrader — Supabase Setup SQL
-- Ejecuta este script en Supabase Dashboard → SQL Editor → New query
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Tabla principal de datos de usuario (ya debe existir si usas SimpleTrader)
create table if not exists public.user_data (
  id          bigserial primary key,
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  payload     jsonb not null default '{}',
  updated_at  timestamptz default now()
);
alter table public.user_data enable row level security;

-- Política: cada usuario sólo ve y modifica su propia fila
create policy if not exists "Users manage own data"
  on public.user_data for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. Tabla de log de ejecuciones de Tradovate (para el webhook)
create table if not exists public.execution_log (
  id          bigserial primary key,
  user_id     uuid not null,
  action      text,
  symbol      text,
  qty         numeric,
  results     jsonb,
  created_at  timestamptz default now()
);
alter table public.execution_log enable row level security;

-- Los usuarios pueden leer sus propios logs (el webhook escribe con service key)
create policy if not exists "Users see own execution logs"
  on public.execution_log for select
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Variables de entorno que debes añadir en Vercel → Settings → Environment Variables
-- ─────────────────────────────────────────────────────────────────────────────
-- SUPABASE_URL          → Settings → API → Project URL
-- SUPABASE_ANON_KEY     → Settings → API → anon public
-- SUPABASE_SERVICE_KEY  → Settings → API → service_role (¡mantener en privado!)
-- TRADOVATE_CID         → https://developer.tradovate.com → tu app → Client ID
-- TRADOVATE_SEC         → https://developer.tradovate.com → tu app → Secret
-- ─────────────────────────────────────────────────────────────────────────────
