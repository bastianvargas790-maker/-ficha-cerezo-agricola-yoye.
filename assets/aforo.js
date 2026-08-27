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

const DB_NAME='yoye-aforo-offline-v1',DB_VERSION=1,STORE='queue';
let localDb;
function openLocalDb(){
  if(localDb)return Promise.resolve(localDb);
  if(!('indexedDB' in window))return Promise.reject(new Error('offline no disponible'));
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'})};
    req.onsuccess=()=>{localDb=req.result;resolve(localDb)};
    req.onerror=()=>reject(req.error);
  });
}
async function localPut(v){const d=await openLocalDb();return new Promise((res,rej)=>{const r=d.transaction(STORE,'readwrite').objectStore(STORE).put(v);r.onsuccess=()=>res(v);r.onerror=()=>rej(r.error)})}
async function localAll(){const d=await openLocalDb();return new Promise((res,rej)=>{const r=d.transaction(STORE).objectStore(STORE).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}

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
let syncRunning=false;

async function cuartelesDeCampo(campo){
  const key=campo.slug;
  if(cuartelesCache[key])return cuartelesCache[key];
  if(!db)return [];
  let list=[];
  try{
    if(campo.id){
      const r=await db.from('cuarteles').select('id,codigo,cuartel').eq('activo',true).eq('campo_id',campo.id).order('codigo');
      if(!r.error&&Array.isArray(r.data))list=r.data;
    }
    if(!list.length&&profile?.organizacion_id){
      const r=await db.from('cuarteles').select('id,codigo,cuartel').eq('activo',true).eq('organizacion_id',profile.organizacion_id).order('codigo');
      if(!r.error&&Array.isArray(r.data))list=r.data;
    }
  }catch{}
  cuartelesCache[key]=list;
  return list;
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

function pasoIdentificacion(campo,cuarteles){
  return `
    <div class="yoye-form-card">
      <div class="yoye-field"><label>Cuartel *</label><div class="yoye-input"><select data-f="cuartel_id">
        <option value="">Selecciona un cuartel de ${esc(campo.nombre)}</option>
        ${cuarteles.map(c=>`<option value="${esc(c.id)}" ${state.cuartel_id===c.id?'selected':''}>${esc(c.codigo||c.cuartel)}</option>`).join('')}
      </select></div>${!cuarteles.length?'<p class="yoye-hint">Este campo aún no tiene cuarteles cargados en la base.</p>':''}</div>
      <div class="yoye-field"><label>Sector</label><div class="yoye-input"><input data-f="sector" type="text" placeholder="Ej. norte" value="${esc(state.sector)}"></div></div>
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

let cuartelesActuales=[];
function renderCuerpo(host,campo){
  const body=$('#yoyeAforoBody',host);
  if(!body)return;
  body.innerHTML=[pasoIdentificacion(campo,cuartelesActuales),pasoPresiones(),pasoEmisores(),pasoResultado()][state.step];
  $('#yoyeAforoProgress',host).innerHTML=progresoHtml();
  const btnBack=$('#yoyeAforoBack',host),btnNext=$('#yoyeAforoNext',host);
  btnBack.disabled=state.step===0;
  btnNext.textContent=state.step===3?'Guardar aforo':'Continuar';
}

function validarPaso(){
  if(state.step===0){
    if(!state.cuartel_id)return 'Selecciona un cuartel.';
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
    sector:state.sector||null,equipo_riego:state.equipo_riego||null,caseta:state.caseta||null,
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
  cuartelesActuales=await cuartelesDeCampo(campo);
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
  cuartelesCache={};
  syncQueue(null);
});
document.addEventListener('yoye-campo-changed',()=>{cuartelesCache={}});
})();
