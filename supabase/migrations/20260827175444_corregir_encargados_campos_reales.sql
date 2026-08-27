-- Corrige los encargados de campo con los nombres reales del equipo
-- (reemplaza los nombres de referencia del prototipo de diseño que se
-- habían sembrado en la migración anterior, 202608270001_multipredio_campos).
-- Aplicada en producción por otra sesión el 2026-08-27 17:54 UTC; este
-- archivo se agrega al repo solo para que el historial de migraciones
-- quede completo y `supabase db diff`/`migration list` no muestren
-- desincronización. No cambia jefe_id: ningún encargado real tiene cuenta
-- de Supabase todavía, así que ese campo queda en null.

update public.campos set encargado_nombre='Rodrigo Abarca', encargado_iniciales='RA', encargado_cargo='Jefe de campo', jefe_id=null where slug='rinconada-plano';
update public.campos set encargado_nombre='Pedro Velásquez', encargado_iniciales='PV', encargado_cargo='Jefe de campo' where slug='rinconada-cerro';
update public.campos set encargado_nombre='Joaquín Quiroga', encargado_iniciales='JQ', encargado_cargo='Jefe de campo' where slug='mirador-plano';
update public.campos set encargado_nombre='Eladio León', encargado_iniciales='EL', encargado_cargo='Jefe de campo' where slug='mirador-cerro';
