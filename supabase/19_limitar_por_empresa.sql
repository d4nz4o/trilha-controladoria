-- =====================================================================
-- 19 · Visualização limitada pela empresa da pessoa
-- Requer 18. Pode ser rodado de novo.
--
--   colaboradores.id_empresa  empresa da pessoa
--   empresas.empresa_holding  quem é de empresa holding (Trilha) vê os dados de TODAS as empresas;
--                             os demais veem só os da própria empresa
-- Vale para balancetes e comentários da revisão analítica (somado às regras dos grupos de acesso).
-- O plano de contas e a hierarquia são comuns. O controle de ativos (arquivo único no bucket) fica restrito
-- pelos grupos até a migração para tabelas.
-- Transição: colaboradores sem empresa entram como Trilha (3700), para ninguém perder acesso. Depois, ajuste
-- em Configurações › Colaboradores.
-- =====================================================================

-- 1) Empresa da pessoa e holding
alter table public.empresas add column if not exists empresa_holding boolean not null default false;
comment on column public.empresas.empresa_holding is 'Quem é desta empresa vê os dados de todas as empresas (ex.: Trilha).';
update public.empresas set empresa_holding = true where id_empresa = 3700 and not empresa_holding;

alter table public.colaboradores add column if not exists id_empresa bigint
  references public.empresas (id_empresa) on update cascade on delete restrict;
create index if not exists colaboradores_empresa_idx on public.colaboradores (id_empresa);
comment on column public.colaboradores.id_empresa is 'Empresa da pessoa: define de quais empresas ela vê dados.';

update public.colaboradores set id_empresa = 3700
where id_empresa is null and exists (select 1 from public.empresas where id_empresa = 3700);

-- 2) Funções
-- Verdadeiro se a empresa da pessoa for holding (vê todas)
create or replace function public.ve_todas_empresas()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select e.empresa_holding from public.colaboradores c join public.empresas e on e.id_empresa = c.id_empresa
                   where c.id_colab = public.id_colab_usuario()), false);
$$;

-- Empresas cujos dados a pessoa vê: todas (holding) ou só a dela; sem empresa no cadastro, nenhuma
create or replace function public.empresas_visiveis()
returns setof bigint language sql stable security definer set search_path = public as $$
  select e.id_empresa from public.empresas e
  where public.ve_todas_empresas()
     or e.id_empresa = (select c.id_empresa from public.colaboradores c where c.id_colab = public.id_colab_usuario());
$$;

-- minhas_permissoes passa a informar também as empresas visíveis (a tela continua com UMA chamada por página)
create or replace function public.minhas_permissoes()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'situacao', public.situacao_acesso(),
    'grupo', (select g.nome_grupo from public.colaboradores c join public.acessos_grupos g using (id_grupo)
              where c.id_colab = public.id_colab_usuario()),
    'recursos', coalesce((select jsonb_object_agg(r.id_recurso, public.nivel_recurso(r.id_recurso))
                          from public.acessos_recursos r), '{}'::jsonb),
    'todas_empresas', public.ve_todas_empresas(),
    'empresas', coalesce((select jsonb_agg(x) from public.empresas_visiveis() x), '[]'::jsonb)
  );
$$;

grant execute on function public.ve_todas_empresas(), public.empresas_visiveis(), public.minhas_permissoes() to authenticated;

-- 3) Regras por empresa (restritivas, somadas às dos grupos)
do $$
declare t text;
begin
  foreach t in array array['balancetes', 'balancetes_comentarios'] loop
    execute format('drop policy if exists "acesso: empresa (consultar)" on public.%I', t);
    execute format('create policy "acesso: empresa (consultar)" on public.%I as restrictive for select to public '
                   'using (id_empresa in (select public.empresas_visiveis()))', t);
    execute format('drop policy if exists "acesso: empresa (gravar)" on public.%I', t);
    execute format('drop policy if exists "acesso: empresa (incluir)" on public.%I', t);
    execute format('create policy "acesso: empresa (incluir)" on public.%I as restrictive for insert to public '
                   'with check (id_empresa in (select public.empresas_visiveis()))', t);
    execute format('drop policy if exists "acesso: empresa (alterar)" on public.%I', t);
    execute format('create policy "acesso: empresa (alterar)" on public.%I as restrictive for update to public '
                   'using (id_empresa in (select public.empresas_visiveis())) with check (id_empresa in (select public.empresas_visiveis()))', t);
    execute format('drop policy if exists "acesso: empresa (excluir)" on public.%I', t);
    execute format('create policy "acesso: empresa (excluir)" on public.%I as restrictive for delete to public '
                   'using (id_empresa in (select public.empresas_visiveis()))', t);
  end loop;
end $$;

-- Empresas: cada um vê as suas no seletor; quem vê o cadastro de empresas vê a lista toda (só os cadastros)
drop policy if exists "acesso: empresa (consultar)" on public.empresas;
create policy "acesso: empresa (consultar)" on public.empresas as restrictive for select to public
  using (id_empresa in (select public.empresas_visiveis()) or (select public.pode_ver('cad_empresas')));
