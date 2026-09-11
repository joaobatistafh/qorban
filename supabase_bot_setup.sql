-- Rode isto uma única vez no Supabase: painel do projeto → SQL Editor → New query → colar e RUN.
-- Complementa o supabase_setup.sql já existente do Qorban Controle.

-- Guarda o estado da conversa de cada usuário do bot (é apagado/reaproveitado a cada novo fluxo).
create table if not exists public.bot_sessions (
  chat_id bigint primary key,
  step text not null default 'inicio',
  -- 'inicio' | 'aguardando_obra' | 'aguardando_tipo' | 'aguardando_busca_item' | 'aguardando_escolha_item' |
  -- 'aguardando_forma_pagto' | 'aguardando_parcelas' | 'aguardando_banco' | 'aguardando_foto' | 'aguardando_confirmacao' |
  -- 'sol_aguardando_tipo' | 'sol_aguardando_busca_item' | 'sol_aguardando_escolha_item' | 'sol_aguardando_descricao' |
  -- 'sol_aguardando_quantidade' | 'sol_aguardando_unidade' | 'sol_aguardando_confirmacao'
  modo text default 'compra', -- 'compra' | 'solicitacao'
  projeto_id uuid,
  projeto_nome text,
  tipo text,
  orc_id text,
  orc_label text,
  forma_pagto text,
  parcelas integer,
  banco text,
  descricao text,
  quantidade numeric,
  unidade text,
  itens_encontrados jsonb,
  extraido jsonb,
  foto_path text,
  atualizado_em timestamptz not null default now()
);

alter table public.bot_sessions enable row level security;
drop policy if exists "acesso anon completo" on public.bot_sessions;
create policy "acesso anon completo" on public.bot_sessions for all to anon using (true) with check (true);

-- Se você já rodou uma versão anterior deste arquivo (sem forma de pagamento/parcelas/banco),
-- rode as linhas abaixo pra atualizar a tabela existente sem perder dados:
alter table public.bot_sessions add column if not exists forma_pagto text;
alter table public.bot_sessions add column if not exists parcelas integer;
alter table public.bot_sessions add column if not exists banco text;
-- Suporte a nota com vários itens e várias folhas:
alter table public.bot_sessions add column if not exists itens_extraidos jsonb default '[]'::jsonb;
alter table public.bot_sessions add column if not exists fotos jsonb default '[]'::jsonb;
-- Suporte ao fluxo /solicitar (solicitação de compra, sem nota fiscal):
alter table public.bot_sessions add column if not exists modo text default 'compra';
alter table public.bot_sessions add column if not exists descricao text;
alter table public.bot_sessions add column if not exists quantidade numeric;
alter table public.bot_sessions add column if not exists unidade text;

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
-- Suporte a nota com vários itens (cada item vira uma linha) e várias folhas (várias fotos):
alter table public.compras_pendentes add column if not exists quantidade numeric default 1;
alter table public.compras_pendentes add column if not exists valor_unitario numeric;
alter table public.compras_pendentes add column if not exists fotos jsonb default '[]'::jsonb;

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

-- Conexão OAuth do Google Drive, uma linha por empresa. Por enquanto o sistema
-- só tem uma empresa (empresa_id = 'default'); quando o multi-empresa entrar,
-- essa tabela já está pronta — só passa a existir uma linha por cliente real.
create table if not exists public.integracoes_google (
  empresa_id text primary key,
  refresh_token text,
  access_token text,
  token_expira_em timestamptz,
  root_folder_id text,
  conectado_email text,
  conectado_em timestamptz,
  atualizado_em timestamptz not null default now()
);

alter table public.integracoes_google enable row level security;
drop policy if exists "acesso anon completo" on public.integracoes_google;
create policy "acesso anon completo" on public.integracoes_google for all to anon using (true) with check (true);

-- Solicitações de compra (fluxo de aprovação), lançadas pelo site ou pelo bot.
create table if not exists public.solicitacoes_compra (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.projetos(id) on delete cascade,
  projeto_nome text,
  orc_id text,
  orc_label text,
  tipo text not null,
  descricao text not null,
  quantidade numeric default 1,
  unidade text,
  status text not null default 'pendente', -- pendente | aprovada | nao_aprovada
  origem text not null default 'site', -- site | telegram
  telegram_user text,
  criado_em timestamptz not null default now(),
  respondido_em timestamptz
);

alter table public.solicitacoes_compra enable row level security;
drop policy if exists "acesso anon completo" on public.solicitacoes_compra;
create policy "acesso anon completo" on public.solicitacoes_compra for all to anon using (true) with check (true);
