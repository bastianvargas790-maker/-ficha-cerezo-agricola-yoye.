-- Planilla de fertilización: catálogo de productos, aplicaciones hechas y plan
-- de la temporada. Reemplaza el Excel "Yoye fertilización 24-25", donde cada
-- cuartel era una hoja con un bloque producto × fecha.
--
-- Criterio: las unidades de nutriente NO se guardan. Se calculan siempre desde
-- la ley del producto (fert_aplicaciones_unidades), así nunca quedan
-- descuadradas como pasaba en la planilla, donde varias fórmulas de U.N habían
-- quedado cortas al agregar fechas nuevas.
--
-- Sin precios ni stock: el apartado trabaja con cantidades, fechas, productos y
-- unidades por hectárea.

-- ---------------------------------------------------------------- productos --
create table if not exists public.fert_productos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  nombre text not null,
  clave text not null,                              -- nombre normalizado, para no duplicar
  unidad text not null default 'kg' check (unidad in ('kg','L')),
  densidad_kg_l numeric check (densidad_kg_l is null or densidad_kg_l > 0),
  ley_n numeric not null default 0 check (ley_n between 0 and 1),
  ley_k2o numeric not null default 0 check (ley_k2o between 0 and 1),
  ley_p2o5 numeric not null default 0 check (ley_p2o5 between 0 and 1),
  ley_mgo numeric not null default 0 check (ley_mgo between 0 and 1),
  ley_cao numeric not null default 0 check (ley_cao between 0 and 1),
  notas text,
  activo boolean not null default true,
  creado_por uuid not null references public.perfiles(id),
  actualizado_por uuid not null references public.perfiles(id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create unique index if not exists fert_productos_clave_idx
  on public.fert_productos (organizacion_id, clave);

-- ------------------------------------------------------------ aplicaciones --
create table if not exists public.fert_aplicaciones (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  cuartel_id uuid not null references public.cuarteles(id) on delete cascade,
  producto_id uuid not null references public.fert_productos(id),
  temporada text not null,                          -- '2025-26'
  fecha date,                                       -- null cuando sólo se sabe el mes
  mes text check (mes is null or mes ~ '^[0-9]{4}-[0-9]{2}$'),
  cantidad numeric not null check (cantidad > 0),
  unidad text not null default 'kg' check (unidad in ('kg','L')),
  via text not null default 'fertirriego' check (via in ('fertirriego','foliar','suelo')),
  observacion text,
  activo boolean not null default true,
  client_uuid uuid,
  creado_por uuid not null references public.perfiles(id),
  actualizado_por uuid not null references public.perfiles(id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  eliminado_por uuid references public.perfiles(id),
  constraint fert_aplicaciones_cuando check (fecha is not null or mes is not null)
);
create index if not exists fert_aplicaciones_cuartel_idx
  on public.fert_aplicaciones (cuartel_id, temporada, fecha desc);
create index if not exists fert_aplicaciones_producto_idx
  on public.fert_aplicaciones (producto_id, temporada);
create unique index if not exists fert_aplicaciones_client_uuid_idx
  on public.fert_aplicaciones (client_uuid) where client_uuid is not null;

-- --------------------------------------------------------------------- plan --
create table if not exists public.fert_plan (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  cuartel_id uuid not null references public.cuarteles(id) on delete cascade,
  producto_id uuid not null references public.fert_productos(id),
  temporada text not null,
  mes_objetivo text check (mes_objetivo is null or mes_objetivo ~ '^[0-9]{4}-[0-9]{2}$'),
  cantidad_ha numeric check (cantidad_ha is null or cantidad_ha >= 0),
  cantidad_total numeric check (cantidad_total is null or cantidad_total >= 0),
  nota text,
  activo boolean not null default true,
  creado_por uuid not null references public.perfiles(id),
  actualizado_por uuid not null references public.perfiles(id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint fert_plan_cantidad check (cantidad_ha is not null or cantidad_total is not null)
);
create index if not exists fert_plan_cuartel_idx
  on public.fert_plan (cuartel_id, temporada);

-- ------------------------------------------------- unidades de nutriente ----
-- Kilos de nutriente de cada aplicación y su equivalente por hectárea. El panel
-- lee esta vista; nunca suma leyes a mano.
create or replace view public.fert_aplicaciones_unidades
with (security_invoker = true) as
select a.id,
       a.organizacion_id,
       a.cuartel_id,
       c.codigo            as cuartel,
       c.superficie_ha,
       a.producto_id,
       p.nombre            as producto,
       a.temporada,
       a.fecha,
       coalesce(a.mes, to_char(a.fecha, 'YYYY-MM')) as mes,
       a.cantidad,
       a.unidad,
       a.via,
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
where a.activo;

-- ------------------------------------------------------------------- RLS ----
alter table public.fert_productos    enable row level security;
alter table public.fert_aplicaciones enable row level security;
alter table public.fert_plan         enable row level security;

create policy fert_productos_read   on public.fert_productos    for select to authenticated using (private.es_miembro(organizacion_id));
create policy fert_productos_insert on public.fert_productos    for insert to authenticated with check (private.puede_editar(organizacion_id) and creado_por=(select auth.uid()));
create policy fert_productos_update on public.fert_productos    for update to authenticated using (private.puede_editar(organizacion_id)) with check (private.puede_editar(organizacion_id));
create policy fert_productos_delete on public.fert_productos    for delete to authenticated using (private.es_admin(organizacion_id));

create policy fert_aplic_read   on public.fert_aplicaciones for select to authenticated using (private.es_miembro(organizacion_id));
create policy fert_aplic_insert on public.fert_aplicaciones for insert to authenticated with check (private.puede_editar(organizacion_id) and creado_por=(select auth.uid()));
create policy fert_aplic_update on public.fert_aplicaciones for update to authenticated using (private.puede_editar(organizacion_id)) with check (private.puede_editar(organizacion_id));
create policy fert_aplic_delete on public.fert_aplicaciones for delete to authenticated using (private.es_admin(organizacion_id));

create policy fert_plan_read   on public.fert_plan for select to authenticated using (private.es_miembro(organizacion_id));
create policy fert_plan_insert on public.fert_plan for insert to authenticated with check (private.puede_editar(organizacion_id) and creado_por=(select auth.uid()));
create policy fert_plan_update on public.fert_plan for update to authenticated using (private.puede_editar(organizacion_id)) with check (private.puede_editar(organizacion_id));
create policy fert_plan_delete on public.fert_plan for delete to authenticated using (private.es_admin(organizacion_id));

-- --------------------------------------------------------------- auditoría --
create trigger auditar_fert_productos    after insert or update or delete on public.fert_productos    for each row execute function private.registrar_cambio();
create trigger auditar_fert_aplicaciones after insert or update or delete on public.fert_aplicaciones for each row execute function private.registrar_cambio();
create trigger auditar_fert_plan         after insert or update or delete on public.fert_plan         for each row execute function private.registrar_cambio();
