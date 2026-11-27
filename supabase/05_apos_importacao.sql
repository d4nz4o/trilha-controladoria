-- =====================================================================
-- 05 · Depois da primeira importação dos CSVs
-- balancetes_classificacoes e balancetes_contas são importadas com os ids já definidos pelo script de
-- preparação (para as ligações baterem). Este passo acerta a numeração automática, para que
-- linhas criadas depois pelo painel continuem do maior id existente.
-- =====================================================================

select setval(pg_get_serial_sequence('public.balancetes_classificacoes', 'id_classificacao'),
              coalesce((select max(id_classificacao) from public.balancetes_classificacoes), 0) + 1, false);

select setval(pg_get_serial_sequence('public.balancetes_contas', 'id_conta'),
              coalesce((select max(id_conta) from public.balancetes_contas), 0) + 1, false);

-- Conferência rápida: quantidades e contas sem classificação
select 'empresas' as tabela, count(*) from public.empresas
union all select 'balancetes_classificacoes', count(*) from public.balancetes_classificacoes
union all select 'balancetes_contas', count(*) from public.balancetes_contas
union all select 'contas sem classificação', count(*) from public.balancetes_contas where id_classificacao is null
union all select 'balancetes', count(*) from public.balancetes
union all select 'balancetes_comentarios', count(*) from public.balancetes_comentarios;
