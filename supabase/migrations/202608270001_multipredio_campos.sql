-- Modelo de datos multipredio: agrega las columnas del rediseño a la tabla
-- public.campos que YA EXISTE en producción (creada el 2026-08-26 fuera del
-- historial de migraciones, junto con cuarteles.campo_id, ya poblada para
-- Rinconada Plano y Mirador Plano). Esta migración EXTIENDE ese trabajo en
-- vez de recrearlo: agrega columnas nuevas, completa los 2 campos que faltan
-- (Rinconada Cerro, Mirador Cerro) y deja un valor por defecto para
-- cuarteles.campo_id en nuevos registros. No toca las 53 filas de cuarteles
-- ya vinculadas ni las columnas/índices/RLS/trigger de auditoría existentes.

alter table public.campos
  add column if not exists slug text,
  add column if not exists superficie_ha numeric,
  add column if not exists cuarteles_referencia integer,
  add column if not exists cultivos_referencia integer,
  add column if not exists alcance text[] not null default '{aforos,calicatas}',
  add column if not exists encargado_nombre text,
  add column if not exists encargado_iniciales text,
  add column if not exists encargado_cargo text,
  add column if not exists foto_url text,
  add column if not exists orden integer not null default 0;

-- Completa las 2 filas ya existentes (creadas manualmente el 2026-08-26) con
-- los datos del rediseño. jefe_id ya es la columna real de "encargado con
-- cuenta"; se usa tal cual, sin agregar una columna nueva.
update public.campos set
  slug = 'rinconada-plano',
  superficie_ha = 78.44,
  cuarteles_referencia = 34,
  cultivos_referencia = 6,
  alcance = array['riego','descoles','acido','aforos','calicatas'],
  encargado_nombre = 'Bastián Vargas',
  encargado_iniciales = 'BV',
  encargado_cargo = 'Jefe de riego',
  foto_url = coalesce(foto_url, 'assets/campos/rinconada-plano.png'),
  orden = 1,
  jefe_id = coalesce(jefe_id, (select id from public.perfiles where organizacion_id = campos.organizacion_id and rol = 'administrador' order by creado_en asc limit 1))
where nombre = 'Rinconada Plano';

update public.campos set
  slug = 'mirador-plano',
  superficie_ha = 56.90,
  cuarteles_referencia = 19,
  cultivos_referencia = 4,
  alcance = array['aforos','calicatas'],
  encargado_nombre = 'Rodrigo Pérez',
  encargado_iniciales = 'RP',
  encargado_cargo = 'Evaluador de riego',
  foto_url = coalesce(foto_url, 'assets/campos/mirador-plano.png'),
  orden = 3
where nombre = 'Mirador Plano';

-- Agrega los 2 campos que aún no existen (sin cuarteles reales todavía; usan
-- la cantidad de referencia del rediseño hasta que se carguen sus cuarteles).
insert into public.campos (organizacion_id, nombre, slug, superficie_ha, cuarteles_referencia, cultivos_referencia, alcance, encargado_nombre, encargado_iniciales, encargado_cargo, foto_url, orden)
select o.id, v.nombre, v.slug, v.superficie_ha, v.cuarteles_referencia, v.cultivos_referencia, v.alcance, v.encargado_nombre, v.encargado_iniciales, v.encargado_cargo, v.foto_url, v.orden
from public.organizaciones o
cross join (values
  ('Rinconada Cerro', 'rinconada-cerro', 41.20::numeric, 18, 3, array['aforos','calicatas'], 'Camila Soto', 'CS', 'Encargada de suelo', 'assets/campos/rinconada-cerro.png', 2),
  ('Mirador Cerro', 'mirador-cerro', 33.50::numeric, 14, 2, array['aforos','calicatas'], 'Ignacio Fuentes', 'IF', 'Encargado de campo', 'assets/campos/mirador-cerro.png', 4)
) as v(nombre, slug, superficie_ha, cuarteles_referencia, cultivos_referencia, alcance, encargado_nombre, encargado_iniciales, encargado_cargo, foto_url, orden)
where o.nombre = 'Agrícola Yoye'
  and not exists (select 1 from public.campos c where c.organizacion_id = o.id and c.nombre = v.nombre);

alter table public.campos alter column slug set not null;
create unique index if not exists campos_org_slug_uidx on public.campos(organizacion_id, slug);

-- Valor por defecto para cuarteles nuevos: Rinconada Plano (las 53 filas
-- existentes ya tienen campo_id asignado, no se tocan).
create or replace function private.campo_predeterminado() returns uuid
language sql stable
set search_path = public, private
as $$
  select id from public.campos where slug = 'rinconada-plano' order by creado_en asc limit 1
$$;
alter table public.cuarteles alter column campo_id set default private.campo_predeterminado();
