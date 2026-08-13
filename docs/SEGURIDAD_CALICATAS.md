# Seguridad · Calicatas

El módulo utiliza la sesión autenticada de Agrícola Yoye y RLS en Supabase.

- `calicatas`, `lecturas_calicata`, `observaciones_calicata` y `fotos_calicata` tienen políticas por organización.
- El bucket `calicatas` es privado y usa la organización como primer segmento de ruta.
- Las imágenes se consultan mediante URLs firmadas temporales.
- No se usa `service_role` en el frontend.

## Advisor de Supabase
Tras completar el módulo no aparecieron avisos nuevos específicos de Calicatas. Permanecen avisos preexistentes sobre tablas de respaldo del esquema `private` sin políticas (tablas no expuestas como módulo operativo) y protección contra contraseñas filtradas desactivada en Auth.