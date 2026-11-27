-- =====================================================================
-- 21 · Plano de contas pelo portal (Configurações › Plano de contas)
-- Requer 17 e 18. Pode ser rodado de novo.
--
-- - Novo recurso "Plano de contas" nos grupos de acesso (cada grupo começa com o nível que tem em
--   "Cadastro de empresas").
-- - Inclusão e alteração de contas (balancetes_contas) pelo portal, para quem edita o recurso. Sem exclusão:
--   os balancetes dependem das contas.
-- - Quem vê o plano de contas consulta as contas e a hierarquia, mesmo sem ver as demonstrações.
-- =====================================================================

insert into public.acessos_recursos (id_recurso, modulo_recurso, nome_recurso, desc_recurso, ordem_recurso) values
  ('plano_contas', 'Administração', 'Plano de contas', 'Configurações › Plano de contas: contas contábeis e classificação no BP e DR', 9)
on conflict (id_recurso) do update set modulo_recurso = excluded.modulo_recurso, nome_recurso = excluded.nome_recurso,
  desc_recurso = excluded.desc_recurso, ordem_recurso = excluded.ordem_recurso;

insert into public.acessos_permissoes (id_grupo, id_recurso, nivel_permissao)
select id_grupo, 'plano_contas', nivel_permissao from public.acessos_permissoes where id_recurso = 'cad_empresas'
on conflict (id_grupo, id_recurso) do nothing;

-- Edição de contas pelo portal (o script 03 dava só leitura)
drop policy if exists "inclusao pelo portal" on public.balancetes_contas;
create policy "inclusao pelo portal" on public.balancetes_contas for insert to authenticated with check (true);
drop policy if exists "edicao pelo portal" on public.balancetes_contas;
create policy "edicao pelo portal" on public.balancetes_contas for update to authenticated using (true) with check (true);
grant insert, update on public.balancetes_contas to authenticated;

-- Regras restritivas (script 18): gravar contas passa a exigir "editar" no Plano de contas;
-- consultar contas e hierarquia, ver as demonstrações OU o plano de contas
do $$
declare t text;
begin
  foreach t in array array['balancetes_contas', 'balancetes_classificacoes'] loop
    execute format('drop policy if exists "acesso: consultar" on public.%I', t);
    execute format('create policy "acesso: consultar" on public.%I as restrictive for select to public '
                   'using ((select public.pode_ver(''demonstracoes'')) or (select public.pode_ver(''plano_contas'')))', t);
  end loop;
end $$;

drop policy if exists "acesso: incluir" on public.balancetes_contas;
create policy "acesso: incluir" on public.balancetes_contas as restrictive for insert to public
  with check ((select public.pode_editar('plano_contas')));
drop policy if exists "acesso: alterar" on public.balancetes_contas;
create policy "acesso: alterar" on public.balancetes_contas as restrictive for update to public
  using ((select public.pode_editar('plano_contas'))) with check ((select public.pode_editar('plano_contas')));
drop policy if exists "acesso: excluir" on public.balancetes_contas;
create policy "acesso: excluir" on public.balancetes_contas as restrictive for delete to public
  using ((select public.pode_editar('plano_contas')));
