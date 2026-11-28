-- =====================================================================
-- 24 · Restaurar as permissões da tabela de comentários (balancetes_comentarios)
-- Para o erro "permission denied for table balancetes_comentarios" ao editar ou excluir um comentário próprio.
-- Esse erro vem da permissão da TABELA (GRANT), não das regras por linha (RLS). Pode ser rodado de novo.
-- =====================================================================

-- 1) Diagnóstico: o que o usuário logado (authenticated) pode fazer hoje
--    (esperado: SELECT, INSERT e DELETE na tabela; UPDATE só na coluna "mensagem")
select 'tabela' as nivel, string_agg(privilege_type, ', ' order by privilege_type) as permissoes
from information_schema.table_privileges
where table_schema = 'public' and table_name = 'balancetes_comentarios' and grantee = 'authenticated'
union all
select 'UPDATE por coluna', string_agg(column_name, ', ' order by column_name)
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'balancetes_comentarios' and grantee = 'authenticated' and privilege_type = 'UPDATE';

-- 2) Correção (mesmo padrão dos scripts 04, 08 e 09): consultar, incluir e excluir; alterar só o texto
grant select, insert, delete on public.balancetes_comentarios to authenticated;
revoke update on public.balancetes_comentarios from authenticated, anon;
grant update (mensagem) on public.balancetes_comentarios to authenticated;

-- 3) Conferência depois da correção
select 'depois: UPDATE por coluna' as nivel, string_agg(column_name, ', ') as permissoes
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'balancetes_comentarios' and grantee = 'authenticated' and privilege_type = 'UPDATE';
