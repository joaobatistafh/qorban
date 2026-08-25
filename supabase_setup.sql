-- Rode isto uma única vez no Supabase: painel do projeto → SQL Editor → New query → colar e RUN.

create table if not exists public.projetos (
  id uuid primary key default gen_random_uuid(),
  nome text not null default 'Novo projeto',
  dados jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

alter table public.projetos enable row level security;

-- Sem tela de login no app: a chave "publishable" usada no front-end precisa
-- de permissão para ler/gravar. Isso deixa a tabela acessível por qualquer
-- pessoa que tenha a URL e a chave (o app inteiro é assim, sem senha) —
-- é o mesmo modelo que você já usa nos outros projetos pessoais.
drop policy if exists "acesso anon completo" on public.projetos;
create policy "acesso anon completo"
  on public.projetos
  for all
  to anon
  using (true)
  with check (true);

-- Acabamentos (tinta/textura/revestimento) salvos "no sistema" — aparecem
-- pré-cadastrados em toda obra nova criada no app.
create table if not exists public.acabamentos_sistema (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null default 'Tinta',
  rendimento numeric,
  criado_em timestamptz not null default now()
);

alter table public.acabamentos_sistema enable row level security;

drop policy if exists "acesso anon completo" on public.acabamentos_sistema;
create policy "acesso anon completo"
  on public.acabamentos_sistema
  for all
  to anon
  using (true)
  with check (true);

-- Dados globais da empresa (não pertencem a uma obra específica):
-- custos de escritório, patrimônio e colaboradores/acessos.
-- Fica sempre em uma única linha, id fixo 'global'.
create table if not exists public.sistema_global (
  id text primary key default 'global',
  dados jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

alter table public.sistema_global enable row level security;

drop policy if exists "acesso anon completo" on public.sistema_global;
create policy "acesso anon completo"
  on public.sistema_global
  for all
  to anon
  using (true)
  with check (true);
