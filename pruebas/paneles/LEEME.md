# Revisión de los paneles en el navegador

Las pruebas de `tests/` leen el código. Estas abren el panel de verdad, con
datos de varios cuarteles y varias fechas, y **miden el dibujo**: si el gráfico
se arma al ancho de la tarjeta o sale estirado, si los rótulos de fecha se
pisan, si algo se sale de la pantalla del teléfono y si al girar el teléfono el
gráfico se rehace.

Son el seguro contra las fallas que no se ven leyendo el archivo: un SVG de 360
px estirado a 1.100 px pasa todas las pruebas de código y en pantalla tiene el
texto del eje tres veces más grande.

## Cómo se corren

```
python3 -m http.server 8899        # desde la raíz del repositorio
node pruebas/paneles/revisar-tendencias.mjs
```

Devuelve 0 si todo pasa y 1 si algo falla, y deja una captura de cada tamaño en
`pruebas/paneles/capturas/` (teléfono de 390 px y notebook de 1440 px, vista de
la selección y ficha de un cuartel). Las capturas no se suben al repositorio:
se vuelven a generar cada vez.

## Qué revisa hoy

- La humedad y la conductividad van en **dos gráficos**, no en uno con dos ejes.
- Entre 2 y 5 líneas por gráfico, con la leyenda nombrando todas las series.
- Los rótulos de fecha no se montan unos sobre otros.
- El dibujo se arma 1:1 con el ancho de la tarjeta (1.114 px en notebook, 324 px
  en teléfono), así el texto del eje mide lo que dice la hoja de estilos.
- Alto grande en el computador y normal en el teléfono.
- Nada del panel se sale de la pantalla.
- La referencia del suelo aparece cuando todos los cuarteles dibujados tienen la
  misma textura.
- Al agrandar la ventana el gráfico se vuelve a dibujar al ancho nuevo.
- Ningún error de JavaScript en toda la carga.

## revisar-todos-los-campos.mjs

El panel "Todos los campos": una tarjeta por campo con cuatro medidores (aforo,
calicatas, ácido y descole).

```
python3 -m http.server 8899
node pruebas/paneles/revisar-todos-los-campos.mjs
```

Lo que cuida:

- Cada campo trae su tarjeta y sus cuatro medidores.
- **El porcentaje cabe dentro de la tarjeta.** Esta es la falla que motivó la
  revisión: sin `min-width:0` en los hijos de la reja, la fila no se encogía y
  el número quedaba cortado por el borde — se leía "9" en vez de "92%", y el
  archivo se veía perfecto.
- En el escritorio las tarjetas se reparten de a cuatro; en el teléfono, una
  abajo de otra.
- Un campo sin datos dice "sin aforos todavía" en vez de dibujar una barra en
  cero, que se lee como "cero por ciento hecho".
- Los indicadores de arriba dicen cuántos de cuántos, no solo el porcentaje.
