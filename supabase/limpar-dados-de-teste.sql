-- ============================================================
-- Students Hub — Limpeza dos dados de teste
-- Executar no Supabase: SQL Editor → New query → Run
-- ============================================================

begin;

-- 1) Apontamentos: apaga TODOS os apontamentos (e versões / registos de auditoria associados).
--    As referências dos exercícios às versões têm de sair primeiro, senão o trigger
--    protect_official_note_version_deletion bloqueia a eliminação.
delete from public.exercise_source_references
 where official_note_id is not null
    or official_version_id is not null;

delete from public.official_notes;

commit;

-- 2) (Opcional) Tirar contas de teste do leaderboard SEM as apagar.
--    Substitui 'nome.de.teste' pelo nome em minúsculas, sem acentos, com pontos nos espaços.
-- update public.profiles
--    set is_public_leaderboard = false
--  where id in (
--    select id from auth.users where email like 'nome.de.teste@%'
--  );

-- 3) Tornar uma conta administradora (depois de ela se registar no site).
--    Substitui 'o.teu.nome' pelo teu nome normalizado (minúsculas, sem acentos, pontos nos espaços).
-- update public.user_roles
--    set role = 'admin'
--  where user_id = (select id from auth.users where email like 'o.teu.nome@%');
