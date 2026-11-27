-- =====================================================================
-- 11 · Acesso somente para colaboradores cadastrados e ativos
-- Além do e-mail de domínio do grupo, a pessoa precisa ter cadastro ATIVO em colaboradores
-- (encontrado pelo id_auth ou pelo e-mail). Sem cadastro: "acesso ainda não liberado pela Controladoria".
-- Requer 10_equipes_e_situacao.sql (campo esta_ativo). Pode ser rodado de novo.
--
-- ANTES DE RODAR, confira quem perderia o acesso (logins sem cadastro ativo correspondente):
--   select u.email, u.last_sign_in_at
--   from auth.users u
--   where not exists (
--     select 1 from public.colaboradores c
--     where c.esta_ativo and (c.id_auth = u.id or lower(trim(c.email_colab)) = lower(trim(u.email))))
--   order by u.last_sign_in_at desc nulls last;
-- =====================================================================

-- Situação do usuário logado: 'liberado' | 'sem_cadastro' | 'inativo' | 'dominio'
-- Usada pelo site para mostrar o aviso certo; as regras das tabelas usam usuario_corporativo().
create or replace function public.situacao_acesso()
returns text
language sql
stable
security definer                 -- lê auth.users e colaboradores independentemente das regras de acesso
set search_path = public, auth
as $$
  with eu as (
    -- E-mail do token; se não vier (alguns logins externos), o do usuário logado em auth.users
    select lower(trim(coalesce(
             nullif(auth.jwt() ->> 'email', ''),
             (select u.email from auth.users u where u.id = auth.uid()),
             ''
           ))) as email
  ),
  cadastro as (
    -- Prefere o vínculo pelo id_auth; senão, pelo e-mail
    select c.esta_ativo
    from public.colaboradores c, eu
    where c.id_auth = auth.uid() or lower(trim(c.email_colab)) = eu.email
    order by (c.id_auth = auth.uid()) desc nulls last, c.esta_ativo desc
    limit 1
  )
  select case
    -- Manter igual a DOMINIOS_CORPORATIVOS em public/src/scripts/core/supabase.js
    when split_part((select email from eu), '@', 2) <> all (array[
      'triviatrens.com.br',
      'tictrens.com.br',
      'comporte.com.br',
      'metrobh.com.br',
      'engetrens.com.br'
    ]) then 'dominio'
    when not exists (select 1 from cadastro) then 'sem_cadastro'
    when (select esta_ativo from cadastro) is not true then 'inativo'
    else 'liberado'
  end;
$$;

comment on function public.situacao_acesso() is
  'Situação do usuário logado no portal: liberado, sem_cadastro (sem cadastro em colaboradores), inativo ou dominio.';

-- Regra usada em todas as tabelas (RLS): só "liberado" acessa
create or replace function public.usuario_corporativo()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.situacao_acesso() = 'liberado';
$$;

comment on function public.usuario_corporativo() is
  'Verdadeiro para e-mail de domínio do grupo com cadastro ATIVO em colaboradores. Usada nas regras de acesso (RLS).';

grant execute on function public.situacao_acesso() to authenticated;
