-- =====================================================================
-- 08 · Edição dos próprios comentários da revisão analítica
-- O site permite editar o texto de um comentário (ícone de lápis), só para quem o escreveu.
--   - Regra de acesso: cada colaborador altera apenas os comentários com o próprio id_colab.
--   - Permissão de coluna: só "mensagem" pode ser alterada (empresa, mês, linha e autor ficam fixos).
-- Requer 01_acesso.sql (id_colab_usuario) e 04_comentarios_revisao.sql. Pode ser rodado de novo.
-- =====================================================================

drop policy if exists "edicao pelo proprio colaborador" on public.revisoes_comentarios;
create policy "edicao pelo proprio colaborador" on public.revisoes_comentarios
  for update to authenticated
  using (id_colab = (select public.id_colab_usuario()))
  with check (id_colab = (select public.id_colab_usuario()));

revoke update on public.revisoes_comentarios from authenticated, anon;
grant update (mensagem) on public.revisoes_comentarios to authenticated;
