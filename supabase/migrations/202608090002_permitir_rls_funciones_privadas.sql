-- Permite que las políticas RLS invoquen las funciones privadas de autorización
-- sin exponer tablas privadas ni permitir crear objetos en el esquema.
revoke create on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

revoke all on all tables in schema private from public, anon, authenticated;

revoke all on function private.es_miembro(uuid),
  private.puede_editar(uuid),
  private.es_admin(uuid)
from public, anon;

grant execute on function private.es_miembro(uuid),
  private.puede_editar(uuid),
  private.es_admin(uuid)
to authenticated;
