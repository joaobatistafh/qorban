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
