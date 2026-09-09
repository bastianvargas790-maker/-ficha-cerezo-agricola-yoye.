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
        db.from('observaciones_calicata').select('calicata_id,categoria,opcion_etiqueta,perfil,profundidad_cm').in('calicata_id',ids)
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
function perfilVertical(titulo,kicker,series,unidad,nota,dominio){
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
  const rotulos=finales.map(f=>`<text x="${Math.min(w-3,f.px+9).toFixed(1)}" y="${(f.py+f.dy+3).toFixed(1)}"
    class="pd-svg-val" text-anchor="start" fill="${f.s.color}">${n1(f.p.valor)}</text>`).join('');

  return `<section class="pd-card">
    <div class="pd-kicker">${esc(kicker)}</div>
    <h3 class="pd-card-title">${esc(titulo)}</h3>
    <div class="pd-svg-wrap"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(titulo)}">
      ${guias}${ejeX}${trazos}${rotulos}
    </svg></div>
    ${nota?`<p class="pd-nota">${esc(nota)}</p>`:''}
  </section>`;
}

/* Barras divergentes: sube o baja respecto de cero. Con barras normales, "la CE
   bajó 0,64" se dibujaba como una barra diminuta hacia el mismo lado que "subió
   4,03", que es justo lo contrario de lo que pasó. */
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
  const rangoEn=(prof,dato)=>{
    const v=medidas.filter(l=>Number(l.profundidad_cm)===prof&&esNum(l[dato])).map(l=>Number(l[dato]));
    return v.length?{min:Math.min(...v),max:Math.max(...v),n:v.length}:null;
  };
  const profMax=profsSel.at(-1);
  const hMax=profMax!=null?rangoEn(profMax,'humedad_pct'):null;
  const ceMax=profMax!=null?rangoEn(profMax,'ce_ms_cm'):null;
  const raices=sel.map(k=>Number(k.profundidad_efectiva_raices_cm)).filter(Number.isFinite);

  const kpis=`<div class="pd-kpis">
    ${kpi('Calicatas en la selección',n0(sel.length),`${n0(cuartelesSel.size)} ${cuartelesSel.size===1?'cuartel':'cuarteles'} de ${n0(cuarteles.length)}`,'cafe')}
    ${kpi('Última evaluación',fecha(ultima.fecha),esc(cuartelDe(ultima).codigo||''),'verde',true)}
    ${hMax?kpi(`Humedad a ${n0(profMax)} cm`,`${n1(hMax.min)}–${n1(hMax.max)}<span class="pd-de">%</span>`,`rango entre ${n0(hMax.n)} lecturas`,'azul',true):''}
    ${ceMax?kpi(`CE a ${n0(profMax)} cm`,`${n2(ceMax.min)}–${n2(ceMax.max)}<span class="pd-de">mS/cm</span>`,'rango, sin promediar cuarteles','terracota',true):''}
    ${raices.length?kpi('Raíces efectivas',`${n0(Math.min(...raices))}–${n0(Math.max(...raices))}<span class="pd-de">cm</span>`,'profundidad declarada','verde',true):''}
  </div>`;

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
        <span>${esc(ctx)} · ${fecha(cal.fecha)}</span></div>
      ${perfilVertical('Humedad por profundidad','Perfil del bulbo',hum,' %',nota||null,domHum)}
      ${perfilVertical('CE por profundidad','Conductividad eléctrica',ce,' mS/cm',null,domCe)}
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

  return filtros+kpis+leyenda+
    `<div class="pd-perfiles">${perfiles}</div>`+
    barrasComparacion+
    anilloUnion+
    (obsRaices.length?barras('Estado de raíces','Observaciones',obsRaices):'')+
    (obsComp.length?barras('Compactación','Observaciones',obsComp):'')+
    tendencia+
    tabla('Todas las lecturas','Detalle',
      ['Cuartel','Fecha','Prof.','Centro','Izquierda','Derecha','CE centro'],detalleFilas,
      detalle?null:'Se muestran hasta seis cuarteles. Filtra por cuartel para ver todas sus fechas.');
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
const claveDelHash=()=>(location.hash.match(/^#panel-(campos|aforos|calicatas|acido|descoles)$/)||[])[1]||null;

function sincronizarConHash(){
  const clave=claveDelHash();
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
