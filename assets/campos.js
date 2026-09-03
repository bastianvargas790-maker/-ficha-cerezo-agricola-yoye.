(()=>{'use strict';
/* Shell multipredio de Agrícola Yoye.
   Se incluye en todas las páginas después de shared-auth.js.
   Aporta: pantalla Bienvenida, selector de campo en el header, menú/nav
   inferior adaptativo por alcance, hoja "Registrar", saludo por hora de
   Santiago, iniciales del encargado y chip de conexión.
   Expone en window: yoyeCampos (lista), yoyeActiveCampo() (objeto activo),
   y los eventos "yoye-campo-ready" / "yoye-campo-changed". */

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STORAGE_KEY='yoye_campo_activo';

const CAMPOS_FALLBACK=[
 {slug:'rinconada-plano',nombre:'Rinconada Plano',superficie_ha:78.44,cuarteles_referencia:34,cultivos_referencia:6,alcance:['riego','descoles','acido','aforos','calicatas'],encargado_nombre:'Rodrigo Abarca',encargado_iniciales:'RA',encargado_cargo:'Jefe de campo',foto_url:'assets/campos/rinconada-plano.png',orden:1},
 {slug:'rinconada-cerro',nombre:'Rinconada Cerro',superficie_ha:41.20,cuarteles_referencia:18,cultivos_referencia:3,alcance:['aforos','calicatas'],encargado_nombre:'Pedro Velásquez',encargado_iniciales:'PV',encargado_cargo:'Jefe de campo',foto_url:'assets/campos/rinconada-cerro.png',orden:2},
 {slug:'mirador-plano',nombre:'Mirador Plano',superficie_ha:56.90,cuarteles_referencia:19,cultivos_referencia:4,alcance:['aforos','calicatas'],encargado_nombre:'Joaquín Quiroga',encargado_iniciales:'JQ',encargado_cargo:'Jefe de campo',foto_url:'assets/campos/mirador-plano.png',orden:3},
 {slug:'mirador-cerro',nombre:'Mirador Cerro',superficie_ha:33.50,cuarteles_referencia:14,cultivos_referencia:2,alcance:['aforos','calicatas'],encargado_nombre:'Eladio León',encargado_iniciales:'EL',encargado_cargo:'Jefe de campo',foto_url:'assets/campos/mirador-cerro.png',orden:4}
];
const MODULO_LABEL={riego:'Riego',descoles:'Descoles',acido:'Ácido',aforos:'Aforos',calicatas:'Calicatas'};
/* Catálogo de cultivos por campo (referencia de contenido, cada campo mantiene
   su propia base de fichas/variedades). No depende de la base de datos. */
const CULTIVOS_POR_CAMPO={
  'rinconada-plano':['cerezo','nogal','naranjo','duraznero','nectarino','ciruelo'],
  'rinconada-cerro':['palto','naranjo','mandarina'],
  'mirador-plano':['cerezo','naranjo','duraznero','nectarino'],
  'mirador-cerro':['nogal','cerezo']
};
window.yoyeCultivosCampo=slug=>CULTIVOS_POR_CAMPO[slug]||CULTIVOS_POR_CAMPO['rinconada-plano'];

let db,session,profile;
let campos=CAMPOS_FALLBACK.slice();
let online=navigator.onLine;
let sheetOpen=null;

function root(){return location.pathname.split('/').filter(Boolean).length>1?'../':'./'}
function isRoot(){return root()==='./'}

function activeSlug(){return localStorage.getItem(STORAGE_KEY)||null}
function setActiveSlug(slug){localStorage.setItem(STORAGE_KEY,slug)}
function findCampo(slug){return campos.find(c=>c.slug===slug)}
function activeCampo(){
  const slug=activeSlug();
  return (slug&&findCampo(slug))||findCampo('rinconada-plano')||campos[0];
}
window.yoyeActiveCampo=activeCampo;

async function loadCampos(){
  if(!db)return;
  const {data,error}=await db.from('campos').select('*').eq('activo',true).order('orden');
  if(error||!data||!data.length)return;
  campos=data.map(c=>({
    id:c.id,slug:c.slug,nombre:c.nombre,
    superficie_ha:c.superficie_ha,cuarteles_referencia:c.cuarteles_referencia,cultivos_referencia:c.cultivos_referencia,
    alcance:c.alcance||[],encargado_perfil_id:c.jefe_id,
    encargado_nombre:c.encargado_nombre,encargado_iniciales:c.encargado_iniciales,encargado_cargo:c.encargado_cargo,
    foto_url:c.foto_url,orden:c.orden
  }));
  window.yoyeCampos=campos;
  await contarCuarteles();
}

/* cuarteles_referencia es la cifra de la ficha del campo, no un conteo: Rinconada
   Cerro trae 18 y Mirador Cerro 14, pero ninguno tiene cuarteles cargados todavía.
   La tarjeta prometía cuarteles que el desplegable de aforo no puede ofrecer, así
   que se muestra lo realmente cargado y la cifra de terreno queda como referencia
   solo cuando ambas difieren. */
async function contarCuarteles(){
  if(!db)return;
  const {data,error}=await db.from('cuarteles').select('campo_id').eq('activo',true);
  if(error||!Array.isArray(data))return;
  const porCampo={};
  data.forEach(r=>{if(r.campo_id)porCampo[r.campo_id]=(porCampo[r.campo_id]||0)+1});
  campos.forEach(c=>{c.cuarteles_cargados=c.id?(porCampo[c.id]||0):null});
  window.yoyeCampos=campos;
  if($('#yoyeBienvenidaGrid'))renderBienvenidaGrid();
}
function resumenCuarteles(c){
  const ref=c.cuarteles_referencia,n=c.cuarteles_cargados;
  if(n==null)return `${ref??'—'} cuarteles`;
  if(n===0)return ref?`sin cuarteles cargados · ${ref} en terreno`:'sin cuarteles cargados';
  if(ref!=null&&ref!==n)return `${n} de ${ref} cuarteles`;
  return `${n} cuarteles`;
}

function saludoSantiago(){
  const hora=Number(new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago',hour:'2-digit',hour12:false}).format(new Date()));
  if(hora<6||hora>=20)return'Buenas noches';
  if(hora<12)return'Buenos días';
  return'Buenas tardes';
}

function tieneModulo(campo,mod){return(campo.alcance||[]).includes(mod)}
function esCompleto(campo){return tieneModulo(campo,'riego')}

/* ---------- Bienvenida ---------- */
function renderBienvenida(){
  let el=$('#yoyeBienvenida');
  if(el)return el;
  el=document.createElement('div');
  el.id='yoyeBienvenida';
  el.className='yoye-shell yoye-bienvenida';
  el.innerHTML=`
    <div class="yb-glow" aria-hidden="true"></div>
    <div class="yb-inner">
      <div class="yb-logo-chip"><img src="${root()}assets/yoye-logo.png" alt="Agrícola Yoye"></div>
      <h1 class="yb-title">Bienvenido</h1>
      <p class="yb-copy">Elige el campo con el que vas a trabajar. Podrás cambiarlo cuando quieras desde el selector del header.</p>
      <div class="yb-heading-row"><span class="yb-eyebrow">Campos</span><span class="yb-rule"></span><span class="yb-count">${campos.length}</span></div>
      <div class="yb-grid" id="yoyeBienvenidaGrid"></div>
      <p class="yb-foot">Cada campo abre con su encargado, sus cuarteles y sus fichas de cultivo.</p>
    </div>`;
  document.body.append(el);
  return el;
}
function renderBienvenidaGrid(){
  const grid=$('#yoyeBienvenidaGrid');
  if(!grid)return;
  grid.innerHTML=campos.map((c,i)=>`
    <button type="button" class="yb-card" data-slug="${esc(c.slug)}" style="animation-delay:${(0.28+i*0.07).toFixed(2)}s">
      <span class="yb-photo">${c.foto_url?`<img src="${root()}${esc(c.foto_url)}" alt="${esc(c.nombre)}" loading="lazy">`:''}</span>
      <span class="yb-card-body">
        <span class="yb-card-name">${esc(c.nombre)}</span>
        <span class="yb-card-summary">${fmtHa(c.superficie_ha)} ha · ${resumenCuarteles(c)}</span>
        <span class="yb-pill">${esCompleto(c)?'Alcance completo':'Aforos · Calicatas'}</span>
      </span>
    </button>`).join('');
  $$('.yb-card',grid).forEach(btn=>btn.onclick=()=>elegirCampo(btn.dataset.slug,true));
}
function fmtHa(v){return v==null?'—':Number(v).toLocaleString('es-CL',{maximumFractionDigits:2})}

function mostrarBienvenida(){
  document.documentElement.classList.add('yoye-gate-open');
  renderBienvenida();
  renderBienvenidaGrid();
}
function ocultarBienvenida(){
  document.documentElement.classList.remove('yoye-gate-open');
  $('#yoyeBienvenida')?.remove();
}

function elegirCampo(slug,fueBienvenida){
  setActiveSlug(slug);
  ocultarBienvenida();
  document.dispatchEvent(new CustomEvent('yoye-campo-changed',{detail:{campo:activeCampo()}}));
  aplicarAlcance();
  renderHeaderSelector();
  cerrarHoja();
  if(fueBienvenida&&!isRoot())location.href=root();
}

/* ---------- Header: selector + conexión ---------- */
function headerHost(){
  return $('.top')||$('.app-topbar')||$('.qd-top')||$('.cal-top')||null;
}
function renderHeaderSelector(){
  const host=headerHost();
  if(!host||document.documentElement.classList.contains('yoye-gate-open'))return;
  host.classList.add('yoye-shell','yoye-header-injected');
  let pill=$('#yoyeCampoPill',host);
  if(!pill){
    pill=document.createElement('button');
    pill.type='button';
    pill.id='yoyeCampoPill';
    pill.className='yoye-campo-pill';
    pill.innerHTML='<span class="yoye-dot" aria-hidden="true"></span><span class="yoye-campo-nombre"></span><span class="yoye-caret" aria-hidden="true">▼</span>';
    pill.onclick=()=>abrirHoja('campos');
    host.append(pill);
  }
  $('.yoye-campo-nombre',pill).textContent=activeCampo().nombre;
  let conn=$('#yoyeConnBtn',host);
  if(!conn){
    conn=document.createElement('button');
    conn.type='button';
    conn.id='yoyeConnBtn';
    conn.className='yoye-conn-btn';
    conn.title='Alternar estado de conexión (demostración)';
    conn.onclick=()=>{online=!online;renderConn();document.dispatchEvent(new CustomEvent('yoye-online-changed',{detail:{online}}))};
    host.append(conn);
  }
  renderConn();
}
function renderConn(){
  const conn=$('#yoyeConnBtn');
  if(!conn)return;
  conn.textContent=online?'●':'◴';
  conn.classList.toggle('is-offline',!online);
  $$('.yoye-sync-chip').forEach(chip=>{
    chip.textContent=online?'✓ Sincronizado':'◴ Sin señal · cambios en cola';
    chip.classList.toggle('is-offline',!online);
  });
}

/* ---------- Hojas (bottom sheets) ---------- */
function sheetHost(){
  let host=$('#yoyeSheetHost');
  if(!host){
    host=document.createElement('div');
    host.id='yoyeSheetHost';
    host.className='yoye-shell';
    document.body.append(host);
  }
  return host;
}
function abrirHoja(nombre){
  sheetOpen=nombre;
  const host=sheetHost();
  if(nombre==='campos')host.innerHTML=hojaCamposHtml();
  else if(nombre==='registrar')host.innerHTML=hojaRegistrarHtml();
  else return;
  host.classList.add('is-open');
  host.querySelector('.yoye-sheet-backdrop')?.addEventListener('click',e=>{if(e.target===e.currentTarget)cerrarHoja()});
  bindHojaEvents(host);
}
function cerrarHoja(){
  sheetOpen=null;
  const host=$('#yoyeSheetHost');
  if(host){host.classList.remove('is-open');host.innerHTML=''}
}
function hojaCamposHtml(){
  const activo=activeCampo();
  return `<div class="yoye-sheet-backdrop"><div class="yoye-sheet">
    <span class="yoye-sheet-handle"></span>
    <h3 class="yoye-sheet-title">Campos</h3>
    <p class="yoye-sheet-copy">Toca un campo para abrirlo.</p>
    <div class="yb-grid yoye-sheet-grid">${campos.map(c=>`
      <div class="yoye-campo-card ${c.slug===activo.slug?'is-active':''}">
        <span class="yb-photo">${c.foto_url?`<img src="${root()}${esc(c.foto_url)}" alt="${esc(c.nombre)}" loading="lazy">`:''}</span>
        <button type="button" class="yoye-campo-card-body" data-slug="${esc(c.slug)}">
          <span class="yoye-campo-card-head"><span class="yb-card-name">${esc(c.nombre)}</span>${c.slug===activo.slug?'<span class="yoye-check">✓</span>':''}</span>
          <span class="yb-card-summary">${fmtHa(c.superficie_ha)} ha · ${resumenCuarteles(c)}</span>
          <span class="yoye-campo-modulos">${(c.alcance||[]).map(m=>MODULO_LABEL[m]||m).join(' · ')}</span>
        </button>
      </div>`).join('')}</div>
  </div></div>`;
}
function registrosDisponibles(campo){
  const items=[];
  if(tieneModulo(campo,'riego'))items.push({id:'riego',g:'💧',t:'Riego',d:'ETo, Kc, horas y caudal real',href:root()+'cerezo/#riego'});
  items.push({id:'calicata',g:'🪨',t:'Calicata',d:'Perfiles H %, CE y T °C',href:root()+'calicatas/registro-v16.html'});
  items.push({id:'aforo',g:'⌁',t:'Aforo',d:'Presiones y 16 emisores',href:null});
  return items;
}
function hojaRegistrarHtml(){
  const campo=activeCampo();
  const registros=registrosDisponibles(campo);
  return `<div class="yoye-sheet-backdrop"><div class="yoye-sheet">
    <span class="yoye-sheet-handle"></span>
    <h3 class="yoye-sheet-title">Registrar en terreno</h3>
    <p class="yoye-sheet-copy">Elige qué vas a registrar en ${esc(campo.nombre)}.</p>
    <div class="yoye-registro-list">${registros.map(r=>`
      <button type="button" class="yoye-registro-item" data-registro="${r.id}" ${r.href?`data-href="${esc(r.href)}"`:''}>
        <span class="yoye-registro-icon">${r.g}</span>
        <span><span class="yoye-registro-title">${esc(r.t)}</span><span class="yoye-registro-desc">${esc(r.d)}</span></span>
      </button>`).join('')}</div>
  </div></div>`;
}
function bindHojaEvents(host){
  $$('[data-slug]',host).forEach(el=>el.onclick=()=>elegirCampo(el.dataset.slug,false));
  $$('[data-registro]',host).forEach(el=>el.onclick=()=>{
    if(el.dataset.registro==='aforo'){cerrarHoja();window.yoyeAbrirAforo?.();return}
    if(el.dataset.href){cerrarHoja();location.href=el.dataset.href}
  });
}

/* ---------- Wizard Aforo ----------
   La implementación real (4 pasos, guardado en aforos/mediciones_aforo con
   cola offline) vive en assets/aforo.js y se expone como window.yoyeAbrirAforo. */

/* ---------- Paneles (lista) ---------- */
function esPaneles(){return /\/paneles\//.test(location.pathname)}
function panelesData(){
  return [
    {mod:'riego',icon:'💧',k:'Temporada',t:'Dashboard general',d:'Riego, ETc y estado del campo',href:root()+'cerezo/#database'},
    {mod:'acido',icon:'☢️',k:'Aplicaciones',t:'Ácido peracético',d:'Aplicado, pendiente y consumo',href:root()+'control-acido/#acido'},
    {mod:'descoles',icon:'🚰',k:'Mantención',t:'Descoles',d:'Avance y estado por sector',href:root()+'control-acido/#descole'},
    {mod:'aforos',icon:'⌁',k:'Uniformidad',t:'Aforos',d:'CU, presión y sectores críticos',href:root()+'aforo-rinconada/'},
    {mod:'calicatas',icon:'🪨',k:'Monitoreo del suelo',t:'Calicatas',d:'H %, CE mS/cm y T °C',href:root()+'calicatas/#historyView'}
  ];
}
function aplicarPaneles(){
  if(!esPaneles())return;
  const campo=activeCampo();
  const host=$('#yoyePanelesList');
  if(!host)return;
  const items=panelesData().filter(p=>tieneModulo(campo,p.mod));
  host.innerHTML=items.map(p=>`
    <a class="yoye-panel-item" href="${esc(p.href)}">
      <span class="yoye-panel-icon">${p.icon}</span>
      <span><span class="yoye-panel-kicker">${esc(p.k)}</span><span class="yoye-panel-title">${esc(p.t)}</span><span class="yoye-panel-desc">${esc(p.d)}</span></span>
      <span class="yoye-panel-chevron">›</span>
    </a>`).join('');
  const sub=$('#yoyePanelesSub');
  if(sub)sub.textContent=esCompleto(campo)?`Todos los módulos disponibles en ${campo.nombre}.`:`${campo.nombre} solo tiene habilitado seguimiento de Aforos y Calicatas.`;
  const note=$('#yoyePanelesNote');
  if(note)note.hidden=esCompleto(campo);
}

/* ---------- Nav inferior ---------- */
function navItems(){
  const path=location.pathname;
  const activeId=/\/cuarteles\//.test(path)?'cuarteles':
    /\/paneles\//.test(path)?'paneles':
    /\/mas\//.test(path)?'mas':
    /\/(cerezo|ciruelo|duraznero|naranjo|nectarino|nogal|palto|mandarina)\//.test(path)&&location.hash==='#database'?'cuarteles':
    isRoot()?'inicio':'';
  return [
    {id:'inicio',t:'Inicio',g:'⌂',href:root()},
    {id:'cuarteles',t:'Cuarteles',g:'▦',href:root()+'cerezo/#database'},
    {id:'registrar',t:'Registrar',g:'＋',href:null},
    {id:'paneles',t:'Paneles',g:'⌁',href:root()+'paneles/'},
    {id:'mas',t:'Más',g:'•••',href:root()+'mas/'}
  ].map(n=>Object.assign(n,{active:n.id===activeId}));
}
function renderBottomNav(){
  if(document.documentElement.classList.contains('yoye-gate-open'))return;
  let nav=$('#yoyeBottomNav');
  if(!nav){
    nav=document.createElement('nav');
    nav.id='yoyeBottomNav';
    nav.className='yoye-shell yoye-bottom-nav';
    nav.setAttribute('aria-label','Navegación principal');
    document.body.append(nav);
    document.documentElement.classList.add('yoye-has-bottom-nav');
  }
  nav.innerHTML=navItems().map(n=>`
    <button type="button" class="yoye-nav-item ${n.active?'is-active':''} ${n.id==='registrar'?'is-center':''}" data-nav="${n.id}" ${n.href?`data-href="${esc(n.href)}"`:''}>
      <span class="yoye-nav-icon">${n.g}</span><span class="yoye-nav-label">${n.t}</span>
    </button>`).join('');
  $$('[data-nav]',nav).forEach(btn=>btn.onclick=()=>{
    if(btn.dataset.nav==='registrar'){abrirHoja('registrar');return}
    if(btn.dataset.href)location.href=btn.dataset.href;
  });
}

/* ---------- Menú adaptativo ---------- */
function aplicarAlcance(){
  const campo=activeCampo();
  document.documentElement.classList.toggle('yoye-campo-completo',esCompleto(campo));
  document.documentElement.classList.toggle('yoye-campo-reducido',!esCompleto(campo));
  if(isRoot())ocultarOperacionesHome(campo);
  renderBottomNav();
}
function ocultarOperacionesHome(campo){
  const heading=$('#operationsTitle');
  const opSection=heading?heading.closest('section'):null;
  const opGrid=opSection?opSection.nextElementSibling:null;
  if(opSection&&opSection.classList.contains('intro'))opSection.hidden=true;
  if(opGrid&&opGrid.classList.contains('grid'))opGrid.hidden=true;
  const calGrid=$('.grid[aria-label="Registro de terreno"]');
  if(calGrid)calGrid.hidden=true;
}

/* ---------- Perfil: iniciales y responsable ----------
   La identidad mostrada es SIEMPRE la de quien inició sesión, nunca la del
   encargado del campo. Antes se caía a campo.encargado_nombre cuando el perfil
   no traía nombre, así que la pantalla saludaba a Eladio León mientras el
   usuario autenticado era otro. En data-yoye-responsable era peor: ese valor
   se guarda, y el registro quedaba firmado por alguien que no lo hizo.
   El encargado del campo es un dato del campo y vive en su tarjeta. */
const ROLES={administrador:'Jefe de riego',editor:'Editor',solo_lectura:'Solo lectura'};
function usuarioNombre(){return profile?.nombre_completo||session?.user?.email||''}
function usuarioCargo(){return profile?.cargo||ROLES[profile?.rol]||'Equipo de campo'}
function usuarioIniciales(){
  const n=profile?.nombre_completo?.trim();
  if(n)return n.split(/\s+/).slice(0,2).map(p=>p[0]).join('').toUpperCase();
  const correo=session?.user?.email;
  return correo?correo[0].toUpperCase():'•';
}
function aplicarPerfil(){
  $$('.profile-icon').forEach(el=>{el.textContent=usuarioIniciales()});
  $$('[data-yoye-responsable]').forEach(el=>{el.value=usuarioNombre()});
}

/* ---------- Saludo (Inicio) ---------- */
function aplicarSaludoInicio(){
  if(!isRoot())return;
  const campo=activeCampo();
  const primerNombre=usuarioNombre().split(' ').slice(0,2).join(' ');
  let host=$('#yoyeSaludo');
  const intro=$('main.shell > .intro');
  if(!host&&intro){
    host=document.createElement('section');
    host.id='yoyeSaludo';
    host.className='yoye-shell yoye-saludo';
    intro.before(host);
  }
  if(!host)return;
  host.innerHTML=`<h2 class="yoye-saludo-title">${esc(saludoSantiago())},<br><span class="yoye-saludo-nombre">${esc(primerNombre||campo.nombre)}.</span></h2>
    <p class="yoye-saludo-sub">${esc(usuarioCargo())} · ${esc(campo.nombre)}</p>
    <span class="yoye-sync-chip"></span>`;
  renderConn();
}

/* ---------- Arranque ---------- */
function mount(){
  const slug=activeSlug();
  if(!slug){mostrarBienvenida();return}
  ocultarBienvenida();
  renderHeaderSelector();
  aplicarAlcance();
  aplicarPerfil();
  aplicarSaludoInicio();
  aplicarPaneles();
}

document.addEventListener('yoye-campo-changed',()=>{
  aplicarAlcance();
  aplicarPerfil();
  aplicarSaludoInicio();
  aplicarPaneles();
  renderHeaderSelector();
});

addEventListener('online',()=>{online=true;renderConn()});
addEventListener('offline',()=>{online=false;renderConn()});

addEventListener('yoye-auth-ready',async e=>{
  db=e.detail.client;session=e.detail.session;
  if(!session)return;
  try{
    const {data}=await db.from('perfiles').select('*').eq('id',session.user.id).maybeSingle();
    profile=data||null;
  }catch{}
  await loadCampos();
  window.yoyeCampos=campos;
  mount();
  document.dispatchEvent(new CustomEvent('yoye-campo-ready',{detail:{campo:activeCampo(),campos}}));
});

/* Páginas sin login propio (dashboards embebidos de solo lectura, ej.
   aforo-rinconada/ y control-acido/): no disparan yoye-auth-ready, así que
   montamos el shell igual con los datos de referencia y localStorage. */
function tieneSharedAuth(){return !!document.querySelector('script[src*="shared-auth"]')}
function mountSinAuth(){
  if(tieneSharedAuth())return;
  window.yoyeCampos=campos;
  mount();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountSinAuth);
else mountSinAuth();
})();
