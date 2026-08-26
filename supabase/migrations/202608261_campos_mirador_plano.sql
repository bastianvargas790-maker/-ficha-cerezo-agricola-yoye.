-- Estructura de campos + carga de Mirador Plano.
-- Aplicado en producción el 26-08-2026. Verificado: Mirador Plano | 19 cuarteles | 3 equipos.
--
-- Fuente de datos: "Sectores de riego YOYE.xlsx", filas 3-21 (caseta mirador plano).
-- Cada fila del Excel = un cuartel. NO se inventa ningún valor agronómico:
-- marco_plantacion, numero_lineas, superficie, presión y caudal quedan NULL hasta
-- que exista una fuente real. Solo se carga lo que la planilla contiene:
-- caseta, equipo, número de cuartel, especie (-> cultivo) y variedad.
--
-- ---------------------------------------------------------------------------
-- Hallazgos del esquema real (verificados contra la base, no supuestos):
--
-- 1. cuarteles.usuario_id es NOT NULL con default auth.uid(). Ejecutado desde el
--    SQL Editor el rol es postgres y auth.uid() devuelve NULL, así que hay que
--    pasarlo explícito o el insert falla. Otras NOT NULL sin default utilizable:
--    cultivo, cuartel, organizacion_id, codigo.
--
-- 2. Existía cuarteles_usuario_id_cultivo_cuartel_key = unique(usuario_id,
--    cultivo, cuartel), heredada de cuando la app tenía un usuario y un campo.
--    Es incompatible con el modelo multi-campo: en Mirador Plano el equipo 2 y
--    el equipo 3 tienen ambos "ciruelos, cuartel 1", y en terreno son cuarteles
--    distintos. Se reemplazó por el índice de más abajo. Ningún upsert de la app
--    la usaba (aforo.js y calicatas.js van por 'id' y 'aforo_id,linea,posicion').
--
-- 3. El número de cuartel se repite entre equipos de una misma caseta. En caseta
--    paltos, "gravedad 3" tiene los cuarteles 1,2,6,15,16 y "equipo 2012 hass 5"
--    tiene otra vez 1,3,4,5,6. Por eso el código incluye el equipo:
--    MP-E<equipo>-<nn>. Una secuencia plana MP-001..MP-019 los fusionaría.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- BLOQUE A · estructura (no toca datos)
-- ===========================================================================
create table if not exists public.campos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id),
  nombre text not null,
  caseta text,
  ubicacion text,
  jefe_id uuid references auth.users(id),
  activo boolean not null default true,
  creado_por uuid references auth.users(id),
  actualizado_por uuid references auth.users(id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (organizacion_id, nombre)
);

alter table public.cuarteles add column if not exists campo_id uuid references public.campos(id);

create index if not exists campos_org_idx on public.campos(organizacion_id);
create index if not exists campos_jefe_idx on public.campos(jefe_id);
create index if not exists cuarteles_campo_idx on public.cuarteles(campo_id);

alter table public.campos enable row level security;

drop policy if exists campos_read on public.campos;
drop policy if exists campos_insert on public.campos;
drop policy if exists campos_update on public.campos;
drop policy if exists campos_delete on public.campos;

create policy campos_read on public.campos for select to authenticated
  using (private.es_miembro(organizacion_id));
create policy campos_insert on public.campos for insert to authenticated
  with check (private.puede_editar(organizacion_id));
create policy campos_update on public.campos for update to authenticated
  using (private.puede_editar(organizacion_id))
  with check (private.puede_editar(organizacion_id));
create policy campos_delete on public.campos for delete to authenticated
  using (private.es_admin(organizacion_id));

drop trigger if exists auditar_campos on public.campos;
create trigger auditar_campos after insert or update or delete on public.campos
  for each row execute function private.registrar_cambio();

grant select, insert, update, delete on public.campos to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campos'
  ) then
    alter publication supabase_realtime add table public.campos;
  end if;
end $$;

-- ===========================================================================
-- BLOQUE A2 · identidad del cuartel  (CAMBIO IRREVERSIBLE, ver nota 2 arriba)
-- Una vez cargados datos multi-campo la restricción vieja ya no puede volver a
-- crearse, porque existirán legítimamente las combinaciones que ella prohibía.
-- ===========================================================================
alter table public.cuarteles
  drop constraint if exists cuarteles_usuario_id_cultivo_cuartel_key;

-- El número puede repetirse entre equipos y entre campos, pero no dentro del
-- mismo equipo de un mismo campo.
-- OJO: campo_id y equipo admiten NULL, y Postgres trata los NULL como distintos,
-- así que las filas sin campo asignado todavía no quedan protegidas por este
-- índice. Revisar duplicados antes de vincularlas (ver bloque C).
create unique index if not exists cuarteles_campo_equipo_cuartel_uidx
  on public.cuarteles (organizacion_id, campo_id, equipo, cuartel);

-- ===========================================================================
-- BLOQUE B · Mirador Plano (19 cuarteles, 3 equipos)
-- ===========================================================================
do $$
declare
  org_id uuid; yo_id uuid; mp_id uuid; insertados integer;
begin
  select id into org_id from public.organizaciones where nombre ilike 'Agr%cola Yoye' limit 1;
  if org_id is null then raise exception 'No se encontro la organizacion'; end if;

  select p.id into yo_id from public.perfiles p
  where p.organizacion_id = org_id and p.rol = 'administrador' and p.estado = 'activo' limit 1;
  if yo_id is null then
    select id into yo_id from auth.users where lower(email) = 'bastianvargas790@gmail.com' limit 1;
  end if;
  if yo_id is null then raise exception 'No hay usuario para usuario_id'; end if;

  insert into public.campos (organizacion_id, nombre, caseta, ubicacion, creado_por, actualizado_por)
  values (org_id, 'Mirador Plano', 'mirador plano', 'Sector Mirador - Plano', yo_id, yo_id)
  on conflict (organizacion_id, nombre) do update set caseta = excluded.caseta;

  select id into mp_id from public.campos
  where organizacion_id = org_id and nombre = 'Mirador Plano';

  insert into public.cuarteles
    (organizacion_id, campo_id, usuario_id, codigo, cuartel, caseta, equipo, cultivo, variedad,
     creado_por, actualizado_por, activo)
  select org_id, mp_id, yo_id, v.codigo, v.cuartel, 'mirador plano', v.equipo, v.cultivo, v.variedad,
         yo_id, yo_id, true
  from (values
    ('MP-E1-01','1','1','nogales',   'chandler'),
    ('MP-E1-02','2','1','nogales',   'chandler'),
    ('MP-E1-03','3','1','cerezos',   'sweet aryana'),
    ('MP-E1-04','4','1','cerezos',   'lapins /santina'),
    ('MP-E1-05','5','1','nogales',   'chandler'),
    ('MP-E1-06','6','1','nogales',   'chandler'),
    ('MP-E2-01','1','2','ciruelos',  'D''agen'),
    ('MP-E2-02','2','2','ciruelos',  'D''agen'),
    ('MP-E2-03','3','2','ciruelos',  'D''agen'),
    ('MP-E2-04','4','2','ciruelos',  'D''agen'),
    ('MP-E2-05','5','2','ciruelos',  'D''agen'),
    ('MP-E2-06','6','2','cerezos',   'santina'),
    ('MP-E2-07','7','2','cerezos',   'lapins /santina'),
    ('MP-E3-01','1','3','ciruelos',  'D''agen'),
    ('MP-E3-02','2','3','ciruelos',  'D''agen'),
    ('MP-E3-03','3','3','ciruelos',  'D''agen'),
    ('MP-E3-04','4','3','nectarines','Sweet giant'),
    ('MP-E3-05','5','3','ciruelos',  'D''agen'),
    ('MP-E3-06','6','3','ciruelos',  'D''agen')
  ) as v(codigo, cuartel, equipo, cultivo, variedad)
  on conflict (organizacion_id, codigo) do nothing;

  get diagnostics insertados = row_count;
  raise notice 'Cuarteles insertados en Mirador Plano: %', insertados;
end $$;

-- Verificación del bloque B. Resultado obtenido el 26-08-2026: Mirador Plano | 19 | 3
select c.nombre, count(cu.id) as cuarteles, count(distinct cu.equipo) as equipos
from public.campos c
left join public.cuarteles cu on cu.campo_id = c.id
group by c.nombre order by c.nombre;

-- ===========================================================================
-- BLOQUE C · Rinconada Plano  (PENDIENTE)
-- ---------------------------------------------------------------------------
-- No carga cuarteles nuevos: vincula al campo Rinconada Plano los que ya
-- existían en la base. Antes de correrlo hay que revisar duplicados, porque
-- al pasar campo_id de NULL a un valor real recién ahí les aplica el índice
-- cuarteles_campo_equipo_cuartel_uidx:
--
--   select equipo, cuartel, count(*)
--   from public.cuarteles
--   where campo_id is null
--   group by equipo, cuartel having count(*) > 1;
--
-- Si esa consulta devuelve filas, hay que resolverlas antes de vincular.
-- ===========================================================================
-- do $$
-- declare org_id uuid; yo_id uuid; rp_id uuid; vinculados integer;
-- begin
--   select id into org_id from public.organizaciones where nombre ilike 'Agr%cola Yoye' limit 1;
--   select p.id into yo_id from public.perfiles p
--   where p.organizacion_id = org_id and p.rol = 'administrador' and p.estado = 'activo' limit 1;
--
--   insert into public.campos (organizacion_id, nombre, ubicacion, creado_por, actualizado_por)
--   values (org_id, 'Rinconada Plano', 'Sector Rinconada - Plano', yo_id, yo_id)
--   on conflict (organizacion_id, nombre) do update set ubicacion = excluded.ubicacion;
--
--   select id into rp_id from public.campos
--   where organizacion_id = org_id and nombre = 'Rinconada Plano';
--
--   update public.cuarteles set campo_id = rp_id
--   where organizacion_id = org_id and campo_id is null;
--   get diagnostics vinculados = row_count;
--   raise notice 'Cuarteles vinculados a Rinconada Plano: %', vinculados;
-- end $$;

-- ===========================================================================
-- PENDIENTE de definición (no cargar todavía)
-- ---------------------------------------------------------------------------
-- Mirador Cerro 28 cuarteles · caseta paltos 44 · caseta citricos 10 ·
-- caseta nogales 5. Falta resolver a qué campo pertenecen "caseta nogales" y
-- "caseta citricos": en el Excel esas filas traen la columna campo vacía, así
-- que la planilla por sí sola no lo define.
-- ===========================================================================
