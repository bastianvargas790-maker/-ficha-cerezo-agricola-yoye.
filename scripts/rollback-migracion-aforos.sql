-- Rollback de la migración histórica de DB_Aforos -> Supabase.
-- NUNCA usar "delete from public.aforos" sin filtro -- borraría también
-- cualquier aforo nuevo capturado por la app desde entonces.
--
-- Paso 1: revisar qué se va a borrar ANTES de borrar.
select id, legacy_id, cuartel_id, fecha, cu, migracion_lote
from public.aforos
where migracion_lote = '<uuid-del-lote-que-imprimió-el-script-de-migración>';

-- Paso 2: borrar. aforo_lecturas se limpia sola por "on delete cascade" desde
-- aforos, así que no hace falta un delete separado para esa tabla.
delete from public.aforos
where migracion_lote = '<uuid-del-lote-que-imprimió-el-script-de-migración>';

-- Alternativa si se perdió el uuid del lote pero se está seguro de que TODOS
-- los registros con fuente = 'db_aforos_historico' deben revertirse (más ancha,
-- usar solo si no hay más de un lote histórico importado):
-- delete from public.aforos where fuente = 'db_aforos_historico';

-- Verificación post-rollback: debe dar 0 filas.
select count(*) from public.aforos where migracion_lote = '<uuid-del-lote>';
