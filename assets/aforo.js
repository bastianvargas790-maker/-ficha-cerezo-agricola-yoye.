(()=>{'use strict';
/* Wizard de Aforo (4 pasos: Identificación · Presiones · Emisores · Resultado).
   Guarda en public.aforos + public.mediciones_aforo (ya existen en Supabase,
   con RLS listo). Cola offline propia en IndexedDB, mismo patrón que
   assets/calicatas.js: guarda local primero, sincroniza cuando hay señal,
   estados pendiente/sincronizando/sincronizado/error con reintento exponencial. */

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uuid=()=>globalThis.crypto?.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:r&3|8;return v.toString(16)});
const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const isNum=v=>v!==null&&v!==''&&v!==undefined&&Number.isFinite(Number(v));

/* DB_VERSION 2: se agrega el store 'cuarteles' para la copia local por campo.
   Va en un store aparte y NO en 'queue' a propósito: syncQueue() recorre queue
   filtrando por status, y un registro sin status entraría a la cola de sincronización
   y haría fallar syncItem() al no tener .aforo. */
const DB_NAME='yoye-aforo-offline-v1',DB_VERSION=2,STORE='queue',STORE_CUARTELES='cuarteles';
let localDb;
function openLocalDb(){
  if(localDb)return Promise.resolve(localDb);
  if(!('indexedDB' in window))return Promise.reject(new Error('offline no disponible'));
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const d=req.result;
      if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE,{keyPath:'id'});
      if(!d.objectStoreNames.contains(STORE_CUARTELES))d.createObjectStore(STORE_CUARTELES,{keyPath:'id'});
    };
    req.onsuccess=()=>{localDb=req.result;resolve(localDb)};
    req.onerror=()=>reject(req.error);
  });
}
async function localPut(v,store=STORE){const d=await openLocalDb();return new Promise((res,rej)=>{const r=d.transaction(store,'readwrite').objectStore(store).put(v);r.onsuccess=()=>res(v);r.onerror=()=>rej(r.error)})}
async function localAll(store=STORE){const d=await openLocalDb();return new Promise((res,rej)=>{const r=d.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
async function localGet(id,store=STORE){const d=await openLocalDb();return new Promise((res,rej)=>{const r=d.transaction(store).objectStore(store).get(id);r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error)})}

const POSICIONES=['Inicio','1/3','2/3','Último'];
const LINEAS=['1ª línea','1/3 línea','2/3 línea','Última línea'];
const TIEMPO_ESTANDAR='36';
/* El orden es posición por posición y, dentro de cada una, línea por línea:
   así se llena en terreno y así está la planilla. */
function emisoresVacios(){
  const out=[];let idx=1;
  POSICIONES.forEach(posicion=>LINEAS.forEach(linea=>out.push({posicion,linea,indice:idx++,volumen_cc:'',tiempo_segundos:TIEMPO_ESTANDAR})));
  return out;
}
function indiceEmisor(posicion,linea){
  return POSICIONES.indexOf(posicion)*LINEAS.length+LINEAS.indexOf(linea);
}
function caudalLh(vol,seg){const v=Number(vol),s=Number(seg);return s>0&&v>=0?(v/s)*3.6:0}
function avg(arr){return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0}
/* Uniformidad igual que la planilla del campo: el caudal del 25 % de emisores
   más bajos dividido por el caudal medio. Es la uniformidad de distribución
   (Merriam & Keller), la que se usa en riego localizado, y es la que están
   calibrados los umbrales de DB_Config (90 / 80 / 70).
   Antes acá se calculaba el CU de Christiansen -- 1 menos la desviación media
   sobre el promedio -- que es otra métrica: con los mismos datos del cuartel 30
   daba 80,6 % donde la planilla daba 68,7 %, y con el mismo nombre y los mismos
   umbrales eso se lee como si el sector estuviera bien. */
function calcularResultado(emisores){
  const caudales=emisores.map(e=>caudalLh(e.volumen_cc,e.tiempo_segundos));
  const promedio=avg(caudales);
  const ordenados=[...caudales].sort((a,b)=>a-b);
  const n25=Math.max(1,Math.round(ordenados.length*0.25));
  const caudal25=avg(ordenados.slice(0,n25));
  const cu=promedio>0?Math.max(0,Math.min(100,caudal25/promedio*100)):0;
  const clasificacion=cu>=90?'Excelente':cu>=80?'Bueno':cu>=70?'Medio':'Bajo';
  return {promedio,caudal25,cu,clasificacion};
}

let db,session,profile;
let cuartelesCache={};
let sectoresCache={};
let syncRunning=false;

/* Cuarteles del campo activo.
   Nunca se cae a "todos los cuarteles de la organización": ese respaldo mezclaba
   los cuarteles de los otros campos cada vez que el campo activo no devolvía
   filas -- por ejemplo Mirador Cerro y Rinconada Cerro, que hoy existen como
   campo pero todavía no tienen cuarteles cargados. La separación por campo es
   el punto del modelo multipredio, así que un campo sin cuarteles muestra la
   lista vacía y su aviso, no los cuarteles de otro.
   Sin conexión se usa la copia local de ESE campo, guardada por slug. */
async function cuartelesDeCampo(campo){
  const key=campo.slug||campo.id;
  if(!key)return [];
  if(cuartelesCache[key])return cuartelesCache[key];
  let list=[];
  if(db&&campo.id){
    try{
      const r=await db.from('cuarteles').select('id,codigo,cuartel,unidades_aforo').eq('activo',true).eq('campo_id',campo.id).order('codigo');
      if(!r.error&&Array.isArray(r.data)){
        list=r.data;
        try{await localPut({id:key,list},STORE_CUARTELES)}catch{}
      }
    }catch{}
  }
  if(!list.length){
    try{const cached=await localGet(key,STORE_CUARTELES);if(cached?.list?.length)list=cached.list}catch{}
  }
  cuartelesCache[key]=list;
  return list;
}

/* Sectores de aforo del campo activo (public.sectores_aforo).
   La numeración de aforo NO es la de riego: un cuartel de riego puede tener dos
   válvulas que se aforan por separado (C-20 se afora como 18 y 20; C-40 como
   "40 A" y "40 B"), y la planilla de cada campo valida esa columna contra su
   propio catálogo. Por eso la lista viene de la base y no se escribe a mano.
   Se guarda con el mismo store que los cuarteles, bajo otra llave, para que la
   app siga preguntando el sector correcto sin señal. */
async function sectoresDeCampo(campo){
  const key=campo.slug||campo.id;
  if(!key)return [];
  if(sectoresCache[key])return sectoresCache[key];
  const cacheKey='sectores:'+key;
  let list=[];
  if(db&&campo.id){
    try{
      const r=await db.from('sectores_aforo').select('id,cuartel_id,codigo,nombre,orden').eq('activo',true).eq('campo_id',campo.id).order('orden');
      if(!r.error&&Array.isArray(r.data)){
        list=r.data;
        try{await localPut({id:cacheKey,list},STORE_CUARTELES)}catch{}
      }
    }catch{}
  }
  if(!list.length){
    try{const cached=await localGet(cacheKey,STORE_CUARTELES);if(cached?.list?.length)list=cached.list}catch{}
  }
  sectoresCache[key]=list;
  return list;
}

/* El sector que quedó elegido para este aforo: el único del cuartel cuando hay
   uno solo, o el que marcó el evaluador cuando hay varios. */
function sectorElegido(){
  const sectores=sectoresDelCuartel();
  if(sectores.length===1)return sectores[0];
  return sectores.find(s=>s.codigo===state.sector)||null;
}

function sectoresDelCuartel(){
  if(!state?.cuartel_id)return [];
  return sectoresActuales.filter(s=>s.cuartel_id===state.cuartel_id);
}

/* La raíz de la app se deduce de la URL de este mismo archivo, que siempre
   cuelga de assets/. Contar segmentos del path fallaba según dónde estuviera
   publicado el sitio: en GitHub Pages hay una carpeta de proyecto de por medio,
   pero servido en la raíz de un dominio los enlaces de Paneles apuntaban a
   /paneles/cuarteles/... y no existían. */
const RAIZ=(()=>{
  const s=[...document.scripts].find(x=>/assets\/(campos|aforo)\.js/.test(x.src||''));
  const m=s&&s.src&&s.src.match(/^(.*\/)assets\/(?:campos|aforo)\.js/);
  if(m){try{return new URL(m[1],location.href).pathname}catch{}}
  return location.pathname.replace(/[^/]*$/,'');
})();
function root(){return RAIZ}

let state=null;
function estadoInicial(campo){
  return {
    id:null,editando:null,
    cuartel_id:'',sector:'',equipo_riego:'',caseta:'',
    temporada:new Date().getFullYear(),fecha_evaluacion:localDate(),
    evaluador_nombre:profile?.nombre_completo||campo.encargado_nombre||session?.user?.email||'',
    cantidad_valvulas:0,tipo_linea:'',
    presiones:Array.from({length:5},()=>({entrada:'',salida:''})),
    emisores:emisoresVacios(),
    observaciones:''
  };
}

/* El teclado del teléfono en español pone coma decimal y un campo numérico del navegador
   la descarta en silencio: una presión de "1,2" bar llegaba como 12. Los campos
   medidos son de texto con teclado decimal, y la coma se convierte acá. */
const MEDIDOS=new Set(['volumen_cc','tiempo_segundos','presion_entrada','presion_salida']);
const decimal=v=>String(v??'').trim().replace(/\s+/g,'').replace(',','.');
function readStepInputs(host){
  if(!state)return;
  $$('[data-f]',host).forEach(el=>{
    const f=el.dataset.f;
    const valor=MEDIDOS.has(f)?decimal(el.value):el.value;
    if(f==='volumen_cc'||f==='tiempo_segundos'){
      const i=Number(el.dataset.i);
      if(state.emisores[i])state.emisores[i][f]=valor;
    }else if(f==='presion_entrada'||f==='presion_salida'){
      const i=Number(el.dataset.i);
      if(state.presiones[i])state.presiones[i][f==='presion_entrada'?'entrada':'salida']=valor;
    }else state[f]=el.value;
  });
}

/* Un cuartel puede tener más de un sector de aforo: válvulas con sistema propio
   que se aforan por separado aunque compartan cuartel de riego (C-20 se afora
   como 18 y 20; C-40 como "40 A" y "40 B"). Los sectores viven en
   public.sectores_aforo, uno por fila del catálogo DB_Cuarteles de la planilla
   de cada campo, y se ofrecen como lista cerrada: el código elegido es el que
   viaja a la hoja, que valida esa columna contra ese mismo catálogo. Escrito a
   mano, "40 A" y "40A" quedan como dos sectores distintos y la planilla rechaza
   la fila.
   Con un solo sector no se pregunta nada: la función de sincronización lo
   resuelve sola. Sin sectores cargados (o sin señal y sin copia local) el campo
   vuelve a ser texto libre para no bloquear el registro en terreno. */
function campoSector(){
  const sectores=sectoresDelCuartel();
  if(!state.cuartel_id||sectores.length===1)return '';
  if(!sectores.length)
    return `<div class="yoye-field"><label>Sector</label><div class="yoye-input"><input data-f="sector" type="text" placeholder="Ej. norte" value="${esc(state.sector)}"></div></div>`;
  return `<div class="yoye-field"><label>Sector de aforo *</label><div class="yoye-input"><select data-f="sector">
    <option value="">¿Cuál sector se aforó?</option>
    ${sectores.map(s=>`<option value="${esc(s.codigo)}" ${state.sector===s.codigo?'selected':''}>${esc(s.nombre||s.codigo)}</option>`).join('')}
  </select></div><p class="yoye-hint">Este cuartel tiene ${sectores.length} sectores de aforo con válvula propia.</p></div>`;
}

function pasoIdentificacion(campo,cuarteles){
  return `
    <div class="yoye-form-card">
      <div class="yoye-field"><label>Cuartel *</label><div class="yoye-input"><select data-f="cuartel_id">
        <option value="">Selecciona un cuartel de ${esc(campo.nombre)}</option>
        ${cuarteles.map(c=>`<option value="${esc(c.id)}" ${state.cuartel_id===c.id?'selected':''}>${esc(c.codigo||c.cuartel)}</option>`).join('')}
      </select></div>${!cuarteles.length?`<p class="yoye-hint">${navigator.onLine?'Este campo aún no tiene cuarteles cargados en la base.':'Sin conexión y sin copia local de este campo. Ábrelo una vez con señal para poder aforarlo después sin conexión.'}</p>`:''}</div>
      ${campoSector()}
      <div class="yoye-field"><label>Equipo de riego</label><div class="yoye-input"><input data-f="equipo_riego" type="text" placeholder="Ej. equipo 3" value="${esc(state.equipo_riego)}"></div></div>
      <div class="yoye-field"><label>Caseta</label><div class="yoye-input"><input data-f="caseta" type="text" placeholder="Opcional" value="${esc(state.caseta)}"></div></div>
      <div class="yoye-field"><label>Fecha de evaluación *</label><div class="yoye-input"><input data-f="fecha_evaluacion" type="date" value="${esc(state.fecha_evaluacion)}"></div></div>
      <div class="yoye-field"><label>Temporada *</label><div class="yoye-input"><input data-f="temporada" type="number" inputmode="numeric" min="2000" max="2100" value="${esc(state.temporada)}"></div></div>
      <div class="yoye-field"><label>Evaluador</label><div class="yoye-input"><input data-f="evaluador_nombre" type="text" value="${esc(state.evaluador_nombre)}"></div></div>
      <div class="yoye-field"><label>Cantidad de válvulas</label><div class="yoye-input"><input data-f="cantidad_valvulas" type="number" inputmode="numeric" min="0" max="20" value="${esc(state.cantidad_valvulas)}"></div></div>
      <div class="yoye-field"><label>Tipo de línea</label><div class="yoye-input"><select data-f="tipo_linea">
        <option value="">Sin especificar</option>
        ${['Cinta','Manguera','Polietileno','Otro'].map(o=>`<option ${state.tipo_linea===o?'selected':''}>${o}</option>`).join('')}
      </select></div></div>
    </div>`;
}
/* Presiones: una fila por válvula, entrada y salida, igual que la planilla.
   Antes era un solo par de números; en terreno se miden hasta cinco válvulas y
   el promedio se calcula sobre las que efectivamente se midieron. */
function presionesPromedio(lista){
  const src=lista||state.presiones;
  const ent=src.map(p=>Number(p.entrada)).filter(v=>Number.isFinite(v)&&v>0);
  const sal=src.map(p=>Number(p.salida)).filter(v=>Number.isFinite(v)&&v>0);
  const entrada=ent.length?avg(ent):null, salida=sal.length?avg(sal):null;
  const perdida=(entrada!==null&&salida!==null)?entrada-salida:null;
  const pct=(perdida!==null&&entrada>0)?perdida/entrada*100:null;
  return {entrada,salida,perdida,pct,nEntrada:ent.length,nSalida:sal.length};
}
function fmt(v,dec=2){return v===null||v===undefined?'—':Number(v).toLocaleString('es-CL',{minimumFractionDigits:dec,maximumFractionDigits:dec})}

function pasoPresiones(){
  const r=presionesPromedio();
  const estado=r.entrada===null?'Sin dato de entrada'
    :r.salida===null?'Sin dato de salida'
    :r.pct<=20?'Pérdida aceptable':'Revisar presión';
  const filas=state.presiones.map((p,i)=>`<tr>
      <th scope="row">Válvula ${i+1}</th>
      <td><input data-f="presion_entrada" data-i="${i}" type="text" inputmode="decimal" autocomplete="off" pattern="[0-9]*[.,]?[0-9]*" placeholder="—" value="${esc(p.entrada)}"></td>
      <td><input data-f="presion_salida" data-i="${i}" type="text" inputmode="decimal" autocomplete="off" pattern="[0-9]*[.,]?[0-9]*" placeholder="—" value="${esc(p.salida)}"></td>
    </tr>`).join('');
  return `
    <div class="yoye-af-card">
      <div class="yoye-af-head">
        <div><span class="yoye-af-paso">Presiones</span>
        <h3>Registro de presiones <small>(bar)</small></h3></div>
        <span class="yoye-af-formula">entrada − salida = pérdida</span>
      </div>
      <div class="yoye-af-tabla-wrap">
        <table class="yoye-af-tabla">
          <thead><tr><th>Válvula</th><th>Entrada</th><th>Salida</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <div class="yoye-af-resumen">
        <div><span>Entrada promedio</span><b>${fmt(r.entrada)}</b></div>
        <div><span>Salida promedio</span><b>${fmt(r.salida)}</b></div>
        <div><span>Pérdida</span><b>${fmt(r.perdida)}</b></div>
      </div>
      <p class="yoye-af-estado">${esc(estado)}</p>
      <p class="yoye-af-nota">Anota las válvulas que alcanzaste a medir; el promedio usa solo esas. Si hoy solo tomaste presiones, guarda igual y completa el resto después con Editar.</p>
    </div>`;
}

/* Emisores: cuatro bloques, uno por posición de la línea, y dentro de cada uno
   una columna por línea. Es la misma grilla de la planilla, para que quien
   afora copie de arriba abajo sin traducir nada. */
function bloqueEmisores(posicion){
  const idx=l=>indiceEmisor(posicion,l);
  const celda=(l,campo,ph)=>{
    const i=idx(l),e=state.emisores[i];
    return `<td><input data-f="${campo}" data-i="${i}" type="text" inputmode="decimal" autocomplete="off" pattern="[0-9]*[.,]?[0-9]*" placeholder="${ph}" value="${esc(e[campo])}"></td>`;
  };
  const caudal=l=>{
    const e=state.emisores[idx(l)];
    return `<td class="yoye-af-calc">${isNum(e.volumen_cc)&&isNum(e.tiempo_segundos)&&Number(e.tiempo_segundos)>0?caudalLh(e.volumen_cc,e.tiempo_segundos).toFixed(1):'—'}</td>`;
  };
  return `<div class="yoye-af-bloque">
    <div class="yoye-af-bloque-tit">${esc(posicion==='Inicio'||posicion==='Último'?posicion:posicion+' de la línea')}</div>
    <div class="yoye-af-tabla-wrap">
      <table class="yoye-af-tabla">
        <thead><tr><th>Dato</th>${LINEAS.map(l=>`<th>${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>
          <tr><th scope="row">Volumen (cc)</th>${LINEAS.map(l=>celda(l,'volumen_cc','cc')).join('')}</tr>
          <tr><th scope="row">Tiempo (s)</th>${LINEAS.map(l=>celda(l,'tiempo_segundos','s')).join('')}</tr>
          <tr class="yoye-af-fila-calc"><th scope="row">Caudal (L/h)</th>${LINEAS.map(caudal).join('')}</tr>
        </tbody>
      </table>
    </div>
  </div>`;
}
function pasoEmisores(){
  const faltan=state.emisores.filter(e=>!isNum(e.volumen_cc)).length;
  return `
    <div class="yoye-af-card">
      <div class="yoye-af-head">
        <div><span class="yoye-af-paso">Emisores</span>
        <h3>Aforo de emisores</h3></div>
        <span class="yoye-af-formula">cc ÷ segundos × 3,6</span>
      </div>
      <p class="yoye-af-nota">Ingresa cada posición por línea, de izquierda a derecha. El tiempo viene con 36 segundos, cámbialo si mediste distinto. Lo que quede en blanco no se guarda: el aforo queda marcado como incompleto y se termina después.</p>
      ${POSICIONES.map(bloqueEmisores).join('')}
      <p class="yoye-af-estado">${faltan?`Faltan ${faltan} de 16 volúmenes`:'Las 16 posiciones están completas'}</p>
    </div>`;
}
function pasoResultado(){
  const completos=emisoresCompletos(state.emisores);
  const hayTodos=completos.length===16;
  const r=hayTodos?calcularResultado(state.emisores):null;
  const kpi=(t,v,cls='')=>`<div class="yoye-resultado-kpi ${cls}"><span>${t}</span><strong>${v}</strong></div>`;
  const grilla=r
    ? `<div class="yoye-resultado-grid">
        ${kpi('Caudal promedio',r.promedio.toFixed(1))}
        ${kpi('Caudal 25% más bajo',r.caudal25.toFixed(1))}
        ${kpi('Coeficiente de uniformidad',r.cu.toFixed(1)+'%','clasificacion-'+r.clasificacion.toLowerCase())}
        ${kpi('Clasificación',esc(r.clasificacion),'clasificacion-'+r.clasificacion.toLowerCase())}
      </div>`
    : `<p class="yoye-af-nota">El caudal y la uniformidad se calculan cuando estén las 16 mediciones: con menos describirían un pedazo del sector y se leerían como si fueran de todo. Van ${completos.length} de 16.</p>`;
  const falta=faltantes();
  return `
    <div class="yoye-af-card">
      <div class="yoye-af-head"><div><span class="yoye-af-paso">Resultado</span>
        <h3>Resumen del aforo</h3></div>
        <span class="yoye-af-formula">cc ÷ segundos × 3,6</span></div>
      ${grilla}
      ${falta.length?`<p class="yoye-af-estado">Queda por tomar: ${esc(falta.join(' · '))}. Se puede guardar igual.</p>`:'<p class="yoye-af-estado">Aforo completo.</p>'}
      <div class="yoye-field"><label>Hallazgos / observaciones</label><div class="yoye-input"><textarea data-f="observaciones" placeholder="Fugas, baja presión, filtro sucio…">${esc(state.observaciones)}</textarea></div></div>
    </div>`;
}

let cuartelesActuales=[],sectoresActuales=[];
/* Una sola página, como el formulario de calicatas: todo a la vista y se
   rellena en el orden que cada uno pueda. El asistente por pasos obligaba a
   completar presiones para llegar a emisores, y en terreno eso no se cumple:
   las presiones de las válvulas se van tomando mientras se avanza. */
function renderCuerpo(host,campo){
  const body=$('#yoyeAforoBody',host);
  if(!body)return;
  body.innerHTML=pasoIdentificacion(campo,cuartelesActuales)+pasoPresiones()+pasoEmisores()+pasoResultado();
  // El sector depende del cuartel elegido, así que se vuelve a dibujar al
  // cambiarlo. Se limpia el sector anterior: pertenecía al cuartel previo.
  $('[data-f="cuartel_id"]',body)?.addEventListener('change',e=>{
    readStepInputs(host);
    state.cuartel_id=e.target.value;
    state.sector='';
    renderCuerpo(host,campo);
  });
  // El resumen se recalcula al escribir, sin redibujar todo el formulario.
  body.addEventListener('input',()=>{
    readStepInputs(host);
    clearTimeout(renderCuerpo._t);
    renderCuerpo._t=setTimeout(()=>{
      const tarjetas=$$('.yoye-af-card',body);
      const ultima=tarjetas[tarjetas.length-1];
      if(ultima&&document.activeElement?.closest('.yoye-af-card')!==ultima){
        ultima.outerHTML=pasoResultado();
      }
    },400);
  });
  const btn=$('#yoyeAforoNext',host);
  if(btn)btn.textContent=state.editando?'Guardar cambios':'Guardar aforo';
}

/* Lo único que se exige es lo que la base no admite vacío: cuartel, fecha y
   temporada, más el sector cuando el cuartel tiene varios. Presiones y
   emisores quedan libres: en terreno el aforo se va llenando por partes -- a
   veces se pasa a tomar solo las presiones y las mediciones vienen después --
   y un formulario que no deja guardar a medias obliga a anotar en papel. */
function validar(){
  if(!state.cuartel_id)return 'Selecciona un cuartel.';
  if(sectoresDelCuartel().length>1&&!state.sector)return 'Este cuartel tiene más de un sector de aforo: indica cuál se aforó.';
  if(!state.fecha_evaluacion)return 'Indica la fecha de evaluación.';
  if(!isNum(state.temporada))return 'Indica la temporada.';
  return null;
}
/* Qué le falta a este aforo para estar completo. Se usa para marcarlo en la
   lista y para avisarlo al guardar, sin impedir que se guarde. */
function emisoresCompletos(emisores){
  return (emisores||[]).filter(e=>isNum(e.volumen_cc)&&isNum(e.tiempo_segundos)&&Number(e.tiempo_segundos)>0);
}
function faltantes(st){
  const e=st||state,out=[];
  const p=presionesPromedio(e.presiones);
  if(p.entrada===null)out.push('presión de entrada');
  if(p.salida===null)out.push('presión de salida');
  const n=emisoresCompletos(e.emisores).length;
  if(n<16)out.push(`${16-n} de 16 mediciones de emisor`);
  return out;
}

async function guardarAforo(host){
  const completos=emisoresCompletos(state.emisores);
  const hayTodos=completos.length===16;
  /* Caudal y uniformidad solo cuando están las 16: con menos, el promedio y el
     CU describirían un pedazo del sector y se leerían como si fueran del
     sector entero. Se dejan vacíos hasta que el aforo esté completo. */
  const r=hayTodos?calcularResultado(state.emisores):null;
  const p=presionesPromedio();
  const entradas=state.presiones.map(x=>Number(x.entrada)).filter(v=>Number.isFinite(v)&&v>0);
  const salidas=state.presiones.map(x=>Number(x.salida)).filter(v=>Number.isFinite(v)&&v>0);
  const id=state.id||uuid();
  const org=profile?.organizacion_id;
  const aforo={
    id,organizacion_id:org,cuartel_id:state.cuartel_id,
    sector:sectorElegido()?.codigo||state.sector||null,
    sector_aforo_id:sectorElegido()?.id||null,
    equipo_riego:state.equipo_riego||null,caseta:state.caseta||null,
    temporada:Number(state.temporada),fecha_evaluacion:state.fecha_evaluacion,
    evaluador_id:state.editando?.evaluador_id||session.user.id,
    evaluador_nombre:state.evaluador_nombre||session.user.email,
    cantidad_valvulas:Number(state.cantidad_valvulas||0)||Math.max(entradas.length,salidas.length),
    tipo_linea:state.tipo_linea||null,
    presion_entrada_prom:p.entrada,presion_salida_prom:p.salida,perdida_carga:p.perdida,
    estado_presion:p.pct===null?null:(p.pct<=20?'Aceptable':'Revisar'),
    presiones_entrada:entradas,presiones_salida:salidas,
    caudal_promedio:r?r.promedio:null,caudal_25:r?r.caudal25:null,
    coeficiente_uniformidad:r?r.cu:null,clasificacion:r?r.clasificacion:null,
    observaciones_rapidas:[],observaciones:state.observaciones||null,
    latitud:null,longitud:null,fotografia_url:null,activo:true,
    created_by:state.editando?.created_by||session.user.id,updated_by:session.user.id
  };
  /* Solo viajan las posiciones medidas: la tabla de mediciones no admite
     volumen ni tiempo vacíos, así que una fila a medias no se guarda. */
  const previas=state.editando?.mediciones||[];
  const mediciones=completos.map(e=>{
    const vieja=previas.find(m=>Number(m.indice)===Number(e.indice));
    return {id:vieja?.id||uuid(),organizacion_id:org,aforo_id:id,
      posicion:e.posicion,linea:e.linea,indice:e.indice,
      volumen_cc:Number(e.volumen_cc),tiempo_segundos:Number(e.tiempo_segundos),
      caudal_l_h:caudalLh(e.volumen_cc,e.tiempo_segundos)};
  });
  const vivas=new Set(mediciones.map(m=>m.id));
  const medicionesBorradas=previas.filter(m=>m.id&&!vivas.has(m.id)).map(m=>m.id);
  const item={id,status:'pending',attempts:0,nextAttemptAt:0,
    createdAt:state.editando?.createdAt||new Date().toISOString(),
    aforo,mediciones,medicionesBorradas};
  await localPut(item);
  actualizarEstadoGuardado(host,'Guardado en el dispositivo. Sincronizando…');
  if(navigator.onLine)syncQueue(host);
  return item;
}

async function syncItem(item){
  if(!db||!session)throw new Error('Sesión no disponible');
  let r=await db.from('aforos').upsert(item.aforo,{onConflict:'id'});
  if(r.error)throw r.error;
  if(item.mediciones.length){
    r=await db.from('mediciones_aforo').upsert(item.mediciones,{onConflict:'id'});
    if(r.error)throw r.error;
  }
  if(item.medicionesBorradas?.length){
    r=await db.from('mediciones_aforo').delete().in('id',item.medicionesBorradas).eq('aforo_id',item.aforo.id);
    if(r.error)throw r.error;
  }
  try{
    await db.functions.invoke('sync-aforo-rinconada',{body:{aforo_id:item.aforo.id}});
  }catch(sheetsError){
    console.warn('No se pudo sincronizar con Google Sheets (el aforo ya quedó guardado en Supabase)',sheetsError);
  }
}
async function syncQueue(host){
  if(syncRunning||!navigator.onLine||!db||!session)return;
  syncRunning=true;
  try{
    const items=(await localAll()).filter(x=>x.status!=='synced'&&(x.nextAttemptAt||0)<=Date.now());
    for(const item of items){
      item.status='syncing';await localPut(item);
      if(host)actualizarEstadoGuardado(host,'Sincronizando…');
      try{
        await syncItem(item);
        item.status='synced';item.syncedAt=new Date().toISOString();item.error=null;item.nextAttemptAt=0;
        if(host)actualizarEstadoGuardado(host,'✓ Sincronizado');
      }catch(e){
        item.status='error';item.attempts=(item.attempts||0)+1;item.error=e.message||'Error de sincronización';
        item.nextAttemptAt=Date.now()+Math.min(15*60*1000,Math.max(10*1000,2**item.attempts*1000));
        if(host)actualizarEstadoGuardado(host,'Sin señal · quedó en cola, se reintentará',true);
      }
      await localPut(item);
    }
  }finally{syncRunning=false}
}
function actualizarEstadoGuardado(host,texto,error=false){
  let el=$('#yoyeAforoEstado',host);
  if(!el)return;
  el.textContent=texto;
  el.className='yoye-pending-badge'+(error?' is-error':'');
}

function cerrarModal(){$('#yoyeAforoModal')?.remove()}

/* Últimos aforos del campo, para corregir o descartar sin salir de la página,
   igual que "Últimas calicatas". Los que están a medias se marcan con lo que
   les falta. */
let recientes=[];
async function cargarRecientes(host,campo){
  const cont=$('#yoyeAforoRecientes',host);
  if(!cont)return;
  const ids=new Set(cuartelesActuales.map(c=>c.id));
  let remotos=[];
  if(db&&session&&navigator.onLine&&ids.size){
    try{
      const {data,error}=await db.from('aforos')
        .select('*').in('cuartel_id',[...ids]).eq('activo',true)
        .order('created_at',{ascending:false}).limit(10);
      if(error)throw error;
      const lista=data||[];
      let med=[];
      if(lista.length){
        const rm=await db.from('mediciones_aforo').select('*').in('aforo_id',lista.map(a=>a.id));
        if(!rm.error)med=rm.data||[];
      }
      remotos=lista.map(a=>({...a,mediciones:med.filter(m=>m.aforo_id===a.id)}));
    }catch(e){console.warn('No se pudieron cargar los últimos aforos',e)}
  }
  let locales=[];
  try{locales=(await localAll()).filter(i=>i.status!=='synced'&&i.aforo)
    .map(i=>({...i.aforo,mediciones:i.mediciones||[],localItem:i}))}catch{}
  const vistos=new Set(locales.map(x=>x.id));
  recientes=[...locales,...remotos.filter(x=>!vistos.has(x.id))].slice(0,10);
  renderRecientes(host,campo);
}
function estadoDeAforo(a){
  const presiones=aPresiones(a);
  const emisores=aEmisores(a.mediciones);
  return faltantes({presiones,emisores});
}
function renderRecientes(host,campo){
  const cont=$('#yoyeAforoRecientes',host);
  if(!cont)return;
  if(!recientes.length){cont.innerHTML='<p class="yoye-af-nota">Todavía no hay aforos registrados en este campo.</p>';return}
  const nombre=id=>cuartelesActuales.find(c=>c.id===id)?.codigo||'—';
  cont.innerHTML=recientes.map(a=>{
    const falta=estadoDeAforo(a);
    return `<div class="yoye-af-reciente">
      <div class="yoye-af-reciente-datos">
        <strong>${esc(nombre(a.cuartel_id))}${a.sector?' · '+esc(a.sector):''}</strong>
        <span>${esc(a.fecha_evaluacion||'')}${a.coeficiente_uniformidad!=null?` · CU ${fmt(a.coeficiente_uniformidad,1)}%`:''}</span>
        ${falta.length?`<small class="yoye-af-incompleto">Incompleto: falta ${esc(falta.join(' · '))}</small>`:'<small>Completo</small>'}
        ${a.localItem?'<small class="yoye-af-incompleto">Pendiente de subir</small>':''}
      </div>
      <div class="yoye-af-reciente-acciones">
        <button type="button" class="btn-secondary" data-editar="${esc(a.id)}">Editar</button>
        <button type="button" class="btn-secondary" data-descartar="${esc(a.id)}">Descartar</button>
      </div>
    </div>`;
  }).join('');
  $$('[data-editar]',cont).forEach(b=>b.onclick=()=>editarAforo(host,campo,b.dataset.editar));
  $$('[data-descartar]',cont).forEach(b=>b.onclick=()=>descartarAforo(host,campo,b.dataset.descartar));
}
/* De lo guardado de vuelta al formulario. */
function aPresiones(a){
  const ent=a.presiones_entrada||[],sal=a.presiones_salida||[];
  const n=Math.max(5,ent.length,sal.length);
  return Array.from({length:n},(_,i)=>({entrada:ent[i]??'',salida:sal[i]??''}));
}
function aEmisores(mediciones){
  const base=emisoresVacios();
  (mediciones||[]).forEach(m=>{
    const i=indiceEmisor(m.posicion,m.linea);
    if(base[i]){base[i].volumen_cc=String(m.volumen_cc??'');base[i].tiempo_segundos=String(m.tiempo_segundos??'')}
  });
  return base;
}
function editarAforo(host,campo,id){
  const a=recientes.find(x=>x.id===id);
  if(!a)return;
  state={...estadoInicial(campo),
    id:a.id,editando:{...a,createdAt:a.localItem?.createdAt},
    cuartel_id:a.cuartel_id,sector:a.sector||'',equipo_riego:a.equipo_riego||'',caseta:a.caseta||'',
    temporada:a.temporada,fecha_evaluacion:a.fecha_evaluacion,
    evaluador_nombre:a.evaluador_nombre||'',cantidad_valvulas:a.cantidad_valvulas||0,
    tipo_linea:a.tipo_linea||'',presiones:aPresiones(a),emisores:aEmisores(a.mediciones),
    observaciones:a.observaciones||''};
  renderCuerpo(host,campo);
  $('#yoyeAforoBody',host)?.scrollIntoView({behavior:'smooth',block:'start'});
  actualizarEstadoGuardado(host,`Editando el aforo del ${a.fecha_evaluacion}`);
  $('#yoyeAforoEstado',host).hidden=false;
}
async function descartarAforo(host,campo,id){
  const a=recientes.find(x=>x.id===id);
  if(!a)return;
  if(!confirm(`¿Descartar el aforo del ${a.fecha_evaluacion}?\n\nSe oculta de la lista y de los paneles; queda recuperable desde la base.`))return;
  if(a.localItem){await localPut({...a.localItem,deleted:true,status:'synced'});return cargarRecientes(host,campo)}
  if(!db||!session||!navigator.onLine)return alert('Conéctate a internet para descartar un aforo ya sincronizado.');
  const {error}=await db.from('aforos').update({activo:false,updated_by:session.user.id}).eq('id',id);
  if(error)return alert('No fue posible descartarlo: '+error.message);
  await cargarRecientes(host,campo);
}

async function abrir(){
  if(!window.yoyeActiveCampo)return;
  if(!session){alert('Inicia sesión en Agrícola Yoye para registrar un aforo. Abre esta opción desde una ficha de cultivo o desde Cuarteles.');return}
  const campo=window.yoyeActiveCampo();
  state=estadoInicial(campo);
  const modal=document.createElement('div');
  modal.id='yoyeAforoModal';
  modal.className='yoye-shell yoye-modal-backdrop';
  modal.innerHTML=`<div class="yoye-modal">
    <div class="yoye-modal-head"><h3>Aforo · ${esc(campo.nombre)}</h3><button type="button" class="yoye-modal-close" aria-label="Cerrar">✕</button></div>
    <div id="yoyeAforoBody"></div>
    <p class="yoye-hint"><span id="yoyeAforoEstado" class="yoye-pending-badge" hidden></span></p>
    <div class="yoye-modal-actions">
      <button type="button" class="btn-primary" id="yoyeAforoNext">Guardar aforo</button>
    </div>
    <div class="yoye-af-card">
      <div class="yoye-af-head"><div><span class="yoye-af-paso">Registrados</span><h3>Últimos aforos</h3></div></div>
      <div id="yoyeAforoRecientes"></div>
    </div>
  </div>`;
  document.body.append(modal);
  modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('.yoye-modal-close'))cerrarModal()});
  $('#yoyeAforoNext',modal).onclick=async()=>{
    readStepInputs(modal);
    const err=validar();
    if(err)return alert(err);
    const btn=$('#yoyeAforoNext',modal);
    btn.disabled=true;
    $('#yoyeAforoEstado',modal).hidden=false;
    try{
      const editaba=!!state.editando;
      await guardarAforo(modal);
      const falta=faltantes();
      actualizarEstadoGuardado(modal,
        (editaba?'Cambios guardados':'Aforo guardado')+
        (falta.length?`. Queda incompleto: falta ${falta.join(' · ')}.`:'. Aforo completo.'));
      state=estadoInicial(campo);
      renderCuerpo(modal,campo);
      await cargarRecientes(modal,campo);
    }catch(e){
      alert('No se pudo guardar: '+(e.message||'intenta nuevamente'));
    }finally{btn.disabled=false}
  };
  [cuartelesActuales,sectoresActuales]=await Promise.all([cuartelesDeCampo(campo),sectoresDeCampo(campo)]);
  renderCuerpo(modal,campo);
  cargarRecientes(modal,campo);
}

window.yoyeAbrirAforo=abrir;

addEventListener('online',()=>syncQueue(null));
addEventListener('visibilitychange',()=>{if(!document.hidden)syncQueue(null)});
setInterval(()=>{if(navigator.onLine)syncQueue(null)},60000);

addEventListener('yoye-auth-ready',async e=>{
  db=e.detail.client;session=e.detail.session;
  if(!session)return;
  try{const {data}=await db.from('perfiles').select('*').eq('id',session.user.id).maybeSingle();profile=data||null}catch{}
  cuartelesCache={};sectoresCache={};
  syncQueue(null);
});
document.addEventListener('yoye-campo-changed',()=>{cuartelesCache={}});
})();
