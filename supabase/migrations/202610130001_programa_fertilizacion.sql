-- El programa de fertilización de la temporada, tal como viene de la planilla:
-- cada cuartel tiene fechas con productos y kilos escritos por adelantado. La
-- app los muestra para confirmar en terreno.
--
-- fert_plan estaba pensado para un plan mensual por hectárea (mes_objetivo,
-- cantidad_ha). El programa real son FECHAS: el 14 de octubre, urea 75 kg en
-- C-7. Se agregan la fecha y la cantidad, y la llave única deja re-subir el
-- programa cuantas veces lo cambie el asesor sin duplicar nada.
alter table public.fert_plan add column if not exists fecha date;
alter table public.fert_plan add column if not exists cantidad numeric check (cantidad is null or cantidad >= 0);
alter table public.fert_plan add column if not exists unidad text not null default 'kg' check (unidad in ('kg','L'));
alter table public.fert_plan drop constraint if exists fert_plan_cantidad;
alter table public.fert_plan add constraint fert_plan_cantidad
  check (cantidad is not null or cantidad_ha is not null or cantidad_total is not null);
/* La llave va sin "where fecha is not null" a propósito: un índice parcial no
   sirve para el upsert de PostgREST (Postgres solo lo usa si la consulta
   repite el predicado, y PostgREST no lo escribe). Las filas con fecha nula
   -- el plan mensual viejo -- no chocan igual, porque en Postgres dos nulos
   se consideran distintos. */
create unique index if not exists fert_plan_fecha_idx
  on public.fert_plan (cuartel_id, producto_id, fecha, temporada);
create index if not exists fert_plan_proxima_idx
  on public.fert_plan (cuartel_id, fecha) where activo and fecha is not null;

-- Confirmar el programa incluye decir que NO se aplicó. Esa respuesta es un
-- dato: sin ella el panel no puede distinguir "no se aplicó" de "no se alcanzó
-- a registrar". Por eso la cantidad puede ser cero y el estado lo explica.
alter table public.fert_aplicaciones add column if not exists estado text not null default 'aplicado'
  check (estado in ('aplicado','no_aplicado'));
alter table public.fert_aplicaciones add column if not exists plan_id uuid references public.fert_plan(id);
alter table public.fert_aplicaciones drop constraint if exists fert_aplicaciones_cantidad_check;
alter table public.fert_aplicaciones add constraint fert_aplicaciones_cantidad_check
  check (cantidad >= 0 and (estado = 'no_aplicado' or cantidad > 0));
create index if not exists fert_aplicaciones_plan_idx on public.fert_aplicaciones (plan_id) where plan_id is not null;

-- La vista de unidades solo cuenta lo aplicado: una omisión no aporta kilos de
-- nutriente, y si entrara con cantidad cero ensuciaría los promedios por ha.
create or replace view public.fert_aplicaciones_unidades
with (security_invoker = true) as
select a.id, a.organizacion_id, a.cuartel_id, c.codigo as cuartel, c.superficie_ha,
       a.producto_id, p.nombre as producto, a.temporada, a.fecha,
       coalesce(a.mes, to_char(a.fecha, 'YYYY-MM')) as mes,
       a.cantidad, a.unidad, a.via,
       round(a.cantidad * p.ley_n,    2) as u_n,
       round(a.cantidad * p.ley_k2o,  2) as u_k2o,
       round(a.cantidad * p.ley_p2o5, 2) as u_p2o5,
       round(a.cantidad * p.ley_mgo,  2) as u_mgo,
       round(a.cantidad * p.ley_cao,  2) as u_cao,
       case when c.superficie_ha > 0 then round(a.cantidad * p.ley_n    / c.superficie_ha, 2) end as u_n_ha,
       case when c.superficie_ha > 0 then round(a.cantidad * p.ley_k2o  / c.superficie_ha, 2) end as u_k2o_ha,
       case when c.superficie_ha > 0 then round(a.cantidad * p.ley_p2o5 / c.superficie_ha, 2) end as u_p2o5_ha,
       case when c.superficie_ha > 0 then round(a.cantidad * p.ley_mgo  / c.superficie_ha, 2) end as u_mgo_ha,
       case when c.superficie_ha > 0 then round(a.cantidad * p.ley_cao  / c.superficie_ha, 2) end as u_cao_ha
from public.fert_aplicaciones a
join public.fert_productos p on p.id = a.producto_id
join public.cuarteles c      on c.id = a.cuartel_id
where a.activo and a.estado = 'aplicado';

-- Programa contra realizado, por cuartel y fecha. Es lo que lee la app al
-- abrir el formulario y lo que después alimenta el panel.
create or replace view public.fert_programa_estado
with (security_invoker = true) as
select pl.id as plan_id, pl.organizacion_id, pl.cuartel_id, c.codigo as cuartel,
       pl.producto_id, p.nombre as producto, p.unidad as unidad_producto,
       pl.temporada, pl.fecha, pl.cantidad as cantidad_programada, pl.unidad,
       a.id as aplicacion_id, a.cantidad as cantidad_aplicada, a.fecha as fecha_aplicacion, a.estado
from public.fert_plan pl
join public.fert_productos p on p.id = pl.producto_id
join public.cuarteles c      on c.id = pl.cuartel_id
left join public.fert_aplicaciones a on a.plan_id = pl.id and a.activo
where pl.activo and pl.fecha is not null;
