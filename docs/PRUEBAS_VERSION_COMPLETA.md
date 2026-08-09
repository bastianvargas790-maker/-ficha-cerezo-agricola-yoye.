# Informe de pruebas — versión de desarrollo

## Pruebas ejecutadas localmente

- Sintaxis de `shared-auth.js`, `app-enhancements-v3.js` y `sw.js`.
- Existencia de las seis rutas de cultivo y recursos PWA.
- Manifest con iconos 192, 512 y maskable.
- Iconos rasterizados en sus dimensiones declaradas.
- Ausencia de `service_role`, contraseñas embebidas y caché deliberada de respuestas Supabase.
- RLS declarada para fuentes y datos técnicos, con escritura limitada a Administrador.
- Diseño adaptable definido para 390 px, áreas táctiles de 44 px, foco visible y `prefers-reduced-motion`.
- Seis fotografías locales WebP, entre 52 y 163 KB, sin dependencia de Wikimedia en tiempo de ejecución.
- Atribución, licencia, autor y transformación documentadas por fotografía.

## Pruebas Supabase ejecutadas el 9 de agosto de 2026

- Migraciones de fuentes técnicas y optimización aplicadas en el proyecto gratuito existente; no se creó una rama con costo.
- Nueve pruebas transaccionales aprobadas: creación por Editor, lectura desde una segunda sesión, bloqueo de escritura para Solo lectura, bloqueo de eliminación para Editor, eliminación por Administrador, fuentes limitadas al Administrador, auditoría y publicación Realtime.
- Tres identidades temporales representaron Administrador, Editor y Solo lectura. La transacción finalizó con `ROLLBACK`.
- Verificación posterior: 0 usuarios, 0 cuarteles y 0 fuentes de prueba residuales.
- Asesor de seguridad: RLS activa en tablas públicas nuevas. Los avisos sobre las tablas de respaldo privadas son informativos y deliberados: no tienen políticas ni privilegios públicos.
- Asesor de rendimiento: se corrigieron las políticas SELECT duplicadas y se agregaron índices a las claves foráneas de las tablas nuevas.

## Pendiente de comprobar antes de producción

- Inicio correcto/incorrecto, recuperación, cambio de correo y contraseña con SMTP real.
- Prueba física con dos teléfonos reales y tres cuentas permanentes. La prueba automatizada cubre las mismas políticas y visibilidad, pero no sustituye la prueba táctil/red real.
- Identificación de los cuatro cuarteles reales con sonda y sus profundidades.
- Lectura de voz `es-CL` y pegado en WhatsApp/Notas sobre iPhone real.
- Instalación PWA en iPhone y limpieza de caché.
- Migración y conteo antes/después de datos existentes.

Ningún punto pendiente debe declararse completado sin evidencia.
