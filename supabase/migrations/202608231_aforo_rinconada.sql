-- Aforo Rinconada: uniformidad de riego por cuartel.
-- Sigue el mismo patrón de organizacion_id/RLS/auditoría que registros_riego y sondas
-- (ver 202608090001_base_central_yoye.sql) y el mismo patrón principal+lecturas que
-- calicatas/lecturas_calicata para las 16 mediciones (4 líneas x 4 posiciones).

create table if not exists public.aforos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id),
  cuartel_id uuid not null references public.cuarteles(id),
  temporada integer not null,
  fecha date not null,
  equipo_riego text,
  n_valvulas integer not null default 0 check (n_valvulas between 0 and 5),
  presiones_entrada numeric[] not null default '{}',
  presiones_salida numeric[] not null default '{}',
  presion_entrada_prom numeric,
  presion_salida_prom numeric,
  perdida_carga_bar numeric,
  perdida_carga_pct numeric,
  q_medio numeric,
  q_25 numeric,
  cu numeric,
  clasificacion text,
  observaciones text,
  ubicacion text,
  activo boolean not null default true,
  version integer not null default 1,
  creado_por uuid not null references auth.users(id),
  actualizado_por uuid not null references auth.users(id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.aforo_lecturas (
  id uuid primary key default gen_random_uuid(),
  aforo_id uuid not null references public.aforos(id) on delete cascade,
  linea integer not null check (linea between 1 and 4),
  posicion text not null check (posicion in ('inicio','un_tercio','dos_tercios','ultimo')),
  volumen_ml numeric,
  tiempo_s numeric,
  caudal_l_h numeric,
  unique (aforo_id, linea, posicion)
);

create index if not exists aforos_cuartel_fecha_idx on public.aforos(cuartel_id, fecha desc);
create index if not exists aforo_lecturas_aforo_idx on public.aforo_lecturas(aforo_id);

alter table public.aforos enable row level security;
alter table public.aforo_lecturas enable row level security;

create policy aforos_read on public.aforos for select to authenticated using (private.es_miembro(organizacion_id));
create policy aforos_insert on public.aforos for insert to authenticated with check (private.puede_editar(organizacion_id) and creado_por = (select auth.uid()));
create policy aforos_update on public.aforos for update to authenticated using (private.puede_editar(organizacion_id)) with check (private.puede_editar(organizacion_id));
create policy aforos_delete on public.aforos for delete to authenticated using (private.es_admin(organizacion_id));

create policy aforo_lecturas_read on public.aforo_lecturas for select to authenticated
  using (exists (select 1 from public.aforos a where a.id = aforo_id and private.es_miembro(a.organizacion_id)));
create policy aforo_lecturas_write on public.aforo_lecturas for all to authenticated
  using (exists (select 1 from public.aforos a where a.id = aforo_id and private.puede_editar(a.organizacion_id)))
  with check (exists (select 1 from public.aforos a where a.id = aforo_id and private.puede_editar(a.organizacion_id)));

drop trigger if exists auditar_aforos on public.aforos;
create trigger auditar_aforos after insert or update or delete on public.aforos for each row execute function private.registrar_cambio();

grant select on public.aforos, public.aforo_lecturas to authenticated;
grant insert, update, delete on public.aforos, public.aforo_lecturas to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='aforos') then
    alter publication supabase_realtime add table public.aforos;
  end if;
end $$;
