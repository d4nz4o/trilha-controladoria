-- =====================================================================
-- 13 · Painel do fechamento: data de conclusão das tarefas
-- Requer 12_tarefas_meses.sql. Pode ser rodado de novo.
--
--   tarefas_colunas.conclui_tarefa  coluna que significa "concluída" (marcada: a última do quadro)
--   tarefas.concluida_em            preenchida pelo banco quando a tarefa entra numa coluna de conclusão;
--                                   apagada se ela sair de lá. O quadro não precisa fazer nada.
-- Tarefas que já estavam concluídas recebem a data da última atualização (melhor aproximação disponível).
-- =====================================================================

alter table public.tarefas_colunas add column if not exists conclui_tarefa boolean not null default false;
comment on column public.tarefas_colunas.conclui_tarefa is 'Tarefa nesta coluna conta como concluída (painel do fechamento).';

-- Se nenhuma coluna estiver marcada, marca a última do quadro (ex.: "Concluído")
update public.tarefas_colunas set conclui_tarefa = true
where id_coluna = (select id_coluna from public.tarefas_colunas order by ordem_coluna desc limit 1)
  and not exists (select 1 from public.tarefas_colunas where conclui_tarefa);

alter table public.tarefas add column if not exists concluida_em timestamptz;
comment on column public.tarefas.concluida_em is 'Quando a tarefa entrou numa coluna de conclusão (preenchida pelo banco).';

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

drop trigger if exists tarefas_registrar_conclusao on public.tarefas;
create trigger tarefas_registrar_conclusao
  before insert or update of id_coluna on public.tarefas
  for each row execute function public.tarefas_registrar_conclusao();

-- Tarefas já concluídas: data da última atualização como aproximação
update public.tarefas t
set concluida_em = coalesce(t.atualizado_em, t.criado_em, now())::timestamptz
where t.concluida_em is null
  and t.id_coluna in (select id_coluna from public.tarefas_colunas where conclui_tarefa);

create index if not exists tarefas_mes_conclusao_idx on public.tarefas (id_mes, concluida_em);
