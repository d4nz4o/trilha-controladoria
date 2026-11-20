-- =====================================================================
-- 02 · Bucket privado "dados" (origem 'storage' em fonte-dados.js)
-- Guarda os mesmos arquivos que hoje ficam abertos em /public, mas só
-- usuários corporativos logados conseguem baixá-los.
--
-- Depois de rodar, envie os arquivos pelo painel (Storage > dados) mantendo estes caminhos:
--   demonstracoes/balancetes.csv     demonstracoes/classificacao.csv
--   demonstracoes/empresas.csv       demonstracoes/hierarquia.csv
--   controles/ativos.json            controles/peps.json
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
