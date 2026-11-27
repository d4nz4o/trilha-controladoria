-- =====================================================================
-- 16 · Cadastro de empresas pelo portal (Configurações › Empresas)
-- O script 03 dava só LEITURA na tabela empresas. Aqui: inclusão e edição para quem tem acesso ao portal
-- (a regra restritiva "somente e-mail corporativo" continua valendo: cadastro ativo em colaboradores).
-- Sem exclusão: os balancetes dependem da empresa; para tirá-la do consolidado, use o método "fora".
-- Pode ser rodado de novo. Quando houver grupos de acesso, a edição passa a ser restrita a eles.
-- =====================================================================

drop policy if exists "inclusao pelo portal" on public.empresas;
create policy "inclusao pelo portal" on public.empresas for insert to authenticated with check (true);

drop policy if exists "edicao pelo portal" on public.empresas;
create policy "edicao pelo portal" on public.empresas for update to authenticated using (true) with check (true);

grant insert, update on public.empresas to authenticated;
