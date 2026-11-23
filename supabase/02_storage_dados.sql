-- =====================================================================
-- 02 · Bucket privado "dados": arquivos do Controle de Ativos (lidos por fonte-dados.js)
-- Só usuários logados com e-mail corporativo conseguem baixá-los. Os arquivos NÃO ficam no site.
--
-- Depois de rodar, envie pelo painel (Storage › dados) criando a pasta "controles" com:
--   controles/ativos.json     controles/peps.json
-- (as cópias de trabalho ficam em dados/controles/, fora do site e do GitHub)
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('dados', 'dados', false)
on conflict (id) do update set public = false;

drop policy if exists "dados: leitura corporativa" on storage.objects;
create policy "dados: leitura corporativa"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'dados' and (select public.usuario_corporativo()));

-- Envio e troca de arquivos: pelo painel do Supabase (que não passa por estas regras).
-- Não há política de escrita para o site.
