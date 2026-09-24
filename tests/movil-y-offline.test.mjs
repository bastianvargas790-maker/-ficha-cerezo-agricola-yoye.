import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/* Esta app se usa de pie, en el cerro y muchas veces sin señal. Lo que se fija
   acá es exactamente lo que la hace fallar en terreno y no en el escritorio. */
const leer = r => readFileSync(new URL(r, import.meta.url), 'utf8');

test('el service worker no se cae entero si falta un recurso', () => {
  // addAll es todo-o-nada: con un solo 404 no se cachea NADA y la app no abre.
  for (const sw of ['../sw.js', '../calicatas/sw.js', '../aforo/sw.js']) {
    const s = leer(sw);
    assert.ok(!/cache\.addAll\(SHELL\)/.test(s), `${sw} todavía usa addAll`);
    assert.ok(s.includes('function precargar'), `${sw} debe precargar de a uno`);
    assert.match(s, /cache\.add\(u\)\.catch\(\(\)=>\{\}\)/);
  }
});

test('cada app borra solo su propia caché', () => {
  // El sw de la raíz borraba toda caché ajena: instalabas Calicatas, abrías la
  // app principal y Calicatas se quedaba sin nada guardado.
  assert.match(leer('../sw.js'), /keys\.filter\(key=>key\.startsWith\('yoye-shell-'\)&&key!==CACHE\)/);
  assert.match(leer('../calicatas/sw.js'), /key\.startsWith\('calicatas-campo-'\)/);
  assert.match(leer('../aforo/sw.js'), /key\.startsWith\('aforo-campo-'\)/);
});

test('sin conexión, el respaldo HTML es solo para navegaciones', () => {
  // Servía la página entera como respuesta a un CSS o un JS que faltaba: la
  // app abría rota en vez de fallar claro.
  for (const sw of ['../sw.js', '../calicatas/sw.js', '../aforo/sw.js'])
    assert.match(leer(sw), /event\.request\.mode==='navigate'\?/, sw);
});

test('el shell de cada app incluye lo que la página realmente pide', () => {
  const raiz = leer('../sw.js');
  assert.ok(raiz.includes('paneles-dashboards.js'), 'Paneles abría sin sus dashboards');
  assert.ok(raiz.includes('paneles-dashboards.css'));
  const cal = leer('../calicatas/sw.js');
  for (const f of ['yoye-theme.css', 'campos.css', 'campos.js', 'aforo.js'])
    assert.ok(cal.includes(f), `Calicatas sin ${f} abría sin estilos`);
});

test('cada app se instala con su propio icono y nombre', () => {
  for (const [man, id, icono] of [['../manifest.webmanifest', '/yoye-app', 'pwa-192.png'],
                                  ['../calicatas/manifest.webmanifest', '/yoye-calicatas', 'calicatas-192.png'],
                                  ['../aforo/manifest.webmanifest', '/yoye-aforo', 'aforo-192.png']]) {
    const d = JSON.parse(leer(man));
    assert.equal(d.id, id, `${man} necesita un id estable`);
    assert.equal(d.display, 'standalone');
    assert.ok(d.icons.some(i => i.src.includes(icono)), `${man} debe usar ${icono}`);
    assert.ok(d.icons.some(i => i.purpose === 'maskable'), 'Android recorta el icono');
  }
});

test('el iPhone abre los accesos directos como aplicación', () => {
  // iOS no lee el manifiesto para esto: usa sus propias meta. Sin ellas el
  // acceso directo abría dentro de Safari y el nombre salía cortado.
  for (const [p, titulo] of [['../index.html', 'Yoye'], ['../calicatas/registro-v16.html', 'Calicatas'],
                             ['../aforo/index.html', 'Aforo']]) {
    const s = leer(p);
    assert.match(s, /name="apple-mobile-web-app-capable" content="yes"/, p);
    assert.ok(s.includes(`name="apple-mobile-web-app-title" content="${titulo}"`), `${p} → ${titulo}`);
    assert.match(s, /rel="apple-touch-icon"/, p);
  }
});

test('los campos numéricos abren el teclado que corresponde', () => {
  // Escribir "23,5" con el teclado de texto es el error más caro de un
  // formulario de terreno.
  const aforo = leer('../assets/aforo.js');
  assert.ok(!/type="number"(?![^>]*inputmode)/.test(aforo.replace(/\n/g, ' ')),
    'todo campo numérico del aforo necesita inputmode');
  assert.match(leer('../calicatas/registro-v16.html'), /id="customDepth" type="number" inputmode="numeric"/);
});

test('los controles se pueden tocar con guante', () => {
  const campos = leer('../assets/campos.css');
  assert.match(campos, /\.yoye-campo-pill\{[^}]*min-height:44px\}/);
  assert.ok(campos.includes('@media (max-width:820px)'), 'el criterio es el ancho, no pointer:coarse');
  assert.ok(leer('../assets/calicatas.css').includes('@media (max-width:820px)'));
});

test('el estado de conexión informa, no se puede falsear', () => {
  // Era un botón que alternaba el estado "para demostración": en terreno
  // alguien lo tocaba y la app se creía sin internet sin estarlo.
  const s = leer('../assets/campos.js');
  assert.ok(!s.includes('Alternar estado de conexión'), 'ya no debe ser un interruptor');
  assert.ok(!/conn\.onclick=\(\)=>\{online=!online/.test(s), 'no debe invertir el estado real');
  assert.match(s, /conn\.setAttribute\('role','status'\)/);
  assert.match(s, /addEventListener\('offline'/);
});

test('la raíz de la app no depende de dónde esté publicada', () => {
  // Contando segmentos del path, servido en la raíz de un dominio los enlaces
  // de Paneles apuntaban a /paneles/cuarteles/... y no existían.
  for (const f of ['../assets/campos.js', '../assets/aforo.js']) {
    const s = leer(f);
    assert.ok(s.includes('const RAIZ='), `${f} debe deducir la raíz`);
    assert.ok(!/function root\(\)\{return location\.pathname\.split/.test(s), `${f} contaba segmentos`);
  }
});

test('la cabecera de Calicatas no duplica el estado de conexión', () => {
  // El shell de Yoye inyecta su chip y Calicatas ya tenía el suyo: se veían
  // dos puntos verdes y el selector de campo quedaba descolocado.
  const css = leer('../assets/calicatas.css');
  assert.match(css, /\.cal-top\.yoye-header-injected \.status\{display:none\}/);
  assert.ok(css.includes('grid-template-areas:"volver perfil" "campo estado"'),
    'en el teléfono la cabecera va en dos filas');
});

test('en el teléfono se pueden llenar humedad, CE y temperatura', () => {
  // La fila de lecturas era una reja de 5 columnas con min-width:500px y
  // .depth-block la recortaba con overflow:hidden: CE y T °C quedaban fuera de
  // la pantalla y el contenedor de scroll ni se enteraba de que había más a la
  // derecha. No eran incómodas: eran inalcanzables.
  const css = leer('../assets/calicatas.css');
  assert.match(css, /@media\(max-width:640px\)\{[\s\S]*?\.reading-row\{[^}]*grid-template-areas:"punto punto punto" "hume ce temp"/);
  assert.match(css, /@media\(max-width:640px\)\{[\s\S]*?\.reading-row\{[^}]*min-width:0/);
  assert.ok(/@media\(max-width:640px\)\{[\s\S]*?\.readings-wrap\{overflow:visible/.test(css),
    'sin desbordar, no hay nada que desplazar');
});

test('en la hoja de campo, toda la fila selecciona', () => {
  // La foto quedaba fuera del botón: ocupaba la mayor parte de la tarjeta y no
  // seleccionaba nada, así que había que apuntarle al borde del texto.
  const js = leer('../assets/campos.js');
  assert.match(js, /<button type="button" class="yoye-campo-fila[^"]*" data-slug=/,
    'la fila entera debe ser el botón');
  assert.ok(!js.includes('yoye-campo-card-body'), 'ya no debe haber un botón interior');
  const css = leer('../assets/campos.css');
  assert.match(css, /\.yoye-campo-mini\{[^}]*width:52px;height:52px/, 'la foto va como miniatura');
  assert.match(css, /\.yoye-campo-fila\{[^}]*min-height:72px/);
});

test('las lecturas se anotan directo: lo que se deja en blanco no se usó', () => {
  // Había que marcar "Medida" en cada una de las 9 filas antes de poder
  // escribir. En terreno, con guantes, eran 9 toques de más por calicata.
  const js = leer('../assets/calicatas.js');
  assert.ok(!js.includes('reading-state'), 'ya no existe el selector por fila');
  assert.match(js, /medida=isNumber\(h\)\|\|isNumber\(c\)\|\|isNumber\(t\)/);
  assert.match(js, /estado:medida\?'medida':'no_realizada'/);
  assert.match(js, /if\(!readings\.some\(r=>r\.estado==='medida'\)\)return \{error:'Anota al menos una lectura\.'\}/);
});
