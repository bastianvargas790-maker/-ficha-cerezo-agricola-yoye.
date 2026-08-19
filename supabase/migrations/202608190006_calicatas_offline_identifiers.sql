-- Identificadores estables para capturas offline y reintentos idempotentes.
-- Todas las columnas son opcionales para conservar compatibilidad con registros existentes.
alter table public.calicatas add column if not exists client_uuid uuid;
alter table public.lecturas_calicata add column if not exists client_uuid uuid;
alter table public.lecturas_calicata add column if not exists creado_por uuid references auth.users(id);
alter table public.observaciones_calicata add column if not exists client_uuid uuid;
alter table public.observaciones_calicata add column if not exists creado_por uuid references auth.users(id);
alter table public.fotos_calicata add column if not exists client_uuid uuid;

create unique index if not exists calicatas_org_client_uuid_uidx
  on public.calicatas(organizacion_id, client_uuid)
  where client_uuid is not null;
create unique index if not exists lecturas_client_uuid_uidx
  on public.lecturas_calicata(client_uuid)
  where client_uuid is not null;
create unique index if not exists observaciones_client_uuid_uidx
  on public.observaciones_calicata(client_uuid)
  where client_uuid is not null;
create unique index if not exists fotos_client_uuid_uidx
  on public.fotos_calicata(client_uuid)
  where client_uuid is not null;
