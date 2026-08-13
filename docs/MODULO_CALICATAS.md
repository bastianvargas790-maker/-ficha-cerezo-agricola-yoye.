# Módulo de Calicatas · Agrícola Yoye

## Objetivo
Registrar calicatas desde terreno y consultar trazabilidad por cuartel sin duplicar la base de cuarteles.

## Flujo
Dashboard → Registro de calicatas → Registrar nueva / Ver historial.

## Supabase
- `calicatas`: cabecera de cada evaluación.
- `lecturas_calicata`: humedad, CE y temperatura por profundidad.
- `observaciones_calicata`: observaciones estructuradas.
- `fotos_calicata`: referencia de fotografías privadas.
- bucket privado `calicatas`.
- vista `v_calicatas_export` para respaldo/exportación.

## Seguridad
Todas las tablas operativas usan RLS. Las fotografías quedan en Storage privado. La app usa la sesión existente de Agrícola Yoye y nunca usa `service_role` en el navegador.

## Estado
La rama `agent/modulo-calicatas` contiene la primera versión funcional. Antes de fusionar a `main` se debe probar con una sesión autorizada en iPhone: carga de cuarteles, guardado de una calicata real, fotografías, historial y gráficas.