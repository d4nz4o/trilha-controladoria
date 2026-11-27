-- =====================================================================
-- 23 · Criar equipes pelo portal (Configurações › Colaboradores › Equipe › "+ Nova equipe…")
-- O script 10 dava só leitura na tabela equipes. Aqui: inclusão por quem tem acesso ao portal; a regra
-- restritiva do script 18 continua exigindo "Edição" no Cadastro de colaboradores. Pode ser rodado de novo.
-- =====================================================================

drop policy if exists "inclusao pelo portal" on public.equipes;
create policy "inclusao pelo portal" on public.equipes for insert to authenticated with check (true);
grant insert on public.equipes to authenticated;
