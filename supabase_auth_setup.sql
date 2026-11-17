-- Qorban Controle — segurança (login + RLS).
-- Rode UMA vez no Supabase: SQL Editor → New query → colar → RUN.
-- ATENÇÃO: publique o front-end novo (com tela de login) ANTES ou junto de rodar este arquivo.
-- Depois dele, a chave pública (anon) deixa de ler/gravar qualquer dado.

-- 1) Administradores (acesso total, independe da lista de Acessos).
--    Sem policies: só o service role (backend) e as funções abaixo enxergam esta tabela.
create table if not exists public.admins (email text primary key);
alter table public.admins enable row level security;
insert into public.admins (email) values ('joao@joao.com') on conflict do nothing;

-- 2) Funções de verificação (usam o e-mail do token do usuário logado).
create or replace function public.sou_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a
                 where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- Equipe = admin OU e-mail cadastrado em Acessos (colaboradores) que não seja "Cliente".
create or replace function public.sou_equipe() returns boolean
language sql stable security definer set search_path = public as $$
  select public.sou_admin() or exists (
    select 1
    from public.sistema_global g,
         jsonb_array_elements(coalesce(g.dados -> 'colaboradores', '[]'::jsonb)) c
    where g.id = 'global'
      and lower(coalesce(c ->> 'email', '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and coalesce(c ->> 'funcao', '') <> 'Cliente'
  );
$$;

create or replace function public.meu_acesso() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('admin', public.sou_admin(), 'equipe', public.sou_equipe());
$$;

revoke all on function public.sou_admin(), public.sou_equipe(), public.meu_acesso() from public, anon;
grant execute on function public.sou_admin(), public.sou_equipe(), public.meu_acesso() to authenticated;

-- 3) Troca o "acesso anon completo" por "somente equipe logada".
do $$
declare t text;
begin
  foreach t in array array['projetos','acabamentos_sistema','sistema_global','compras_pendentes','solicitacoes_compra']
  loop
    execute format('drop policy if exists "acesso anon completo" on public.%I', t);
    execute format('drop policy if exists "equipe acessa" on public.%I', t);
    execute format('create policy "equipe acessa" on public.%I for all to authenticated using (public.sou_equipe()) with check (public.sou_equipe())', t);
  end loop;
end $$;

-- Tabelas usadas só pelo backend (service role ignora RLS): fecha o acesso público.
-- integracoes_google guarda os tokens do Google Drive — nunca deve ser legível pelo navegador.
drop policy if exists "acesso anon completo" on public.integracoes_google;
drop policy if exists "acesso anon completo" on public.bot_sessions;

-- 4) Fotos das notas fiscais (bucket privado): só equipe logada.
drop policy if exists "bot lê e grava notas" on storage.objects;
drop policy if exists "equipe lê notas" on storage.objects;
create policy "equipe lê notas" on storage.objects for select to authenticated
  using (bucket_id = 'notas-fiscais' and public.sou_equipe());
