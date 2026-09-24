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
/* Qué panel está en pantalla y si la entrada de historial la creamos nosotros:
   eso decide si el botón "← Paneles" puede usar el atrás del navegador o tiene
   que reescribir la URL (cuando se llegó por enlace directo no hay a dónde
   volver dentro de la app). */
let panelAbierto=null,entradaPropia=false;

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
  // pad.t deja aire suficiente para la cifra sobre la barra más alta: con 10 la
  // etiqueta del máximo quedaba cortada por el borde del SVG.
  const w=320,h=176,pad={l:34,r:8,t:18,b:26};
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
/* Mismo criterio que campos.js: en el sitio publicado las páginas cuelgan de
   una carpeta, así que desde /paneles/ hay que subir un nivel. */
const raiz=()=>location.pathname.split('/').filter(Boolean).length>1?'../':'./';
/* Panel sin datos: el aviso va primero y a todo el ancho, con la acción que
   corresponde. Antes quedaba al costado de un gráfico con todo en cero, que es
   peor que no mostrar nada. */
function vacioAccion(titulo,detalle,accion,href){
  return `<section class="pd-card pd-vacio pd-vacio-full">
    <strong class="pd-vacio-titulo">${esc(titulo)}</strong>
    <span>${esc(detalle)}</span>
    ${accion?`<a class="pd-vacio-accion" href="${esc(href)}">${esc(accion)}</a>`:''}
  </section>`;
}

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

  // Sin aforos, "avance por equipo" son barras en cero para todos: ruido que
  // hace parecer roto un panel que solo está esperando el primer registro.
  if(!aforos.length)return kpis+vacioAccion(
    `Todavía no hay aforos registrados en ${campo.nombre}.`,
    `Los ${n0(totalSectores)} sectores del campo ya están cargados. En cuanto se registre el primer aforo desde la app, este panel se llena solo.`,
    'Abrir la app de Aforo', raiz()+'aforo/');

  return kpis+destacados+
    (filasEquipo.length?barras('Avance por equipo','Comparación',filasEquipo):'')+
    (filasClase.length?barras('Aforos por clasificación','Distribución',filasClase):'')+
    (ultimos?`<section class="pd-card pd-ancho"><div class="pd-kicker">Detalle</div><h3 class="pd-card-title">Últimos aforos</h3>
      <div class="pd-tabla-wrap"><table class="pd-tabla"><thead><tr><th>Sector</th><th>Fecha</th><th>CU</th><th>Clasificación</th></tr></thead><tbody>${ultimos}</tbody></table></div></section>`:'');
}

/* ---------- Calicatas ----------
   Una calicata es la lectura de un bulbo húmedo: tres puntos (centro bajo el
   gotero, izquierda y derecha) a tres profundidades. Lo que dice si el riego
   está bien no es el promedio, es la FORMA del perfil: si la humedad cae a
   90 cm el bulbo no llega a la raíz; si la CE sube con la profundidad hay
   sales acumulándose abajo; si un lado está más seco el bulbo va corrido.
   Promediar el campo mezcla cuarteles con distinto suelo, cultivo y caudal, y
   borra justamente eso: los datos reales del campo van de 0 a 6,2 mS/cm de CE
   a 90 cm, y su promedio no describe a ninguno de los dos cuarteles.
   Por eso este panel filtra y compara, y nunca promedia entre cuarteles. */

/* Paleta de los tres puntos del perfil. Fija por identidad -- el centro es
   siempre azul -- y validada para daltonismo sobre el fondo de la app
   (separación mínima ΔE 8,4 en protanopía; todos sobre 3:1 de contraste). */
const PUNTOS=[
  {clave:'punto_cero',      nombre:'Centro',    color:'#2a78d6'},
  {clave:'linea_izquierda', nombre:'Izquierda', color:'#eb6834'},
  {clave:'linea_derecha',   nombre:'Derecha',   color:'#199e70'}
];
const RAMPA=['#cde2fb','#9ec5f4','#6da7ec','#3987e5','#256abf','#184f95'];
const etiquetaPerfil=k=>PUNTOS.find(p=>p.clave===k)?.nombre||k;
const UNION={unidos:'Bulbos unidos',parcialmente_unidos:'Parcialmente unidos',no_unidos:'Bulbos separados'};

/* Filtros del panel. Viven fuera del render para sobrevivir al repintado. */
let filtroCal={cuartel:'',caseta:'',equipo:'',cultivo:''};

async function datosCalicatas(campo){
  const cuart=await db.from('cuarteles').select('id,codigo,cultivo,variedad,caseta,equipo')
    .eq('campo_id',campo.id).eq('activo',true);
  const cuarteles=cuart.data||[];
  const porCuartel=new Map(cuarteles.map(c=>[c.id,c]));
  let calicatas=[],lecturas=[],observaciones=[];
  if(cuarteles.length){
    const r=await db.from('calicatas')
      .select('id,cuartel_id,fecha,hora,responsable,union_bulbos,profundidad_hoyo_cm,profundidad_efectiva_raices_cm,horas_desde_ultimo_riego,duracion_ultimo_riego_h,observaciones_generales')
      .in('cuartel_id',cuarteles.map(c=>c.id)).eq('activo',true).order('fecha',{ascending:false});
    calicatas=r.data||[];
    if(calicatas.length){
      const ids=calicatas.map(c=>c.id);
      const [l,o]=await Promise.all([
        db.from('lecturas_calicata').select('calicata_id,perfil,profundidad_cm,humedad_pct,ce_ms_cm,temperatura_c,estado').in('calicata_id',ids),
        db.from('observaciones_calicata').select('calicata_id,categoria,opcion_codigo,opcion_etiqueta,perfil,profundidad_cm').in('calicata_id',ids)
      ]);
      lecturas=l.data||[]; observaciones=o.data||[];
    }
  }
  return {cuarteles,porCuartel,calicatas,lecturas,observaciones};
}

/* ---------- Piezas propias del perfil ---------- */
/* Perfil vertical: la profundidad baja por el eje Y, como se ve en el hoyo.
   Un gráfico de barras horizontal no deja leer la forma del bulbo.
   El dominio del eje se recibe de afuera y es COMÚN a todos los perfiles del
   panel: si cada tarjeta se escala a sus propios datos, un cuartel que va de
   9 a 30 % se ve igual que uno que va de 29 a 33 %, y comparar deja de
   significar nada. */
function perfilVertical(titulo,kicker,series,unidad,nota,dominio,referencia,raicesCm){
  const profs=[...new Set(series.flatMap(s=>s.puntos.map(p=>p.prof)))].sort((a,b)=>a-b);
  const valores=series.flatMap(s=>s.puntos.map(p=>p.valor)).filter(Number.isFinite);
  if(!profs.length||!valores.length)return '';
  const w=320,h=200,pad={l:36,r:54,t:14,b:28};
  const min=dominio?dominio[0]:0, max=(dominio?dominio[1]:Math.max(...valores))||1;
  const x=v=>pad.l+(v-min)/((max-min)||1)*(w-pad.l-pad.r);
  const maxProf=Math.max(...profs), minProf=Math.min(...profs);
  const y=p=>pad.t+(p-minProf)/((maxProf-minProf)||1)*(h-pad.t-pad.b);

  const guias=profs.map(pr=>`<line x1="${pad.l}" x2="${w-pad.r}" y1="${y(pr).toFixed(1)}" y2="${y(pr).toFixed(1)}" class="pd-svg-guia"></line>
    <text x="${pad.l-6}" y="${(y(pr)+3).toFixed(1)}" class="pd-svg-eje" text-anchor="end">${n0(pr)}</text>`).join('');
  const ejeX=[min,(min+max)/2,max].map(v=>`<text x="${x(v).toFixed(1)}" y="${h-pad.b+16}" class="pd-svg-eje">${n1(v)}</text>`).join('');

  /* Rótulos: cada serie lleva el suyo al final del trazo, pero cuando dos caen
     casi encima -- que es lo normal cuando los tres puntos miden parecido -- se
     separan en vertical. Antes se pisaban y quedaba "29,833,132,2" ilegible. */
  const finales=series.map(s=>{
    const ps=s.puntos.filter(p=>Number.isFinite(p.valor)).sort((a,b)=>a.prof-b.prof);
    return ps.length?{s,p:ps.at(-1),px:x(ps.at(-1).valor),py:y(ps.at(-1).prof)}:null;
  }).filter(Boolean).sort((a,b)=>a.px-b.px);
  finales.forEach((f,i)=>{
    f.dy=0;
    for(let j=0;j<i;j++) if(Math.abs(finales[j].px-f.px)<42&&Math.abs((finales[j].py+finales[j].dy)-(f.py+f.dy))<11)
      f.dy=(finales[j].dy||0)-11;
  });

  const trazos=series.map(s=>{
    const ps=s.puntos.filter(p=>Number.isFinite(p.valor)).sort((a,b)=>a.prof-b.prof);
    if(!ps.length)return '';
    const d=ps.map((p,i)=>`${i?'L':'M'}${x(p.valor).toFixed(1)},${y(p.prof).toFixed(1)}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
      ${ps.map(p=>`<circle cx="${x(p.valor).toFixed(1)}" cy="${y(p.prof).toFixed(1)}" r="4" fill="${s.color}" stroke="var(--paper,#fffdf8)" stroke-width="2"><title>${esc(s.nombre)} · ${n0(p.prof)} cm · ${n1(p.valor)}${esc(unidad||'')}</title></circle>`).join('')}`;
  }).join('');
  /* Referencias del suelo: capacidad de campo y punto de marchitez. Sin ellas
     un 15 % de humedad no dice nada; con ellas se ve de inmediato si la
     lectura está cómoda o al borde del estrés. */
  const bandas=(()=>{
    if(!referencia||!Number.isFinite(referencia.cc)||!Number.isFinite(referencia.pmp))return '';
    const dentro=v=>v>=min&&v<=max;
    const linea=(v,txt,color)=>dentro(v)?`<line x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="${pad.t-4}" y2="${h-pad.b}" stroke="${color}" stroke-width="1" stroke-dasharray="4 3"></line>
      <text x="${x(v).toFixed(1)}" y="${pad.t-6}" class="pd-svg-eje" fill="${color}">${txt}</text>`:'';
    const zona=dentro(referencia.pmp)||dentro(referencia.cc)
      ? `<rect x="${x(Math.max(min,referencia.pmp)).toFixed(1)}" y="${pad.t}" width="${Math.max(0,x(Math.min(max,referencia.cc))-x(Math.max(min,referencia.pmp))).toFixed(1)}" height="${(h-pad.b-pad.t).toFixed(1)}" fill="#3f7a4f" opacity=".07"></rect>`:'';
    return zona+linea(referencia.pmp,'PMP','#b1543a')+linea(referencia.cc,'CC','#2a78d6');
  })();

  /* Hasta dónde llegan las raíces: bajo esa línea el agua medida ya no la toma
     el árbol. Se dibuja siempre que la profundidad declarada caiga dentro del
     rango del hoyo, para no perder de vista qué parte del perfil manda. */
  const lineaRaices=(()=>{
    const r=Number(raicesCm);
    if(!Number.isFinite(r)||r<minProf||r>maxProf)return '';
    const yr=y(r).toFixed(1);
    return `<line x1="${pad.l}" x2="${w-pad.r}" y1="${yr}" y2="${yr}" stroke="#7d5838" stroke-width="1.4" stroke-dasharray="6 4"></line>
      <text x="${pad.l+4}" y="${(Number(yr)-5).toFixed(1)}" class="pd-svg-eje" text-anchor="start" fill="#7d5838">fin de raíces</text>`;
  })();

  const rotulos=finales.map(f=>`<text x="${Math.min(w-3,f.px+9).toFixed(1)}" y="${(f.py+f.dy+3).toFixed(1)}"
    class="pd-svg-val" text-anchor="start" fill="${f.s.color}">${n1(f.p.valor)}</text>`).join('');

  return `<section class="pd-card">
    <div class="pd-kicker">${esc(kicker)}</div>
    <h3 class="pd-card-title">${esc(titulo)}</h3>
    <div class="pd-svg-wrap"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(titulo)}">
      ${guias}${ejeX}${bandas}${lineaRaices}${trazos}${rotulos}
    </svg></div>
    ${nota?`<p class="pd-nota">${esc(nota)}</p>`:''}
  </section>`;
}

/* Barras divergentes: sube o baja respecto de cero. Con barras normales, "la CE
   bajó 0,64" se dibujaba como una barra diminuta hacia el mismo lado que "subió
   4,03", que es justo lo contrario de lo que pasó. */
/* Evolución de un mismo cuartel entre fechas. Una calicata sirve para decidir
   el riego de hoy; la serie de calicatas del mismo cuartel es la que muestra si
   el suelo se está secando, si las sales se acumulan o si un cambio de pauta
   funcionó. */
function serieTiempo(titulo,kicker,fechas,series,nota,referencia){
  const puntos=series.flatMap(s=>s.valores.filter(v=>Number.isFinite(v)));
  if(fechas.length<2||!puntos.length)return '';
  const w=320,h=190,pad={l:38,r:14,t:16,b:34};
  const vals=puntos.concat(referencia?[referencia.cc,referencia.pmp].filter(Number.isFinite):[]);
  const max=Math.max(...vals)*1.08||1, min=Math.min(0,Math.min(...vals));
  const x=i=>pad.l+(fechas.length===1?0:i/(fechas.length-1))*(w-pad.l-pad.r);
  const y=v=>h-pad.b-((v-min)/((max-min)||1))*(h-pad.t-pad.b);
  const guias=[min,(min+max)/2,max].map(v=>`<line x1="${pad.l}" x2="${w-pad.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="pd-svg-guia"></line>
    <text x="${pad.l-6}" y="${(y(v)+3).toFixed(1)}" class="pd-svg-eje" text-anchor="end">${n1(v)}</text>`).join('');
  const banda=referencia&&Number.isFinite(referencia.cc)&&Number.isFinite(referencia.pmp)
    ? `<rect x="${pad.l}" y="${y(referencia.cc).toFixed(1)}" width="${(w-pad.l-pad.r).toFixed(1)}" height="${Math.max(0,y(referencia.pmp)-y(referencia.cc)).toFixed(1)}" fill="#3f7a4f" opacity=".08"></rect>
       <text x="${w-pad.r}" y="${(y(referencia.cc)-4).toFixed(1)}" class="pd-svg-eje" text-anchor="end">CC</text>
       <text x="${w-pad.r}" y="${(y(referencia.pmp)+11).toFixed(1)}" class="pd-svg-eje" text-anchor="end">PMP</text>`:'';
  const ejeX=fechas.map((f,i)=>`<text x="${x(i).toFixed(1)}" y="${h-pad.b+16}" class="pd-svg-eje">${esc(String(f))}</text>`).join('');
  const dibujadas=series.map(s=>({s,ps:s.valores.map((v,i)=>({v,i})).filter(p=>Number.isFinite(p.v))}))
    .filter(d=>d.ps.length);
  /* Los rótulos del final se pisaban cuando dos profundidades terminan con
     valores parecidos, que es lo normal. Se separan en vertical. */
  const finales=dibujadas.map(d=>({d,px:x(d.ps.at(-1).i),py:y(d.ps.at(-1).v),dy:0}))
    .sort((a,b)=>a.py-b.py);
  finales.forEach((f,i)=>{for(let j=0;j<i;j++)
    if(Math.abs(finales[j].px-f.px)<46&&Math.abs((finales[j].py+finales[j].dy)-(f.py+f.dy))<12)f.dy=(finales[j].dy||0)+12;});
  const trazos=dibujadas.map(({s,ps})=>{
    const d=ps.map((p,k)=>`${k?'L':'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>
      ${ps.map(p=>`<circle cx="${x(p.i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4" fill="${s.color}" stroke="var(--paper,#fffdf8)" stroke-width="2"><title>${esc(s.nombre)} · ${esc(fechas[p.i])} · ${n1(p.v)}${esc(s.unidad||'')}</title></circle>`).join('')}`;
  }).join('');
  const rotulos=finales.map(f=>`<text x="${(f.px-6).toFixed(1)}" y="${(f.py+f.dy-8).toFixed(1)}"
    class="pd-svg-val" text-anchor="end" fill="${f.d.s.color}">${n1(f.d.ps.at(-1).v)}</text>`).join('');
  return `<section class="pd-card"><div class="pd-kicker">${esc(kicker)}</div>
    <h3 class="pd-card-title">${esc(titulo)}</h3>
    <div class="pd-svg-wrap"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(titulo)}">${guias}${banda}${ejeX}${trazos}${rotulos}</svg></div>
    <div class="pd-leyenda">${series.map(s=>`<span class="pd-leyenda-item"><i style="background:${s.color}"></i>${esc(s.nombre)}</span>`).join('')}</div>
    ${nota?`<p class="pd-nota">${esc(nota)}</p>`:''}</section>`;
}

function barrasDivergentes(titulo,kicker,filas,nota){
  const vals=filas.map(f=>f.valor).filter(Number.isFinite);
  if(!vals.length)return '';
  const tope=Math.max(...vals.map(Math.abs))||1;
  return `<section class="pd-card">
    <div class="pd-kicker">${esc(kicker)}</div>
    <h3 class="pd-card-title">${esc(titulo)}</h3>
    <div class="pd-div">${filas.map(f=>{
      const pos=f.valor>=0, ancho=Math.max(1.5,Math.abs(f.valor)/tope*50);
      return `<div class="pd-div-row">
        <span class="pd-div-label">${esc(f.etiqueta)}</span>
        <span class="pd-div-track">
          <i class="${pos?'pd-div-pos':'pd-div-neg'}" style="${pos?'left:50%':'right:50%'};width:${ancho.toFixed(1)}%"></i>
          <b class="pd-div-cero"></b>
        </span>
        <b class="pd-div-valor">${esc(f.texto)}</b>
      </div>`}).join('')}</div>
    ${nota?`<p class="pd-nota">${esc(nota)}</p>`:''}
  </section>`;
}

/* Anillo: solo para parte-de-un-todo con pocas porciones, nunca para comparar
   valores parecidos (para eso están las barras). */
function anillo(titulo,kicker,partes,pie){
  const total=partes.reduce((t,p)=>t+p.valor,0);
  if(!total)return '';
  const r=46,c=2*Math.PI*r; let acum=0;
  const arcos=partes.filter(p=>p.valor>0).map(p=>{
    const frac=p.valor/total, largo=Math.max(0,c*frac-3);   // 3 = separación entre porciones
    const el=`<circle cx="60" cy="60" r="${r}" fill="none" stroke="${p.color}" stroke-width="15"
      stroke-dasharray="${largo.toFixed(2)} ${(c-largo).toFixed(2)}" stroke-dashoffset="${(-c*acum).toFixed(2)}"
      transform="rotate(-90 60 60)"><title>${esc(p.etiqueta)}: ${n0(p.valor)} de ${n0(total)} (${n1(frac*100)}%)</title></circle>`;
    acum+=frac; return el;
  }).join('');
  const mayor=[...partes].sort((a,b)=>b.valor-a.valor)[0];
  return `<section class="pd-card">
    <div class="pd-kicker">${esc(kicker)}</div>
    <h3 class="pd-card-title">${esc(titulo)}</h3>
    <div class="pd-anillo-fila">
      <svg viewBox="0 0 120 120" class="pd-anillo" role="img" aria-label="${esc(titulo)}">
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--surface-alt,#efe9dc)" stroke-width="15"></circle>
        ${arcos}
        <text x="60" y="57" text-anchor="middle" class="pd-anillo-num">${n0(mayor.valor)}</text>
        <text x="60" y="73" text-anchor="middle" class="pd-anillo-de">de ${n0(total)}</text>
      </svg>
      <ul class="pd-leyenda-lista">${partes.filter(p=>p.valor>0).map(p=>`
        <li><i style="background:${p.color}"></i><span>${esc(p.etiqueta)}</span><b>${n0(p.valor)}</b></li>`).join('')}</ul>
    </div>
    ${pie?`<p class="pd-nota">${esc(pie)}</p>`:''}
  </section>`;
}

function tabla(titulo,kicker,cabeceras,filas,nota){
  if(!filas.length)return '';
  return `<section class="pd-card pd-ancho"><div class="pd-kicker">${esc(kicker)}</div>
    <h3 class="pd-card-title">${esc(titulo)}</h3>
    <div class="pd-tabla-wrap"><table class="pd-tabla"><thead><tr>${cabeceras.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${filas.map(f=>`<tr>${f.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    ${nota?`<p class="pd-nota">${esc(nota)}</p>`:''}</section>`;
}

/* ---------- Render del panel ---------- */
function pintarCalicatas(d,campo){
  const {cuarteles,porCuartel,calicatas,lecturas,observaciones}=d;

  if(!calicatas.length)return `<div class="pd-kpis">
    ${kpi('Calicatas registradas','0','en todo el campo','cafe')}
    ${kpi('Cuarteles del campo',n0(cuarteles.length),'listos para evaluar','cafe')}
  </div>`+vacioAccion(
    `Todavía no hay calicatas registradas en ${campo.nombre}.`,
    'Se registran desde la app de Calicatas y aparecen acá de inmediato, sin pasar por la planilla.',
    'Abrir la app de Calicatas', raiz()+'calicatas/');

  // --- Filtros: una sola fila que alcanza a todos los gráficos ---
  const cuartelDe=k=>porCuartel.get(k.cuartel_id)||{};
  const opciones=(campoNombre)=>[...new Set(calicatas.map(k=>cuartelDe(k)[campoNombre]).filter(Boolean))].sort();
  const pasa=k=>{const q=cuartelDe(k);
    return (!filtroCal.cuartel||q.codigo===filtroCal.cuartel)
        && (!filtroCal.caseta ||q.caseta===filtroCal.caseta)
        && (!filtroCal.equipo ||q.equipo===filtroCal.equipo)
        && (!filtroCal.cultivo||q.cultivo===filtroCal.cultivo)};
  const sel=calicatas.filter(pasa);
  const selector=(id,etq,vals,actual)=>`<label class="pd-filtro"><span>${esc(etq)}</span>
    <select data-cal-filtro="${id}"><option value="">Todos</option>
    ${vals.map(v=>`<option value="${esc(v)}"${v===actual?' selected':''}>${esc(v)}</option>`).join('')}</select></label>`;
  const filtros=`<div class="pd-filtros">
    ${selector('cuartel','Cuartel',opciones('codigo'),filtroCal.cuartel)}
    ${selector('cultivo','Cultivo',opciones('cultivo'),filtroCal.cultivo)}
    ${selector('caseta','Caseta',opciones('caseta'),filtroCal.caseta)}
    ${selector('equipo','Equipo',opciones('equipo'),filtroCal.equipo)}
    ${Object.values(filtroCal).some(Boolean)?'<button type="button" class="pd-filtro-limpiar" data-cal-filtro="limpiar">Quitar filtros</button>':''}
  </div>`;

  if(!sel.length)return filtros+vacio('Ningún registro cumple con ese filtro. Quita alguno para volver a ver datos.');

  const idsSel=new Set(sel.map(k=>k.id));
  const medidas=lecturas.filter(l=>idsSel.has(l.calicata_id)&&l.estado!=='no_realizada');
  const valorDe=(cal,perfil,prof,campoDato)=>{
    const l=medidas.find(x=>x.calicata_id===cal.id&&x.perfil===perfil&&Number(x.profundidad_cm)===prof);
    return l&&esNum(l[campoDato])?Number(l[campoDato]):null;
  };
  const profsSel=[...new Set(medidas.map(l=>Number(l.profundidad_cm)).filter(Number.isFinite))].sort((a,b)=>a-b);

  // --- Indicadores de la selección: hechos, no promedios entre cuarteles ---
  const cuartelesSel=new Set(sel.map(k=>k.cuartel_id));
  const ultima=sel[0];
  /* --- Lectura agronómica de cada calicata ---
     El criterio vive en assets/calicatas-analisis.js y es el mismo que usa la
     app al guardar: zona de raíces, uniformidad del bulbo, movimiento del agua
     y sales. Acá solo se dibuja. */
  const agro=globalThis.YoyeAgro;
  const texturaDe=cal=>observaciones.find(o=>o.calicata_id===cal.id&&o.categoria==='horizontes')?.opcion_codigo||null;
  const lecturasDe=cal=>medidas.filter(l=>l.calicata_id===cal.id);
  const cacheAgro=new Map();
  const leer=cal=>{
    if(!agro)return null;
    if(!cacheAgro.has(cal.id))cacheAgro.set(cal.id,agro.resumen(lecturasDe(cal),{
      textura:texturaDe(cal),raicesCm:cal.profundidad_efectiva_raices_cm,
      unionBulbos:cal.union_bulbos,cultivo:cuartelDe(cal).cultivo}));
    return cacheAgro.get(cal.id);
  };
  const totalesDe=cal=>{
    const r=leer(cal);
    if(!r)return {h:[],ce:[],t:[],hTot:null,ceTot:null,tTot:null};
    const porProf=clave=>profsSel.map(pr=>{
      const x=r.porProfundidad.find(y=>y.prof===pr);
      return {prof:pr,valor:x&&Number.isFinite(x[clave])?x[clave]:null};
    });
    return {h:porProf('h'),ce:porProf('ce'),t:porProf('t'),
      hTot:r.total.h,ceTot:r.total.ce,tTot:r.total.t,zona:r.zonaRaices,resumen:r};
  };
  const conUnidad=(v,f,u)=>v===null||v===undefined?'—':f(v)+u;
  const raices=sel.map(k=>Number(k.profundidad_efectiva_raices_cm)).filter(Number.isFinite);

  /* Indicadores: lo que se mide es la ZONA DE RAÍCES de cada calicata, no una
     profundidad suelta ni un promedio del campo. Con varias calicatas se
     muestra el rango entre ellas. */
  const lecturasSel=sel.map(leer).filter(Boolean);
  const rango=(valor,f,u)=>{
    const v=lecturasSel.map(valor).filter(x=>x!==null&&x!==undefined&&Number.isFinite(x));
    if(!v.length)return null;
    const mn=Math.min(...v),mx=Math.max(...v);
    return {valor:(v.length===1||f(mn)===f(mx)?f(mn):`${f(mn)}–${f(mx)}`)+`<span class="pd-de">${u}</span>`,n:v.length};
  };
  const pieRango=r=>r.n===1?'en la zona de raíces':`rango entre ${n0(r.n)} calicatas`;
  const kH=rango(r=>r.zonaRaices.h,n1,'%'),kCe=rango(r=>r.zonaRaices.ce,n2,'mS/cm'),
    kAgo=rango(r=>r.zonaRaices.agotamiento,n0,'%');
  /* Cada alerta lleva su cuartel y su fecha: una alerta sin saber de qué
     calicata habla no sirve para ir a terreno. */
  const alertas=sel.flatMap(cal=>{
    const r=leer(cal);if(!r)return [];
    return r.diagnostico.puntos.filter(p=>p.nivel==='alerta'||p.nivel==='critico')
      .map(p=>({...p,cuartel:cuartelDe(cal).codigo||'—',fecha:cal.fecha}));
  });

  const kpis=`<div class="pd-kpis">
    ${kpi('Calicatas en la selección',n0(sel.length),`${n0(cuartelesSel.size)} ${cuartelesSel.size===1?'cuartel':'cuarteles'} de ${n0(cuarteles.length)}`,'cafe')}
    ${kpi('Última evaluación',fecha(ultima.fecha),esc(cuartelDe(ultima).codigo||''),'verde',true)}
    ${kH?kpi('Humedad en zona de raíces',kH.valor,pieRango(kH),'azul',true):''}
    ${kAgo?kpi('Agua aprovechable consumida',kAgo.valor,'0% = capacidad de campo · 100% = marchitez','terracota',true)
      :kpi('Agua aprovechable','Sin textura','Anota la textura del suelo al registrar','terracota',true)}
    ${kCe?kpi('CE en zona de raíces',kCe.valor,'sonda directa, sin promediar cuarteles','cafe',true):''}
    ${raices.length?kpi('Raíces efectivas',`${Math.min(...raices)===Math.max(...raices)?n0(raices[0]):`${n0(Math.min(...raices))}–${n0(Math.max(...raices))}`}<span class="pd-de">cm</span>`,'profundidad declarada','verde',true):''}
  </div>`;

  const totalesFilas=sel.slice(0,40).map(cal=>{
    const q=cuartelDe(cal),tt=totalesDe(cal),z=tt.zona||{};
    return [`<strong>${esc(q.codigo||'—')}</strong>`,`<span title="${fecha(cal.fecha)}">${String(fecha(cal.fecha)).slice(0,5)}</span>`,
      `<strong>${conUnidad(z.h,n1,'')}</strong>`,
      z.agotamiento==null?'—':`<strong>${n0(z.agotamiento)}%</strong>`,
      `<strong>${conUnidad(tt.hTot,n1,'')}</strong>`,
      `<strong>${conUnidad(tt.ceTot,n2,'')}</strong>`,
      `<strong>${conUnidad(tt.tTot,n1,'')}</strong>`,
      ...tt.h.map(x=>{
        const texto=conUnidad(x.valor,n1,'');
        const fuera=esNum(cal.profundidad_efectiva_raices_cm)&&x.prof>Number(cal.profundidad_efectiva_raices_cm);
        return fuera?`<span class="pd-fuera" title="Bajo la zona de raíces: medido, pero el árbol no lo aprovecha">${texto}</span>`:texto;
      })];
  });
  const tablaTotales=tabla('Totales por calicata','Zona de raíces y perfil completo',
    ['Cuartel','Fecha','H raíces %','Agotam.','Hum. %','CE','T °C',...profsSel.map(pr=>`H% ${n0(pr)} cm`)],
    totalesFilas,
    'Las profundidades en gris quedan bajo la zona de raíces: se miden igual, pero esa agua no la toma el árbol. H raíces es el promedio de las profundidades dentro de la zona de raíces declarada. Agotam. es cuánta del agua aprovechable ya se consumió (0% = capacidad de campo, 100% = punto de marchitez); necesita la textura anotada. CE en mS/cm, sonda directa. Cada fila es UNA calicata; no se mezclan cuarteles.');

  // --- Perfiles: uno por calicata, nunca uno solo promediado ---
  const perfilesDe=(cal,dato,unidad)=>PUNTOS.map(p=>({
    nombre:p.nombre,color:p.color,
    puntos:profsSel.map(pr=>({prof:pr,valor:valorDe(cal,p.clave,pr,dato)})).filter(x=>x.valor!==null)
  })).filter(s=>s.puntos.length);

  // Con un cuartel elegido se ve el detalle; sin filtro, un perfil por cuartel
  // (su calicata más reciente) para poder compararlos de un vistazo.
  const porCuartelUltima=[...cuartelesSel].map(id=>sel.find(k=>k.cuartel_id===id));
  const detalle=filtroCal.cuartel||porCuartelUltima.length===1;
  const muestras=detalle?sel.slice(0,4):porCuartelUltima.slice(0,6);

  /* Dominio común: se calcula sobre TODAS las muestras que se van a dibujar,
     así los perfiles de dos cuarteles se pueden poner uno al lado del otro. */
  const dominioDe=dato=>{
    const v=muestras.flatMap(cal=>PUNTOS.flatMap(p=>profsSel.map(pr=>valorDe(cal,p.clave,pr,dato))))
      .filter(x=>x!==null&&Number.isFinite(x));
    if(!v.length)return null;
    const max=Math.max(...v);
    return [0, max*1.05||1];
  };
  const domHum=dominioDe('humedad_pct'), domCe=dominioDe('ce_ms_cm');

  /* Diagnóstico por calicata: el texto que uno diría parado al lado del hoyo,
     con el número que lo respalda. Cada frase sale de ESTA calicata. */
  const NIVEL={critico:'alerta',alerta:'alerta',exceso:'alerta',atencion:'atencion',ok:'ok',info:'info'};
  function diagnosticoCard(cal){
    const r=leer(cal);if(!r||!r.diagnostico.puntos.length)return '';
    const q=cuartelDe(cal);
    const ref=r.textura
      ? `${r.textura.etiqueta}: CC ${n1(r.textura.cc)} % y PMP ${n1(r.textura.pmp)} % en humedad volumétrica `+
        `(${n0(r.textura.ccPeso)} % y ${n0(r.textura.pmpPeso)} % en peso seco, Da ${n2(r.textura.da)} g/cc), `+
        `capacidad de retención ${n2(r.textura.cr)} mm/mm.`
      : 'Sin textura anotada: el agua aprovechable no se puede calcular.';
    return `<section class="pd-card pd-diag">
      <div class="pd-kicker">Lectura de la calicata</div>
      <h3 class="pd-card-title">${esc(q.codigo||'Sin código')} · ${fecha(cal.fecha)}</h3>
      <ul class="pd-diag-lista">${r.diagnostico.puntos.map(p=>
        `<li class="pd-diag-${esc(NIVEL[p.nivel]||'info')}">${esc(p.texto)}</li>`).join('')}</ul>
      ${r.diagnostico.acciones.length?`<div class="pd-diag-accion"><b>Qué hacer</b><ul>${
        r.diagnostico.acciones.map(a=>`<li>${esc(a)}</li>`).join('')}</ul></div>`:''}
      <p class="pd-nota">${esc(ref)}</p>
    </section>`;
  }

  const perfiles=muestras.map(cal=>{
    const q=cuartelDe(cal);
    const ctx=[q.cultivo,q.variedad,q.caseta?`Caseta ${q.caseta}`:null,q.equipo].filter(Boolean).join(' · ');
    const hum=perfilesDe(cal,'humedad_pct');
    const ce=perfilesDe(cal,'ce_ms_cm');
    const nota=[
      esNum(cal.horas_desde_ultimo_riego)?`${n0(cal.horas_desde_ultimo_riego)} h desde el último riego`:null,
      esNum(cal.duracion_ultimo_riego_h)?`riego de ${n1(cal.duracion_ultimo_riego_h)} h`:null,
      UNION[cal.union_bulbos]||null,
      esNum(cal.profundidad_efectiva_raices_cm)?`raíces a ${n0(cal.profundidad_efectiva_raices_cm)} cm`:null
    ].filter(Boolean).join(' · ');
    return `<div class="pd-perfil"><div class="pd-perfil-cab">
        <strong>${esc(q.codigo||'Sin código')}</strong>
        <span>${esc(ctx)} · ${fecha(cal.fecha)}</span>
        ${(()=>{const tt=totalesDe(cal);return `<span class="pd-totales">Total: <b>${conUnidad(tt.hTot,n1,' %')}</b> humedad · <b>${conUnidad(tt.ceTot,n2,' mS/cm')}</b> CE · <b>${conUnidad(tt.tTot,n1,' °C')}</b></span>`})()}</div>
      ${perfilVertical('Humedad por profundidad','Perfil del bulbo',hum,' %',nota||null,domHum,leer(cal)?.textura||null,cal.profundidad_efectiva_raices_cm)}
      ${perfilVertical('CE por profundidad','Conductividad eléctrica',ce,' mS/cm',null,domCe,null,cal.profundidad_efectiva_raices_cm)}
      ${diagnosticoCard(cal)}
    </div>`;
  }).join('');

  // --- Comparación entre cuarteles (no promedio del campo) ---
  const compara=[...cuartelesSel].map(id=>{
    const cal=sel.find(k=>k.cuartel_id===id);
    const q=porCuartel.get(id)||{};
    const h=prof=>{const v=PUNTOS.map(p=>valorDe(cal,p.clave,prof,'humedad_pct')).filter(x=>x!==null);
      return v.length?prom(v):null};
    const ce=prof=>{const v=PUNTOS.map(p=>valorDe(cal,p.clave,prof,'ce_ms_cm')).filter(x=>x!==null);
      return v.length?prom(v):null};
    const sup=profsSel[0], fondo=profsSel.at(-1);
    return {codigo:q.codigo||'—', cultivo:q.cultivo||'', fecha:cal.fecha,
      hSup:h(sup), hFondo:h(fondo), ceSup:ce(sup), ceFondo:ce(fondo),
      caida:(h(sup)!==null&&h(fondo)!==null)?h(sup)-h(fondo):null,
      salto:(ce(sup)!==null&&ce(fondo)!==null)?ce(fondo)-ce(sup):null};
  }).sort((a,b)=>(b.salto??-99)-(a.salto??-99));

  const sup=profsSel[0], fondo=profsSel.at(-1);
  const barrasComparacion=(compara.length>1&&fondo!==sup)?
    barrasDivergentes(`Cambio de CE entre ${n0(sup)} y ${n0(fondo)} cm`,'Comparación entre cuarteles',
      compara.filter(c=>c.salto!==null).map(c=>({etiqueta:c.codigo,valor:c.salto,
        texto:`${c.salto>0?'+':'−'}${n2(Math.abs(c.salto))} mS/cm`})),
      'A la derecha, la CE sube con la profundidad: hay sales acumulándose bajo la zona de raíces.')
    +barrasDivergentes(`Cambio de humedad entre ${n0(sup)} y ${n0(fondo)} cm`,'Comparación entre cuarteles',
      compara.filter(c=>c.caida!==null).map(c=>({etiqueta:c.codigo,valor:-c.caida,
        texto:`${c.caida>0?'−':'+'}${n1(Math.abs(c.caida))} pp`})),
      'A la izquierda, el suelo se seca hacia abajo: el bulbo no está llegando a esa profundidad.')
    :'';

  // --- Tendencia: solo si un cuartel tiene más de una fecha ---
  const fechasPorCuartel=new Map();
  sel.forEach(k=>{const a=fechasPorCuartel.get(k.cuartel_id)||[];a.push(k);fechasPorCuartel.set(k.cuartel_id,a)});
  const conHistoria=[...fechasPorCuartel.entries()].filter(([,ks])=>new Set(ks.map(k=>k.fecha)).size>1);
  const tendencia=conHistoria.length?tabla('Evolución por fecha','Tendencia',
    ['Cuartel','Fecha',`Humedad ${n0(sup)} cm`,`Humedad ${n0(fondo)} cm`,`CE ${n0(fondo)} cm`],
    conHistoria.flatMap(([id,ks])=>ks.sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))).map(k=>{
      const q=porCuartel.get(id)||{};
      const h=prof=>{const v=PUNTOS.map(p=>valorDe(k,p.clave,prof,'humedad_pct')).filter(x=>x!==null);return v.length?n1(prom(v))+' %':'—'};
      const c=prof=>{const v=PUNTOS.map(p=>valorDe(k,p.clave,prof,'ce_ms_cm')).filter(x=>x!==null);return v.length?n2(prom(v)):'—'};
      return [esc(q.codigo||'—'),fecha(k.fecha),h(sup),h(fondo),c(fondo)];
    })),'Cada fila es una calicata completa; los valores son el promedio de los tres puntos de ESA calicata.'):'';

  // --- Anillo: unión de bulbos, que sí es parte de un todo ---
  const unionCuenta=new Map();
  sel.forEach(k=>{const u=UNION[k.union_bulbos]||'Sin registrar';unionCuenta.set(u,(unionCuenta.get(u)||0)+1)});
  /* Un anillo de una sola porción no dice nada: cuando todas las calicatas
     coinciden, el dato cabe en una frase. */
  const anilloUnion=unionCuenta.size>1
    ? anillo('Unión de bulbos','Continuidad de la franja húmeda',
        [...unionCuenta.entries()].map(([etiqueta,valor],i)=>({etiqueta,valor,color:RAMPA[RAMPA.length-1-i]||RAMPA[0]})),
        'Cuando los bulbos no se unen quedan franjas secas entre goteros.')
    : `<section class="pd-card"><div class="pd-kicker">Continuidad de la franja húmeda</div>
       <h3 class="pd-card-title">Unión de bulbos</h3>
       <p class="pd-dato-suelto">${esc([...unionCuenta.keys()][0]||'Sin registrar')}</p>
       <p class="pd-nota">Las ${n0(sel.length)} calicatas de la selección coinciden.</p></section>`;

  // --- Observaciones de perfil ---
  const cuentaObs=cat=>{const m=new Map();
    observaciones.filter(o=>idsSel.has(o.calicata_id)&&o.categoria===cat&&o.opcion_etiqueta)
      .forEach(o=>m.set(o.opcion_etiqueta,(m.get(o.opcion_etiqueta)||0)+1));
    return [...m.entries()].map(([etiqueta,valor])=>({etiqueta,valor,texto:n0(valor)})).sort((a,b)=>b.valor-a.valor)};
  const obsRaices=cuentaObs('raices'), obsComp=cuentaObs('estructura_compactacion');

  // --- Tabla completa: cada lectura, sin agregar nada ---
  const detalleFilas=sel.slice(0,6).flatMap(cal=>{
    const q=cuartelDe(cal);
    return profsSel.map(pr=>[esc(q.codigo||'—'),fecha(cal.fecha),`${n0(pr)} cm`,
      ...PUNTOS.map(p=>{const v=valorDe(cal,p.clave,pr,'humedad_pct');return v===null?'—':n1(v)+' %'}),
      (()=>{const v=valorDe(cal,'punto_cero',pr,'ce_ms_cm');return v===null?'—':n2(v)})()]);
  });

  const leyenda=`<div class="pd-leyenda pd-ancho">${PUNTOS.map(p=>
    `<span class="pd-leyenda-item"><i style="background:${p.color}"></i>${esc(p.nombre)}</span>`).join('')}
    <span class="pd-leyenda-nota">${muestras.length>1?'Todos los perfiles comparten la misma escala.':'Escala del cuartel.'}</span></div>`;

  /* Ranking: qué cuartel está más apretado de agua HOY. Es la pregunta con la
     que uno entra al panel, y antes había que leer tres gráficos para saberlo. */
  const ranking=(()=>{
    const filas=[...cuartelesSel].map(id=>{
      const cal=sel.find(k=>k.cuartel_id===id),r=leer(cal),q=porCuartel.get(id)||{};
      if(!r||!esNum(r.zonaRaices.h))return null;
      const ago=r.zonaRaices.agotamiento;
      return {etiqueta:q.codigo||'—',valor:ago!=null?ago:r.zonaRaices.h,
        texto:ago!=null?`${n0(ago)}% consumido · ${n1(r.zonaRaices.h)}%`:`${n1(r.zonaRaices.h)}%`,
        orden:ago!=null?ago:-r.zonaRaices.h};
    }).filter(Boolean).sort((a,b)=>b.orden-a.orden);
    if(filas.length<2)return '';
    const conAgo=lecturasSel.some(r=>r.zonaRaices.agotamiento!=null);
    return barras(conAgo?'Agua aprovechable ya consumida, por cuartel':'Humedad en la zona de raíces, por cuartel',
      'Comparación entre cuarteles',filas);
  })();

  const resumenAlertas=alertas.length?`<section class="pd-card pd-ancho pd-diag">
    <div class="pd-kicker">Lo que hay que mirar</div>
    <h3 class="pd-card-title">${n0(alertas.length)} ${alertas.length===1?'punto crítico':'puntos críticos'} en la selección</h3>
    <ul class="pd-diag-lista">${alertas.slice(0,6).map(p=>
      `<li class="pd-diag-alerta"><b>${esc(p.cuartel)} · ${fecha(p.fecha)}</b> ${esc(p.texto)}</li>`).join('')}
    </ul>${alertas.length>6?`<p class="pd-nota">Se muestran 6 de ${n0(alertas.length)}. Filtra por cuartel para verlas todas.</p>`:''}
  </section>`:'';

  /* --- Elegir cuartel ---
     Cada cuartel tiene su suelo, su cultivo y su historia: mezclarlos en un
     solo resumen no dice nada. Sin cuartel elegido, el panel ofrece la lista
     para entrar a uno; con cuartel elegido, muestra su ficha y su evolución. */
  const tarjetasCuartel=[...cuartelesSel].map(id=>{
    const cal=sel.find(k=>k.cuartel_id===id),r=leer(cal),q=porCuartel.get(id)||{};
    const n=sel.filter(k=>k.cuartel_id===id).length;
    const est=r&&r.zonaRaices.estado;
    const chip=est?`<span class="pd-chip pd-chip-${esc(est.clave)}">${esc(est.etiqueta)}</span>`
      :'<span class="pd-chip pd-chip-info">Sin textura</span>';
    const ctx=[q.cultivo,q.variedad].filter(Boolean).join(' · ');
    return `<button type="button" class="pd-cuartel" data-cal-cuartel="${esc(q.codigo||'')}">
      <span class="pd-cuartel-cab"><strong>${esc(q.codigo||'—')}</strong>${chip}</span>
      <span class="pd-cuartel-ctx">${esc(ctx||'Sin cultivo declarado')}</span>
      <span class="pd-cuartel-datos">
        <b>${r&&esNum(r.zonaRaices.h)?n1(r.zonaRaices.h)+' %':'—'}</b> en raíces ·
        <b>${r&&esNum(r.zonaRaices.ce)?n2(r.zonaRaices.ce):'—'}</b> mS/cm</span>
      <span class="pd-cuartel-pie">${fecha(cal.fecha)} · ${n0(n)} ${n===1?'calicata':'calicatas'}</span>
    </button>`;
  }).join('');
  const eleccion=`<section class="pd-card pd-ancho"><div class="pd-kicker">Empieza por acá</div>
    <h3 class="pd-card-title">Elige un cuartel</h3>
    <p class="pd-nota" style="margin:0 0 10px">Cada cuartel se lee por separado: su suelo, su cultivo y su
      historia de calicatas. Toca uno para ver su ficha completa y cómo viene cambiando.</p>
    <div class="pd-cuarteles">${tarjetasCuartel}</div></section>`;

  if(!filtroCal.cuartel){
    return filtros+kpis+resumenAlertas+eleccion+ranking+tablaTotales+
      tabla('Todas las lecturas','Detalle',
        ['Cuartel','Fecha','Prof.','Centro','Izquierda','Derecha','CE centro'],detalleFilas,
        'Se muestran hasta seis cuarteles. Entra a un cuartel para ver todas sus fechas y su evolución.');
  }

  /* --- Ficha del cuartel elegido --- */
  const delCuartel=sel.slice().sort((a,b)=>String(b.fecha+(b.hora||'')).localeCompare(String(a.fecha+(a.hora||''))));
  const qSel=cuartelDe(delCuartel[0]),rUlt=leer(delCuartel[0]);
  const fichaCab=`<section class="pd-card pd-ancho pd-ficha"><div class="pd-kicker">Cuartel</div>
    <h3 class="pd-card-title">${esc(qSel.codigo||'—')}</h3>
    <p class="pd-nota" style="margin:0">${esc([qSel.cultivo,qSel.variedad,qSel.caseta?`Caseta ${qSel.caseta}`:null,qSel.equipo].filter(Boolean).join(' · ')||'Sin datos del cuartel')}
      · ${n0(delCuartel.length)} ${delCuartel.length===1?'calicata registrada':'calicatas registradas'}
      ${rUlt&&rUlt.referenciaCultivo?`· ${esc(rUlt.referenciaCultivo.etiqueta)}: umbral de sales ${n1(rUlt.referenciaCultivo.umbral)} dS/m (CEe)`:''}</p>
    <button type="button" class="pd-filtro-limpiar" data-cal-filtro="limpiar" style="margin-top:10px">Ver otro cuartel</button></section>`;

  /* Evolución: una línea por profundidad, con la banda de suelo si hay textura. */
  const cronologia=delCuartel.slice().reverse();
  /* Dos calicatas del mismo día quedaban como dos "07/09" iguales en el eje;
     cuando pasa, la hora las distingue. */
  const fechasSerie=cronologia.map((k,i,a)=>{
    const d=String(fecha(k.fecha)).slice(0,5);
    const repetida=a.some((o,j)=>j!==i&&o.fecha===k.fecha);
    return repetida&&k.hora?`${d} ${String(k.hora).slice(0,5)}`:d;
  });
  const valorProf=(cal,prof,clave)=>{const r=leer(cal);const x=r&&r.porProfundidad.find(y=>y.prof===prof);
    return x&&Number.isFinite(x[clave])?x[clave]:null};
  const COLORES=[PUNTOS[0].color,PUNTOS[1].color,PUNTOS[2].color,'#8c6847','#39798a'];
  const serieHum=serieTiempo('Humedad por fecha','Evolución del cuartel',fechasSerie,
    profsSel.map((pr,i)=>({nombre:`${n0(pr)} cm`,color:COLORES[i%COLORES.length],unidad:' %',
      valores:cronologia.map(k=>valorProf(k,pr,'h'))})),
    'Cada línea es una profundidad, promediando los tres puntos de esa calicata. La franja verde es el agua aprovechable del suelo según la textura anotada.',
    rUlt&&rUlt.textura?{cc:rUlt.textura.cc,pmp:rUlt.textura.pmp}:null);
  const serieCe=serieTiempo('CE por fecha','Evolución del cuartel',fechasSerie,
    profsSel.map((pr,i)=>({nombre:`${n0(pr)} cm`,color:COLORES[i%COLORES.length],unidad:' mS/cm',
      valores:cronologia.map(k=>valorProf(k,pr,'ce'))})),
    'Si la CE sube fecha a fecha en la misma profundidad, hay sales acumulándose; conviene confirmarlo con extracto de saturación.');
  const sinHistoria=delCuartel.length<2
    ? `<section class="pd-card"><div class="pd-kicker">Evolución del cuartel</div>
       <h3 class="pd-card-title">Falta una segunda calicata</h3>
       <p class="pd-nota">Con una sola fecha se puede leer el perfil de hoy, pero no si el cuartel se está
       secando o salinizando. La comparación aparece sola cuando registres la siguiente.</p></section>`:'';

  const filasCuartel=delCuartel.map(cal=>{
    const r=leer(cal),z=r?r.zonaRaices:{};
    return [`<span title="${fecha(cal.fecha)}">${String(fecha(cal.fecha)).slice(0,5)}</span>`,
      esNum(z.h)?`<strong>${n1(z.h)}</strong>`:'—',
      z.agotamiento==null?'—':`<strong>${n0(z.agotamiento)}%</strong>`,
      esNum(z.ce)?n2(z.ce):'—',
      r&&esNum(r.total.t)?n1(r.total.t):'—',
      esNum(cal.profundidad_efectiva_raices_cm)?n0(cal.profundidad_efectiva_raices_cm):'—',
      esc(UNION[cal.union_bulbos]||'—')];
  });

  /* En la ficha, los indicadores son la ÚLTIMA calicata del cuartel y cuánto
     cambió respecto de la anterior: el estado de hoy y hacia dónde va. */
  const rPrev=delCuartel[1]?leer(delCuartel[1]):null;
  const delta=(ahora,antes,f,u)=>{
    if(!esNum(ahora)||!esNum(antes))return null;
    const d=ahora-antes;
    return `${d>0?'+':'−'}${f(Math.abs(d))}${u} desde ${fecha(delCuartel[1].fecha)}`;
  };
  const zUlt=rUlt?rUlt.zonaRaices:{};
  const kpisCuartel=`<div class="pd-kpis">
    ${kpi('Última evaluación',fecha(delCuartel[0].fecha),`${n0(delCuartel.length)} ${delCuartel.length===1?'calicata':'calicatas'} en este cuartel`,'verde',true)}
    ${esNum(zUlt.h)?kpi('Humedad en zona de raíces',`${n1(zUlt.h)}<span class="pd-de">%</span>`,
      delta(zUlt.h,rPrev&&rPrev.zonaRaices.h,n1,' pp')||`hasta ${n0(zUlt.limite)} cm`,'azul',true):''}
    ${zUlt.agotamiento!=null
      ? kpi('Agua aprovechable consumida',`${n0(zUlt.agotamiento)}<span class="pd-de">%</span>`,
          zUlt.estado?zUlt.estado.etiqueta:'0% = capacidad de campo','terracota',true)
      : kpi('Agua aprovechable','Sin textura','Anota la textura del suelo al registrar','terracota',true)}
    ${esNum(zUlt.ce)?kpi('CE en zona de raíces',`${n2(zUlt.ce)}<span class="pd-de">mS/cm</span>`,
      delta(zUlt.ce,rPrev&&rPrev.zonaRaices.ce,n2,' mS/cm')||'sonda directa','cafe',true):''}
    ${esNum(delCuartel[0].profundidad_efectiva_raices_cm)?kpi('Raíces efectivas',
      `${n0(delCuartel[0].profundidad_efectiva_raices_cm)}<span class="pd-de">cm</span>`,'declarada en esta calicata','verde',true):''}
    ${rUlt&&esNum(zUlt.laminaFaltante)?kpi('Falta para capacidad de campo',
      `${n1(zUlt.laminaFaltante)}<span class="pd-de">mm</span>`,
      `la zona de raíces guarda ${n0(zUlt.laminaUtil)} mm llena`,'azul',true):''}
    ${rUlt&&esNum(rUlt.bajoRaices.h)?kpi('Bajo las raíces',`${n1(rUlt.bajoRaices.h)}<span class="pd-de">%</span>`,
      `a ${rUlt.bajoRaices.profundidades.map(n0).join(', ')} cm · ahí ya casi no hay raíz efectiva`,'azul',true):''}
    ${rUlt&&rUlt.uniformidad?kpi('Uniformidad del bulbo',rUlt.uniformidad.etiqueta,
      `${n0(rUlt.uniformidad.peor)}% de variación entre los tres puntos`,
      rUlt.uniformidad.clave==='ok'?'verde':'terracota',true):''}
  </div>`;

  return filtros+kpisCuartel+fichaCab+resumenAlertas+
    (serieHum||sinHistoria)+serieCe+
    tabla('Historia del cuartel','Calicata por calicata',
      ['Fecha','H raíces %','Agotam.','CE','T °C','Raíces cm','Bulbos'],filasCuartel,
      'Cada fila es una calicata completa de este cuartel. H raíces y agotamiento se miden solo hasta la profundidad de raíces declarada ese día.')+
    leyenda+
    `<div class="pd-perfiles">${perfiles}</div>`+
    (obsRaices.length?barras('Estado de raíces','Observaciones',obsRaices):'')+
    (obsComp.length?barras('Compactación','Observaciones',obsComp):'')+
    tabla('Todas las lecturas','Detalle',
      ['Cuartel','Fecha','Prof.','Centro','Izquierda','Derecha','CE centro'],detalleFilas,
      'Las lecturas tal cual se anotaron, sin promediar nada.');
}

/* ---------- Ácido peracético y descole ----------
   Los dos salen de la misma tabla, que es la copia en la base del registro de
   aplicaciones de la planilla oficial del campo. Antes estos paneles eran un
   enlace al archivo en Drive: había que salir de la app y Google pedía acceso. */
async function datosAcido(campo){
  const r=await db.from('aplicaciones_acido')
    .select('id_registro,caseta,equipo,cuartel_codigo,variedad,superficie_ha,fecha_aplicacion,estado_aplicacion,fecha_descole,estado_descole,litros_requeridos,litros_aplicados,litros_pendientes,actualizado_en')
    .eq('campo_id',campo.id).order('id_registro');
  return {filas:r.data||[],error:r.error};
}
const grupo=f=>[f.caseta,f.equipo?'E'+String(f.equipo).replace(/^E/i,''):null].filter(Boolean).join(' · ')||'Sin identificación';
const actualizacion=filas=>{
  const f=filas.map(x=>x.actualizado_en).filter(Boolean).sort().at(-1);
  if(!f)return '';
  const d=new Date(f);
  return `Datos de la planilla oficial del campo · actualizados el ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
};

function pintarAcido(d,campo){
  const filas=d.filas;
  if(!filas.length)return vacio(`Todavía no hay registro de aplicaciones cargado para ${campo.nombre}.`);
  const req=filas.reduce((t,f)=>t+(Number(f.litros_requeridos)||0),0);
  const apl=filas.reduce((t,f)=>t+(Number(f.litros_aplicados)||0),0);
  const pen=filas.reduce((t,f)=>t+(Number(f.litros_pendientes)||0),0);
  const avance=req?apl/req*100:0;

  const kpis=`<div class="pd-kpis">
    ${kpi('Avance aplicado',`${n1(avance)}<span class="pd-de">%</span>`,'sobre los litros requeridos','terracota')}
    ${kpi('Litros requeridos',`${n1(req)}<span class="pd-de">L</span>`,'para todo el campo','terracota')}
    ${kpi('Litros aplicados',`${n1(apl)}<span class="pd-de">L</span>`,`${n0(filas.filter(f=>f.estado_aplicacion==='Aplicado').length)} de ${n0(filas.length)} cuarteles`,'verde')}
    ${kpi('Litros pendientes',`${n1(pen)}<span class="pd-de">L</span>`,`${n0(filas.filter(f=>f.estado_aplicacion!=='Aplicado').length)} cuarteles por aplicar`,'azul')}
  </div>`;

  const g=new Map();
  filas.forEach(f=>{const k=grupo(f),e=g.get(k)||{req:0,apl:0};
    e.req+=Number(f.litros_requeridos)||0; e.apl+=Number(f.litros_aplicados)||0; g.set(k,e)});
  const porGrupo=[...g.entries()].map(([k,e])=>({etiqueta:k,valor:e.req?e.apl/e.req*100:0,
    texto:`${n1(e.req?e.apl/e.req*100:0)}%`})).sort((a,b)=>b.valor-a.valor);

  const pendientes=filas.filter(f=>f.estado_aplicacion!=='Aplicado')
    .sort((a,b)=>(Number(b.litros_pendientes)||0)-(Number(a.litros_pendientes)||0)).slice(0,10)
    .map(f=>`<tr><td>${esc(f.cuartel_codigo||'—')}</td><td>${esc(grupo(f))}</td>
      <td>${n1(Number(f.superficie_ha)||0)} ha</td><td>${n1(Number(f.litros_pendientes)||0)} L</td></tr>`).join('');

  return kpis+
    barras('Avance por grupo','Comparación',porGrupo)+
    (pendientes?`<section class="pd-card pd-ancho"><div class="pd-kicker">Detalle</div><h3 class="pd-card-title">Cuarteles por aplicar</h3>
      <div class="pd-tabla-wrap"><table class="pd-tabla"><thead><tr><th>Cuartel</th><th>Grupo</th><th>Superficie</th><th>Pendiente</th></tr></thead><tbody>${pendientes}</tbody></table></div></section>`:'')+
    `<p class="pd-nota">${esc(actualizacion(filas))}</p>`;
}

function pintarDescole(d,campo){
  const filas=d.filas;
  if(!filas.length)return vacio(`Todavía no hay registro de descole cargado para ${campo.nombre}.`);
  /* Regla de la planilla: "No aplica" se excluye del total; "No aplica
     (plantación nueva)" cuenta como superficie ya resuelta. */
  const aplicables=filas.filter(f=>String(f.estado_descole||'')!=='No aplica');
  const sup=x=>Number(x.superficie_ha)||0;
  const total=aplicables.reduce((t,f)=>t+sup(f),0);
  const resuelto=aplicables.filter(f=>/descolado|no aplica \(plantaci/i.test(f.estado_descole||'')).reduce((t,f)=>t+sup(f),0);
  const pendiente=total-resuelto;
  const avance=total?resuelto/total*100:0;

  const kpis=`<div class="pd-kpis">
    ${kpi('Superficie aplicable',`${n1(total)}<span class="pd-de">ha</span>`,'sin contar lo que no aplica','azul')}
    ${kpi('Superficie descolada',`${n1(resuelto)}<span class="pd-de">ha</span>`,`${n0(aplicables.filter(f=>/descolado/i.test(f.estado_descole||'')).length)} cuarteles`,'verde')}
    ${kpi('Superficie pendiente',`${n1(pendiente)}<span class="pd-de">ha</span>`,'por descolar','terracota')}
    ${kpi('Avance del campo',`${n1(avance)}<span class="pd-de">%</span>`,'por superficie','azul')}
  </div>`;

  const g=new Map();
  aplicables.forEach(f=>{const k=grupo(f),e=g.get(k)||{total:0,ok:0};
    e.total+=sup(f); if(/descolado|no aplica \(plantaci/i.test(f.estado_descole||''))e.ok+=sup(f); g.set(k,e)});
  const porGrupo=[...g.entries()].map(([k,e])=>({etiqueta:k,valor:e.total?e.ok/e.total*100:0,
    texto:`${n1(e.total?e.ok/e.total*100:0)}%`})).sort((a,b)=>b.valor-a.valor);

  const estados=new Map();
  aplicables.forEach(f=>{const k=f.estado_descole||'Sin estado';estados.set(k,(estados.get(k)||0)+1)});
  const porEstado=[...estados.entries()].map(([k,v])=>({etiqueta:k,valor:v,texto:n0(v)})).sort((a,b)=>b.valor-a.valor);

  const pend=aplicables.filter(f=>!/descolado|no aplica/i.test(f.estado_descole||''))
    .sort((a,b)=>sup(b)-sup(a)).slice(0,10)
    .map(f=>`<tr><td>${esc(f.cuartel_codigo||'—')}</td><td>${esc(grupo(f))}</td>
      <td>${n1(sup(f))} ha</td><td>${esc(f.estado_descole||'—')}</td></tr>`).join('');

  return kpis+
    barras('Avance por grupo','Comparación',porGrupo)+
    barras('Cuarteles por estado','Distribución',porEstado)+
    (pend?`<section class="pd-card pd-ancho"><div class="pd-kicker">Detalle</div><h3 class="pd-card-title">Cuarteles por descolar</h3>
      <div class="pd-tabla-wrap"><table class="pd-tabla"><thead><tr><th>Cuartel</th><th>Grupo</th><th>Superficie</th><th>Estado</th></tr></thead><tbody>${pend}</tbody></table></div></section>`:'')+
    `<p class="pd-nota">${esc(actualizacion(filas))}</p>`;
}

/* ---------- Todos los campos ----------
   Los demás paneles miran el campo activo. Este los pone lado a lado, que es la
   vista que pide jefatura: dónde va cada campo sin ir cambiando de uno en uno.
   No lleva filtro por campo a propósito: las políticas de RLS deciden qué campos
   entran, así que un jefe de campo ve aquí solo el suyo. */
async function datosTodos(){
  const campos=(window.yoyeCampos||[]).filter(c=>c.id);
  const [cu,se,ca,ac]=await Promise.all([
    db.from('cuarteles').select('id,campo_id,superficie_ha').eq('activo',true),
    db.from('sectores_aforo').select('id,campo_id').eq('activo',true),
    db.from('calicatas').select('id,cuartel_id,fecha').eq('activo',true),
    db.from('aplicaciones_acido').select('campo_id,superficie_ha,litros_requeridos,litros_aplicados,estado_descole')
  ]);
  const cuarteles=cu.data||[];
  let aforos=[];
  if(cuarteles.length){
    const r=await db.from('aforos').select('cuartel_id,sector_aforo_id,coeficiente_uniformidad');
    if(!r.error)aforos=r.data||[];
  }
  return {campos,cuarteles,sectores:se.data||[],calicatas:ca.data||[],acido:ac.data||[],aforos};
}

function pintarTodos(d){
  const {campos,cuarteles,sectores,calicatas,acido,aforos}=d;
  if(!campos.length)return vacio('No hay campos disponibles para tu cuenta.');
  const campoDeCuartel=new Map(cuarteles.map(c=>[c.id,c.campo_id]));
  const evaluados=new Set(aforos.map(a=>a.sector_aforo_id||a.cuartel_id).filter(Boolean));
  const cus=aforos.map(a=>Number(a.coeficiente_uniformidad)).filter(v=>Number.isFinite(v)&&v>0);

  const resumen=campos.map(c=>{
    const suyos=cuarteles.filter(q=>q.campo_id===c.id);
    const conSup=suyos.filter(q=>esNum(q.superficie_ha));
    const misSectores=sectores.filter(s=>s.campo_id===c.id);
    const totalSectores=misSectores.length||suyos.length;
    const hechos=misSectores.filter(s=>evaluados.has(s.id)).length
      || suyos.filter(q=>evaluados.has(q.id)).length;
    const misCalicatas=calicatas.filter(k=>campoDeCuartel.get(k.cuartel_id)===c.id);
    const misAcido=acido.filter(a=>a.campo_id===c.id);
    const req=misAcido.reduce((t,a)=>t+(Number(a.litros_requeridos)||0),0);
    const apl=misAcido.reduce((t,a)=>t+(Number(a.litros_aplicados)||0),0);
    return {
      nombre:c.nombre, slug:c.slug,
      // La superficie sale de los cuarteles cuando está medida; si no, la del
      // campo, que es el dato de referencia. Nunca se inventa.
      superficie: conSup.length?conSup.reduce((t,q)=>t+Number(q.superficie_ha),0)
        :(esNum(c.superficie_ha)?Number(c.superficie_ha):0),
      superficieMedida: conSup.length>0,
      cuarteles:suyos.length, sectores:totalSectores, aforos:hechos,
      avance: totalSectores?hechos/totalSectores*100:0,
      calicatas:misCalicatas.length,
      cuartelesConCalicata:new Set(misCalicatas.map(k=>k.cuartel_id)).size,
      acidoAvance: req?apl/req*100:null
    };
  });

  const totCuarteles=resumen.reduce((t,r)=>t+r.cuarteles,0);
  const totSectores=resumen.reduce((t,r)=>t+r.sectores,0);
  const totAforos=resumen.reduce((t,r)=>t+r.aforos,0);
  const totCalicatas=resumen.reduce((t,r)=>t+r.calicatas,0);
  const totSup=resumen.reduce((t,r)=>t+r.superficie,0);

  const kpis=`<div class="pd-kpis">
    ${kpi('Campos',n0(campos.length),'con acceso en tu cuenta','verde')}
    ${kpi('Superficie total',`${n2(totSup)}<span class="pd-de">ha</span>`,'suma de los campos','verde')}
    ${kpi('Cuarteles',n0(totCuarteles),`${n0(totSectores)} sectores de riego`,'azul')}
    ${kpi('Avance del aforo',`${totSectores?n1(totAforos/totSectores*100):'0,0'}<span class="pd-de">%</span>`,`${n0(totAforos)} de ${n0(totSectores)} sectores`,'azul')}
    ${kpi('Calicatas',n0(totCalicatas),cus.length?`CU promedio ${n1(prom(cus))}%`:'registradas en total','cafe')}
  </div>`;

  const filaAvance=resumen.map(r=>({etiqueta:r.nombre,valor:r.avance,
    texto:`${n0(r.aforos)}/${n0(r.sectores)} · ${n1(r.avance)}%`}));
  const filaSup=resumen.map(r=>({etiqueta:r.nombre,valor:r.superficie,texto:`${n2(r.superficie)} ha`}))
    .sort((a,b)=>b.valor-a.valor);
  const filaCal=resumen.filter(r=>r.cuarteles).map(r=>({etiqueta:r.nombre,
    valor:r.cuarteles?r.cuartelesConCalicata/r.cuarteles*100:0,
    texto:`${n0(r.cuartelesConCalicata)}/${n0(r.cuarteles)}`}));
  const conAcido=resumen.filter(r=>r.acidoAvance!==null);

  const tabla=`<section class="pd-card pd-ancho"><div class="pd-kicker">Detalle</div>
    <h3 class="pd-card-title">Resumen por campo</h3>
    <div class="pd-tabla-wrap"><table class="pd-tabla">
      <thead><tr><th>Campo</th><th>Superficie</th><th>Cuarteles</th><th>Sectores</th><th>Aforos</th><th>Calicatas</th><th>Avance</th></tr></thead>
      <tbody>${resumen.map(r=>`<tr>
        <td>${esc(r.nombre)}</td>
        <td>${n2(r.superficie)} ha${r.superficieMedida?'':' *'}</td>
        <td>${n0(r.cuarteles)}</td><td>${n0(r.sectores)}</td>
        <td>${n0(r.aforos)}</td><td>${n0(r.calicatas)}</td>
        <td>${n1(r.avance)}%</td></tr>`).join('')}</tbody>
    </table></div>
    ${resumen.some(r=>!r.superficieMedida)?'<p class="pd-nota">* Superficie de referencia del campo: todavía falta cargarla cuartel por cuartel.</p>':''}
  </section>`;

  /* Cobertura del monitoreo: cuántos cuarteles tienen al menos una calicata.
     Es parte de un todo real -- evaluado o no evaluado -- así que el anillo
     dice algo; las barras con todo en cero, no. */
  const evaluadosTot=resumen.reduce((t,r)=>t+r.cuartelesConCalicata,0);
  const anilloCobertura=totCuarteles?anillo('Cobertura del monitoreo','Calicatas',[
    {etiqueta:'Cuarteles con calicata',valor:evaluadosTot,color:'#2a78d6'},
    {etiqueta:'Todavía sin evaluar',valor:Math.max(0,totCuarteles-evaluadosTot),color:'#cde2fb'}
  ],'Sobre el total de cuarteles cargados en los campos que puedes ver.'):'';

  /* El avance del aforo se dibuja solo cuando hay alguno: con todo en cero son
     cuatro barras vacías que hacen parecer roto un panel que solo espera datos. */
  const hayAforos=resumen.some(r=>r.aforos>0);

  return kpis+
    (hayAforos?barras('Avance del aforo por campo','Comparación',filaAvance):'')+
    barras('Superficie por campo','Comparación',filaSup)+
    anilloCobertura+
    (filaCal.some(f=>f.valor>0)?barras('Cuarteles con calicata','Comparación',filaCal):'')+
    (conAcido.length?barras('Ácido peracético aplicado','Comparación',
      conAcido.map(r=>({etiqueta:r.nombre,valor:r.acidoAvance,texto:`${n1(r.acidoAvance)}%`}))):'')+
    (hayAforos?'':`<p class="pd-nota pd-ancho">Todavía no hay aforos registrados en ningún campo: por eso no aparece la comparación de avance. En cuanto se registre el primero, este panel la muestra.</p>`)+
    tabla;
}

/* ---------- Orquestación ---------- */
const PANELES={
  campos:{titulo:'Todos los campos',kicker:'Comparación',global:true,
    desc:'Los cuatro campos lado a lado: superficie, cuarteles, avance del aforo y calicatas.',
    datos:datosTodos,pinta:pintarTodos},
  aforos:{titulo:'Aforos',kicker:'Uniformidad',desc:'Avance del aforo, coeficiente de uniformidad y sectores que requieren atención.',datos:datosAforo,pinta:pintarAforo},
  calicatas:{titulo:'Calicatas',kicker:'Monitoreo del suelo',desc:'Humedad, conductividad eléctrica y observaciones de perfil por cuartel.',datos:datosCalicatas,pinta:pintarCalicatas},
  acido:{titulo:'Ácido peracético',kicker:'Aplicaciones',desc:'Litros aplicados y pendientes, avance por caseta y equipo.',datos:datosAcido,pinta:pintarAcido},
  descoles:{titulo:'Descoles',kicker:'Mantención',desc:'Avance del descole por superficie, grupo por grupo.',datos:datosAcido,pinta:pintarDescole}
};

async function abrirPanel(clave,{desdeHash=false}={}){
  const p=PANELES[clave];
  const campo=typeof window.yoyeActiveCampo==='function'?window.yoyeActiveCampo():null;
  // "Todos los campos" no depende del campo activo; los demás sí.
  if(!p||!db||(!campo&&!p.global))return;
  campoActual=campo;
  const host=$('#yoyePanelVista'),lista=$('#yoyePanelesList'),hero=$('#yoyePanelesHero'),nota=$('#yoyePanelesNote');
  if(!host)return;
  // La nota de alcance habla del campo activo y de la lista; con un dashboard
  // abierto queda fuera de lugar, sobre todo en "Todos los campos".
  lista.hidden=true; if(hero)hero.hidden=true; if(nota)nota.hidden=true;
  host.hidden=false;
  host.innerHTML=`<button type="button" class="pd-volver" id="pdVolver">← Paneles</button>
    <div class="pd-kicker">${esc(p.global?'Todos los campos':p.kicker+' · '+campo.nombre)}</div>
    <h2 class="pd-titulo">${esc(p.titulo)}</h2>
    <p class="pd-desc">${esc(p.desc)}</p>
    <div class="pd-cargando">Cargando datos del campo…</div>`;
  $('#pdVolver').onclick=()=>cerrarPanel();
  /* Al abrir un panel desde el final de la lista, en el teléfono se entraba con
     la página ya desplazada y el dashboard empezaba a media pantalla. Al
     recargar el mismo panel (cambio de campo) se respeta dónde iba leyendo. */
  const otroPanel=panelAbierto!==clave;
  panelAbierto=clave;
  if(otroPanel)scrollTo({top:0,behavior:'instant'});
  // Abrir desde la lista agrega una entrada al historial, para que el atrás del
  // navegador devuelva a la lista. Si venimos siguiendo el hash, la entrada ya
  // existe y volver a escribirla duplicaría el paso atrás.
  if(!desdeHash&&location.hash!=='#panel-'+clave){location.hash='#panel-'+clave;entradaPropia=true}
  try{
    const d=await p.datos(campo);
    if(panelAbierto!==clave)return;   // llegó tarde: ya se abrió otro panel
    // El cuerpo va envuelto para poder acomodarlo en dos columnas en notebook.
    $('.pd-cargando',host).outerHTML=`<div class="pd-cuerpo">${p.pinta(d,campo)}</div>`;
  }catch(e){
    const c=$('.pd-cargando',host);
    if(c)c.outerHTML=vacio('No se pudieron cargar los datos: '+(e?.message||'error de conexión'));
  }
}
function cerrarPanel({desdeHash=false}={}){
  const host=$('#yoyePanelVista'),lista=$('#yoyePanelesList'),hero=$('#yoyePanelesHero');
  panelAbierto=null;
  if(host){host.hidden=true;host.innerHTML=''}
  if(lista)lista.hidden=false;
  if(hero)hero.hidden=false;
  // campos.js decide si la nota corresponde a este campo; al volver se repinta.
  if(typeof window.yoyeRefrescarPaneles==='function')window.yoyeRefrescarPaneles();
  if(desdeHash||!location.hash.startsWith('#panel-'))return;
  /* Si la entrada del historial la creamos al abrir, el botón "← Paneles" hace
     lo mismo que el atrás del navegador y no deja pasos muertos. Si se llegó
     por enlace directo no hay a dónde volver: se reescribe la URL. */
  if(entradaPropia){entradaPropia=false;history.back()}
  else history.replaceState(null,'',location.pathname);
}

/* La lista de paneles la dibuja campos.js después de autenticar, así que en vez
   de enganchar cada enlace se escucha el clic en el contenedor: da igual cuándo
   aparezcan los elementos. Los paneles externos siguen abriendo su fuente. */
function claveDe(href){
  if(/#todos-los-campos/.test(href))return 'campos';
  if(/aforo-rinconada/.test(href))return 'aforos';
  if(/calicatas/.test(href))return 'calicatas';
  if(/#acido/.test(href))return 'acido';
  if(/#descole/.test(href))return 'descoles';
  return null;
}
/* Los filtros del panel de Calicatas se dibujan con el resto del contenido, así
   que se escucha en el contenedor: da igual cuándo aparezcan. */
function enlazarFiltros(){
  const host=$('#yoyePanelVista');
  if(!host||host.dataset.pdFiltros)return;
  host.dataset.pdFiltros='1';
  host.addEventListener('change',ev=>{
    const s=ev.target.closest('select[data-cal-filtro]');
    if(!s)return;
    filtroCal[s.dataset.calFiltro]=s.value;
    if(panelAbierto)abrirPanel(panelAbierto,{desdeHash:true});
  });
  host.addEventListener('click',ev=>{
    const tarjeta=ev.target.closest('[data-cal-cuartel]');
    if(tarjeta){
      filtroCal.cuartel=tarjeta.dataset.calCuartel;
      if(panelAbierto)abrirPanel(panelAbierto,{desdeHash:true});
      return;
    }
    if(!ev.target.closest('[data-cal-filtro="limpiar"]'))return;
    filtroCal={cuartel:'',caseta:'',equipo:'',cultivo:''};
    if(panelAbierto)abrirPanel(panelAbierto,{desdeHash:true});
  });
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

/* ---------- El hash manda ----------
   Antes la vista y la URL vivían cada una por su lado: al abrir un panel se
   escribía el hash, pero nadie escuchaba si cambiaba. Con el botón atrás del
   navegador -- que en el teléfono es el gesto de volver -- la URL retrocedía y
   el dashboard seguía en pantalla; un enlace a otro panel desde uno abierto no
   hacía nada. Ahora la URL es la única fuente de verdad y la pantalla la sigue. */
/* El hash puede traer además el cuartel: #panel-calicatas:C-5. Así la app de
   Calicatas enlaza directo a la ficha del cuartel que se acaba de registrar. */
const HASH_RE=/^#panel-(campos|aforos|calicatas|acido|descoles)(?::([^#?/]+))?$/;
const claveDelHash=()=>(location.hash.match(HASH_RE)||[])[1]||null;
const cuartelDelHash=()=>{const m=location.hash.match(HASH_RE);
  return m&&m[2]?decodeURIComponent(m[2]):null};

function sincronizarConHash(){
  const clave=claveDelHash(),cuartel=cuartelDelHash();
  if(clave==='calicatas'&&cuartel&&filtroCal.cuartel!==cuartel){
    filtroCal.cuartel=cuartel;
    if(clave===panelAbierto)return abrirPanel(clave,{desdeHash:true});
  }
  if(clave){ if(clave!==panelAbierto)abrirPanel(clave,{desdeHash:true}) }
  else if(panelAbierto)cerrarPanel({desdeHash:true});
}
addEventListener('hashchange',sincronizarConHash);

/* Al cargar con #panel-… se esperaba 900 ms fijos: se veía la lista y recién
   después saltaba al dashboard. Ahora se abre apenas hay sesión y campo, que
   suele ser bastante antes. */
function abrirCuandoSePueda(intentos=25){
  if(!claveDelHash())return;
  const listo=db&&(typeof window.yoyeActiveCampo==='function'?window.yoyeActiveCampo()?.id:null);
  if(listo)return sincronizarConHash();
  if(intentos>0)setTimeout(()=>abrirCuandoSePueda(intentos-1),120);
}
addEventListener('yoye-auth-ready',e=>{db=e.detail.client;abrirCuandoSePueda()});
addEventListener('DOMContentLoaded',()=>{enlazarLista();enlazarFiltros();abrirCuandoSePueda()});
document.addEventListener('yoye-campo-changed',()=>{
  filtroCal={cuartel:'',caseta:'',equipo:'',cultivo:''};
  // Cambiar de campo con un dashboard abierto lo recarga con los datos del
  // campo nuevo, en vez de dejar a la vista los números del anterior.
  if(panelAbierto)abrirPanel(panelAbierto,{desdeHash:true}); else cerrarPanel({desdeHash:true});
});
window.yoyeAbrirPanel=abrirPanel;
})();
