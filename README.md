# Material de estudio de cultivos — Agrícola Yoye

Base de fichas técnicas interactivas para estudiar fenología, riego, nutrición, diagnóstico y planificación de labores en frutales del Fundo La Rinconada de Puangue, Melipilla.

## Fichas publicadas

| Cultivo | Página web | Archivo fuente |
|---|---|---|
| Cerezo | [Abrir ficha](https://bastianvargas790-maker.github.io/-ficha-cerezo-agricola-yoye./) | `/index.html` |
| Nogal | [Abrir ficha](https://bastianvargas790-maker.github.io/-ficha-cerezo-agricola-yoye./nogal/) | `/nogal/index.html` |
| Duraznero | [Abrir ficha](https://bastianvargas790-maker.github.io/-ficha-cerezo-agricola-yoye./duraznero/) | `/duraznero/index.html` |
| Naranjo | [Abrir ficha](https://bastianvargas790-maker.github.io/-ficha-cerezo-agricola-yoye./naranjo/) | `/naranjo/index.html` |
| Ciruelo | [Abrir ficha](https://bastianvargas790-maker.github.io/-ficha-cerezo-agricola-yoye./ciruelo/) | `/ciruelo/index.html` |
| Nectarino | [Abrir ficha](https://bastianvargas790-maker.github.io/-ficha-cerezo-agricola-yoye./nectarino/) | `/nectarino/index.html` |

## Contenido común

Cada ficha integra:

- Fenología y criterios de observación.
- Riego, sondas de humedad y cálculos orientativos.
- Nutrición y función de nutrientes.
- Diagnóstico visual y protocolo de revisión en terreno.
- Calendario editable de labores.
- Ficha editable por cuartel.
- Diseño adaptable a celular e impresión en PDF.

## Contexto agronómico del proyecto

- Zona: Cuncumén–Melipilla, Región Metropolitana de Chile.
- Condición climática: mediterránea interior, con influencia del corredor hacia San Antonio.
- Cultivos incluidos: cerezo, nogal, duraznero, naranjo, ciruelo y nectarino.
- Sistema de riego habitual: goteo.
- Monitoreo considerado: sondas a 30, 60 y 90 cm, humedad, temperatura y conductividad eléctrica.
- Uso: material de estudio y apoyo para planificación; las decisiones productivas deben validarse con datos del cuartel, análisis, etiquetas vigentes y asesoría competente.

## Continuación del proyecto

Usar este repositorio como fuente principal para próximas mejoras. Al solicitar cambios, indicar:

1. Cultivo o cultivos afectados.
2. Sección de la ficha.
3. Información que debe agregarse, corregirse o compararse.
4. Si el cambio debe aplicarse a una sola ficha o a todas.
5. Fotografías, análisis, registros o manuales que sirvan como respaldo.

## Arquitectura de la versión multidispositivo

- Supabase Auth mantiene una sola sesión en toda la aplicación.
- Supabase Postgres es la fuente oficial de cuarteles, riegos, sondas, perfiles e historial.
- RLS aplica los roles Administrador, Editor y Solo lectura desde el servidor.
- `localStorage` se consulta exclusivamente para importar registros antiguos de forma voluntaria.
- Realtime actualiza cuarteles y riegos entre teléfonos autorizados.
- La migración y su procedimiento están documentados en `supabase/migrations` y `docs/MIGRACION.md`.

## Pendientes antes de producción

- Identificar los cuatro cuarteles con sonda y sus profundidades reales.
- Incorporar fotografías propias o con licencia comprobada para los seis cultivos.
- Ejecutar la prueba multidispositivo con cuentas de los tres roles.
- Trasladar el frontend a un hosting con control perimetral cuando Cloudflare esté disponible.
