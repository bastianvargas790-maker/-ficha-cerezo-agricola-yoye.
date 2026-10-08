# Revisión en teléfono, antes de publicar

Las pruebas de `tests/` leen el código fuente. Eso deja pasar todo lo que
depende de **dónde** corre la app, y en esta aplicación eso importa: se usa en
un teléfono, en el cerro, con mala señal.

Dos fallas llegaron publicadas justamente por ahí:

- El botón **"Compartir"** aparecía solo si el navegador tiene
  `navigator.share`. Un Chromium de escritorio no lo tiene, así que en las
  pruebas el botón nunca salía; en el teléfono salía siempre, y abría la hoja
  del sistema en vez de dejar el mensaje para copiar.
- El mensaje del grupo vivía en una caja de 180px con scroll propio. En
  pantalla grande se veía; en el teléfono parecía que no había mensaje.

Este script abre la app de verdad, en 390px, con `navigator.share` presente, y
además prueba **sin señal**. Es lo que hay que correr antes de decir que algo
funciona.

```bash
# desde la raíz del repo
python3 -m http.server 8899 &
node pruebas/terreno/revisar-en-telefono.mjs

# para comparar contra lo que está publicado
git worktree add /tmp/publicado origin/main
(cd /tmp/publicado && python3 -m http.server 8898 &)
node pruebas/terreno/revisar-en-telefono.mjs http://localhost:8898
```

Devuelve 0 si pasa todo y 1 si algo falla. Necesita Playwright con Chromium.

## revisar-fertilizacion.mjs

El registro de fertilizaciones y el cuartel que se desmarcaba en Calicatas.
Abre la app de verdad en 390 px y hace lo que se hace en terreno: abrir la hoja
"Registrar", anotar productos y kilos, guardar con y sin señal, corregir y
descartar.

```
python3 -m http.server 8899        # desde la raíz del repositorio
node pruebas/terreno/revisar-fertilizacion.mjs
```

Lo que cuida:

- La hoja "Registrar" ya no ofrece riego y sí fertilización.
- El catálogo de productos se carga y un producto líquido trae litros puesto.
- Una fila cuenta sólo con producto y cantidad; lo que queda a medias se avisa.
- Sin señal guarda igual en el teléfono y no intenta subir.
- Tras guardar, el cuartel queda puesto y las cantidades se borran.
- Lo del mismo cuartel y el mismo día es una sola tarjeta, no dos.
- Descartar oculta con `activo=false`; nunca borra.
- **El cuartel de la calicata sigue elegido** después de que la app recarga los
  campos. Esta es la falla que motivó el archivo: no se perdía al guardar, se
  perdía cuando volvía la señal y el formulario se repintaba debajo.
