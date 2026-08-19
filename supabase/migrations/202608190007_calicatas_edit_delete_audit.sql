-- Eliminación lógica y permisos de edición para creador/editor/administrador.
-- Los registros hijos y los objetos de Storage se conservan para auditoría;
-- la aplicación oculta los padres con activo=false.
alter table public.calicatas add column if not exists eliminado_en timestamptz;
alter table public.calicatas add column if not exists eliminado_por uuid references auth.users(id);
create index if not exists calicatas_eliminado_por_idx on public.calicatas(eliminado_por);

drop policy if exists calicatas_update on public.calicatas;
create policy calicatas_update on public.calicatas
for update to authenticated
using (private.puede_editar(organizacion_id) or creado_por=(select auth.uid()))
with check (
  (private.puede_editar(organizacion_id) and actualizado_por=(select auth.uid()))
  or (creado_por=(select auth.uid()) and actualizado_por=(select auth.uid()))
);

drop policy if exists lecturas_calicata_update on public.lecturas_calicata;
create policy lecturas_calicata_update on public.lecturas_calicata
for update to authenticated
using (
  private.puede_editar(organizacion_id)
  or exists (select 1 from public.calicatas c where c.id=calicata_id and c.organizacion_id=lecturas_calicata.organizacion_id and c.creado_por=(select auth.uid()))
)
with check (
  private.puede_editar(organizacion_id)
  or exists (select 1 from public.calicatas c where c.id=calicata_id and c.organizacion_id=lecturas_calicata.organizacion_id and c.creado_por=(select auth.uid()))
);

drop policy if exists lecturas_calicata_delete on public.lecturas_calicata;
create policy lecturas_calicata_delete on public.lecturas_calicata
for delete to authenticated
using (
  private.puede_editar(organizacion_id)
  or exists (select 1 from public.calicatas c where c.id=calicata_id and c.organizacion_id=lecturas_calicata.organizacion_id and c.creado_por=(select auth.uid()))
);

drop policy if exists observaciones_calicata_update on public.observaciones_calicata;
create policy observaciones_calicata_update on public.observaciones_calicata
for update to authenticated
using (
  private.puede_editar(organizacion_id)
  or exists (select 1 from public.calicatas c where c.id=calicata_id and c.organizacion_id=observaciones_calicata.organizacion_id and c.creado_por=(select auth.uid()))
)
with check (
  private.puede_editar(organizacion_id)
  or exists (select 1 from public.calicatas c where c.id=calicata_id and c.organizacion_id=observaciones_calicata.organizacion_id and c.creado_por=(select auth.uid()))
);

drop policy if exists observaciones_calicata_delete on public.observaciones_calicata;
create policy observaciones_calicata_delete on public.observaciones_calicata
for delete to authenticated
using (
  private.puede_editar(organizacion_id)
  or exists (select 1 from public.calicatas c where c.id=calicata_id and c.organizacion_id=observaciones_calicata.organizacion_id and c.creado_por=(select auth.uid()))
);

drop policy if exists fotos_calicata_update on public.fotos_calicata;
create policy fotos_calicata_update on public.fotos_calicata
for update to authenticated
using (
  private.puede_editar(organizacion_id)
  or exists (select 1 from public.calicatas c where c.id=calicata_id and c.organizacion_id=fotos_calicata.organizacion_id and c.creado_por=(select auth.uid()))
)
with check (
  private.puede_editar(organizacion_id)
  or exists (select 1 from public.calicatas c where c.id=calicata_id and c.organizacion_id=fotos_calicata.organizacion_id and c.creado_por=(select auth.uid()))
);

drop policy if exists fotos_calicata_delete on public.fotos_calicata;
create policy fotos_calicata_delete on public.fotos_calicata
for delete to authenticated
using (
  private.puede_editar(organizacion_id)
  or exists (select 1 from public.calicatas c where c.id=calicata_id and c.organizacion_id=fotos_calicata.organizacion_id and c.creado_por=(select auth.uid()))
);

-- Evita reevaluar auth.uid() por cada fila al insertar fotos.
drop policy if exists fotos_calicata_insert on public.fotos_calicata;
create policy fotos_calicata_insert on public.fotos_calicata
for insert to authenticated
with check (private.puede_editar(organizacion_id) and creado_por=(select auth.uid()));

-- Storage: el creador también puede gestionar fotos de su propia calicata.
drop policy if exists calicatas_storage_insert on storage.objects;
create policy calicatas_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id='calicatas' and array_length(storage.foldername(name),1)>=2
  and (private.puede_editar(((storage.foldername(name))[1])::uuid)
    or exists (select 1 from public.calicatas c where c.id=((storage.foldername(name))[2])::uuid and c.organizacion_id=((storage.foldername(name))[1])::uuid and c.creado_por=(select auth.uid())))
);

drop policy if exists calicatas_storage_update on storage.objects;
create policy calicatas_storage_update on storage.objects
for update to authenticated
using (
  bucket_id='calicatas' and array_length(storage.foldername(name),1)>=2
  and (private.puede_editar(((storage.foldername(name))[1])::uuid)
    or exists (select 1 from public.calicatas c where c.id=((storage.foldername(name))[2])::uuid and c.organizacion_id=((storage.foldername(name))[1])::uuid and c.creado_por=(select auth.uid())))
)
with check (
  bucket_id='calicatas' and array_length(storage.foldername(name),1)>=2
  and (private.puede_editar(((storage.foldername(name))[1])::uuid)
    or exists (select 1 from public.calicatas c where c.id=((storage.foldername(name))[2])::uuid and c.organizacion_id=((storage.foldername(name))[1])::uuid and c.creado_por=(select auth.uid())))
);

drop policy if exists calicatas_storage_delete on storage.objects;
create policy calicatas_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id='calicatas' and array_length(storage.foldername(name),1)>=2
  and (private.puede_editar(((storage.foldername(name))[1])::uuid)
    or exists (select 1 from public.calicatas c where c.id=((storage.foldername(name))[2])::uuid and c.organizacion_id=((storage.foldername(name))[1])::uuid and c.creado_por=(select auth.uid())))
);
