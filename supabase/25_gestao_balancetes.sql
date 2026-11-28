-- =====================================================================
-- 25 · Gestão de balancetes pelo portal (Configurações › Balancetes)
-- Requer 18, 19, 21 e 22. Pode ser rodado de novo.
--
-- - Novo recurso "Gestão de balancetes" (cada grupo começa com o nível que tem em "Plano de contas").
-- - Alterar e excluir saldos pelo portal exige "Edição" nesse recurso (antes: em Demonstrações).
-- - balancetes_resumo(): quantidade de saldos por empresa e mês (o quadro de meses carregados).
-- - balancetes_carregar(linhas, substituir): carga de CSV numa única operação. As linhas entram na tabela de
--   pendências (script 22): o que tiver conta cadastrada vai para balancetes; o resto fica como pendência.
--   substituir = true apaga antes os saldos (e pendências) das empresas e meses do arquivo.
-- =====================================================================

insert into public.acessos_recursos (id_recurso, modulo_recurso, nome_recurso, desc_recurso, ordem_recurso) values
  ('balancetes', 'Administração', 'Gestão de balancetes', 'Configurações › Balancetes: carregar, alterar e excluir saldos', 10)
on conflict (id_recurso) do update set modulo_recurso = excluded.modulo_recurso, nome_recurso = excluded.nome_recurso,
  desc_recurso = excluded.desc_recurso, ordem_recurso = excluded.ordem_recurso;

insert into public.acessos_permissoes (id_grupo, id_recurso, nivel_permissao)
select id_grupo, 'balancetes', nivel_permissao from public.acessos_permissoes where id_recurso = 'plano_contas'
on conflict (id_grupo, id_recurso) do nothing;

-- Alterar e excluir saldos pelo portal (a inclusão passa pela carga)
drop policy if exists "edicao pelo portal" on public.balancetes;
create policy "edicao pelo portal" on public.balancetes for update to authenticated using (true) with check (true);
drop policy if exists "exclusao pelo portal" on public.balancetes;
create policy "exclusao pelo portal" on public.balancetes for delete to authenticated using (true);
grant update (montante_balancete), delete on public.balancetes to authenticated;

-- Regras restritivas (script 18): consultar = ver Demonstrações OU a Gestão de balancetes; gravar = Edição na gestão
drop policy if exists "acesso: consultar" on public.balancetes;
create policy "acesso: consultar" on public.balancetes as restrictive for select to public
  using ((select public.pode_ver('demonstracoes')) or (select public.pode_ver('balancetes')));
drop policy if exists "acesso: incluir" on public.balancetes;
create policy "acesso: incluir" on public.balancetes as restrictive for insert to public
  with check ((select public.pode_editar('balancetes')));
drop policy if exists "acesso: alterar" on public.balancetes;
create policy "acesso: alterar" on public.balancetes as restrictive for update to public
  using ((select public.pode_editar('balancetes'))) with check ((select public.pode_editar('balancetes')));
drop policy if exists "acesso: excluir" on public.balancetes;
create policy "acesso: excluir" on public.balancetes as restrictive for delete to public
  using ((select public.pode_editar('balancetes')));

-- Pendências: também para quem gerencia os balancetes
drop policy if exists "consulta" on public.balancetes_pendencias;
create policy "consulta" on public.balancetes_pendencias for select to authenticated
  using (((select public.pode_ver('plano_contas')) or (select public.pode_ver('balancetes')))
         and id_empresa in (select public.empresas_visiveis()));
drop policy if exists "inclusao e descarte" on public.balancetes_pendencias;
create policy "inclusao e descarte" on public.balancetes_pendencias for all to authenticated
  using (((select public.pode_editar('plano_contas')) or (select public.pode_editar('balancetes')))
         and id_empresa in (select public.empresas_visiveis()))
  with check (((select public.pode_editar('plano_contas')) or (select public.pode_editar('balancetes')))
              and id_empresa in (select public.empresas_visiveis()));

-- Quadro de meses carregados (respeita as regras de acesso de quem consulta)
create or replace function public.balancetes_resumo()
returns table (id_empresa bigint, periodo_balancete date, linhas bigint, total numeric)
language sql stable as $$
  select b.id_empresa, b.periodo_balancete, count(*), sum(b.montante_balancete)
  from public.balancetes b
  group by 1, 2
  order by 2 desc, 1;
$$;
grant execute on function public.balancetes_resumo() to authenticated;

-- Carga de CSV: p_linhas = [{"id_empresa":4029,"numero_conta":"11110001","periodo_balancete":"2026-10-31",
--                             "montante_balancete":1234.56,"desc_conta":"opcional"}, …]
create or replace function public.balancetes_carregar(p_linhas jsonb, p_substituir boolean default false)
returns jsonb
language plpgsql
security definer                 -- apaga e grava numa única operação, com as verificações abaixo
set search_path = public
as $$
declare
  v_apagadas  integer := 0;
  v_linhas    integer;
  v_chaves    integer;
  v_pendentes integer;
  v_empresa   bigint;
begin
  if not public.pode_editar('balancetes') then
    raise exception 'Seu grupo de acesso não permite carregar balancetes.';
  end if;

  drop table if exists _carga;                     -- mais de uma carga na mesma transação
  create temp table _carga on commit drop as
  select id_empresa, trim(numero_conta) as numero_conta,
         (date_trunc('month', periodo_balancete) + interval '1 month - 1 day')::date as periodo_balancete,
         coalesce(montante_balancete, 0)::numeric(18, 2) as montante_balancete, nullif(trim(desc_conta), '') as desc_conta
  from jsonb_to_recordset(p_linhas) as l(id_empresa bigint, numero_conta text, periodo_balancete date,
                                          montante_balancete numeric, desc_conta text);

  if exists (select 1 from _carga where id_empresa is null or coalesce(numero_conta, '') = '' or periodo_balancete is null) then
    raise exception 'Há linhas sem empresa, conta ou mês.';
  end if;
  select c.id_empresa into v_empresa from _carga c
  where c.id_empresa not in (select public.empresas_visiveis()) limit 1;
  if v_empresa is not null then
    raise exception 'Você não tem acesso aos balancetes da empresa %.', v_empresa;
  end if;

  if p_substituir then
    delete from public.balancetes b
    using (select distinct id_empresa, periodo_balancete from _carga) m
    where b.id_empresa = m.id_empresa and b.periodo_balancete = m.periodo_balancete;
    get diagnostics v_apagadas = row_count;
    delete from public.balancetes_pendencias p
    using (select distinct id_empresa, periodo_balancete from _carga) m
    where p.id_empresa = m.id_empresa and p.periodo_balancete = m.periodo_balancete;
  end if;

  insert into public.balancetes_pendencias (id_empresa, numero_conta, periodo_balancete, montante_balancete, desc_conta)
  select id_empresa, numero_conta, periodo_balancete, montante_balancete, desc_conta from _carga;
  get diagnostics v_linhas = row_count;

  select count(*) into v_chaves from (select distinct id_empresa, numero_conta, periodo_balancete from _carga) k;
  select count(distinct (p.id_empresa, p.numero_conta, p.periodo_balancete)) into v_pendentes
  from public.balancetes_pendencias p
  join (select distinct id_empresa, numero_conta, periodo_balancete from _carga) k using (id_empresa, numero_conta, periodo_balancete);

  return jsonb_build_object('linhas', v_linhas, 'gravadas', v_chaves - v_pendentes, 'pendentes', v_pendentes, 'apagadas', v_apagadas);
end;
$$;
grant execute on function public.balancetes_carregar(jsonb, boolean) to authenticated;
