-- =====================================================================
-- 18 · Aplicar os grupos de acesso em todo o portal
-- Requer 11 (situacao_acesso) e 17 (grupos de acesso). Pode ser rodado de novo.
--
-- 1) Funções: nivel_recurso, pode_ver, pode_editar e minhas_permissoes (a tela faz UMA chamada por página).
-- 2) Regras RESTRITIVAS por tabela, conforme o recurso: elas se somam às regras atuais (que continuam valendo,
--    ex.: só o autor edita o próprio comentário). Ver = consultar; editar = incluir, alterar e excluir.
-- 3) Transição: quem está ativo e sem grupo recebe o grupo "Acesso total" (editar em tudo), para ninguém
--    perder acesso no dia em que o script rodar. Depois, ajuste os grupos em Configurações.
-- 4) Proteção: o portal nunca fica sem ninguém que edite os grupos de acesso.
--
-- ANTES DE RODAR, confira quem ficaria no grupo "Acesso total" (ativos sem grupo):
--   select nome_colab, email_colab from public.colaboradores where esta_ativo and id_grupo is null order by 1;
-- =====================================================================

-- 0) Segurança: depois da transição, alguém ativo precisa poder editar os grupos de acesso
do $$
begin
  if not exists (select 1 from public.colaboradores c join public.acessos_permissoes p on p.id_grupo = c.id_grupo
                 where c.esta_ativo and p.id_recurso = 'grupos_acesso' and p.nivel_permissao = 'editar')
     and not exists (select 1 from public.colaboradores where esta_ativo and id_grupo is null) then
    raise exception 'Nada foi aplicado: nenhum colaborador ativo ficaria com "editar" em Grupos de acesso. '
      'Em Configurações, dê esse nível a um grupo e coloque você nele (ou deixe seu cadastro sem grupo) e rode de novo.';
  end if;
end $$;

-- 1) Funções de permissão ---------------------------------------------------------------------------

-- Nível do usuário logado num recurso: o do grupo dele; sem grupo ou sem linha = nao_ver
create or replace function public.nivel_recurso(p_recurso text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.nivel_permissao
    from public.colaboradores c
    join public.acessos_permissoes p on p.id_grupo = c.id_grupo and p.id_recurso = p_recurso
    where c.id_colab = public.id_colab_usuario()
  ), 'nao_ver');
$$;

create or replace function public.pode_ver(p_recurso text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.nivel_recurso(p_recurso) in ('ver', 'editar');
$$;

create or replace function public.pode_editar(p_recurso text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.nivel_recurso(p_recurso) = 'editar';
$$;

-- Tudo o que a tela precisa ao abrir uma página, numa chamada: situação do acesso, grupo e nível por recurso
create or replace function public.minhas_permissoes()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'situacao', public.situacao_acesso(),
    'grupo', (select g.nome_grupo from public.colaboradores c join public.acessos_grupos g using (id_grupo)
              where c.id_colab = public.id_colab_usuario()),
    'recursos', coalesce((select jsonb_object_agg(r.id_recurso, public.nivel_recurso(r.id_recurso))
                          from public.acessos_recursos r), '{}'::jsonb)
  );
$$;

grant execute on function public.nivel_recurso(text), public.pode_ver(text), public.pode_editar(text),
  public.minhas_permissoes() to authenticated;

-- 2) Regras restritivas por tabela -----------------------------------------------------------------
--    tabela | quem pode consultar | quem pode incluir, alterar e excluir
do $$
declare
  r record;
begin
  for r in select * from (values
    ('balancetes',                '(select public.pode_ver(''demonstracoes''))',   '(select public.pode_editar(''demonstracoes''))'),
    ('balancetes_contas',         '(select public.pode_ver(''demonstracoes''))',   '(select public.pode_editar(''demonstracoes''))'),
    ('balancetes_classificacoes', '(select public.pode_ver(''demonstracoes''))',   '(select public.pode_editar(''demonstracoes''))'),
    ('balancetes_comentarios',    '(select public.pode_ver(''demonstracoes''))',   '(select public.pode_editar(''demonstracoes''))'),
    ('empresas',                  '((select public.pode_ver(''demonstracoes'')) or (select public.pode_ver(''cad_empresas'')))',
                                  '(select public.pode_editar(''cad_empresas''))'),
    ('colaboradores',             null,                                             '(select public.pode_editar(''cad_colaboradores''))'),
    ('equipes',                   null,                                             '(select public.pode_editar(''cad_colaboradores''))'),
    ('acessos_grupos',            null,                                             '(select public.pode_editar(''grupos_acesso''))'),
    ('acessos_permissoes',        null,                                             '(select public.pode_editar(''grupos_acesso''))'),
    ('tarefas',                   '(select public.pode_ver(''tarefas''))',         '(select public.pode_editar(''tarefas''))'),
    ('tarefas_colunas',           '(select public.pode_ver(''tarefas''))',         '(select public.pode_editar(''tarefas''))'),
    ('tarefas_meses',             '(select public.pode_ver(''tarefas''))',         '(select public.pode_editar(''tarefas''))'),
    ('subtarefas',                '(select public.pode_ver(''tarefas''))',         '(select public.pode_editar(''tarefas''))'),
    ('tags',                      '(select public.pode_ver(''tarefas''))',         '(select public.pode_editar(''tarefas''))'),
    ('tarefas_tags',              '(select public.pode_ver(''tarefas''))',         '(select public.pode_editar(''tarefas''))'),
    ('tarefas_colaboradores',     '(select public.pode_ver(''tarefas''))',         '(select public.pode_editar(''tarefas''))'),
    ('tarefas_comentarios',       '(select public.pode_ver(''tarefas''))',         '(select public.pode_editar(''tarefas''))'),
    ('tarefas_anexos',            '(select public.pode_ver(''tarefas''))',         '(select public.pode_editar(''tarefas''))'),
    ('tarefas_historicos',        '(select public.pode_ver(''tarefas''))',         '(select public.pode_editar(''tarefas''))'),
    ('tarefas_feriados',          null,                                             '((select public.pode_editar(''tarefas'')) or (select public.pode_editar(''ferias_equipe'')))'),
    ('ferias',                    '(select public.pode_ver(''ferias_equipe''))',   '(select public.pode_editar(''ferias_equipe''))'),
    ('automacoes',                '(select public.pode_ver(''automacoes''))',      '(select public.pode_editar(''automacoes''))')
  ) as t(tabela, ver, editar)
  loop
    if to_regclass('public.' || r.tabela) is null then
      raise notice 'Tabela % não existe; regras não aplicadas.', r.tabela;
      continue;
    end if;
    execute format('drop policy if exists "acesso: consultar" on public.%I', r.tabela);
    execute format('drop policy if exists "acesso: incluir" on public.%I', r.tabela);
    execute format('drop policy if exists "acesso: alterar" on public.%I', r.tabela);
    execute format('drop policy if exists "acesso: excluir" on public.%I', r.tabela);
    if r.ver is not null then
      execute format('create policy "acesso: consultar" on public.%I as restrictive for select to public using (%s)', r.tabela, r.ver);
    end if;
    execute format('create policy "acesso: incluir" on public.%I as restrictive for insert to public with check (%s)', r.tabela, r.editar);
    execute format('create policy "acesso: alterar" on public.%I as restrictive for update to public using (%s) with check (%s)', r.tabela, r.editar, r.editar);
    execute format('create policy "acesso: excluir" on public.%I as restrictive for delete to public using (%s)', r.tabela, r.editar);
  end loop;
end $$;

-- Arquivos: bucket "dados" (controle de ativos) e "anexos-tarefas" (anexos das tarefas)
drop policy if exists "acesso: arquivos (consultar)" on storage.objects;
create policy "acesso: arquivos (consultar)" on storage.objects as restrictive for select to public
  using (bucket_id <> 'dados' or (select public.pode_ver('controle_ativos')));
drop policy if exists "acesso: arquivos (incluir)" on storage.objects;
create policy "acesso: arquivos (incluir)" on storage.objects as restrictive for insert to public
  with check (bucket_id <> 'anexos-tarefas' or (select public.pode_editar('tarefas')));
drop policy if exists "acesso: arquivos (excluir)" on storage.objects;
create policy "acesso: arquivos (excluir)" on storage.objects as restrictive for delete to public
  using (bucket_id <> 'anexos-tarefas' or (select public.pode_editar('tarefas')));

-- 3) Transição: grupo "Acesso total" para quem está ativo e sem grupo --------------------------------
insert into public.acessos_grupos (nome_grupo, desc_grupo)
select 'Acesso total', 'Editar em tudo. Criado na aplicação dos grupos (script 18) para ninguém perder acesso; ajuste ou exclua.'
where not exists (select 1 from public.acessos_grupos where nome_grupo = 'Acesso total');

insert into public.acessos_permissoes (id_grupo, id_recurso, nivel_permissao)
select g.id_grupo, r.id_recurso, 'editar'
from public.acessos_grupos g cross join public.acessos_recursos r
where g.nome_grupo = 'Acesso total'
on conflict (id_grupo, id_recurso) do nothing;

update public.colaboradores
set id_grupo = (select id_grupo from public.acessos_grupos where nome_grupo = 'Acesso total')
where esta_ativo and id_grupo is null;

-- 4) Proteção: sempre há alguém ativo que edita os grupos de acesso ------------------------------------
create or replace function public.acessos_garantir_administrador()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.colaboradores c
    join public.acessos_permissoes p on p.id_grupo = c.id_grupo
    where c.esta_ativo and p.id_recurso = 'grupos_acesso' and p.nivel_permissao = 'editar'
  ) then
    raise exception 'Alteração recusada: o portal ficaria sem ninguém ativo que possa editar os grupos de acesso.';
  end if;
  return null;
end;
$$;

drop trigger if exists acessos_garantir_administrador on public.acessos_permissoes;
create trigger acessos_garantir_administrador
  after update or delete on public.acessos_permissoes
  for each statement execute function public.acessos_garantir_administrador();

drop trigger if exists acessos_garantir_administrador on public.colaboradores;
create trigger acessos_garantir_administrador
  after update of id_grupo, esta_ativo or delete on public.colaboradores
  for each statement execute function public.acessos_garantir_administrador();
