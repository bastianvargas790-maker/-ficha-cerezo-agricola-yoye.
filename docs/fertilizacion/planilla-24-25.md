# Planilla de fertilización 24-25 — lo que trae y cómo la llevamos a Paneles

## 1. Qué hay adentro

La planilla tiene **43 hojas con datos** (más "Hoja 1" vacía), una por cuartel, todas con la misma
estructura: un bloque `producto × fecha de aplicación`.

- **900 aplicaciones** registradas, **56.488 kg** de producto en total
- **39 cuarteles** con aplicaciones (19 y 9 y 8 quedaron en cero)
- Temporada **18-jul-2025 → 9-feb-2026**, 124 fechas distintas (la planilla se llama 24-25, pero
  las fechas son de la temporada 2025-26)
- **46 productos** distintos una vez normalizados los nombres

De cada hoja se puede sacar, sin ambigüedad:

| dato | de dónde sale |
|---|---|
| cuartel, cultivo/variedad, sector de riego, hectáreas | cabecera (filas 2-4) |
| producto y su ley (%N, %K₂O, %MgO, %CaO, %P₂O₅) | columnas B-G |
| kg aplicados en cada fecha | columnas I en adelante |
| kg totales del producto en la temporada | columna H |
| unidades de N, K, P, Mg (totales y por ha) | bloque final (U. N, U.P., U.F., U. MG) |

Verifiqué el traspaso producto por producto contra las propias fórmulas de la planilla:
**686 de 695 filas dan exactamente lo mismo**. Las 9 que difieren son fórmulas que quedaron
cortas en la planilla, no errores del traspaso (van en el punto 2).

## 2. Cosas de la planilla que conviene no arrastrar al sistema

1. **El mismo producto escrito de muchas formas.** `QropMix` / `Qropmix` / `qropmix urea` /
   `Qrop mix urea`; `pow humus` / `pow hummus`; `hiberhumus` con cinco grafías;
   `bioamino-L` con seis; el boro aparece con **doce** nombres distintos
   (`HIGH LEVEL B21`, `boro nutrafol 21`, `nutrafol B21 boro`, …). Así no se puede sumar consumo.
2. **La misma ley distinta según la hoja.** Nitrato de magnesio aparece con 11,5 / 12 / 13 %N y
   con 15 % y 46 % de MgO. Nitrato de amonio con 22 % y 33,5 %N.
3. **La columna H se llama distinto en cada hoja** ("Kg Total" en unas, "Kg/ha Total" en otras)
   pero el número siempre es el kg total del cuartel. En **30-32** sí es kg/ha y tiene además una
   columna extra "Kg Total", por eso las unidades de esa hoja quedaron calculadas por hectárea
   mientras las otras están en total.
4. **57 aplicaciones sin fecha**: la columna dice sólo "oct", "nov", "ene", y algunas quedaron
   como "22-ee", "12-01ene" o "dic29-". Se puede guardar el mes, pero se pierde el dato fino.
5. **Cuatro fechas de diciembre quedaron con año 2026** (23, 29, 30 y 31 de diciembre) cuando
   debían ser 2025.
6. **Unidades mal rotuladas**: en el bloque de totales `U.P.` es potasio y `U.F.` es fósforo,
   pero en el bloque por hectárea `U.P./HA` es fósforo. Se presta para leer al revés.
7. **Litros mezclados con kilos** en algunas celdas ("50L", "6 L", "10 kg").
8. **Los costos están todos en `#DIV/0!`** — la lista de precios existe pero la fórmula se rompió.
9. **Superficies que no calzan con las de la base**: 34 (1,5 vs 2,5), 26 (2,32 vs 3,32),
   14A (1,99 vs 1,84), 39 (1,57 vs 1,0), 37 (1,68 vs 1,53). Y siete hojas no traen ha.

## 3. Hojas que no tienen cuartel en el sistema

33 hojas calzan directo con un cuartel de Rinconada Plano. Quedan afuera:

- **8, 9, 10-1, 10-2, 10-3, 11, 12** — sector "tendido", ciruelos. No existen como cuartel en
  ningún campo de la base.
- **34-1** (tiffany, 0,3 ha) y **26 injerto** (0,85 ha) — son pedazos de 34 y 26.
- **nogales mirador** — es de Mirador, y además es la única hoja que viene como *plan*
  (kg/ha programados por sector, sin fechas), no como registro de aplicaciones.

Y tres cuarteles de Rinconada Plano no tienen hoja: **C-29 nuevo, C-39 nuevo, Isla**.

## 4. Cómo lo llevaría a Paneles

Cuatro tablas, nada más:

**`fert_productos`** — el catálogo, una vez y para todas las temporadas.
`nombre` · `clave` (nombre normalizado, para no volver a duplicar) · `ley_n` · `ley_k2o` ·
`ley_p2o5` · `ley_mgo` · `ley_cao` · `unidad` (kg/L) · `densidad` (para los líquidos) · `activo`

**`fert_aplicaciones`** — lo que efectivamente se aplicó.
`cuartel_id` · `producto_id` · `fecha` (o `mes` cuando no hay fecha) · `cantidad` · `unidad` ·
`via` (fertirriego / foliar / suelo) · `observacion` · `registrado_por`
→ las unidades de N, K₂O, P₂O₅, MgO y CaO **no se guardan**: se calculan de la ley del producto,
así nunca quedan descuadradas como en la planilla.

**`fert_plan`** — lo programado para la temporada.
`cuartel_id` · `producto_id` · `temporada` · `kg_ha` o `kg_total` · `mes_objetivo`
→ de aquí sale el "plan vs. realizado" que hoy no se puede ver.

Sin precios ni stock: el apartado trabaja con **cantidades, fechas, productos y unidades por
hectárea**. La lista de US$/kg de 16 productos que trae la planilla queda anotada en el archivo
`precios.csv` por si algún día sirve, pero no entra al sistema.

## 5. Las cuatro vistas del apartado

1. **Aplicaciones hechas** — lista por cuartel y por fecha, con filtro por producto y por mes,
   y el acumulado de la temporada. Es la planilla, pero leíble en el teléfono y sin scroll lateral.
2. **Plan de la temporada** — lo programado contra lo aplicado, por cuartel y por nutriente,
   con el % de avance y lo que queda por aplicar.
3. **Unidades por nutriente** — U-N, U-K₂O, U-P₂O₅, U-MgO y U-CaO, totales y por hectárea,
   por cuartel y por mes, con la curva de la temporada. Es el número con el que se conversa
   con el asesor.
4. **Consumo** — kilos por producto en la temporada, por cuartel y por mes.

## 6. Decisiones tomadas

- **Sin precios ni stock.** Cantidades, fechas, productos y unidades por hectárea.
- **Las siete hojas del tendido (8 a 12) quedan fuera** hasta que esos cuarteles existan en la
  base. Son 6 aplicaciones, 1.295 kg.
- **34-1 y 26 injerto se suman a C-34 y C-26**, con la observación del sector, porque en la base
  son un solo cuartel (26 + 26 injerto = 3,17 ha y C-26 figura con 3,32).
- **Manda la superficie de la base**, no la de la planilla: las unidades por hectárea salen de
  `cuarteles.superficie_ha`. Donde las dos no calzan el número cambia bastante — C-39 antiguo da
  325 U-N/ha con 1,0 ha y 207 con las 1,57 de la planilla. Hay que corregir la que esté mala.
- **Una sola ley por producto**, la de ficha técnica donde la planilla se contradecía.
- **La base todavía no se toca.** La migración y la carga quedan escritas y probadas, listas para
  ejecutar cuando lo digas.

## 7. Lo que quedó escrito y probado

- `supabase/migrations/202609280001_fertilizacion.sql` — las tres tablas con sus políticas RLS
  siguiendo el mismo patrón del resto del sistema, la auditoría, y la vista
  `fert_aplicaciones_unidades`, que calcula U-N, U-K₂O, U-P₂O₅, U-MgO y U-CaO totales y por
  hectárea desde la ley del producto.
- `docs/fertilizacion/carga-2025-26.sql` — el catálogo de 41 productos y las **894 aplicaciones**
  (55.193 kg) de los 32 cuarteles de Rinconada Plano.

Los dos se ejecutaron en un Postgres 16 de prueba con los 36 cuarteles reales de Rinconada Plano
cargados: migración y carga corrieron sin un solo error, las 894 aplicaciones entraron, y la vista
de unidades devolvió los números por cuartel y por mes. Nada de esto tocó tu base.
