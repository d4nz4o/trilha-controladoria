-- =====================================================================
-- 15 · Ajuste após renomear tabelas no Supabase
--   contas_contabeis -> balancetes_contas · classificacoes -> balancetes_classificacoes
--   revisoes_comentarios -> balancetes_comentarios · colunas_tarefas -> tarefas_colunas
--
-- Tabelas renomeadas mantêm dados, ligações e regras de acesso, mas funções do banco guardam os nomes como
-- texto e não acompanham a renomeação. Duas funções citam colunas_tarefas e são recriadas aqui:
--   - tarefas_registrar_conclusao (data de conclusão ao mover o cartão; script 13)
--   - tarefas_iniciar_mes         ("Começar próximo mês"; script 12)
-- Pode ser rodado de novo.
-- =====================================================================

do $$
begin
  if to_regclass('public.tarefas_colunas') is null then
    raise exception 'A tabela public.tarefas_colunas não existe. Renomeie colunas_tarefas antes de rodar este script.';
  end if;
end $$;

create or replace function public.tarefas_registrar_conclusao()
returns trigger
language plpgsql
as $$
declare
  v_nova     boolean := coalesce((select conclui_tarefa from public.tarefas_colunas where id_coluna = new.id_coluna), false);
  v_anterior boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_anterior := coalesce((select conclui_tarefa from public.tarefas_colunas where id_coluna = old.id_coluna), false);
  end if;
  if not v_nova then
    new.concluida_em := null;                               -- saiu (ou não está) numa coluna de conclusão
  elsif not v_anterior then
    new.concluida_em := coalesce(new.concluida_em, now());  -- acabou de entrar
  end if;
  return new;
end;
$$;

create or replace function public.tarefas_iniciar_mes(
  p_competencia    date,
  p_id_mes_origem  bigint default null,
  p_ids_tarefas    bigint[] default '{}'
)
returns bigint
language plpgsql
as $$
declare
  v_competencia  date := date_trunc('month', p_competencia)::date;
  v_id_mes       bigint;
  v_coluna       bigint;
  v_origem_txt   text;
  v_colab        bigint := public.id_colab_usuario();
  t              record;
  v_nova         bigint;
begin
  if exists (select 1 from public.tarefas_meses where competencia_mes = v_competencia) then
    raise exception 'A competência % já existe.', to_char(v_competencia, 'MM/YYYY');
  end if;

  insert into public.tarefas_meses (competencia_mes, id_mes_origem)
  values (v_competencia, p_id_mes_origem)
  returning id_mes into v_id_mes;

  if p_id_mes_origem is null or coalesce(array_length(p_ids_tarefas, 1), 0) = 0 then
    return v_id_mes;
  end if;

  select id_coluna into v_coluna from public.tarefas_colunas order by ordem_coluna limit 1;
  -- Competência no padrão do portal (ex.: out/26)
  select (array['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'])[extract(month from competencia_mes)::int]
         || '/' || to_char(competencia_mes, 'YY')
    into v_origem_txt from public.tarefas_meses where id_mes = p_id_mes_origem;

  for t in
    select * from public.tarefas
    where id_mes = p_id_mes_origem and id_tarefa = any (p_ids_tarefas) and coalesce(tarefa_arquivada, false) = false
    order by id_tarefa
  loop
    insert into public.tarefas (
      titulo_tarefa, descricao_tarefa, id_coluna, id_criador, prioridade_tarefa,
      prazo_inicio, prazo_fim, tarefa_arquivada, id_mes, tarefa_recorrente, tipo_prazo, prazo_du_inicio, prazo_du_fim
    ) values (
      t.titulo_tarefa, t.descricao_tarefa, coalesce(v_coluna, t.id_coluna), coalesce(v_colab, t.id_criador), t.prioridade_tarefa,
      -- data fixa: +1 mês, no próximo dia útil (dias úteis: o gatilho recalcula)
      case when t.tipo_prazo = 'data' and t.prazo_inicio is not null
           then public.tarefas_proximo_dia_util((t.prazo_inicio + interval '1 month')::date) + t.prazo_inicio::time end,
      case when t.tipo_prazo = 'data' and t.prazo_fim is not null
           then public.tarefas_proximo_dia_util((t.prazo_fim + interval '1 month')::date) + t.prazo_fim::time end,
      false, v_id_mes, t.tarefa_recorrente, t.tipo_prazo, t.prazo_du_inicio, t.prazo_du_fim
    ) returning id_tarefa into v_nova;

    insert into public.tarefas_colaboradores (id_tarefa, id_colab)
      select v_nova, id_colab from public.tarefas_colaboradores where id_tarefa = t.id_tarefa;
    insert into public.tarefas_tags (id_tarefa, id_tag)
      select v_nova, id_tag from public.tarefas_tags where id_tarefa = t.id_tarefa;
    insert into public.subtarefas (id_tarefa, titulo_subtarefa, concluido, ordem_subtarefa)
      select v_nova, titulo_subtarefa, false, ordem_subtarefa from public.subtarefas where id_tarefa = t.id_tarefa;
    insert into public.tarefas_historicos (id_tarefa, acao_historico, id_colab)
      values (v_nova, 'Criada a partir de ' || v_origem_txt, v_colab);
  end loop;

  return v_id_mes;
end;
$$;

grant execute on function public.tarefas_iniciar_mes(date, bigint, bigint[]) to authenticated;
