(()=>{'use strict';
/* Inicio de la app: saludo, indicadores del campo activo, estado de la
   información y las fichas de cultivo.
   El diseño viene de la versión anterior (agricola-yoye-site); lo que cambia es
   el origen de los datos: antes se leían de planillas de Drive, ahora salen de
   la base, filtrados por el campo activo. Las alertas se calculan sobre datos
   reales -- nunca se inventa un porcentaje para llenar una tarjeta. */

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n0=v=>Number(v).toLocaleString('es-CL',{maximumFractionDigits:0});
const n1=v=>Number(v).toLocaleString('es-CL',{minimumFractionDigits:1,maximumFractionDigits:1});
const n2=v=>Number(v).toLocaleString('es-CL',{minimumFractionDigits:2,maximumFractionDigits:2});
const pl=(n,sing,plur)=>`${n0(n)} ${n===1?sing:plur}`;
const esNum=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));

const CULTIVOS=[
  {slug:'cerezo',   nombre:'Cerezo',    cientifico:'Prunus avium',       img:'cerezo.webp',    accent:'#8a2035'},
  {slug:'ciruelo',  nombre:'Ciruelo',   cientifico:'Prunus domestica',   img:'ciruelo.webp',   accent:'#754178'},
  {slug:'nogal',    nombre:'Nogal',     cientifico:'Juglans regia',      img:'nogal.webp',     accent:'#6f7f38'},
  {slug:'duraznero',nombre:'Duraznero', cientifico:'Prunus persica',     img:'duraznero.webp', accent:'#d56559'},
  {slug:'nectarino',nombre:'Nectarino', cientifico:'Prunus persica var. nucipersica', img:'nectarino.webp', accent:'#c75268'},
  {slug:'naranjo',  nombre:'Naranjo',   cientifico:'Citrus sinensis',    img:'naranjo.webp',   accent:'#dc781c'},
  {slug:'palto',    nombre:'Palto',     cientifico:'Persea americana',   img:'palto.webp',     accent:'#3f7a4f'},
  {slug:'mandarina',nombre:'Mandarina', cientifico:'Citrus reticulata',  img:'mandarina.webp', accent:'#c9601b'}
];

let db,session,profile,datos=null;

function saludo(){
  const hora=Number(new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago',hour:'2-digit',hour12:false}).format(new Date()));
  if(hora<6||hora>=20)return 'Buenas noches';
  if(hora<12)return 'Buenos días';
  return 'Buenas tardes';
}
function nombreCorto(){
  const n=profile?.nombre_completo||session?.user?.email||'';
  return n.includes('@')?n.split('@')[0]:n;
}
function cargoDe(){
  const rol=profile?.rol;
  if(rol==='administrador')return 'Administración';
  if(rol==='editor')return 'Jefe de campo';
  return 'Equipo Agrícola Yoye';
}

function pintarCabecera(){
  const g=$('#greeting'); if(g)g.textContent=saludo();
  const n=$('#profileDisplayName'); if(n)n.textContent=nombreCorto()||'—';
  const c=$('#profileJobTitle'); if(c)c.textContent=cargoDe();
}
function estadoSync(txt,ok=true){
  const s=$('#syncText'); if(s)s.textContent=txt;
  const chip=$('#syncChip'); if(chip)chip.classList.toggle('is-off',!ok);
}

/* ---------- Datos del campo activo ---------- */
async function cargarDatos(campo){
  const vacio={cuarteles:[],sectores:[],aforos:[],calicatas:[]};
  if(!db||!campo?.id)return vacio;
  const [cu,se]=await Promise.all([
    db.from('cuarteles').select('id,codigo,cultivo,variedad,superficie_ha').eq('campo_id',campo.id).eq('activo',true),
    db.from('sectores_aforo').select('id,cuartel_id').eq('campo_id',campo.id).eq('activo',true)
  ]);
  const cuarteles=cu.data||[], sectores=se.data||[];
  if(!cuarteles.length)return {...vacio,cuarteles,sectores};
  const ids=cuarteles.map(c=>c.id);
  const [af,ca]=await Promise.all([
    db.from('aforos').select('id,cuartel_id,sector_aforo_id,fecha_evaluacion,coeficiente_uniformidad').in('cuartel_id',ids),
    db.from('calicatas').select('id,cuartel_id,fecha').in('cuartel_id',ids).eq('activo',true)
  ]);
  return {cuarteles,sectores,aforos:af.data||[],calicatas:ca.data||[]};
}

/* ---------- Indicadores ---------- */
function pintarKpis(campo){
  const host=$('#homeKpis'); if(!host)return;
  const {cuarteles,sectores,aforos,calicatas}=datos;
  const conSuperficie=cuarteles.filter(c=>esNum(c.superficie_ha));
  const superficie=conSuperficie.reduce((t,c)=>t+Number(c.superficie_ha),0);
  const superficieCampo=esNum(campo?.superficie_ha)?Number(campo.superficie_ha):null;
  const cultivos=new Set(cuarteles.map(c=>String(c.cultivo||'').toLowerCase()).filter(v=>v&&v!=='por definir'));
  const totalSectores=sectores.length||cuarteles.length;
  const evaluados=new Set(aforos.map(a=>a.sector_aforo_id||a.cuartel_id).filter(Boolean));
  const avance=totalSectores?evaluados.size/totalSectores*100:0;
  const conCalicata=new Set(calicatas.map(c=>c.cuartel_id));
  const ultima=[...calicatas].sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)))[0];

  // La superficie se muestra desde los cuarteles cuando la tienen; si no, la del
  // campo, diciendo de dónde viene. Nunca se rellena con un supuesto.
  const supValor=conSuperficie.length?`${n2(superficie)} ha`:(superficieCampo!==null?`${n2(superficieCampo)} ha`:'—');
  const supPie=conSuperficie.length?`${n0(conSuperficie.length)} de ${n0(cuarteles.length)} ${cuarteles.length===1?'cuartel medido':'cuarteles medidos'}`
    :(superficieCampo!==null?'Superficie del campo · falta por cuartel':'Sin superficie registrada');

  host.innerHTML=`
    <a class="kpi primary kpi-action" href="cuarteles/lista.html"><span>Superficie registrada</span><strong>${esc(supValor)}</strong><small>${esc(supPie)} ›</small></a>
    <a class="kpi kpi-action" href="cuarteles/lista.html"><span>Cuarteles</span><strong>${n0(cuarteles.length)}</strong><small>${n0(cultivos.size)} cultivo${cultivos.size===1?'':'s'} · Ver base ›</small></a>
    <a class="kpi kpi-action" href="paneles/#panel-calicatas"><span>Calicatas</span><strong>${n0(calicatas.length)}</strong><small>${ultima?`Última ${fechaCorta(ultima.fecha)} · Ver panel ›`:'Sin registros · Ver panel ›'}</small></a>
    <a class="kpi kpi-action" href="paneles/#panel-aforos"><span>Avance del aforo</span><strong>${totalSectores?n1(avance)+'%':'—'}</strong><small>${n0(evaluados.size)} de ${n0(totalSectores)} ${totalSectores===1?'sector':'sectores'} ›</small></a>
    <a class="kpi kpi-action" href="paneles/"><span>Cuarteles evaluados</span><strong>${n0(conCalicata.size)}</strong><small>con calicata · Ver paneles ›</small></a>`;
}
function fechaCorta(f){
  if(!f)return '—';
  const [a,m,d]=String(f).slice(0,10).split('-');
  return `${d}/${m}`;
}

/* ---------- Estado de la información ---------- */
function pintarAlertas(campo){
  const host=$('#homeAlerts'); if(!host)return;
  const {cuarteles,sectores,aforos,calicatas}=datos;
  const alertas=[];
  const sinSuperficie=cuarteles.filter(c=>!esNum(c.superficie_ha)).length;
  if(sinSuperficie)alertas.push({tono:'warning',t:`${pl(sinSuperficie,'cuartel','cuarteles')} sin superficie registrada`,
    d:'Sin superficie no se puede calcular lámina de riego ni reposición. Cárgala en la ficha del cuartel.',href:'cuarteles/lista.html'});
  const sinCultivo=cuarteles.filter(c=>!c.cultivo||String(c.cultivo).toLowerCase()==='por definir').length;
  if(sinCultivo)alertas.push({tono:'warning',t:`${pl(sinCultivo,'cuartel','cuarteles')} sin cultivo definido`,
    d:'El cultivo decide qué ficha técnica se ofrece y qué se copia a la planilla.',href:'cuarteles/lista.html'});
  const evaluados=new Set(aforos.map(a=>a.sector_aforo_id||a.cuartel_id).filter(Boolean));
  const faltanAforo=(sectores.length||cuarteles.length)-evaluados.size;
  if(faltanAforo>0)alertas.push({tono:'info',t:`${pl(faltanAforo,'sector','sectores')} sin aforo registrado`,
    d:'Se registran desde la app de Aforo y aparecen en el panel al instante.',href:'paneles/#panel-aforos'});
  const sinCalicata=cuarteles.length-new Set(calicatas.map(c=>c.cuartel_id)).size;
  if(sinCalicata>0)alertas.push({tono:'info',t:`${pl(sinCalicata,'cuartel','cuarteles')} sin calicata`,
    d:'La calicata es lo que muestra cómo se está mojando el suelo bajo el gotero.',href:'paneles/#panel-calicatas'});

  host.innerHTML=alertas.length?alertas.map(a=>`
    <a class="alert alert-${a.tono}" href="${esc(a.href)}">
      <span class="alert-dot" aria-hidden="true"></span>
      <span class="alert-body"><strong>${esc(a.t)}</strong><span>${esc(a.d)}</span></span>
      <span class="alert-go" aria-hidden="true">›</span>
    </a>`).join('')
    :`<div class="empty-state compact"><strong>Todo al día en ${esc(campo?.nombre||'este campo')}</strong><span>No hay datos pendientes de cargar.</span></div>`;
}

/* ---------- Fichas de cultivo ---------- */
function variedadesDe(slug){
  const s=slug.toLowerCase();
  const suyos=(datos?.cuarteles||[]).filter(c=>String(c.cultivo||'').toLowerCase().startsWith(s.slice(0,5)));
  const v=[...new Set(suyos.map(c=>c.variedad).filter(x=>x&&x!=='Sin información'))];
  return v.slice(0,2).join(' · ');
}
function pintarCultivos(){
  const host=$('#homeCrops'); if(!host)return;
  host.innerHTML=CULTIVOS.map(c=>{
    const vars=variedadesDe(c.slug);
    return `<a class="crop-card" href="${c.slug}/" style="--accent:${c.accent}" aria-label="Abrir ficha técnica de ${esc(c.nombre)}">
      <img src="assets/img/portada/${c.img}" alt="Fotografía de ${esc(c.nombre)}" loading="lazy" decoding="async">
      <span class="content">
        <span class="eyebrow" style="color:#fff">Ficha técnica</span>
        <h3>${esc(c.nombre)}</h3>
        <p><i>${esc(c.cientifico)}</i></p>
        <span class="crop-meta"><span>${esc(vars||'Contenido agronómico')}</span></span>
      </span>
    </a>`;
  }).join('');
}

/* ---------- Orquestación ---------- */
let cargando=false;
async function refrescar(){
  const campo=typeof window.yoyeActiveCampo==='function'?window.yoyeActiveCampo():null;
  pintarCabecera();
  const titulo=$('#homeCampo');
  if(titulo)titulo.textContent=campo?.nombre||'';
  if(!db||!campo?.id){
    estadoSync('Elige un campo para ver sus datos',false);
    pintarCultivos();
    return;
  }
  if(cargando)return;
  cargando=true;
  estadoSync('Sincronizando…');
  try{
    datos=await cargarDatos(campo);
    const hora=new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago',hour:'2-digit',minute:'2-digit'}).format(new Date());
    estadoSync(`Sincronizado · ${hora}`);
    pintarKpis(campo); pintarAlertas(campo); pintarCultivos();
  }catch(e){
    estadoSync('Sin conexión con la base',false);
  }finally{cargando=false}
}

addEventListener('yoye-auth-ready',async e=>{
  db=e.detail.client; session=e.detail.session;
  if(session){
    try{const {data}=await db.from('perfiles').select('*').eq('id',session.user.id).maybeSingle();profile=data||null}catch{}
  }
  setTimeout(refrescar,250);
});
document.addEventListener('yoye-campo-ready',refrescar);
document.addEventListener('yoye-campo-changed',()=>{datos=null;refrescar()});
addEventListener('DOMContentLoaded',()=>{pintarCabecera();pintarCultivos()});
addEventListener('online',refrescar);
})();
