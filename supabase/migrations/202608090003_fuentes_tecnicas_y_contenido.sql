-- Fuentes y contenido técnico trazable. Revisar en rama de prueba antes de producción.
create table if not exists public.fuentes_tecnicas (
 id uuid primary key default gen_random_uuid(), organizacion_id uuid not null references public.organizaciones(id),
 cultivo text not null, tema text, documento text not null, institucion text, autor text, ano integer,
 pagina_capitulo text, url text, zona text, condicion_experimental text, limitaciones text,
 vigencia text not null default 'por_revisar', fecha_consulta date, estado text not null default 'identificada',
 creado_por uuid references auth.users(id), actualizado_por uuid references auth.users(id),
 creado_en timestamptz not null default now(), actualizado_en timestamptz not null default now()
);
create table if not exists public.datos_tecnicos (
 id uuid primary key default gen_random_uuid(), organizacion_id uuid not null references public.organizaciones(id),
 fuente_id uuid references public.fuentes_tecnicas(id), cultivo text not null, especie_tipo text, tema text not null,
 valor_texto text not null, valor_min numeric, valor_max numeric, unidad text, clasificacion text not null default 'dato_manual',
 zona text, condicion_experimental text, limitaciones text, requiere_confirmacion boolean not null default false,
 creado_por uuid references auth.users(id), actualizado_por uuid references auth.users(id),
 creado_en timestamptz not null default now(), actualizado_en timestamptz not null default now()
);
alter table public.fuentes_tecnicas enable row level security;alter table public.datos_tecnicos enable row level security;
create policy fuentes_read on public.fuentes_tecnicas for select to authenticated using (private.es_miembro(organizacion_id));
create policy fuentes_insert on public.fuentes_tecnicas for insert to authenticated with check (private.es_admin(organizacion_id));
create policy fuentes_update on public.fuentes_tecnicas for update to authenticated using (private.es_admin(organizacion_id)) with check (private.es_admin(organizacion_id));
create policy fuentes_delete on public.fuentes_tecnicas for delete to authenticated using (private.es_admin(organizacion_id));
create policy datos_read on public.datos_tecnicos for select to authenticated using (private.es_miembro(organizacion_id));
create policy datos_insert on public.datos_tecnicos for insert to authenticated with check (private.es_admin(organizacion_id));
create policy datos_update on public.datos_tecnicos for update to authenticated using (private.es_admin(organizacion_id)) with check (private.es_admin(organizacion_id));
create policy datos_delete on public.datos_tecnicos for delete to authenticated using (private.es_admin(organizacion_id));
grant select on public.fuentes_tecnicas,public.datos_tecnicos to authenticated;grant insert,update,delete on public.fuentes_tecnicas,public.datos_tecnicos to authenticated;
drop trigger if exists auditar_fuentes on public.fuentes_tecnicas;create trigger auditar_fuentes after insert or update or delete on public.fuentes_tecnicas for each row execute function private.registrar_cambio();
drop trigger if exists auditar_datos_tecnicos on public.datos_tecnicos;create trigger auditar_datos_tecnicos after insert or update or delete on public.datos_tecnicos for each row execute function private.registrar_cambio();
create index if not exists fuentes_tecnicas_org_idx on public.fuentes_tecnicas(organizacion_id);
create index if not exists fuentes_tecnicas_creado_por_idx on public.fuentes_tecnicas(creado_por);
create index if not exists fuentes_tecnicas_actualizado_por_idx on public.fuentes_tecnicas(actualizado_por);
create index if not exists datos_tecnicos_org_idx on public.datos_tecnicos(organizacion_id);
create index if not exists datos_tecnicos_fuente_idx on public.datos_tecnicos(fuente_id);
create index if not exists datos_tecnicos_creado_por_idx on public.datos_tecnicos(creado_por);
create index if not exists datos_tecnicos_actualizado_por_idx on public.datos_tecnicos(actualizado_por);
