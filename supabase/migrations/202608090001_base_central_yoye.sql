-- Base central multidispositivo de Agrícola Yoye.
-- Ejecutar en Supabase solo después de revisar el respaldo y la rama de prueba.
create extension if not exists pgcrypto;

create table if not exists public.organizaciones (
  id uuid primary key default gen_random_uuid(), nombre text not null unique,
  creado_en timestamptz not null default now()
);
insert into public.organizaciones(nombre) values ('Agrícola Yoye') on conflict (nombre) do nothing;

create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organizacion_id uuid not null references public.organizaciones(id),
  nombre_completo text, correo text not null, telefono text check (telefono is null or telefono ~ '^\+[1-9][0-9]{7,14}$'),
  cargo text, rol text not null default 'solo_lectura' check (rol in ('administrador','editor','solo_lectura')),
  estado text not null default 'activo' check (estado in ('activo','inactivo','pendiente')),
  prefiere_alertas boolean not null default false, ultimo_acceso timestamptz,
  creado_en timestamptz not null default now(), actualizado_en timestamptz not null default now()
);

alter table public.cuarteles add column if not exists organizacion_id uuid references public.organizaciones(id);
alter table public.cuarteles add column if not exists codigo text;
alter table public.cuarteles add column if not exists caseta text;
alter table public.cuarteles add column if not exists equipo text;
alter table public.cuarteles add column if not exists marco_plantacion text;
alter table public.cuarteles add column if not exists profundidad_efectiva_cm numeric;
alter table public.cuarteles add column if not exists numero_lineas integer;
alter table public.cuarteles add column if not exists caudal_emisor_l_h numeric;
alter table public.cuarteles add column if not exists espaciamiento_emisor_m numeric;
alter table public.cuarteles add column if not exists precipitacion_mm_h numeric;
alter table public.cuarteles add column if not exists presion_bar numeric;
alter table public.cuarteles add column if not exists tiene_sonda boolean not null default false;
alter table public.cuarteles add column if not exists estado text not null default 'activo';
alter table public.cuarteles add column if not exists activo boolean not null default true;
alter table public.cuarteles add column if not exists version integer not null default 1;
alter table public.cuarteles add column if not exists creado_por uuid references auth.users(id);
alter table public.cuarteles add column if not exists actualizado_por uuid references auth.users(id);
alter table public.cuarteles add column if not exists ficha_legacy jsonb;
update public.cuarteles set codigo=coalesce(codigo,cuartel), organizacion_id=(select id from public.organizaciones where nombre='Agrícola Yoye') where codigo is null or organizacion_id is null;
alter table public.cuarteles alter column organizacion_id set not null;
alter table public.cuarteles alter column codigo set not null;
create unique index if not exists cuarteles_org_codigo_uidx on public.cuarteles(organizacion_id,codigo);

create table if not exists public.registros_riego (
  id uuid primary key default gen_random_uuid(), organizacion_id uuid not null references public.organizaciones(id),
  cuartel_id uuid not null references public.cuarteles(id), fecha date not null, estado_fenologico text,
  eto_mm numeric, kc numeric, etc_mm numeric, lluvia_efectiva_mm numeric default 0,
  volumen_calculado_m3 numeric, horas_programadas numeric, horas_reales numeric, caudal_real_m3_h numeric,
  presion_bar numeric, lecturas_humedad jsonb, conductividad_electrica numeric, estrategia text,
  responsable text, observaciones text, activo boolean not null default true, version integer not null default 1,
  creado_por uuid not null references auth.users(id), actualizado_por uuid not null references auth.users(id),
  creado_en timestamptz not null default now(), actualizado_en timestamptz not null default now()
);
create table if not exists public.sondas (
  id uuid primary key default gen_random_uuid(), organizacion_id uuid not null references public.organizaciones(id),
  cuartel_id uuid not null unique references public.cuarteles(id), identificador text, profundidades_cm integer[] not null default '{}',
  variables text[] not null default '{}', fecha_instalacion date, estado text not null default 'sin_configurar',
  ultima_lectura jsonb, ultima_comunicacion timestamptz, observaciones text,
  creado_por uuid references auth.users(id), actualizado_por uuid references auth.users(id),
  creado_en timestamptz not null default now(), actualizado_en timestamptz not null default now()
);
create table if not exists public.historial_cambios (
  id bigint generated always as identity primary key, organizacion_id uuid not null references public.organizaciones(id),
  usuario_id uuid references auth.users(id), tabla text not null, registro_id text not null, accion text not null,
  valor_anterior jsonb, valor_nuevo jsonb, fecha timestamptz not null default now()
);

create schema if not exists private;
create or replace function private.es_miembro(org uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.perfiles p where p.id=(select auth.uid()) and p.organizacion_id=org and p.estado='activo')
$$;
create or replace function private.puede_editar(org uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.perfiles p where p.id=(select auth.uid()) and p.organizacion_id=org and p.estado='activo' and p.rol in ('administrador','editor'))
$$;
create or replace function private.es_admin(org uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.perfiles p where p.id=(select auth.uid()) and p.organizacion_id=org and p.estado='activo' and p.rol='administrador')
$$;

alter table public.organizaciones enable row level security;
alter table public.perfiles enable row level security;
alter table public.cuarteles enable row level security;
alter table public.registros_riego enable row level security;
alter table public.sondas enable row level security;
alter table public.historial_cambios enable row level security;
drop policy if exists "Leer cuarteles propios autorizados" on public.cuarteles;
drop policy if exists "Crear cuarteles propios autorizados" on public.cuarteles;
drop policy if exists "Editar cuarteles propios autorizados" on public.cuarteles;
drop policy if exists "Eliminar cuarteles propios autorizados" on public.cuarteles;
revoke all on function private.es_miembro(uuid),private.puede_editar(uuid),private.es_admin(uuid) from public,anon;
grant execute on function private.es_miembro(uuid),private.puede_editar(uuid),private.es_admin(uuid) to authenticated;
create policy org_read on public.organizaciones for select to authenticated using (private.es_miembro(id));
create policy perfiles_read on public.perfiles for select to authenticated using (id=(select auth.uid()) or private.es_admin(organizacion_id));
create policy perfiles_self_update on public.perfiles for update to authenticated using (id=(select auth.uid())) with check (id=(select auth.uid()));
create policy cuarteles_read on public.cuarteles for select to authenticated using (private.es_miembro(organizacion_id));
create policy cuarteles_insert on public.cuarteles for insert to authenticated with check (private.puede_editar(organizacion_id) and creado_por=(select auth.uid()));
create policy cuarteles_update on public.cuarteles for update to authenticated using (private.puede_editar(organizacion_id)) with check (private.puede_editar(organizacion_id));
create policy cuarteles_delete on public.cuarteles for delete to authenticated using (private.es_admin(organizacion_id));
create policy riegos_read on public.registros_riego for select to authenticated using (private.es_miembro(organizacion_id));
create policy riegos_insert on public.registros_riego for insert to authenticated with check (private.puede_editar(organizacion_id) and creado_por=(select auth.uid()));
create policy riegos_update on public.registros_riego for update to authenticated using (private.puede_editar(organizacion_id)) with check (private.puede_editar(organizacion_id));
create policy riegos_delete on public.registros_riego for delete to authenticated using (private.es_admin(organizacion_id));
create policy sondas_read on public.sondas for select to authenticated using (private.es_miembro(organizacion_id));
create policy sondas_write on public.sondas for all to authenticated using (private.puede_editar(organizacion_id)) with check (private.puede_editar(organizacion_id));
create policy historial_read on public.historial_cambios for select to authenticated using (private.es_miembro(organizacion_id));

create or replace function private.registrar_cambio() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare org uuid; rid text;
begin
  if tg_op='DELETE' then org:=old.organizacion_id; rid:=old.id::text; else org:=new.organizacion_id; rid:=new.id::text; end if;
  insert into public.historial_cambios(organizacion_id,usuario_id,tabla,registro_id,accion,valor_anterior,valor_nuevo)
  values(org,(select auth.uid()),tg_table_name,rid,tg_op,case when tg_op='INSERT' then null else to_jsonb(old) end,case when tg_op='DELETE' then null else to_jsonb(new) end);
  return null;
end $$;
revoke all on function private.registrar_cambio() from public,anon,authenticated;
drop trigger if exists auditar_cuarteles on public.cuarteles;
create trigger auditar_cuarteles after insert or update or delete on public.cuarteles for each row execute function private.registrar_cambio();
drop trigger if exists auditar_riegos on public.registros_riego;
create trigger auditar_riegos after insert or update or delete on public.registros_riego for each row execute function private.registrar_cambio();
drop trigger if exists auditar_sondas on public.sondas;
create trigger auditar_sondas after insert or update or delete on public.sondas for each row execute function private.registrar_cambio();

grant select on public.organizaciones,public.perfiles,public.cuarteles,public.registros_riego,public.sondas,public.historial_cambios to authenticated;
grant insert,update,delete on public.cuarteles,public.registros_riego,public.sondas to authenticated;
grant update(nombre_completo,telefono,cargo,prefiere_alertas) on public.perfiles to authenticated;
alter publication supabase_realtime add table public.cuarteles;
alter publication supabase_realtime add table public.registros_riego;
alter publication supabase_realtime add table public.sondas;

-- Convertir la única cuenta autorizada actual en administrador inicial.
insert into public.perfiles(id,organizacion_id,correo,rol,estado)
select u.id,o.id,lower(u.email),'administrador','activo' from auth.users u cross join public.organizaciones o
where lower(u.email) in (select email from public.usuarios_autorizados) and o.nombre='Agrícola Yoye'
on conflict (id) do update set organizacion_id=excluded.organizacion_id,rol='administrador',estado='activo';
