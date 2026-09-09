import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/* El panel promediaba todas las calicatas del campo. Con los datos reales eso
   mezcla un cuartel con CE 6,2 mS/cm a 90 cm y otro con 0: el promedio, 3,1,
   no describe a ninguno de los dos. Lo que se fija acá es que el panel no
   vuelva a promediar entre cuarteles. */
const js = readFileSync(new URL('../assets/paneles-dashboards.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/paneles-dashboards.css', import.meta.url), 'utf8');

test('el panel filtra por cuartel, cultivo, caseta y equipo', () => {
  assert.match(js, /let filtroCal=\{cuartel:'',caseta:'',equipo:'',cultivo:''\}/);
  for (const f of ['cuartel','cultivo','caseta','equipo'])
    assert.ok(js.includes(`selector('${f}'`), `falta el filtro de ${f}`);
  assert.ok(js.includes('function enlazarFiltros'), 'los filtros deben repintar el panel');
});

test('los filtros están arriba y alcanzan a todos los gráficos', () => {
  // Un filtro dentro de una tarjeta deja cada gráfico mostrando otra cosa.
  assert.match(js, /return filtros\+kpis\+leyenda\+/);
  assert.match(css, /\.pd-filtros\{display:flex/);
});

test('no se promedia entre cuarteles', () => {
  const bloque = js.slice(js.indexOf('function pintarCalicatas'), js.indexOf('/* ---------- Ácido'));
  assert.ok(bloque.includes('rango, sin promediar cuarteles'), 'los indicadores deben ser rangos');
  assert.ok(!/Humedad promedio por cuartel/.test(bloque), 'ya no debe existir el promedio del campo');
  assert.ok(bloque.includes('porCuartelUltima'), 'un perfil por cuartel, no uno agregado');
});

test('los perfiles comparten una escala común', () => {
  // Con cada tarjeta escalada a sus propios datos, un cuartel que va de 9 a 30 %
  // se ve igual que uno de 29 a 33 % y comparar deja de significar algo.
  assert.ok(js.includes('const dominioDe=dato=>'), 'debe calcularse un dominio común');
  assert.match(js, /perfilVertical\('Humedad por profundidad'[^)]*domHum\)/);
  assert.match(js, /perfilVertical\('CE por profundidad'[^)]*domCe\)/);
});

test('el perfil se dibuja con la profundidad hacia abajo', () => {
  // Es como se ve en el hoyo; en barras horizontales no se lee la forma del bulbo.
  assert.ok(js.includes('function perfilVertical'), 'falta el perfil vertical');
  assert.match(js, /const y=p=>pad\.t\+\(p-minProf\)/);
});

test('los rótulos no se pisan entre sí', () => {
  // Con los tres puntos midiendo parecido quedaba "29,833,132,2" ilegible.
  assert.match(js, /f\.dy=\(finales\[j\]\.dy\|\|0\)-11/);
});

test('subir y bajar se dibujan hacia lados distintos', () => {
  // "La CE bajó 0,64" salía como una barra hacia el mismo lado que "subió 4,03".
  assert.ok(js.includes('function barrasDivergentes'), 'faltan las barras divergentes');
  assert.match(css, /\.pd-div-cero\{position:absolute;left:50%/);
});

test('un anillo de una sola porción no se dibuja', () => {
  // Un anillo con una categoría es un gráfico que no compara nada.
  assert.match(js, /const anilloUnion=unionCuenta\.size>1/);
});

test('la paleta de los tres puntos es fija y validada', () => {
  // Validada contra el fondo de la app: separación mínima ΔE 8,4 en protanopía
  // y los tres sobre 3:1 de contraste. Cambiar un hex obliga a revalidar.
  assert.match(js, /\{clave:'punto_cero',\s*nombre:'Centro',\s*color:'#2a78d6'\}/);
  assert.match(js, /\{clave:'linea_izquierda',\s*nombre:'Izquierda',\s*color:'#eb6834'\}/);
  assert.match(js, /\{clave:'linea_derecha',\s*nombre:'Derecha',\s*color:'#199e70'\}/);
});

test('la app de Calicatas quedó solo para registrar', () => {
  const html = readFileSync(new URL('../calicatas/registro-v16.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('data-view="history"'), 'no debe ofrecer el historial en terreno');
  assert.match(html, /href="\.\.\/paneles\/#panel-calicatas"/, 'debe enviar al panel');
  const calCss = readFileSync(new URL('../assets/calicatas.css', import.meta.url), 'utf8');
  assert.match(calCss, /#historyView\{display:none !important\}/);
});

test('el resumen de campos no dibuja barras vacías', () => {
  // Sin ningún aforo, cuatro barras en cero hacen parecer roto un panel que
  // solo está esperando el primer registro.
  assert.match(js, /const hayAforos=resumen\.some\(r=>r\.aforos>0\)/);
  assert.ok(js.includes('Cobertura del monitoreo'), 'la cobertura sí es parte de un todo');
});
