# Migración a la base central

1. La rama `agent/base-central-multidispositivo` conserva el estado previo de `main`.
2. Antes de aplicar SQL, exportar las tablas actuales `usuarios_autorizados` y `cuarteles` desde Supabase.
3. Las migraciones `202608090001` a `202608090005` están registradas en el proyecto Supabase existente.
4. Confirmar RLS con cuentas Administrador, Editor y Solo lectura.
5. En cada teléfono antiguo, abrir **Base de cuarteles** y usar **Revisar e importar**.
6. La importación usa la clave única `(organizacion_id, codigo)` y no borra `localStorage`.
7. Comparar cantidad y contenido antes de retirar el almacenamiento local antiguo.

Los cuatro cuarteles con sonda se identifican desde la base central. No se asignan profundidades globales ni se inventan cuarteles.

La migración `003` agrega el inventario de fuentes y los datos técnicos trazables. La `004` separa las políticas por operación y agrega índices; la `005` hace la misma optimización para sondas. Se aplicaron directamente al proyecto gratuito existente para evitar el costo horario de una rama; no se creó ninguna rama de pago.
