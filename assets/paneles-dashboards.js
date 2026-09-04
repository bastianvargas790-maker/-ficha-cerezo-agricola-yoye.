(()=>{'use strict';
/* Dashboards de Aforos y Calicatas, dentro de la aplicación y por campo.
   Antes estos dos paneles eran enlaces a archivos de Drive: se salía de la app
   y Google pedía acceso. Ahora los datos salen de la base — que es donde ya
   viven desde que Calicatas y Aforo sincronizan — y se dibujan aquí mismo.
   Las políticas de RLS hacen el resto: un jefe ve solo su campo. */

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n1=v=>Number(v).toLocaleString('es-CL',{minimumFractionDigits:1,maximumFractionDigits:1});
const n2=v=>Number(v).toLocaleString('es-CL',{minimumFractionDigits:2,maximumFractionDigits:2});
const n0=v=>Number(v).toLocaleString('es-CL',{maximumFractionDigits:0});
const esNum=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const prom=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const fecha=f=>{if(!f)return '—';const [a,m,d]=String(f).slice(0,10).split('-');return `${d}/${m}/${a}`};

let db,campoActual=null;

/* ---------- Piezas visuales ---------- */
function kpi(label,valor,pie,tono,chico){
  return `<article class="pd-kpi pd-tono-${tono||'verde'}">
    <span class="pd-kpi-label">${esc(label)}</span>
    <strong class="pd-kpi-valor${chico?' pd-chico':''}">${valor}</strong>
    ${pie?`<span class="pd-kpi-pie">${esc(pie)}</span>`:''}
  </article>`;
}
function barras(titulo,kicker,filas,sufijo){
  if(!filas.length)return '';
  const max=Math.max(...filas.map(f=>f.valor),0)||1;
  return `<section class="pd-card">
    <div class="pd-kicker">${esc(kicker)}</div>
    <h3 class="pd-card-title">${esc(titulo)}</h3>
    <div class="pd-bars">${filas.map(f=>`
      <div class="pd-bar-row">
        <span class="pd-bar-label">${esc(f.etiqueta)}</span>
        <span class="pd-bar-track"><i style="width:${Math.max(1,Math.round(f.valor/max*100))}%"></i></span>
        <b class="pd-bar-valor">${f.texto??(n1(f.valor)+(sufijo||''))}</b>
      </div>`).join('')}</div>
  </section>`;
}
/* Barras verticales en SVG: sin librerías, se ve igual sin conexión. */
function columnas(titulo,kicker,datos,unidad,color){
  if(!datos.length)return '';
  const w=320,h=170,pad={l:34,r:8,t:10,b:26};
  const max=Math.max(...datos.map(d=>d.valor))||1;
  const ancho=(w-pad.l-pad.r)/datos.length;
  const barras=datos.map((d,i)=>{
    const alto=Math.max(2,(h-pad.t-pad.b)*(d.valor/max));
    const x=pad.l+i*ancho+ancho*0.18, y=h-pad.b-alto, bw=ancho*0.64;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${alto.toFixed(1)}" rx="3" fill="${color}"></rect>
      <text x="${(x+bw/2).toFixed(1)}" y="${(y-4).toFixed(1)}" class="pd-svg-val">${n1(d.valor)}</text>
      <text x="${(x+bw/2).toFixed(1)}" y="${h-pad.b+15}" class="pd-svg-eje">${esc(d.etiqueta)}</text>`;
  }).join('');
  const lineas=[0,0.5,1].map(f=>{
    const y=h-pad.b-(h-pad.t-pad.b)*f;
    return `<line x1="${pad.l}" x2="${w-pad.r}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="pd-svg-guia"></line>
      <text x="${pad.l-6}" y="${(y+3).toFixed(1)}" class="pd-svg-eje" text-anchor="end">${n1(max*f)}</text>`;
  }).join('');
  return `<section class="pd-card">
    <div class="pd-kicker">${esc(kicker)}</div>
    <h3 class="pd-card-title">${esc(titulo)}</h3>
    <div class="pd-svg-wrap"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(titulo)}">${lineas}${barras}</svg></div>
    ${unidad?`<p class="pd-nota">${esc(unidad)}</p>`:''}
  </section>`;
}
const vacio=t=>`<section class="pd-card pd-vacio">${esc(t)}</section>`;

/* ---------- Datos ---------- */
async function datosAforo(campo){
  const [sect,cuart] = await Promise.all([
    db.from('sectores_aforo').select('id,codigo,cuartel_id').eq('campo_id',campo.id).eq('activo',true),
    db.from('cuarteles').select('id,codigo,equipo,caseta').eq('campo_id',campo.id).eq('activo',true)
  ]);
  const sectores=sect.data||[], cuarteles=cuart.data||[];
  const porCuartel=new Map(cuarteles.map(c=>[c.id,c]));
  let aforos=[];
  if(cuarteles.length){
    const r=await db.from('aforos')
      .select('id,cuartel_id,sector,sector_aforo_id,fecha_evaluacion,temporada,coeficiente_uniformidad,clasificacion,caudal_promedio,presion_entrada_prom,presion_salida_prom,estado_presion')
      .in('cuartel_id',cuarteles.map(c=>c.id))
      .order('fecha_evaluacion',{ascending:false});
    if(!r.error)aforos=r.data||[];
  }
  return {sectores,cuarteles,porCuartel,aforos};
}

function pintarAforo(d,campo){
  const {sectores,cuarteles,porCuartel,aforos}=d;
  const totalSectores=sectores.length||cuarteles.length;
  const evaluados=new Set(aforos.map(a=>a.sector_aforo_id||a.cuartel_id).filter(Boolean));
  const avance=totalSectores?evaluados.size/totalSectores*100:0;
  const cus=aforos.map(a=>Number(a.coeficiente_uniformidad)).filter(v=>Number.isFinite(v)&&v>0);
  const cuProm=prom(cus);
  const enRango=cus.length?cus.filter(v=>v>=70).length/cus.length*100:null;
  const ordenados=[...aforos].filter(a=>esNum(a.coeficiente_uniformidad))
    .sort((a,b)=>Number(b.coeficiente_uniformidad)-Number(a.coeficiente_uniformidad));
  const nombre=a=>a.sector||porCuartel.get(a.cuartel_id)?.codigo||'Sin código';
  const mejor=ordenados[0], peor=ordenados.at(-1);

  const kpis=`<div class="pd-kpis">
    ${kpi('Sectores evaluados',`${n0(evaluados.size)}<span class="pd-de">/ ${n0(totalSectores)}</span>`,'sectores con aforo registrado','verde')}
    ${kpi('Avance del aforo',`${n1(avance)}<span class="pd-de">%</span>`,'del total del campo','verde')}
    ${kpi('CU promedio',cuProm===null?'—':`${n1(cuProm)}<span class="pd-de">%</span>`,'coeficiente de uniformidad','azul')}
    ${kpi('En rango aceptable',enRango===null?'—':`${n1(enRango)}<span class="pd-de">%</span>`,'CU igual o sobre 70%','azul')}
  </div>`;

  const destacados=(mejor&&peor)?`<div class="pd-kpis">
    ${kpi('Mejor desempeño',`${esc(nombre(mejor))} · ${n1(mejor.coeficiente_uniformidad)}%`,'mayor CU registrado','verde',true)}
    ${kpi('Atención prioritaria',`${esc(nombre(peor))} · ${n1(peor.coeficiente_uniformidad)}%`,'menor CU registrado','terracota',true)}
  </div>`:'';

  // Avance por equipo de riego: cuántos de sus sectores ya se aforaron.
  const equipos=new Map();
  for(const s of sectores){
    const eq=porCuartel.get(s.cuartel_id)?.equipo||'Sin equipo';
    const e=equipos.get(eq)||{total:0,hechos:0};
    e.total++; if(evaluados.has(s.id)||evaluados.has(s.cuartel_id))e.hechos++;
    equipos.set(eq,e);
  }
  const filasEquipo=[...equipos.entries()].map(([eq,e])=>({
    etiqueta:eq, valor:e.total?e.hechos/e.total*100:0,
    texto:`${n0(e.hechos)}/${n0(e.total)} · ${n1(e.total?e.hechos/e.total*100:0)}%`
  })).sort((a,b)=>b.valor-a.valor);

  const clases=new Map();
  aforos.forEach(a=>{const c=a.clasificacion||'Sin clasificar';clases.set(c,(clases.get(c)||0)+1)});
  const filasClase=[...clases.entries()].map(([c,q])=>({etiqueta:c,valor:q,texto:n0(q)}));

  const ultimos=aforos.slice(0,8).map(a=>`<tr>
    <td>${esc(nombre(a))}</td><td>${fecha(a.fecha_evaluacion)}</td>
    <td>${esNum(a.coeficiente_uniformidad)?n1(a.coeficiente_uniformidad)+'%':'—'}</td>
    <td>${esc(a.clasificacion||'—')}</td></tr>`).join('');

  return kpis+destacados+
    (filasEquipo.length?barras('Avance por equipo','Comparación',filasEquipo):'')+
    (filasClase.length?barras('Aforos por clasificación','Distribución',filasClase):'')+
    (ultimos?`<section class="pd-card"><div class="pd-kicker">Detalle</div><h3 class="pd-card-title">Últimos aforos</h3>
      <div class="pd-tabla-wrap"><table class="pd-tabla"><thead><tr><th>Sector</th><th>Fecha</th><th>CU</th><th>Clasificación</th></tr></thead><tbody>${ultimos}</tbody></table></div></section>`:'')+
    (aforos.length?'':vacio(`Todavía no hay aforos registrados en ${campo.nombre}. En cuanto se registre el primero desde la app, este panel se llena solo.`));
}

async function datosCalicatas(campo){
  const cuart=await db.from('cuarteles').select('id,codigo,cultivo,equipo').eq('campo_id',campo.id).eq('activo',true);
  const cuarteles=cuart.data||[];
  const porCuartel=new Map(cuarteles.map(c=>[c.id,c]));
  let calicatas=[],lecturas=[],observaciones=[];
  if(cuarteles.length){
    const r=await db.from('calicatas').select('id,cuartel_id,fecha,responsable,union_bulbos,profundidad_efectiva_raices_cm')
      .in('cuartel_id',cuarteles.map(c=>c.id)).eq('activo',true).order('fecha',{ascending:false});
    calicatas=r.data||[];
    if(calicatas.length){
      const ids=calicatas.map(c=>c.id);
      const [l,o]=await Promise.all([
        db.from('lecturas_calicata').select('calicata_id,perfil,profundidad_cm,humedad_pct,ce_ms_cm,temperatura_c,estado').in('calicata_id',ids),
        db.from('observaciones_calicata').select('calicata_id,categoria,opcion_etiqueta').in('calicata_id',ids)
      ]);
      lecturas=l.data||[]; observaciones=o.data||[];
    }
  }
  return {cuarteles,porCuartel,calicatas,lecturas,observaciones};
}

function pintarCalicatas(d,campo){
  const {cuarteles,porCuartel,calicatas,lecturas,observaciones}=d;
  const conCalicata=new Set(calicatas.map(c=>c.cuartel_id));
  const medidas=lecturas.filter(l=>l.estado!=='no_realizada');
  const profs=[...new Set(medidas.map(l=>Number(l.profundidad_cm)).filter(Number.isFinite))].sort((a,b)=>a-b);
  const porProf=campo=>profs.map(p=>{
    const v=medidas.filter(l=>Number(l.profundidad_cm)===p&&esNum(l[campo])).map(l=>Number(l[campo]));
    return {etiqueta:`${n0(p)} cm`, valor:v.length?prom(v):0, n:v.length};
  }).filter(x=>x.n>0);

  const humedades=medidas.filter(l=>esNum(l.humedad_pct)).map(l=>Number(l.humedad_pct));
  const kpis=`<div class="pd-kpis">
    ${kpi('Calicatas registradas',n0(calicatas.length),'en todo el campo','cafe')}
    ${kpi('Cuarteles evaluados',`${n0(conCalicata.size)}<span class="pd-de">/ ${n0(cuarteles.length)}</span>`,'con al menos una calicata','cafe')}
    ${kpi('Última evaluación',fecha(calicatas[0]?.fecha),calicatas[0]?esc(porCuartel.get(calicatas[0].cuartel_id)?.codigo||''):'sin registros','verde',true)}
    ${kpi('Humedad promedio',humedades.length?`${n1(prom(humedades))}<span class="pd-de">%</span>`:'—','de todas las mediciones','verde')}
  </div>`;

  const raices=new Map(),compact=new Map();
  observaciones.forEach(o=>{
    const m=o.categoria==='raices'?raices:o.categoria==='estructura_compactacion'?compact:null;
    if(m&&o.opcion_etiqueta)m.set(o.opcion_etiqueta,(m.get(o.opcion_etiqueta)||0)+1);
  });
  const aFilas=m=>[...m.entries()].map(([k,v])=>({etiqueta:k,valor:v,texto:n0(v)})).sort((a,b)=>b.valor-a.valor);

  const porCuartelFilas=[...conCalicata].map(id=>{
    const suyas=calicatas.filter(c=>c.cuartel_id===id).map(c=>c.id);
    const v=medidas.filter(l=>suyas.includes(l.calicata_id)&&esNum(l.humedad_pct)).map(l=>Number(l.humedad_pct));
    return {etiqueta:porCuartel.get(id)?.codigo||'—', valor:v.length?prom(v):0, texto:v.length?n1(prom(v))+'%':'—'};
  }).sort((a,b)=>b.valor-a.valor);

  return kpis+
    columnas('Humedad promedio por profundidad','Perfil descriptivo',porProf('humedad_pct'),'Promedio de todos los perfiles medidos del campo. Las profundidades sin mediciones no aparecen.','#3f7a4f')+
    columnas('CE promedio por profundidad','Conductividad eléctrica',porProf('ce_ms_cm'),'Milisiemens por centímetro.','#8c6847')+
    (porCuartelFilas.length?barras('Humedad promedio por cuartel','Comparación',porCuartelFilas):'')+
    (raices.size?barras('Estado de raíces','Observaciones',aFilas(raices)):'')+
    (compact.size?barras('Compactación','Observaciones',aFilas(compact)):'')+
    (calicatas.length?'':vacio(`Todavía no hay calicatas registradas en ${campo.nombre}. Se registran desde la app de Calicatas y aparecen aquí de inmediato.`));
}

/* ---------- Orquestación ---------- */
const PANELES={
  aforos:{titulo:'Aforos',kicker:'Uniformidad',desc:'Avance del aforo, coeficiente de uniformidad y sectores que requieren atención.',datos:datosAforo,pinta:pintarAforo},
  calicatas:{titulo:'Calicatas',kicker:'Monitoreo del suelo',desc:'Humedad, conductividad eléctrica y observaciones de perfil por cuartel.',datos:datosCalicatas,pinta:pintarCalicatas}
};

async function abrirPanel(clave){
  const p=PANELES[clave];
  const campo=typeof window.yoyeActiveCampo==='function'?window.yoyeActiveCampo():null;
  if(!p||!campo||!db)return;
  campoActual=campo;
  const host=$('#yoyePanelVista'),lista=$('#yoyePanelesList'),hero=$('#yoyePanelesHero');
  if(!host)return;
  lista.hidden=true; if(hero)hero.hidden=true;
  host.hidden=false;
  host.innerHTML=`<button type="button" class="pd-volver" id="pdVolver">← Paneles</button>
    <div class="pd-kicker">${esc(p.kicker)} · ${esc(campo.nombre)}</div>
    <h2 class="pd-titulo">${esc(p.titulo)}</h2>
    <p class="pd-desc">${esc(p.desc)}</p>
    <div class="pd-cargando">Cargando datos del campo…</div>`;
  $('#pdVolver').onclick=cerrarPanel;
  location.hash='#panel-'+clave;
  try{
    const d=await p.datos(campo);
    $('.pd-cargando',host).outerHTML=p.pinta(d,campo);
  }catch(e){
    const c=$('.pd-cargando',host);
    if(c)c.outerHTML=vacio('No se pudieron cargar los datos: '+(e?.message||'error de conexión'));
  }
}
function cerrarPanel(){
  const host=$('#yoyePanelVista'),lista=$('#yoyePanelesList'),hero=$('#yoyePanelesHero');
  if(host){host.hidden=true;host.innerHTML=''}
  if(lista)lista.hidden=false;
  if(hero)hero.hidden=false;
  if(location.hash.startsWith('#panel-'))history.replaceState(null,'',location.pathname);
}

/* La lista de paneles la dibuja campos.js después de autenticar, así que en vez
   de enganchar cada enlace se escucha el clic en el contenedor: da igual cuándo
   aparezcan los elementos. Los paneles externos siguen abriendo su fuente. */
function claveDe(href){
  if(/aforo-rinconada/.test(href))return 'aforos';
  if(/calicatas/.test(href))return 'calicatas';
  return null;
}
function enlazarLista(){
  const lista=$('#yoyePanelesList');
  if(!lista||lista.dataset.pdEnlazado)return;
  lista.dataset.pdEnlazado='1';
  lista.addEventListener('click',ev=>{
    const a=ev.target.closest('a.yoye-panel-item');
    if(!a)return;
    const clave=claveDe(a.getAttribute('href')||'');
    if(!clave)return;
    ev.preventDefault();
    abrirPanel(clave);
  });
}

addEventListener('yoye-auth-ready',e=>{db=e.detail.client});
addEventListener('DOMContentLoaded',()=>{
  enlazarLista();
  setTimeout(()=>{const m=location.hash.match(/^#panel-(aforos|calicatas)$/);if(m)abrirPanel(m[1])},900);
});
document.addEventListener('yoye-campo-changed',()=>{
  const m=location.hash.match(/^#panel-(aforos|calicatas)$/);
  if(m)abrirPanel(m[1]); else cerrarPanel();
});
window.yoyeAbrirPanel=abrirPanel;
})();
