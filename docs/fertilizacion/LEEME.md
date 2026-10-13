# Programa de fertilización: de la planilla a la app

El programa lo escribe el asesor en la planilla del Drive
(`Yoye_fertilizacion_2025-2026_rinconada`): en cada hoja de cuartel, las
columnas con **fecha todavía por venir** llevan los kilos de cada producto. Eso
es el programa; cuando la fecha pasa, esa misma celda es lo aplicado.

La app lo muestra para confirmarlo en terreno. No lo lee de la planilla: la
planilla se lo manda.

## Cómo queda conectado

```
Planilla (Google Sheets)
   └─ menú "Agrícola Yoye → Subir programa a la app"   ← subir-programa.gs
        └─ POST con el secreto compartido
             └─ Edge Function programa-fertilizacion
                  └─ fert_plan  (una línea por cuartel · producto · fecha)
                       └─ la app, al elegir el cuartel, ofrece la fecha más
                          cercana pendiente para confirmar
```

## Instalación, una sola vez

1. **Base de datos** — ejecutar en orden:
   - `supabase/migrations/202610130001_programa_fertilizacion.sql`
   - `supabase/migrations/202610130002_fert_hoja_cuartel.sql`
2. **Edge Function** — desplegar `supabase/functions/programa-fertilizacion`
   con `verify_jwt = false`: no la llama un usuario con sesión, la llama la
   planilla con el secreto compartido `GOOGLE_SHEETS_SYNC_SECRET`, el mismo que
   ya usan `sync-calicata` y `sync-aforo-rinconada`.
3. **Planilla** — Extensiones → Apps Script, pegar `subir-programa.gs`, y en
   Propiedades del script agregar `SUPABASE_FUNCION` y `SYNC_SECRET`.

## Cómo se usa

- El asesor cambia el programa → **Agrícola Yoye → Subir programa**. Se puede
  apretar las veces que sea: lo que ya estaba se actualiza, lo que se borró de
  la planilla se da de baja, nada se duplica ni se borra de verdad.
- Antes de subir, **Ver qué se va a subir** dice cuántas líneas y de qué
  cuarteles, y qué hojas quedan fuera.
- En terreno: Registrar → Fertilización → elegir el cuartel. Aparece la fecha
  pendiente más cercana con sus productos y tres botones por producto:
  **Igual**, **Cambié**, **No apliqué**.

## Decisiones que conviene recordar

- **El programa se busca por fecha, no por número de semana.** La semana del
  mes es solo el rótulo ("octubre, semana 2 · miércoles 14"). Revisando la
  planilla, de 271 fechas programadas hay 17 casos donde dos aplicaciones del
  mismo cuartel caen en la misma semana del mes (el 23 y el 28 de octubre, por
  ejemplo); contando de lunes a domingo bajan a 6, pero no desaparecen. La
  fecha sí es única.
- **"No apliqué" es un dato.** Se guarda con cantidad 0 y `estado =
  'no_aplicado'`, amarrado a su línea del programa. Sin eso, el panel no puede
  distinguir "no se aplicó" de "no se alcanzó a registrar". No entra en la
  vista de unidades por hectárea: una omisión no aporta kilos de nutriente.
- **La equivalencia hoja → cuartel se guarda en `fert_hoja_cuartel`.** Las
  hojas se llaman "7", "13 a", "nogales 15", "29"; los cuarteles son "C-7",
  "C-13A", "C-15", "C-29 antiguo". Las reglas de texto fallan justo en los
  cuarteles que existen dos veces (29 y 39, antiguo y nuevo). Si el asesor
  renombra una hoja, se arregla una fila de esa tabla, sin tocar código.
- **No se sugiere "lo mismo que la semana pasada".** En la temporada
  2025-2026, de 359 semanas seguidas solo el 22% repitió el mismo producto con
  los mismos kilos, y el 70% cambió la lista de productos.
