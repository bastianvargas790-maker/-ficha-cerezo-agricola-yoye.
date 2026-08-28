# Rama obsoleta — no continuar aquí

**Estado: descartada el 2026-08-27. No fusionar a `main`.**

Esta rama contiene una implementación del aforo (`assets/aforo.js`,
`aforo-rinconada/index.html`) que **no funciona contra la base de datos real**.

## Por qué

Escribe las mediciones en `public.aforo_lecturas`, una tabla que **no existe**
en el Supabase de producción. Se verificó consultando `information_schema`
directamente contra la base viva: las tablas reales de aforo son
`public.aforos` y `public.mediciones_aforo`.

La migración `supabase/migrations/202608231_aforo_rinconada.sql` que crea
`aforo_lecturas` nunca se aplicó a esa base — vive solo en este repo. El primer
guardado de un aforo desde esta rama fallaría.

## Qué se rescató

El trabajo útil de esta rama se reconstruyó sobre la implementación que sí
calza con la base (el wizard de 4 pasos en `main`), en el commit
`57c484a "Separar cuarteles por campo en el wizard de Aforo"`:

- Separación de cuarteles por campo, incluida la copia local por campo en
  IndexedDB para uso sin conexión.
- `unidades_aforo` como lista cerrada en el campo Sector, para las extensiones
  que se aforan por separado (C-37 tiene la Isla; C-40, las válvulas A y B).

Lo que **no** se portó, porque ya existía en `main`: el selector de campo, que
vive en `assets/campos.js` (`yoyeActiveCampo`, evento `yoye-campo-changed`).

Lo que **no** existe en ninguna de las dos: una vista de historial de aforos.
`aforo.js` solo escribe. Es un hueco del producto, no una regresión.

## Por qué se conserva

Como registro de por qué se descartó este camino, para que nadie vuelva a
partir de aquí suponiendo que es la implementación buena. El estado actual del
aforo está en `main`.
