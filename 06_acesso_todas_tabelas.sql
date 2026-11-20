-- =====================================================================
-- 06 · Regra de e-mail corporativo em TODAS as tabelas do schema public
-- Requer 01_acesso.sql (função usuario_corporativo). Pode ser rodado de novo a qualquer momento,
-- por exemplo depois de criar uma tabela nova: ele só (re)cria as próprias regras.
--
-- Como funciona:
--   1) Em toda tabela: RLS ligado + regra RESTRITIVA "somente e-mail corporativo".
--      Restritiva = precisa ser cumprida SEMPRE, além de qualquer outra regra que já exista.
--      Assim, regras antigas que liberavam acesso amplo passam a exigir o e-mail corporativo,
--      sem precisar apagá-las.
--   2) Tabelas da controladoria (o site lê, cria, edita e apaga): regra PERMISSIVA de acesso
--      completo para usuários logados — que, somada à restritiva, vale só para e-mail corporativo.
--   3) Demonstrações: continuam com as regras dos scripts 03 e 04 (só leitura; comentário em nome próprio).
--
-- Não afeta: o painel do Supabase, importações e a chave de serviço (service_role), que não passam por RLS,
-- nem funções "security definer" (ex.: id_colab_usuario e o trigger que vincula colaborador ao login).
--
-- Desempenho: a função é chamada como (select public.usuario_corporativo()) para rodar UMA vez por consulta,
-- e não uma vez por linha (recomendação do Supabase para RLS).
-- =====================================================================

-- 1) Regra restritiva em todas as tabelas
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('drop policy if exists "somente e-mail corporativo" on public.%I', t.tablename);
    execute format(
      'create policy "somente e-mail corporativo" on public.%I as restrictive for all to public '
      'using ((select public.usuario_corporativo())) with check ((select public.usuario_corporativo()))', t.tablename);
  end loop;
end $$;

-- 2) Controladoria: acesso completo (ler, criar, editar, apagar) para usuários logados.
--    Combinada com a regra restritiva, vale só para e-mail corporativo.
do $$
declare t text;
begin
  foreach t in array array[
    'tarefas', 'colunas_tarefas', 'subtarefas', 'tags', 'tarefas_tags', 'tarefas_colaboradores',
    'tarefas_comentarios', 'tarefas_anexos', 'tarefas_historicos', 'colaboradores', 'ferias', 'automacoes'
  ] loop
    if to_regclass('public.' || t) is null then
      raise notice 'Tabela % não existe; ignorada.', t;
      continue;
    end if;
    execute format('drop policy if exists "controladoria: acesso da equipe" on public.%I', t);
    execute format(
      'create policy "controladoria: acesso da equipe" on public.%I for all to authenticated '
      'using (true) with check (true)', t);
  end loop;
end $$;

-- 3) Conferência: regras de cada tabela.
--    Tabela sem nenhuma regra permissiva fica inacessível pelo site (só o painel acessa) — veja a coluna "situacao".
select c.relname as tabela,
       c.relrowsecurity as rls_ativo,
       string_agg(p.policyname || ' [' || p.permissive || ', ' || p.cmd || ']', ' · ' order by p.permissive, p.policyname) as regras,
       case
         when not bool_or(p.permissive = 'PERMISSIVE') or bool_or(p.permissive = 'PERMISSIVE') is null
           then 'sem regra permissiva: site sem acesso'
         else 'ok'
       end as situacao
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by situacao desc, c.relname;
