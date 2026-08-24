-- Aforo Rinconada: uniformidad de riego por cuartel.
-- Sigue el mismo patrón de organizacion_id/RLS/auditoría que registros_riego y sondas
-- (ver 202608090001_base_central_yoye.sql) y el mismo patrón principal+lecturas que
-- calicatas/lecturas_calicata para las 16 mediciones (4 líneas x 4 posiciones).
--
-- Esquema aprobado conceptualmente por Bastián Vargas (23-08-2026) tras varias rondas
-- de auditoría contra el histórico real de DB_Aforos. Puntos clave que NO se deben
-- rediseñar sin evidencia nueva concreta (ver reporte de arquitectura):
--   - unidad_aforo: NO se crean cuarteles separados para divisiones de medición como
--     C-40A/C-40B -- comparten cuartel_id y usan este campo. Confirmado con evidencia
--     textual (las observaciones de esos aforos mencionan "válvula 1"/"válvula 2" del
--     mismo cuartel, no de cuarteles distintos).
--   - tiempo_medicion_s vive en aforos, no en aforo_lecturas: verificado contra el
--     100% de los 37 aforos históricos, ninguno usó un tiempo distinto por celda.
--   - clasificacion usa 4 niveles (Excelente/Bueno/Medio/Bajo), reproduce 36/36
--     clasificaciones reales con los umbrales 90/80/70 (viven en aforo-formulas.js,
--     no hardcodeados acá, para poder ajustarlos sin migración).
--   - migracion_lote identifica el lote de importación histórica para poder hacer
--     rollback sin tocar aforos nuevos capturados por la app.
-- Este archivo reemplaza cualquier versión anterior de este mismo commit.

create table if not exists public.aforos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id),
  cuartel_id uuid not null references public.cuarteles(id),
  -- Unidad de medición dentro del cuartel cuando el aforo se hace por válvula/sector
  -- y no por el cuartel completo (ej. C-40 -> 'A' o 'B'). NULL cuando el aforo cubre
  -- el cuartel como unidad única. No es un catálogo separado de cuarteles.
  unidad_aforo text,
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
  -- Tiempo único de captura para las 16 mediciones de este aforo (nunca varía por
  -- celda en el histórico real). Ver aforo-formulas.js para el cálculo de caudal.
  tiempo_medicion_s numeric,
  q_medio numeric,
  q_25 numeric,
  cu numeric,
  -- Umbrales (90/80/70) NO se fijan aquí -- viven en aforo-formulas.js para poder
  -- ajustarlos sin migración si se confirma un valor distinto contra una fuente
  -- primaria. Esta columna solo guarda la etiqueta resultante.
  clasificacion text check (clasificacion in ('Excelente', 'Bueno', 'Medio', 'Bajo', 'Sin datos')),
  observaciones text,
  ubicacion text,
  legacy_id text unique, -- ej. 'AF-2025-001'; NULL para aforos nuevos de la app
  fuente text not null default 'aforo_rinconada' check (fuente in ('aforo_rinconada', 'db_aforos_historico', 'base_yoye_historico')),
  -- Identifica el lote de importación histórica (un uuid por corrida de migración).
  -- NULL para aforos capturados normalmente por la app. Permite un rollback dirigido
  -- (delete where migracion_lote = '<lote>') sin arriesgar aforos nuevos que se hayan
  -- creado después de la migración pero antes de un eventual rollback.
  migracion_lote uuid,
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
  linea integer not null,
  posicion text not null,
  orden smallint not null default 0,
  volumen_ml numeric,
  caudal_l_h numeric,
  unique (aforo_id, linea, posicion)
);

create index if not exists aforos_cuartel_fecha_idx on public.aforos(cuartel_id, fecha desc);
create index if not exists aforos_fuente_idx on public.aforos(fuente);
create index if not exists aforos_migracion_lote_idx on public.aforos(migracion_lote) where migracion_lote is not null;
create index if not exists aforo_lecturas_aforo_idx on public.aforo_lecturas(aforo_id);

alter table public.aforos enable row level security;
alter table public.aforo_lecturas enable row level security;

create policy aforos_read on public.aforos for select to authenticated using (private.es_miembro(organizacion_id));
create policy aforos_insert on public.aforos for insert to authenticated with check (private.puede_editar(organizacion_id) and creado_por = (select auth.uid()));
-- actualizado_por = auth.uid() exigido explícitamente -- corrige el gap señalado
-- sobre registros_riego/sondas, pero SOLO para esta tabla (auditoría aparte).
create policy aforos_update on public.aforos for update to authenticated
  using (private.puede_editar(organizacion_id))
  with check (private.puede_editar(organizacion_id) and actualizado_por = (select auth.uid()));
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
