import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

/* El botón "Cuarteles" y los números del Inicio apuntaban a cerezo/#database:
   miraras el campo que miraras, terminabas en la ficha de cerezo sin poder
   cambiar de cultivo. Ahora hay una lista propia; que no se vuelva atrás. */
const leer = ruta => readFileSync(new URL(ruta, import.meta.url), 'utf8');

test('existe la lista de cuarteles', () => {
  assert.ok(existsSync(new URL('../cuarteles/lista.html', import.meta.url)));
  assert.ok(existsSync(new URL('../assets/cuarteles-lista.js', import.meta.url)));
});

test('nada de la navegación manda a la ficha de cerezo', () => {
  for (const ruta of ['../index.html', '../assets/campos.js', '../cuarteles/index.html']) {
    assert.ok(!leer(ruta).includes('cerezo/#'), `${ruta} no debe enlazar a la ficha de cerezo`);
  }
});

test('el Inicio muestra las ocho fichas, no solo las del campo', () => {
  // El Inicio dejó de filtrar por los cultivos del campo activo: las fichas son
  // material de estudio y se ofrecen todas siempre.
  const home = leer('../assets/home-yoye.js');
  for (const cultivo of ['cerezo', 'ciruelo', 'nogal', 'duraznero', 'nectarino', 'naranjo', 'palto', 'mandarina']) {
    assert.ok(home.includes(`slug:'${cultivo}'`), `falta la ficha ${cultivo}`);
  }
  assert.ok(!home.includes('yoyeCultivosCampo'), 'el Inicio no debe filtrar las fichas por campo');
});

test('el Inicio no duplica los accesos de registro que viven en la barra inferior', () => {
  const inicio = leer('../index.html');
  assert.ok(!inicio.includes('Registro de calicatas'));
  assert.ok(!inicio.includes('Registro de aforos'));
});

test('todo el sitio usa el logo oficial', () => {
  for (const ruta of ['../index.html', '../paneles/index.html', '../cuarteles/index.html',
                      '../cuarteles/lista.html', '../aforo/index.html', '../mas/index.html']) {
    assert.ok(!leer(ruta).includes('yoye-logo.svg'), `${ruta} usa el logo genérico`);
  }
});

test('el Inicio usa el sistema visual de la app y no inventa datos', () => {
  const inicio = leer('../index.html');
  const home = leer('../assets/home-yoye.js');
  assert.match(inicio, /yoye-app\.css\?v=/);
  assert.match(inicio, /id="homeKpis"/);
  assert.match(inicio, /id="homeAlerts"/);
  assert.match(inicio, /id="homeCrops"/);
  // Los indicadores salen de la base, filtrados por el campo activo.
  for (const tabla of ['cuarteles', 'sectores_aforo', 'aforos', 'calicatas']) {
    assert.ok(home.includes(`from('${tabla}')`), `el Inicio debe consultar ${tabla}`);
  }
  assert.ok(home.includes("eq('campo_id',campo.id)"), 'los datos del Inicio deben filtrarse por campo');
});

test('la app se adapta a pantallas de notebook', () => {
  // En 1440 px la versión anterior se veía como un teléfono estirado: una sola
  // columna al centro y la barra inferior cruzando toda la pantalla.
  const inicio = leer('../index.html');
  const cuarteles = leer('../cuarteles/lista.html');
  const paneles = leer('../paneles/index.html');
  const campos = leer('../assets/campos.css');
  const panelCss = leer('../assets/paneles-dashboards.css');

  assert.match(inicio, /@media\(min-width:1000px\)[\s\S]*crop-strip/);
  assert.match(cuarteles, /@media\(min-width:760px\)[\s\S]*cl-list/);
  assert.match(paneles, /@media\(min-width:1000px\)/);
  assert.match(campos, /@media \(min-width:900px\)[\s\S]*yoye-bottom-nav/);
  assert.match(panelCss, /@media \(min-width:1000px\)[\s\S]*pd-cuerpo/);
});

test('la lista de paneles se oculta al abrir un dashboard', () => {
  // El estilo en línea le ganaba al atributo hidden y quedaban las dos cosas.
  const paneles = leer('../paneles/index.html');
  assert.ok(!paneles.includes('style="display:flex;flex-direction:column;gap:12px"'));
  assert.match(paneles, /#yoyePanelesList\[hidden\]/);
});
