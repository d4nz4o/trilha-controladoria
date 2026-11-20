-- =====================================================================
-- 05 · Depois da primeira importação dos CSVs
-- classificacoes e contas_contabeis são importadas com os ids já definidos pelo script de
-- preparação (para as ligações baterem). Este passo acerta a numeração automática, para que
-- linhas criadas depois pelo painel continuem do maior id existente.
-- =====================================================================

select setval(pg_get_serial_sequence('public.classificacoes', 'id_classificacao'),
              coalesce((select max(id_classificacao) from public.classificacoes), 0) + 1, false);

select setval(pg_get_serial_sequence('public.contas_contabeis', 'id_conta'),
              coalesce((select max(id_conta) from public.contas_contabeis), 0) + 1, false);

-- Conferência rápida: quantidades e contas sem classificação
select 'empresas' as tabela, count(*) from public.empresas
union all select 'classificacoes', count(*) from public.classificacoes
union all select 'contas_contabeis', count(*) from public.contas_contabeis
union all select 'contas sem classificação', count(*) from public.contas_contabeis where id_classificacao is null
union all select 'balancetes', count(*) from public.balancetes
union all select 'revisoes_comentarios', count(*) from public.revisoes_comentarios;
