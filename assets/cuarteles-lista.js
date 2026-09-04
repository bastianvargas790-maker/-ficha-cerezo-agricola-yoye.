(()=>{'use strict';
/* Lista de cuarteles del campo activo.
   Antes esta pantalla no existía: el botón "Cuarteles" de la barra inferior y
   los números del Inicio apuntaban a cerezo/#database, o sea a la base que vive
   dentro de la ficha de cerezo. Por eso, mirara el campo que mirara, el usuario
   terminaba en la ficha de cerezo sin poder cambiar de cultivo.
   Aquí los cuarteles salen de la base, filtrados por el campo activo (las
   políticas de RLS hacen lo suyo igual), y cada uno abre su tablero y la ficha
   del cultivo que le corresponde. */

const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* Cultivos con ficha publicada. La ficha se ofrece solo cuando existe: un
   cuartel de mandarina no puede terminar abriendo la ficha de cerezo. */
const FICHAS={cerezo:'cerezo',ciruelo:'ciruelo',duraznero:'duraznero',naranjo:'naranjo',
  nectarino:'nectarino',nogal:'nogal',palto:'palto',mandarina:'mandarina'};
function fichaDe(cultivo){
  const c=String(cultivo||'').toLowerCase().trim();
  if(!c)return null;
  // La base guarda a veces el plural del campo ("nogales", "ciruelos").
  for(const clave of Object.keys(FICHAS)){
    if(c===clave||c===clave+'s'||c.startsWith(clave))return FICHAS[clave];
  }
  if(c.startsWith('nectarin'))return 'nectarino';
  if(c.startsWith('durazn'))return 'duraznero';
  if(c.startsWith('mandarin'))return 'mandarina';
  if(c.startsWith('naranj'))return 'naranjo';
  if(c.startsWith('cerez'))return 'cerezo';
  if(c.startsWith('ciruel'))return 'ciruelo';
  if(c.startsWith('nogal'))return 'nogal';
  if(c.startsWith('palt'))return 'palto';
  return null;
}
const titulo=s=>{const t=String(s||'').trim();return t?t[0].toUpperCase()+t.slice(1):''};
const num=v=>v===null||v===undefined||v===''?null:Number(v);

let db,session,todos=[];

function pintar(){
  const lista=$('#clLista'),estado=$('#clEstado'),cuenta=$('#clCount');
  const q=($('#clBuscar').value||'').toLowerCase().trim();
  const cultivo=$('#clCultivo').value;
  const visibles=todos.filter(c=>{
    if(cultivo&&String(c.cultivo||'').toLowerCase()!==cultivo)return false;
    if(!q)return true;
    return [c.codigo,c.cuartel,c.cultivo,c.variedad,c.equipo,c.caseta]
      .some(v=>String(v||'').toLowerCase().includes(q));
  });
  cuenta.textContent=visibles.length===todos.length
    ? `${todos.length} cuarteles`
    : `${visibles.length} de ${todos.length} cuarteles`;
  lista.innerHTML=visibles.map(c=>{
    const ficha=fichaDe(c.cultivo);
    const sup=num(c.superficie_ha);
    const meta=[titulo(c.cultivo)||'Cultivo por definir',c.variedad&&c.variedad!=='Sin información'?c.variedad:null,
      sup?`${sup.toLocaleString('es-CL',{maximumFractionDigits:2})} ha`:null].filter(Boolean).join(' · ');
    const tags=[c.equipo,c.caseta].filter(Boolean).map(t=>`<span class="cl-tag">${esc(t)}</span>`).join('');
    return `<li class="cl-item">
      <h2>${esc(c.codigo||c.cuartel||'Sin código')}</h2>
      <p class="cl-meta">${esc(meta)}</p>
      ${tags?`<div class="cl-tags">${tags}</div>`:''}
      <div class="cl-links">
        <a class="primary" href="./?id=${encodeURIComponent(c.id)}">Ver tablero</a>
        ${ficha?`<a href="../${ficha}/">Ficha de ${esc(titulo(ficha))}</a>`:''}
      </div>
    </li>`;
  }).join('');
  estado.hidden=visibles.length>0;
  if(!visibles.length)estado.textContent=todos.length?'Ningún cuartel coincide con la búsqueda.':'Este campo todavía no tiene cuarteles cargados.';
}

function llenarFiltroCultivos(){
  const sel=$('#clCultivo');
  const cultivos=[...new Set(todos.map(c=>String(c.cultivo||'').toLowerCase()).filter(Boolean))].sort();
  sel.innerHTML='<option value="">Todos los cultivos</option>'+
    cultivos.map(c=>`<option value="${esc(c)}">${esc(titulo(c))}</option>`).join('');
}

async function cargar(){
  const campo=typeof window.yoyeActiveCampo==='function'?window.yoyeActiveCampo():null;
  const sub=$('#clSub');
  if(!db||!campo?.id){
    if(sub)sub.textContent='Elige un campo para ver sus cuarteles.';
    $('#clEstado').textContent='Sin campo activo.';
    return;
  }
  if(sub)sub.textContent=`Los cuarteles de ${campo.nombre}, con su cultivo, su tablero y su ficha técnica.`;
  const r=await db.from('cuarteles')
    .select('id,codigo,cuartel,cultivo,variedad,superficie_ha,equipo,caseta')
    .eq('campo_id',campo.id).eq('activo',true).order('codigo');
  if(r.error){
    $('#clEstado').textContent='No se pudieron cargar los cuarteles: '+(r.error.message||'error de conexión');
    return;
  }
  todos=r.data||[];
  llenarFiltroCultivos();
  pintar();
}

addEventListener('yoye-auth-ready',e=>{db=e.detail.client;session=e.detail.session;setTimeout(cargar,300)});
document.addEventListener('yoye-campo-ready',cargar);
document.addEventListener('yoye-campo-changed',()=>{todos=[];cargar()});
addEventListener('DOMContentLoaded',()=>{
  $('#clBuscar').addEventListener('input',pintar);
  $('#clCultivo').addEventListener('change',pintar);
});
})();
