-- Evita una política SELECT duplicada en sondas y mantiene las mismas capacidades por rol.
drop policy if exists sondas_write on public.sondas;
create policy sondas_insert on public.sondas for insert to authenticated with check (private.puede_editar(organizacion_id));
create policy sondas_update on public.sondas for update to authenticated using (private.puede_editar(organizacion_id)) with check (private.puede_editar(organizacion_id));
create policy sondas_delete on public.sondas for delete to authenticated using (private.es_admin(organizacion_id));
