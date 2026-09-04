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
function emisoresVacios(){
  const out=[];let idx=1;
  LINEAS.forEach(linea=>POSICIONES.forEach(posicion=>out.push({posicion,linea,indice:idx++,volumen_cc:'',tiempo_segundos:''})));
  return out;
}
function caudalLh(vol,seg){const v=Number(vol),s=Number(seg);return s>0&&v>=0?(v/s)*3.6:0}
function avg(arr){return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0}
function calcularResultado(emisores){
  const caudales=emisores.map(e=>caudalLh(e.volumen_cc,e.tiempo_segundos));
  const promedio=avg(caudales);
  const ordenados=[...caudales].sort((a,b)=>a-b);
  const n25=Math.max(1,Math.round(ordenados.length*0.25));
  const caudal25=avg(ordenados.slice(0,n25));
  const desvMedia=avg(caudales.map(c=>Math.abs(c-promedio)));
  const cu=promedio>0?Math.max(0,Math.min(100,100*(1-desvMedia/promedio))):0;
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

function root(){return location.pathname.split('/').filter(Boolean).length>1?'../':'./'}

let state=null;
function estadoInicial(campo){
  return {
    step:0,
    cuartel_id:'',sector:'',equipo_riego:'',caseta:'',
    temporada:new Date().getFullYear(),fecha_evaluacion:localDate(),
    evaluador_nombre:profile?.nombre_completo||campo.encargado_nombre||session?.user?.email||'',
    cantidad_valvulas:0,tipo_linea:'',
    presion_entrada_prom:'',presion_salida_prom:'',
    emisores:emisoresVacios(),
    observaciones:''
  };
}

function readStepInputs(host){
  if(!state)return;
  $$('[data-f]',host).forEach(el=>{
    const f=el.dataset.f;
    if(f==='volumen_cc'||f==='tiempo_segundos'){
      const i=Number(el.dataset.i);
      if(state.emisores[i])state.emisores[i][f]=el.value;
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
      <div class="yoye-field"><label>Temporada *</label><div class="yoye-input"><input data-f="temporada" type="number" min="2000" max="2100" value="${esc(state.temporada)}"></div></div>
      <div class="yoye-field"><label>Evaluador</label><div class="yoye-input"><input data-f="evaluador_nombre" type="text" value="${esc(state.evaluador_nombre)}"></div></div>
      <div class="yoye-field"><label>Cantidad de válvulas</label><div class="yoye-input"><input data-f="cantidad_valvulas" type="number" min="0" max="5" value="${esc(state.cantidad_valvulas)}"></div></div>
      <div class="yoye-field"><label>Tipo de línea</label><div class="yoye-input"><select data-f="tipo_linea">
        <option value="">Sin especificar</option>
        ${['Cinta','Manguera','Polietileno','Otro'].map(o=>`<option ${state.tipo_linea===o?'selected':''}>${o}</option>`).join('')}
      </select></div></div>
    </div>`;
}
function pasoPresiones(){
  const entrada=Number(state.presion_entrada_prom)||0,salida=Number(state.presion_salida_prom)||0;
  const perdida=entrada-salida,pct=entrada>0?(perdida/entrada*100):0;
  return `
    <div class="yoye-form-card">
      <div class="yoye-field"><label>Presión de entrada *</label><div class="yoye-input"><input data-f="presion_entrada_prom" type="number" step="0.1" min="0" placeholder="0,0" value="${esc(state.presion_entrada_prom)}"><span class="yoye-unit">bar</span></div></div>
      <div class="yoye-field"><label>Presión de salida *</label><div class="yoye-input"><input data-f="presion_salida_prom" type="number" step="0.1" min="0" placeholder="0,0" value="${esc(state.presion_salida_prom)}"><span class="yoye-unit">bar</span></div></div>
      <div class="yoye-hint">Pérdida de carga estimada: <b>${perdida.toFixed(2)} bar</b> (${pct.toFixed(0)}%) · ${pct<=20?'Aceptable':'Revisar presión'}</div>
    </div>`;
}
function pasoEmisores(){
  let out='<div class="yoye-form-card"><p class="yoye-hint">Registra volumen (cc) y tiempo (s) en las 16 posiciones. El caudal se calcula solo.</p><div class="yoye-emisores-grid">';
  let linea='';
  state.emisores.forEach((e,i)=>{
    if(e.linea!==linea){linea=e.linea;out+=`<div class="yoye-emisor-linea-label">${esc(linea)}</div>`}
    out+=`<div class="yoye-emisor-row">
      <span class="yoye-emisor-pos">${esc(e.posicion)}</span>
      <input data-f="volumen_cc" data-i="${i}" type="number" min="0" step="1" inputmode="decimal" placeholder="cc" value="${esc(e.volumen_cc)}">
      <input data-f="tiempo_segundos" data-i="${i}" type="number" min="0" step="0.1" inputmode="decimal" placeholder="s" value="${esc(e.tiempo_segundos)}">
      <span class="yoye-emisor-caudal">${isNum(e.volumen_cc)&&isNum(e.tiempo_segundos)?caudalLh(e.volumen_cc,e.tiempo_segundos).toFixed(1)+' L/h':'—'}</span>
    </div>`;
  });
  out+='</div></div>';
  return out;
}
function pasoResultado(){
  const r=calcularResultado(state.emisores);
  return `
    <div class="yoye-resultado-grid">
      <div class="yoye-resultado-kpi"><span>Caudal promedio</span><strong>${r.promedio.toFixed(1)}</strong></div>
      <div class="yoye-resultado-kpi"><span>Caudal 25% más bajo</span><strong>${r.caudal25.toFixed(1)}</strong></div>
      <div class="yoye-resultado-kpi clasificacion-${r.clasificacion.toLowerCase()}"><span>Coeficiente de uniformidad</span><strong>${r.cu.toFixed(1)}%</strong></div>
      <div class="yoye-resultado-kpi clasificacion-${r.clasificacion.toLowerCase()}"><span>Clasificación</span><strong>${esc(r.clasificacion)}</strong></div>
    </div>
    <div class="yoye-form-card" style="margin-top:12px">
      <div class="yoye-field"><label>Hallazgos / observaciones</label><div class="yoye-input"><textarea data-f="observaciones" placeholder="Fugas, baja presión, filtro sucio…">${esc(state.observaciones)}</textarea></div></div>
    </div>`;
}

const PASOS=['Identificación','Presiones','Emisores','Resultado'];
function progresoHtml(){
  return `<div class="yoye-wizard-progress">${PASOS.map((_,i)=>`<span class="yoye-wizard-seg ${i<=state.step?'is-done':''}"></span>`).join('')}</div>
  <div class="yoye-wizard-status"><span>Paso ${state.step+1} de 4 · <b>${PASOS[state.step]}</b></span></div>`;
}

let cuartelesActuales=[],sectoresActuales=[];
function renderCuerpo(host,campo){
  const body=$('#yoyeAforoBody',host);
  if(!body)return;
  body.innerHTML=[pasoIdentificacion(campo,cuartelesActuales),pasoPresiones(),pasoEmisores(),pasoResultado()][state.step];
  // El sector depende del cuartel elegido, así que el paso 1 se vuelve a dibujar
  // al cambiarlo. Se limpia el sector anterior: pertenecía al cuartel previo.
  if(state.step===0)$('[data-f="cuartel_id"]',body)?.addEventListener('change',e=>{
    readStepInputs(host);
    state.cuartel_id=e.target.value;
    state.sector='';
    renderCuerpo(host,campo);
  });
  $('#yoyeAforoProgress',host).innerHTML=progresoHtml();
  const btnBack=$('#yoyeAforoBack',host),btnNext=$('#yoyeAforoNext',host);
  btnBack.disabled=state.step===0;
  btnNext.textContent=state.step===3?'Guardar aforo':'Continuar';
}

function validarPaso(){
  if(state.step===0){
    if(!state.cuartel_id)return 'Selecciona un cuartel.';
    if(sectoresDelCuartel().length>1&&!state.sector)return 'Este cuartel tiene más de un sector de aforo: indica cuál se aforó.';
    if(!state.fecha_evaluacion)return 'Indica la fecha de evaluación.';
    if(!isNum(state.temporada))return 'Indica la temporada.';
  }
  if(state.step===1){
    if(!isNum(state.presion_entrada_prom)||!isNum(state.presion_salida_prom))return 'Completa las presiones de entrada y salida.';
  }
  if(state.step===2){
    const incompleto=state.emisores.some(e=>!isNum(e.volumen_cc)||!isNum(e.tiempo_segundos)||Number(e.tiempo_segundos)<=0);
    if(incompleto)return 'Completa volumen y tiempo en las 16 posiciones (tiempo mayor a 0).';
  }
  return null;
}

async function guardarAforo(host){
  const r=calcularResultado(state.emisores);
  const entrada=Number(state.presion_entrada_prom),salida=Number(state.presion_salida_prom);
  const perdida=entrada-salida,pct=entrada>0?(perdida/entrada*100):0;
  const id=uuid();
  const org=profile?.organizacion_id;
  const aforo={
    id,organizacion_id:org,cuartel_id:state.cuartel_id,
    sector:sectorElegido()?.codigo||state.sector||null,
    sector_aforo_id:sectorElegido()?.id||null,
    equipo_riego:state.equipo_riego||null,caseta:state.caseta||null,
    temporada:Number(state.temporada),fecha_evaluacion:state.fecha_evaluacion,
    evaluador_id:session.user.id,evaluador_nombre:state.evaluador_nombre||session.user.email,
    cantidad_valvulas:Number(state.cantidad_valvulas||0),tipo_linea:state.tipo_linea||null,
    presion_entrada_prom:entrada,presion_salida_prom:salida,perdida_carga:perdida,
    estado_presion:pct<=20?'Aceptable':'Revisar',
    presiones_entrada:[entrada],presiones_salida:[salida],
    caudal_promedio:r.promedio,caudal_25:r.caudal25,coeficiente_uniformidad:r.cu,clasificacion:r.clasificacion,
    observaciones_rapidas:[],observaciones:state.observaciones||null,
    latitud:null,longitud:null,fotografia_url:null,
    created_by:session.user.id,updated_by:session.user.id
  };
  const mediciones=state.emisores.map(e=>({
    id:uuid(),organizacion_id:org,aforo_id:id,posicion:e.posicion,linea:e.linea,indice:e.indice,
    volumen_cc:Number(e.volumen_cc),tiempo_segundos:Number(e.tiempo_segundos),caudal_l_h:caudalLh(e.volumen_cc,e.tiempo_segundos)
  }));
  const item={id,status:'pending',attempts:0,nextAttemptAt:0,createdAt:new Date().toISOString(),aforo,mediciones};
  await localPut(item);
  actualizarEstadoGuardado(host,'Guardado en el dispositivo. Sincronizando…');
  if(navigator.onLine)syncQueue(host);
  return item;
}

async function syncItem(item){
  if(!db||!session)throw new Error('Sesión no disponible');
  let r=await db.from('aforos').upsert(item.aforo,{onConflict:'id'});
  if(r.error)throw r.error;
  r=await db.from('mediciones_aforo').upsert(item.mediciones,{onConflict:'id'});
  if(r.error)throw r.error;
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

async function abrir(){
  if(!window.yoyeActiveCampo)return;
  if(!session){alert('Inicia sesión en Agrícola Yoye para registrar un aforo. Abre esta opción desde una ficha de cultivo o desde Cuarteles.');return}
  const campo=window.yoyeActiveCampo();
  state=estadoInicial(campo);
  const modal=document.createElement('div');
  modal.id='yoyeAforoModal';
  modal.className='yoye-shell yoye-modal-backdrop';
  modal.innerHTML=`<div class="yoye-modal">
    <div class="yoye-modal-head"><h3>Nuevo aforo · ${esc(campo.nombre)}</h3><button type="button" class="yoye-modal-close" aria-label="Cerrar">✕</button></div>
    <div id="yoyeAforoProgress"></div>
    <div id="yoyeAforoBody"></div>
    <p class="yoye-hint"><span id="yoyeAforoEstado" class="yoye-pending-badge" hidden></span></p>
    <div class="yoye-modal-actions">
      <button type="button" class="btn-secondary" id="yoyeAforoBack">Atrás</button>
      <button type="button" class="btn-primary" id="yoyeAforoNext">Continuar</button>
    </div>
  </div>`;
  document.body.append(modal);
  modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('.yoye-modal-close'))cerrarModal()});
  $('#yoyeAforoBack',modal).onclick=()=>{readStepInputs(modal);if(state.step>0){state.step--;renderCuerpo(modal,campo)}};
  $('#yoyeAforoNext',modal).onclick=async()=>{
    readStepInputs(modal);
    const err=validarPaso();
    if(err)return alert(err);
    if(state.step<3){state.step++;renderCuerpo(modal,campo);return}
    const btn=$('#yoyeAforoNext',modal);
    btn.disabled=true;
    $('#yoyeAforoEstado',modal).hidden=false;
    try{
      await guardarAforo(modal);
      $('#yoyeAforoBody',modal).innerHTML='<div class="yoye-form-card"><p>Aforo guardado. Puedes cerrar esta ventana; seguirá sincronizando en segundo plano si estás sin conexión.</p></div>';
      $('#yoyeAforoProgress',modal).innerHTML='';
      btn.textContent='Listo';btn.onclick=cerrarModal;btn.disabled=false;
      $('#yoyeAforoBack',modal).hidden=true;
    }catch(e){
      alert('No se pudo guardar: '+(e.message||'intenta nuevamente'));
      btn.disabled=false;
    }
  };
  [cuartelesActuales,sectoresActuales]=await Promise.all([cuartelesDeCampo(campo),sectoresDeCampo(campo)]);
  renderCuerpo(modal,campo);
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
