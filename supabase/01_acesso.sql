-- =====================================================================
-- 01 · Regra de acesso comum
-- Rode uma vez no SQL Editor do Supabase, antes dos demais scripts.
-- Libera os dados do portal só para quem está logado com e-mail corporativo do grupo
-- (a mesma regra que o login do site já aplica no navegador, agora no banco).
-- Domínios aceitos: triviatrens.com.br, tictrens.com.br, comporte.com.br, metrobh.com.br e engetrens.com.br.
-- =====================================================================

create or replace function public.usuario_corporativo()
returns boolean
language sql
stable
security definer                 -- pode ler auth.users quando o token não traz o e-mail
set search_path = public, auth
as $$
  -- Manter igual a DOMINIOS_CORPORATIVOS em public/src/scripts/core/supabase.js
  -- E-mail do token; se não vier (alguns logins externos), o do usuário logado em auth.users
  select lower(split_part(trim(coalesce(
           nullif(auth.jwt() ->> 'email', ''),
           (select u.email from auth.users u where u.id = auth.uid()),
           ''
         )), '@', 2)) = any (array[
    'triviatrens.com.br',
    'tictrens.com.br',
    'comporte.com.br',
    'metrobh.com.br',
    'engetrens.com.br'
  ]);
$$;

comment on function public.usuario_corporativo() is
  'Verdadeiro quando o usuário logado tem e-mail de um domínio do grupo (triviatrens, tictrens, comporte, metrobh .com.br). Usada nas políticas de RLS do portal.';

-- id_colab (tabela colaboradores) do usuário logado: pelo id_auth; se não houver, pelo e-mail.
-- Devolve null quando o usuário não está cadastrado como colaborador.
-- "security definer": funciona mesmo que as regras de leitura de colaboradores mudem.
create or replace function public.id_colab_usuario()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select c.id_colab
  from public.colaboradores c
  where c.id_auth = auth.uid()
     or lower(c.email_colab) = lower(auth.jwt() ->> 'email')
  order by (c.id_auth = auth.uid()) desc nulls last
  limit 1;
$$;

comment on function public.id_colab_usuario() is
  'id_colab do usuário logado (por id_auth ou e-mail); null se ele não estiver em colaboradores.';
