-- =====================================================================
-- 09 · Exclusão dos próprios comentários da revisão analítica
-- O site permite excluir um comentário (ícone de lixeira, com confirmação), só para quem o escreveu.
-- Requer 01_acesso.sql (id_colab_usuario) e 04_comentarios_revisao.sql. Pode ser rodado de novo.
-- =====================================================================

drop policy if exists "exclusao pelo proprio colaborador" on public.revisoes_comentarios;
create policy "exclusao pelo proprio colaborador" on public.revisoes_comentarios
  for delete to authenticated
  using (id_colab = (select public.id_colab_usuario()));

grant delete on public.revisoes_comentarios to authenticated;
