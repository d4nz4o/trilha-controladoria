-- =====================================================================
-- 20 · Novo domínio aceito no portal: engetrens.com.br
-- Recria situacao_acesso (script 11) com o domínio na lista. usuario_corporativo e minhas_permissoes usam esta
-- função, então todas as regras do banco passam a aceitar o domínio. Pode ser rodado de novo.
-- Manter igual a DOMINIOS_CORPORATIVOS em public/src/scripts/core/supabase.js.
-- A pessoa continua precisando de cadastro ATIVO em colaboradores (e de grupo e empresa para ver os dados).
-- =====================================================================

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
