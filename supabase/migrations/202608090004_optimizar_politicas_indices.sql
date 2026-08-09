-- Elimina políticas SELECT duplicadas y agrega índices a claves foráneas nuevas.
drop policy if exists fuentes_write on public.fuentes_tecnicas;
drop policy if exists datos_write on public.datos_tecnicos;

create policy fuentes_insert on public.fuentes_tecnicas for insert to authenticated with check (private.es_admin(organizacion_id));
create policy fuentes_update on public.fuentes_tecnicas for update to authenticated using (private.es_admin(organizacion_id)) with check (private.es_admin(organizacion_id));
create policy fuentes_delete on public.fuentes_tecnicas for delete to authenticated using (private.es_admin(organizacion_id));
create policy datos_insert on public.datos_tecnicos for insert to authenticated with check (private.es_admin(organizacion_id));
create policy datos_update on public.datos_tecnicos for update to authenticated using (private.es_admin(organizacion_id)) with check (private.es_admin(organizacion_id));
create policy datos_delete on public.datos_tecnicos for delete to authenticated using (private.es_admin(organizacion_id));

create index if not exists fuentes_tecnicas_org_idx on public.fuentes_tecnicas(organizacion_id);
create index if not exists fuentes_tecnicas_creado_por_idx on public.fuentes_tecnicas(creado_por);
create index if not exists fuentes_tecnicas_actualizado_por_idx on public.fuentes_tecnicas(actualizado_por);
create index if not exists datos_tecnicos_org_idx on public.datos_tecnicos(organizacion_id);
create index if not exists datos_tecnicos_fuente_idx on public.datos_tecnicos(fuente_id);
create index if not exists datos_tecnicos_creado_por_idx on public.datos_tecnicos(creado_por);
create index if not exists datos_tecnicos_actualizado_por_idx on public.datos_tecnicos(actualizado_por);
