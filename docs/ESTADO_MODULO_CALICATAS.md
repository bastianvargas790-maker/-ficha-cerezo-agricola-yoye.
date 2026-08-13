# Estado del módulo de Calicatas

Implementado en rama `agent/modulo-calicatas`:

- acceso desde Dashboard principal
- formulario móvil con cuarteles reales
- mediciones por profundidad
- observaciones de raíces y compactación
- carga de fotografías privadas
- historial por cuartel
- gráficas de humedad, CE y temperatura
- filtro por profundidad
- tendencias básicas
- integración con Supabase y RLS

Pendiente antes de producción:

- prueba con una calicata real desde iPhone
- revisión visual en pantalla pequeña
- confirmar comportamiento de fotografías HEIC según navegador
- verificar rol de solo lectura
- conectar/exportar al Google Sheet existente como respaldo
- fusionar a `main` después de la validación.