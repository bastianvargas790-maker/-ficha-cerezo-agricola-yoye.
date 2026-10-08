/* Registro de fertilizaciones en terreno.
 *
 * Reemplaza la planilla por cuartel: se elige el cuartel y la fecha una vez y
 * se van agregando filas de producto + cantidad, como las profundidades de una
 * calicata. Guarda primero en el teléfono y sube cuando hay señal, igual que
 * Calicatas y Aforo: en el campo la señal se corta y el registro no puede
 * depender de ella.
 *
 * Las unidades de nutriente (N, K2O, P2O5, MgO, CaO) NO se escriben acá: salen
 * de la ley del producto en la vista fert_aplicaciones_unidades. En la planilla
 * esas fórmulas quedaban cortas al agregar fechas y los totales no cuadraban.
 */
(()=>{'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uuid=()=>globalThis.crypto?.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:r&3|8;return v.toString(16)});
const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const decimal=v=>String(v??'').trim().replace(/\s+/g,'').replace(',','.');
const num=v=>{const n=Number(decimal(v));return Number.isFinite(n)?n:null};
const fmt=(v,d=1)=>v===null||v===undefined?'—':Number(v).toLocaleString('es-CL',{minimumFractionDigits:d,maximumFractionDigits:d});
const fechaCorta=f=>{if(!f)return '';const [a,m,d]=String(f).slice(0,10).split('-');return `${d}/${m}/${a}`};

/* La temporada agrícola parte en julio: lo aplicado en agosto de 2025 y en
   enero de 2026 es la misma temporada 2025-2026. */
function temporadaDe(fecha){
  const f=String(fecha||localDate()).slice(0,10), a=Number(f.slice(0,4)), m=Number(f.slice(5,7));
  const inicio=m>=7?a:a-1;
  return `${inicio}-${inicio+1}`;
}
/* Nombre normalizado del producto. Es lo que evita que vuelva a pasar lo de la
   planilla, donde el boro estaba escrito de doce formas distintas y el consumo
   por producto no se podía sumar. */
const claveProducto=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
  .replace(/[^a-z0-9]+/g,' ').trim();

/* ---------- Guardado local ---------- */
const DB_NAME='yoye-fert-offline-v1',DB_VERSION=1,STORE='queue',STORE_CAT='catalogo';
let localDb;
function openLocalDb(){
  if(localDb)return Promise.resolve(localDb);
  return new Promise((res,rej)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{const d=req.result;
      if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE,{keyPath:'id'});
      if(!d.objectStoreNames.contains(STORE_CAT))d.createObjectStore(STORE_CAT,{keyPath:'id'})};
    req.onsuccess=()=>{localDb=req.result;res(localDb)};
    req.onerror=()=>rej(req.error);
  });
}
async function localPut(v,store=STORE){const d=await openLocalDb();return new Promise((res,rej)=>{const r=d.transaction(store,'readwrite').objectStore(store).put(v);r.onsuccess=()=>res(v);r.onerror=()=>rej(r.error)})}
async function localAll(store=STORE){const d=await openLocalDb();return new Promise((res,rej)=>{const r=d.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
async function localDelete(id,store=STORE){const d=await openLocalDb();return new Promise((res,rej)=>{const r=d.transaction(store,'readwrite').objectStore(store).delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
async function localGet(id,store=STORE){const d=await openLocalDb();return new Promise((res,rej)=>{const r=d.transaction(store).objectStore(store).get(id);r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error)})}

let db,session,profile;
let cuartelesCache={},productos=[],syncRunning=false;
let cuartelesActuales=[],recientes=[],state=null;

/* Cuarteles del campo activo, con copia local para seguir registrando sin
   señal. Mismo criterio que Aforo. */
async function cuartelesDeCampo(campo){
  const key=campo.slug||campo.id;
  if(!key)return [];
  if(cuartelesCache[key])return cuartelesCache[key];
  let list=[];
  if(db&&campo.id){
    try{
      const r=await db.from('cuarteles').select('id,codigo,cuartel,cultivo,variedad,superficie_ha')
        .eq('activo',true).eq('campo_id',campo.id).order('codigo');
      if(!r.error&&Array.isArray(r.data)){list=r.data;try{await localPut({id:key,list},STORE_CAT)}catch{}}
    }catch{}
  }
  if(!list.length){try{const c=await localGet(key,STORE_CAT);if(c?.list?.length)list=c.list}catch{}}
  cuartelesCache[key]=list;
  return list;
}
/* Catálogo de productos. Se cachea igual que los cuarteles: en terreno hay que
   poder elegir el producto sin señal. */
async function cargarProductos(){
  if(productos.length)return productos;
  let list=[];
  if(db){
    try{
      const r=await db.from('fert_productos').select('id,nombre,clave,unidad').eq('activo',true).order('nombre');
      if(!r.error&&Array.isArray(r.data)){list=r.data;try{await localPut({id:'productos',list},STORE_CAT)}catch{}}
    }catch{}
  }
  if(!list.length){try{const c=await localGet('productos',STORE_CAT);if(c?.list?.length)list=c.list}catch{}}
  productos=list;
  return productos;
}

/* ---------- Estado del formulario ---------- */
const filaVacia=()=>({id:uuid(),producto_id:'',nombre_nuevo:'',cantidad:'',unidad:'kg'});
function estadoInicial(cuartel){
  return {cuartel_id:cuartel||'',fecha:localDate(),filas:[filaVacia(),filaVacia()],
    filasBorradas:[],editando:null};
}
function leerFormulario(host){
  const cab=$('#yoyeFertCab',host);
  if(cab){
    state.cuartel_id=$('[data-f="cuartel_id"]',cab)?.value||'';
    state.fecha=$('[data-f="fecha"]',cab)?.value||'';
  }
  $$('[data-fila]',host).forEach(row=>{
    const f=state.filas.find(x=>x.id===row.dataset.fila);
    if(!f)return;
    f.producto_id=$('[data-c="producto"]',row)?.value||'';
    f.nombre_nuevo=$('[data-c="nombre"]',row)?.value||'';
    f.cantidad=$('[data-c="cantidad"]',row)?.value||'';
    f.unidad=$('[data-c="unidad"]',row)?.value||'kg';
  });
}
/* Una fila cuenta cuando tiene producto Y cantidad mayor que cero. Las filas a
   medias no se guardan y el aviso dice cuántas quedaron fuera: es el mismo
   criterio de la calicata incompleta, nada se inventa. */
function filaCompleta(f){
  const nombre=f.producto_id==='nuevo'?f.nombre_nuevo.trim():f.producto_id;
  return !!nombre&&num(f.cantidad)>0;
}
function filaEmpezada(f){
  return !!(f.producto_id||f.nombre_nuevo.trim()||String(f.cantidad).trim());
}
function validar(){
  if(!state.cuartel_id)return 'Elige el cuartel.';
  if(!state.fecha)return 'Falta la fecha de la aplicación.';
  if(!state.filas.some(filaCompleta))return 'Anota al menos un producto con sus kilos o litros.';
  const mal=state.filas.find(f=>f.producto_id==='nuevo'&&!f.nombre_nuevo.trim()&&num(f.cantidad)>0);
  if(mal)return 'Escribe el nombre del producto nuevo.';
  return '';
}

/* ---------- Dibujo ---------- */
function opcionesProducto(f){
  const sel=f.producto_id;
  return `<option value="">Elige el producto…</option>
    ${productos.map(p=>`<option value="${esc(p.id)}"${sel===p.id?' selected':''}>${esc(p.nombre)}</option>`).join('')}
    <option value="nuevo"${sel==='nuevo'?' selected':''}>Otro producto…</option>`;
}
function filaHtml(f,i){
  const nuevo=f.producto_id==='nuevo';
  return `<div class="yoye-fert-fila" data-fila="${esc(f.id)}">
    <div class="yoye-fert-fila-cab"><span>Producto ${i+1}</span>
      <button type="button" class="yoye-fert-quitar" data-quitar="${esc(f.id)}" aria-label="Quitar producto ${i+1}">✕</button></div>
    <div class="yoye-input"><select data-c="producto">${opcionesProducto(f)}</select></div>
    ${nuevo?`<div class="yoye-input"><input data-c="nombre" type="text" placeholder="Nombre del producto" value="${esc(f.nombre_nuevo)}"></div>`:''}
    <div class="yoye-fert-cantidad">
      <div class="yoye-input"><input data-c="cantidad" type="text" inputmode="decimal" placeholder="Cantidad" value="${esc(f.cantidad)}"></div>
      <div class="yoye-input"><select data-c="unidad">
        <option value="kg"${f.unidad==='kg'?' selected':''}>kg</option>
        <option value="L"${f.unidad==='L'?' selected':''}>litros</option>
      </select></div>
    </div>
  </div>`;
}
function cuerpoHtml(campo){
  const cuarteles=cuartelesActuales;
  return `<div class="yoye-form-card" id="yoyeFertCab">
      <div class="yoye-field"><label>Cuartel *</label><div class="yoye-input"><select data-f="cuartel_id">
        <option value="">Selecciona un cuartel de ${esc(campo.nombre)}</option>
        ${cuarteles.map(c=>`<option value="${esc(c.id)}"${state.cuartel_id===c.id?' selected':''}>${esc(c.codigo||c.cuartel)}${c.cultivo?' · '+esc(c.cultivo):''}</option>`).join('')}
      </select></div>${!cuarteles.length?`<p class="yoye-hint">${navigator.onLine?'Este campo aún no tiene cuarteles cargados en la base.':'Sin conexión y sin copia local de este campo. Ábrelo una vez con señal para poder registrar después sin conexión.'}</p>`:''}</div>
      <div class="yoye-field"><label>Fecha de aplicación *</label><div class="yoye-input"><input data-f="fecha" type="date" value="${esc(state.fecha)}"></div>
        <p class="yoye-hint">Temporada ${esc(temporadaDe(state.fecha))}.</p></div>
    </div>
    <div class="yoye-form-card">
      <div class="yoye-af-head"><div><span class="yoye-af-paso">Lo aplicado</span><h3>Productos y cantidad</h3></div></div>
      <div id="yoyeFertFilas">${state.filas.map(filaHtml).join('')}</div>
      <button type="button" class="btn-secondary" id="yoyeFertAgregar">+ Agregar producto</button>
      ${productos.length?'':'<p class="yoye-hint">El catálogo de productos no se pudo cargar. Elige “Otro producto…” y escribe el nombre; se agrega al catálogo al subir.</p>'}
    </div>`;
}
function renderCuerpo(host,campo){
  const body=$('#yoyeFertBody',host);
  if(!body)return;
  body.innerHTML=cuerpoHtml(campo);
  $('#yoyeFertAgregar',body).onclick=()=>{leerFormulario(host);state.filas.push(filaVacia());renderCuerpo(host,campo)};
  $$('[data-quitar]',body).forEach(b=>b.onclick=()=>{
    leerFormulario(host);
    const f=state.filas.find(x=>x.id===b.dataset.quitar);
    if(f&&f.guardada)state.filasBorradas.push(f.id);
    state.filas=state.filas.filter(x=>x.id!==b.dataset.quitar);
    if(!state.filas.length)state.filas.push(filaVacia());
    renderCuerpo(host,campo);
  });
  /* Al elegir el producto se pone su unidad de ficha (los líquidos en litros),
     y "Otro producto…" abre el campo de texto. */
  $$('[data-c="producto"]',body).forEach(sel=>sel.onchange=()=>{
    leerFormulario(host);
    const row=sel.closest('[data-fila]'), f=state.filas.find(x=>x.id===row.dataset.fila);
    const p=productos.find(x=>x.id===sel.value);
    if(f&&p)f.unidad=p.unidad||'kg';
    renderCuerpo(host,campo);
  });
  $('[data-f="fecha"]',body)?.addEventListener('change',()=>{leerFormulario(host);renderCuerpo(host,campo)});
}

/* ---------- Guardar ---------- */
async function guardarAplicacion(host){
  const org=profile?.organizacion_id;
  const fecha=state.fecha, temporada=temporadaDe(fecha);
  const filas=state.filas.filter(filaCompleta).map(f=>({
    id:f.id,
    producto_id:f.producto_id==='nuevo'?null:f.producto_id,
    producto_nombre:f.producto_id==='nuevo'?f.nombre_nuevo.trim()
      :(productos.find(p=>p.id===f.producto_id)?.nombre||''),
    cantidad:num(f.cantidad), unidad:f.unidad==='L'?'L':'kg'
  }));
  const item={id:state.id||uuid(),status:'pending',attempts:0,nextAttemptAt:0,
    createdAt:state.editando?.createdAt||new Date().toISOString(),
    organizacion_id:org, cuartel_id:state.cuartel_id, fecha, temporada,
    filas, filasBorradas:state.filasBorradas.slice(),
    creado_por:state.editando?.creado_por||session.user.id};
  await localPut(item);
  for(const id of state.editando?.locales||[])if(id!==item.id)await localDelete(id);
  estadoGuardado(host,navigator.onLine?'Guardado en el dispositivo. Sincronizando…':'Guardado en el dispositivo. Se enviará al recuperar internet.');
  return item;
}
/* Producto escrito a mano: se busca por clave antes de crearlo, así dos
   teléfonos que escriben "Nitrato de Potasio" y "nitrato potasio" terminan en
   el mismo producto y no en dos. */
async function productoDe(fila){
  if(fila.producto_id)return fila.producto_id;
  const clave=claveProducto(fila.producto_nombre);
  if(!clave)throw new Error('Producto sin nombre');
  const org=profile?.organizacion_id;
  const hay=await db.from('fert_productos').select('id').eq('organizacion_id',org).eq('clave',clave).maybeSingle();
  if(hay.data?.id)return hay.data.id;
  const r=await db.from('fert_productos').insert({
    organizacion_id:org,nombre:fila.producto_nombre,clave,unidad:fila.unidad,
    notas:'Agregado desde el registro en terreno; falta su ley de nutrientes.',
    creado_por:session.user.id,actualizado_por:session.user.id}).select('id').single();
  if(r.error)throw r.error;
  productos=[];
  return r.data.id;
}
async function syncItem(item){
  if(!db||!session)throw new Error('Sesión no disponible');
  if(item.deleted){
    const ids=item.filas.map(f=>f.id);
    if(ids.length){
      const r=await db.from('fert_aplicaciones').update({activo:false,actualizado_por:session.user.id}).in('id',ids);
      if(r.error)throw r.error;
    }
    return;
  }
  const filas=[];
  for(const f of item.filas){
    const producto_id=await productoDe(f);
    f.producto_id=producto_id;            // queda resuelto por si hay reintento
    filas.push({id:f.id,organizacion_id:item.organizacion_id,cuartel_id:item.cuartel_id,
      producto_id,temporada:item.temporada,fecha:item.fecha,cantidad:f.cantidad,
      unidad:f.unidad,activo:true,
      creado_por:item.creado_por,actualizado_por:session.user.id});
  }
  if(filas.length){
    const r=await db.from('fert_aplicaciones').upsert(filas,{onConflict:'id'});
    if(r.error)throw r.error;
  }
  if(item.filasBorradas?.length){
    const r=await db.from('fert_aplicaciones').update({activo:false,actualizado_por:session.user.id})
      .in('id',item.filasBorradas);
    if(r.error)throw r.error;
  }
}
async function syncQueue(host){
  if(syncRunning||!navigator.onLine||!db||!session)return;
  syncRunning=true;
  try{
    const items=(await localAll()).filter(x=>x.status!=='synced'&&(x.nextAttemptAt||0)<=Date.now());
    for(const item of items){
      item.status='syncing';await localPut(item);
      if(host)estadoGuardado(host,'Sincronizando…');
      try{
        await syncItem(item);
        item.status='synced';item.syncedAt=new Date().toISOString();item.error=null;item.nextAttemptAt=0;
        if(host)estadoGuardado(host,'✓ Sincronizado');
      }catch(e){
        item.status='error';item.attempts=(item.attempts||0)+1;item.error=e.message||'Error de sincronización';
        item.nextAttemptAt=Date.now()+Math.min(15*60*1000,Math.max(10*1000,2**item.attempts*1000));
        if(host)estadoGuardado(host,'Sin señal · quedó en cola, se reintentará',true);
      }
      await localPut(item);
    }
  }finally{syncRunning=false}
}
/* Dos avisos distintos, porque antes se pisaban: el resumen de lo guardado
   -- cuántos productos y en qué cuartel -- desaparecía a los dos segundos,
   reemplazado por "✓ Sincronizado". En terreno el que importa es el primero:
   es la confirmación de que lo anotado quedó. El estado de la subida va al
   lado, en chico. */
function avisoGuardado(host,texto){
  const el=$('#yoyeFertEstado',host);
  if(!el)return;
  el.hidden=false;
  el.textContent=texto;
}
function estadoGuardado(host,texto,error=false){
  const el=$('#yoyeFertSync',host);
  if(!el)return;
  el.hidden=false;
  el.textContent=texto;
  el.className='yoye-pending-badge'+(error?' is-error':'');
}

/* ---------- Últimas aplicaciones ----------
   Cada tarjeta es un cuartel y una fecha: lo que se cargó de una vez. Las filas
   de la base se agrupan igual, así una aplicación cargada en dos tandas el
   mismo día se lee como una sola. */
function agrupar(filas,nombreProducto){
  const grupos=new Map();
  filas.forEach(f=>{
    const k=`${f.cuartel_id}|${String(f.fecha).slice(0,10)}`;
    if(!grupos.has(k))grupos.set(k,{clave:k,cuartel_id:f.cuartel_id,fecha:String(f.fecha).slice(0,10),filas:[],local:null});
    grupos.get(k).filas.push({id:f.id,producto_id:f.producto_id,
      producto_nombre:f.producto_nombre||nombreProducto(f.producto_id),
      cantidad:Number(f.cantidad),unidad:f.unidad});
  });
  return [...grupos.values()];
}
async function cargarRecientes(host,campo){
  const cont=$('#yoyeFertRecientes',host);
  if(!cont)return;
  const ids=new Set(cuartelesActuales.map(c=>c.id));
  const nombreProducto=id=>productos.find(p=>p.id===id)?.nombre||'Producto';
  let remotas=[];
  if(db&&session&&navigator.onLine&&ids.size){
    try{
      const {data,error}=await db.from('fert_aplicaciones')
        .select('id,cuartel_id,producto_id,fecha,cantidad,unidad,creado_en')
        .in('cuartel_id',[...ids]).eq('activo',true)
        .order('fecha',{ascending:false}).limit(120);
      if(error)throw error;
      remotas=agrupar(data||[],nombreProducto);
    }catch(e){console.warn('No se pudieron cargar las últimas aplicaciones',e)}
  }
  /* Lo guardado en el teléfono también va en la lista, incluso lo que ya subió:
     si la consulta a la base falla por señal mala, la fertilización que uno
     acaba de anotar no puede desaparecer de la pantalla. Lo que sí cambia es la
     marca de "Pendiente de subir".
     Todo lo del mismo cuartel y el mismo día es UNA tarjeta, venga de la base o
     de dos cargas seguidas en el teléfono: si no, la misma aplicación aparecía
     repetida y Editar sólo tomaba la primera mitad. Lo del teléfono manda sobre
     lo de la base, porque es lo último que se escribió. */
  let locales=[];
  try{
    locales=(await localAll()).filter(i=>!i.deleted&&i.cuartel_id&&i.filas?.length)
      .map(i=>({clave:`${i.cuartel_id}|${i.fecha}`,cuartel_id:i.cuartel_id,fecha:i.fecha,
        filas:i.filas.map(f=>({...f})),item:i,pendiente:i.status!=='synced'}));
  }catch{}
  const mapa=new Map();
  remotas.forEach(g=>mapa.set(g.clave,{...g,locales:[],pendiente:false}));
  locales.sort((a,b)=>String(a.item.createdAt||'').localeCompare(String(b.item.createdAt||'')));
  locales.forEach(l=>{
    let g=mapa.get(l.clave);
    if(!g){g={clave:l.clave,cuartel_id:l.cuartel_id,fecha:l.fecha,filas:[],locales:[],pendiente:false};mapa.set(l.clave,g)}
    g.locales.push(l.item);
    if(l.pendiente)g.pendiente=true;
    l.filas.forEach(f=>{
      const i=g.filas.findIndex(x=>x.id===f.id);
      if(i>=0)g.filas[i]=f; else g.filas.push(f);
    });
  });
  recientes=[...mapa.values()].sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))).slice(0,10);
  renderRecientes(host,campo);
}
function renderRecientes(host,campo){
  const cont=$('#yoyeFertRecientes',host);
  if(!cont)return;
  if(!recientes.length){cont.innerHTML='<p class="yoye-af-nota">Todavía no hay fertilizaciones registradas en este campo.</p>';return}
  const nombre=id=>cuartelesActuales.find(c=>c.id===id)?.codigo||'—';
  cont.innerHTML=recientes.map(g=>{
    const kg=g.filas.filter(f=>f.unidad!=='L').reduce((t,f)=>t+(Number(f.cantidad)||0),0);
    const l=g.filas.filter(f=>f.unidad==='L').reduce((t,f)=>t+(Number(f.cantidad)||0),0);
    const total=[kg?`${fmt(kg)} kg`:null,l?`${fmt(l)} L`:null].filter(Boolean).join(' · ')||'—';
    return `<div class="yoye-af-reciente">
      <div class="yoye-af-reciente-datos">
        <strong>${esc(nombre(g.cuartel_id))} · ${esc(fechaCorta(g.fecha))}</strong>
        <span>${g.filas.length} ${g.filas.length===1?'producto':'productos'} · ${esc(total)}</span>
        <small>${esc(g.filas.map(f=>`${f.producto_nombre} ${fmt(f.cantidad)} ${f.unidad}`).join(' · '))}</small>
        ${g.pendiente?'<small class="yoye-af-incompleto">Pendiente de subir</small>':''}
      </div>
      <div class="yoye-af-reciente-acciones">
        <button type="button" class="btn-secondary" data-editar="${esc(g.clave)}">Editar</button>
        <button type="button" class="btn-secondary" data-descartar="${esc(g.clave)}">Descartar</button>
      </div>
    </div>`;
  }).join('');
  $$('[data-editar]',cont).forEach(b=>b.onclick=()=>editar(host,campo,b.dataset.editar));
  $$('[data-descartar]',cont).forEach(b=>b.onclick=()=>descartar(host,campo,b.dataset.descartar));
}
function editar(host,campo,clave){
  const g=recientes.find(x=>x.clave===clave);
  if(!g)return;
  const primero=(g.locales||[])[0]||null;
  state={id:primero?.id||uuid(),cuartel_id:g.cuartel_id,fecha:g.fecha,
    filas:g.filas.map(f=>({id:f.id,producto_id:f.producto_id||'',nombre_nuevo:f.producto_id?'':(f.producto_nombre||''),
      cantidad:String(f.cantidad??''),unidad:f.unidad||'kg',guardada:true})),
    filasBorradas:[],
    /* Se corrige el grupo completo, así que los otros guardados sueltos del
       mismo cuartel y día quedan reemplazados por este: si no, uno viejo podía
       subir después y deshacer la corrección. */
    editando:{createdAt:primero?.createdAt,creado_por:primero?.creado_por,
      locales:(g.locales||[]).map(i=>i.id)}};
  if(!state.filas.length)state.filas.push(filaVacia());
  renderCuerpo(host,campo);
  $('#yoyeFertGuardar',host).textContent='Guardar cambios';
  avisoGuardado(host,`Editando la aplicación de ${nombreCuartel(g.cuartel_id)} del ${fechaCorta(g.fecha)}.`);
  $('#yoyeFertBody',host)?.scrollIntoView({behavior:'smooth',block:'start'});
}
function nombreCuartel(id){return cuartelesActuales.find(c=>c.id===id)?.codigo||'—'}
async function descartar(host,campo,clave){
  const g=recientes.find(x=>x.clave===clave);
  if(!g)return;
  if(!confirm(`¿Descartar la fertilización de ${nombreCuartel(g.cuartel_id)} del ${fechaCorta(g.fecha)}?\n\nSon ${g.filas.length} ${g.filas.length===1?'producto':'productos'}. Se ocultan de los paneles y quedan recuperables desde la base.`))return;
  const locales=g.locales||[];
  if(locales.length){
    /* Lo del teléfono se marca de baja: si ya había subido, la cola pone
       activo=false en la base; si no alcanzó a subir, no sube nada. */
    for(const item of locales)
      await localPut({...item,deleted:true,status:item.status==='synced'?'pending':'synced'});
    if(navigator.onLine)await syncQueue(host);
  }
  if(!locales.length||!g.pendiente){
    if(!db||!session||!navigator.onLine)
      return locales.length?cargarRecientes(host,campo)
        :alert('Conéctate a internet para descartar una fertilización ya sincronizada.');
    const {error}=await db.from('fert_aplicaciones')
      .update({activo:false,actualizado_por:session.user.id}).in('id',g.filas.map(f=>f.id));
    if(error)return alert('No fue posible descartarla: '+error.message);
  }
  await cargarRecientes(host,campo);
}

/* ---------- Apertura ---------- */
function cerrarModal(){$('#yoyeFertModal')?.remove()}
async function abrir(){
  if(!window.yoyeActiveCampo)return;
  if(!session){alert('Inicia sesión en Agrícola Yoye para registrar una fertilización.');return}
  const campo=window.yoyeActiveCampo();
  state=estadoInicial('');
  const modal=document.createElement('div');
  modal.id='yoyeFertModal';
  modal.className='yoye-shell yoye-modal-backdrop';
  modal.innerHTML=`<div class="yoye-modal">
    <div class="yoye-modal-head"><h3>Fertilización · ${esc(campo.nombre)}</h3><button type="button" class="yoye-modal-close" aria-label="Cerrar">✕</button></div>
    <div id="yoyeFertBody"></div>
    <p class="yoye-hint"><span id="yoyeFertEstado" class="yoye-fert-aviso" hidden></span>
      <span id="yoyeFertSync" class="yoye-pending-badge" hidden></span></p>
    <div class="yoye-modal-actions">
      <button type="button" class="btn-primary" id="yoyeFertGuardar">Guardar fertilización</button>
    </div>
    <div class="yoye-af-card">
      <div class="yoye-af-head"><div><span class="yoye-af-paso">Registradas</span><h3>Últimas fertilizaciones</h3></div></div>
      <div id="yoyeFertRecientes"></div>
    </div>
  </div>`;
  document.body.append(modal);
  modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('.yoye-modal-close'))cerrarModal()});
  $('#yoyeFertGuardar',modal).onclick=async()=>{
    leerFormulario(modal);
    const err=validar();
    if(err)return alert(err);
    const btn=$('#yoyeFertGuardar',modal);
    btn.disabled=true;
    try{
      const editaba=!!state.editando;
      const guardadas=state.filas.filter(filaCompleta).length;
      const aMedias=state.filas.filter(f=>filaEmpezada(f)&&!filaCompleta(f)).length;
      const cuartel=state.cuartel_id;
      await guardarAplicacion(modal);
      /* La subida se espera antes de repintar la lista: si no, la tarjeta
         recién guardada aparecía como "Pendiente de subir" aunque ya hubiera
         subido, y había que cerrar y abrir para verla bien. Sin señal la cola
         vuelve de inmediato y el aviso dice que quedó en el teléfono. */
      if(navigator.onLine)await syncQueue(modal);
      avisoGuardado(modal,
        `${editaba?'Cambios guardados':'Fertilización guardada'}: ${guardadas} ${guardadas===1?'producto':'productos'} en ${nombreCuartel(cuartel)}.`+
        (aMedias?` Quedó ${aMedias} ${aMedias===1?'fila a medias sin guardar':'filas a medias sin guardar'}.`:''));
      /* El cuartel queda puesto: en terreno se fertiliza cuartel por cuartel y
         casi siempre viene otra carga del mismo. */
      state=estadoInicial(cuartel);
      renderCuerpo(modal,campo);
      $('#yoyeFertGuardar',modal).textContent='Guardar fertilización';
      await cargarRecientes(modal,campo);
    }catch(e){
      alert('No se pudo guardar: '+(e.message||'intenta nuevamente'));
    }finally{btn.disabled=false}
  };
  [cuartelesActuales]=await Promise.all([cuartelesDeCampo(campo),cargarProductos()]);
  renderCuerpo(modal,campo);
  cargarRecientes(modal,campo);
}

window.yoyeAbrirFertilizacion=abrir;

addEventListener('online',()=>syncQueue(null));
addEventListener('visibilitychange',()=>{if(!document.hidden)syncQueue(null)});
setInterval(()=>{if(navigator.onLine)syncQueue(null)},60000);

addEventListener('yoye-auth-ready',async e=>{
  db=e.detail.client;session=e.detail.session;
  if(!session)return;
  try{const {data}=await db.from('perfiles').select('*').eq('id',session.user.id).maybeSingle();profile=data||null}catch{}
  cuartelesCache={};productos=[];
  syncQueue(null);
});
document.addEventListener('yoye-campo-changed',()=>{cuartelesCache={}});
})();
