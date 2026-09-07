-- Rode isto uma única vez no Supabase: painel do projeto → SQL Editor → New query → colar e RUN.
-- Complementa o supabase_setup.sql já existente do Qorban Controle.

-- Guarda o estado da conversa de cada usuário do bot (é apagado/reaproveitado a cada novo fluxo).
create table if not exists public.bot_sessions (
  chat_id bigint primary key,
  step text not null default 'inicio',
  -- 'inicio' | 'aguardando_obra' | 'aguardando_tipo' | 'aguardando_busca_item' | 'aguardando_escolha_item' | 'aguardando_foto' | 'aguardando_confirmacao'
  projeto_id uuid,
  projeto_nome text,
  tipo text,
  orc_id text,
  orc_label text,
  itens_encontrados jsonb,
  extraido jsonb,
  foto_path text,
  atualizado_em timestamptz not null default now()
);

alter table public.bot_sessions enable row level security;
drop policy if exists "acesso anon completo" on public.bot_sessions;
create policy "acesso anon completo" on public.bot_sessions for all to anon using (true) with check (true);

-- Fila de compras lançadas pelo bot, esperando serem importadas pelo app.
-- Isso evita o bot escrever direto no JSON grande do projeto (que o app também edita).
create table if not exists public.compras_pendentes (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.projetos(id) on delete cascade,
  projeto_nome text,
  tipo text not null,
  orc_id text,
  orc_label text,
  forma_pagto text default 'PIX',
  parcelas integer default 1,
  banco text,
  loja text,
  valor_total numeric,
  data_nota date,
  numero_nota text,
  descricao text,
  foto_path text,
  status text not null default 'pendente', -- pendente | importada | descartada
  telegram_user text,
  criado_em timestamptz not null default now()
);

alter table public.compras_pendentes enable row level security;
drop policy if exists "acesso anon completo" on public.compras_pendentes;
create policy "acesso anon completo" on public.compras_pendentes for all to anon using (true) with check (true);

-- Se você já rodou uma versão anterior deste arquivo (sem forma de pagamento/parcelas/banco),
-- rode as linhas abaixo pra atualizar a tabela existente sem perder dados:
alter table public.compras_pendentes add column if not exists forma_pagto text default 'PIX';
alter table public.compras_pendentes add column if not exists parcelas integer default 1;
alter table public.compras_pendentes add column if not exists banco text;

-- Bucket para as fotos das notas fiscais (privado; o app usa signed URL pra exibir).
insert into storage.buckets (id, name, public)
values ('notas-fiscais', 'notas-fiscais', false)
on conflict (id) do nothing;

drop policy if exists "bot lê e grava notas" on storage.objects;
create policy "bot lê e grava notas"
  on storage.objects for all
  to anon
  using (bucket_id = 'notas-fiscais')
  with check (bucket_id = 'notas-fiscais');
