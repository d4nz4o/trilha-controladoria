-- =====================================================================
-- 07 · Regras de acesso mais rápidas (rodar uma vez em bancos criados antes desta versão)
-- As regras chamavam public.usuario_corporativo() para CADA linha lida (20 mil+ nos balancetes),
-- o que deixava o carregamento das demonstrações em ~20 s. Escrita como (select public.usuario_corporativo()),
-- a função roda UMA vez por consulta (recomendação do Supabase). As permissões continuam exatamente as mesmas.
-- Os scripts 02, 03, 04 e 06 já estão nesta forma para instalações novas.
-- =====================================================================

-- Todas as tabelas: regra restritiva "somente e-mail corporativo"
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop policy if exists "somente e-mail corporativo" on public.%I', t.tablename);
    execute format(
      'create policy "somente e-mail corporativo" on public.%I as restrictive for all to public '
      'using ((select public.usuario_corporativo())) with check ((select public.usuario_corporativo()))', t.tablename);
  end loop;
end $$;

-- Demonstrações: leitura corporativa
do $$
declare t text;
begin
  foreach t in array array['empresas', 'balancetes_classificacoes', 'balancetes_contas', 'balancetes', 'balancetes_comentarios'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists "leitura corporativa" on public.%I', t);
    execute format('create policy "leitura corporativa" on public.%I for select to authenticated '
                   'using ((select public.usuario_corporativo()))', t);
  end loop;
end $$;

-- Comentários: inclusão só em nome próprio
drop policy if exists "inclusao pelo proprio colaborador" on public.balancetes_comentarios;
create policy "inclusao pelo proprio colaborador" on public.balancetes_comentarios
  for insert to authenticated
  with check (
    (select public.usuario_corporativo())
    and (select public.id_colab_usuario()) is not null
    and id_colab = (select public.id_colab_usuario())
  );

-- Bucket privado "dados" (Controle de Ativos), se existir
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'dados: leitura corporativa') then
    drop policy "dados: leitura corporativa" on storage.objects;
    create policy "dados: leitura corporativa" on storage.objects for select to authenticated
      using (bucket_id = 'dados' and (select public.usuario_corporativo()));
  end if;
end $$;
