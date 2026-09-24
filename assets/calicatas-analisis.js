/* Lectura agronómica de una calicata.
   Una calicata no es un promedio: es un perfil. Este archivo concentra los
   criterios con los que se leen esos números para que la app de registro y el
   panel digan exactamente lo mismo.

   Convenciones de este sistema:
   - La humedad viene de sonda (humedad volumétrica, % v/v).
   - La CE se mide con sonda directa en el suelo (CE aparente o "bulk"), NO es
     extracto de saturación de laboratorio. Depende mucho de la humedad, así
     que sirve como alerta temprana y para comparar la misma profundidad entre
     fechas, no para dictar un diagnóstico de salinidad.
   - Nunca se promedian cuarteles distintos. Dentro de UNA calicata sí: primero
     el promedio de los tres puntos a cada profundidad, después el promedio de
     las profundidades, para que cada profundidad pese lo mismo. */
(function(raiz){
  'use strict';

  /* Características hidráulicas por textura, de la tabla de referencia del
     campo (Bastián, 25/09/2026). CC y PMP vienen en porcentaje de PESO SECO;
     la sonda de terreno mide humedad VOLUMÉTRICA, así que se convierten
     multiplicando por la densidad aparente:  θv = θpeso × Da.
     CR es la capacidad de retención en mm de agua por mm de suelo, que es lo
     que permite pasar de un porcentaje a milímetros de lámina. */
  const TEXTURAS_BASE={
    arenoso:          {etiqueta:'Arenoso',          porosidad:38, da:1.65, ccPeso:9,  pmpPeso:4,  cr:0.08, rangoCc:[6,12],  rangoPmp:[2,6]},
    franco_arenoso:   {etiqueta:'Franco arenoso',   porosidad:43, da:1.50, ccPeso:14, pmpPeso:6,  cr:0.12, rangoCc:[10,18], rangoPmp:[4,8]},
    franco:           {etiqueta:'Franco',           porosidad:47, da:1.40, ccPeso:22, pmpPeso:10, cr:0.17, rangoCc:[18,26], rangoPmp:[8,12]},
    franco_arcilloso: {etiqueta:'Franco arcilloso', porosidad:49, da:1.35, ccPeso:27, pmpPeso:13, cr:0.19, rangoCc:[23,31], rangoPmp:[11,15]},
    arcillo_arenoso:  {etiqueta:'Arcillo arenoso',  porosidad:51, da:1.30, ccPeso:31, pmpPeso:15, cr:0.21, rangoCc:[27,35], rangoPmp:[14,16]},
    arcilloso:        {etiqueta:'Arcilloso',        porosidad:53, da:1.25, ccPeso:35, pmpPeso:17, cr:0.23, rangoCc:[31,39], rangoPmp:[15,19]}
  };
  const redondeaUno=v=>Math.round(v*10)/10;
  const TEXTURAS=Object.fromEntries(Object.entries(TEXTURAS_BASE).map(([k,t])=>[k,{
    ...t,
    cc:redondeaUno(t.ccPeso*t.da),        // capacidad de campo en humedad volumétrica
    pmp:redondeaUno(t.pmpPeso*t.da),      // punto de marchitez en humedad volumétrica
    haVolumen:redondeaUno((t.ccPeso-t.pmpPeso)*t.da)
  }]));

  /* CE aparente de sonda directa. El umbral alto es conservador porque todo lo
     que hay en estos campos (cerezo, nogal, palto, cítricos, carozos) es
     sensible a sales. Pasado ese punto corresponde confirmar con extracto de
     saturación en laboratorio antes de tomar decisiones de lavado. */
  const CE_BANDAS=[
    {hasta:0.2,clave:'baja',etiqueta:'Muy baja',nota:'Suelo lavado o muy seco al momento de medir.'},
    {hasta:0.6,clave:'normal',etiqueta:'Normal',nota:'Rango habitual de un suelo regado con fertirriego corriente.'},
    {hasta:1.0,clave:'atencion',etiqueta:'En aumento',nota:'Conviene seguirla en las próximas calicatas del mismo cuartel.'},
    {hasta:Infinity,clave:'alerta',etiqueta:'Alta',nota:'Alta para frutales sensibles. Confirmar con extracto de saturación antes de decidir un lavado.'}
  ];

  /* Umbrales de salinidad por especie, en CE del EXTRACTO DE SATURACIÓN (CEe,
     dS/m): el valor a partir del cual la especie empieza a perder rendimiento,
     y cuánto pierde por cada dS/m por encima (modelo Maas & Hoffman, que es el
     que usan las tablas de FAO y las guías de riego).

     Son de laboratorio. La sonda de terreno mide CE aparente del suelo, que a
     capacidad de campo suele ser del orden de tres veces menor, y además sube y
     baja con la humedad. Por eso el panel avisa "conviene medir extracto" en
     vez de declarar un problema de salinidad: la sonda sirve para detectar la
     tendencia, el laboratorio para decidir un lavado. */
  const FACTOR_SONDA=3;
  const CULTIVOS={
    cerezo:{etiqueta:'Cerezo',umbral:1.5,pendiente:22,clase:'Sensible',fuente:'IVIA/Agrosal'},
    ciruelo:{etiqueta:'Ciruelo',umbral:1.5,pendiente:18,clase:'Sensible',fuente:'IVIA/Agrosal (FAO indica 2,6 para ciruelo/ciruela seca)'},
    duraznero:{etiqueta:'Duraznero',umbral:1.7,pendiente:21,clase:'Sensible',fuente:'FAO / Maas & Hoffman'},
    nectarino:{etiqueta:'Nectarino',umbral:1.7,pendiente:21,clase:'Sensible',fuente:'FAO (se usa el valor de duraznero)'},
    nogal:{etiqueta:'Nogal',umbral:1.5,pendiente:null,clase:'Sensible',fuente:'FAO lo clasifica sensible sin umbral experimental; 1,5 es referencia conservadora'},
    naranjo:{etiqueta:'Naranjo',umbral:1.3,pendiente:13,clase:'Sensible',fuente:'FAO / Maas & Hoffman (Agrosal indica 1,7)'},
    mandarino:{etiqueta:'Mandarino',umbral:1.3,pendiente:13,clase:'Sensible',fuente:'FAO, cítricos'},
    palto:{etiqueta:'Palto',umbral:1.3,pendiente:24,clase:'Sensible',fuente:'FAO / IVIA (1,3–1,6 según fuente)'},
    almendro:{etiqueta:'Almendro',umbral:1.5,pendiente:19,clase:'Sensible',fuente:'FAO / Maas & Hoffman'}
  };
  /* Los cuarteles traen el cultivo escrito de varias formas: "Cerezo",
     "cerezos", "nectarines". Se normaliza antes de buscar el umbral. */
  function claveCultivo(nombre){
    const t=String(nombre||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
    if(!t)return null;
    const reglas=[[/cerez/,'cerezo'],[/ciruel/,'ciruelo'],[/durazn|melocoton/,'duraznero'],
      [/nectarin/,'nectarino'],[/nogal|nuez|nueces/,'nogal'],[/naranj/,'naranjo'],
      [/mandarin|clementin/,'mandarino'],[/palt|aguacate/,'palto'],[/almendr/,'almendro']];
    return (reglas.find(([re])=>re.test(t))||[])[1]||null;
  }
  function referenciaCultivo(nombre){const k=claveCultivo(nombre);return k?{clave:k,...CULTIVOS[k]}:null}
  /* CE de sonda a la que conviene mandar una muestra al laboratorio: el umbral
     del cultivo llevado a orden de magnitud de sonda. */
  function ceSondaDeAviso(nombre){
    const r=referenciaCultivo(nombre);
    return r&&r.umbral?Math.round(r.umbral/FACTOR_SONDA*100)/100:null;
  }

  const esNum=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const prom=a=>a.length?a.reduce((x,y)=>x+Number(y),0)/a.length:null;
  const r1=v=>v==null?null:Math.round(v*10)/10;
  const r2=v=>v==null?null:Math.round(v*100)/100;

  function bandaCE(v){
    if(!esNum(v))return null;
    return CE_BANDAS.find(b=>Number(v)<=b.hasta)||CE_BANDAS[CE_BANDAS.length-1];
  }

  /* Coeficiente de variación entre los tres puntos de una misma profundidad.
     Es la forma de ver si el bulbo moja parejo o si un lado se está quedando
     seco: dos calicatas con la misma humedad promedio pueden ser un bulbo
     uniforme o uno desplazado, y eso cambia la decisión de riego. */
  function cv(valores){
    const v=valores.filter(esNum).map(Number);
    if(v.length<2)return null;
    const m=prom(v);
    if(!m)return null;
    const ds=Math.sqrt(v.reduce((a,x)=>a+(x-m)**2,0)/v.length);
    return ds/m*100;
  }

  /* Agotamiento del agua aprovechable: 0 % es capacidad de campo y 100 % es
     punto de marchitez. Es la cifra que de verdad dice "hay que regar", mucho
     más que el % de humedad suelto. */
  function agotamiento(h,textura){
    const t=TEXTURAS[textura];
    if(!t||!esNum(h))return null;
    return Math.max(0,Math.min(150,(t.cc-Number(h))/(t.cc-t.pmp)*100));
  }
  function estadoHumedad(ago,h,textura){
    const t=TEXTURAS[textura];
    if(ago==null)return null;
    if(t&&esNum(h)&&Number(h)>t.cc+2)return {clave:'exceso',etiqueta:'Sobre capacidad de campo',
      nota:'Por encima de lo que el suelo retiene: el agua extra percola bajo las raíces.'};
    if(ago<35)return {clave:'ok',etiqueta:'Cómodo',nota:'Agua disponible sin restricción.'};
    if(ago<60)return {clave:'atencion',etiqueta:'Consumiendo reserva',nota:'Dentro de lo manejable; el próximo riego define.'};
    if(ago<80)return {clave:'alerta',etiqueta:'Al límite',nota:'La planta empieza a gastar energía en extraer agua.'};
    return {clave:'critico',etiqueta:'En déficit',nota:'Cerca del punto de marchitez: hay estrés hídrico.'};
  }

  /* Milímetros de agua en un espesor de suelo. profundidadCm en centímetros. */
  function laminas(h,textura,profundidadCm){
    const t=TEXTURAS[textura];
    if(!t||!esNum(profundidadCm))return {laminaUtil:null,laminaFaltante:null,laminaActual:null};
    const mm=Number(profundidadCm)*10;
    const laminaUtil=(t.cc-t.pmp)/100*mm;
    if(!esNum(h))return {laminaUtil,laminaFaltante:null,laminaActual:null};
    const laminaActual=Math.max(0,(Number(h)-t.pmp)/100*mm);
    const laminaFaltante=Math.max(0,(t.cc-Number(h))/100*mm);
    return {laminaUtil,laminaActual,laminaFaltante};
  }

  const ordenarProf=a=>[...new Set(a.map(Number).filter(Number.isFinite))].sort((x,y)=>x-y);

  /* Resumen completo de UNA calicata. */
  function resumen(lecturas,opciones){
    const o=opciones||{},medidas=(lecturas||[]).filter(l=>l.estado!=='no_realizada');
    const profs=ordenarProf(medidas.map(l=>l.profundidad_cm));
    const enProf=(prof,campo)=>medidas.filter(l=>Number(l.profundidad_cm)===prof&&esNum(l[campo])).map(l=>Number(l[campo]));
    const porProfundidad=profs.map(prof=>{
      const h=enProf(prof,'humedad_pct'),ce=enProf(prof,'ce_ms_cm'),t=enProf(prof,'temperatura_c');
      return {prof,h:prom(h),ce:prom(ce),t:prom(t),puntos:h.length,
        cvHumedad:cv(h),hMin:h.length?Math.min(...h):null,hMax:h.length?Math.max(...h):null,
        agotamiento:agotamiento(prom(h),o.textura),banda:bandaCE(prom(ce))};
    });
    const mediaDe=clave=>prom(porProfundidad.map(x=>x[clave]).filter(esNum));
    const total={h:mediaDe('h'),ce:mediaDe('ce'),t:mediaDe('t')};

    /* La zona de raíces manda: el agua que está más abajo no la toma el árbol.
       Sin profundidad de raíces declarada se usan los primeros 60 cm, que es
       donde está el grueso de las raíces activas en estos huertos. */
    const limite=esNum(o.raicesCm)?Number(o.raicesCm):60;
    const dentro=porProfundidad.filter(x=>x.prof<=limite),fuera=porProfundidad.filter(x=>x.prof>limite);
    const zonaRaices={limite,
      h:prom(dentro.map(x=>x.h).filter(esNum)),ce:prom(dentro.map(x=>x.ce).filter(esNum)),
      profundidades:dentro.map(x=>x.prof)};
    const bajoRaices={h:prom(fuera.map(x=>x.h).filter(esNum)),ce:prom(fuera.map(x=>x.ce).filter(esNum)),
      profundidades:fuera.map(x=>x.prof)};
    zonaRaices.agotamiento=agotamiento(zonaRaices.h,o.textura);
    /* De porcentaje a milímetros: es lo que permite decir cuánto falta regar.
       Lámina = (humedad faltante en % volumétrico / 100) × profundidad. */
    Object.assign(zonaRaices,laminas(zonaRaices.h,o.textura,limite));
    zonaRaices.estado=estadoHumedad(zonaRaices.agotamiento,zonaRaices.h,o.textura);
    zonaRaices.banda=bandaCE(zonaRaices.ce);

    const uniformidad=(()=>{
      const c=porProfundidad.map(x=>x.cvHumedad).filter(esNum);
      if(!c.length)return null;
      const peor=Math.max(...c),media=prom(c);
      const clave=peor<15?'ok':peor<30?'atencion':'alerta';
      return {peor,media,clave,
        etiqueta:clave==='ok'?'Bulbo parejo':clave==='atencion'?'Diferencias entre puntos':'Bulbo disparejo'};
    })();

    const sales=(()=>{
      if(!esNum(zonaRaices.ce)&&!esNum(bajoRaices.ce))return null;
      const acumula=esNum(zonaRaices.ce)&&esNum(bajoRaices.ce)?bajoRaices.ce-zonaRaices.ce:null;
      return {enRaices:zonaRaices.ce,bajoRaices:bajoRaices.ce,diferencia:acumula,banda:bandaCE(zonaRaices.ce),
        lavando:acumula!=null&&acumula>0.15,subiendo:acumula!=null&&acumula<-0.15};
    })();

    /* Movimiento del agua: dónde quedó el frente húmedo. Si la calicata llegó
       más abajo que las raíces, se compara zona de raíces contra el fondo; si
       las raíces llegan hasta el fondo del hoyo, se compara la primera
       profundidad con la última, que es lo único que los datos permiten. */
    const frente=(()=>{
      const conH=porProfundidad.filter(x=>esNum(x.h));
      if(conH.length<2)return null;
      const bajo=esNum(bajoRaices.h),
        arriba=bajo?zonaRaices.h:conH[0].h,
        abajo=bajo?bajoRaices.h:conH[conH.length-1].h,
        dif=abajo-arriba,
        ref=bajo?'bajo-raices':'perfil',
        profArriba=bajo?zonaRaices.profundidades:[conH[0].prof],
        profAbajo=bajo?bajoRaices.profundidades:[conH[conH.length-1].prof];
      const base={diferencia:dif,ref,profArriba,profAbajo};
      if(dif>4)return {...base,clave:bajo?'percola':'humedo-abajo',
        etiqueta:bajo?'El agua pasa bajo las raíces':'Más húmedo abajo que arriba'};
      if(dif<-6)return {...base,clave:'corto',etiqueta:'El frente no llega al fondo'};
      return {...base,clave:'parejo',etiqueta:'Perfil parejo en profundidad'};
    })();

    const refCultivo=referenciaCultivo(o.cultivo);
    return {profundidades:profs,porProfundidad,total,zonaRaices,bajoRaices,uniformidad,sales,frente,
      textura:TEXTURAS[o.textura]||null,cultivo:o.cultivo||null,referenciaCultivo:refCultivo,
      unionBulbos:o.unionBulbos||null,
      diagnostico:diagnostico({porProfundidad,total,zonaRaices,bajoRaices,uniformidad,sales,frente,
        textura:TEXTURAS[o.textura]||null,unionBulbos:o.unionBulbos,referenciaCultivo:refCultivo})};
  }

  /* Frases de diagnóstico y una recomendación de manejo. Cada frase sale de un
     número concreto de ESTA calicata; si el dato no está, la frase no aparece
     en vez de inventarse un supuesto. */
  function diagnostico(r){
    const puntos=[],acciones=[];
    const zr=r.zonaRaices,br=r.bajoRaices;
    if(zr.estado){
      puntos.push({clave:'humedad',nivel:zr.estado.clave,
        texto:`Zona de raíces (${zr.profundidades.join(', ')} cm): ${fmt1(zr.h)} % de humedad, ${Math.round(zr.agotamiento)} % del agua aprovechable ya consumida. ${zr.estado.nota}`});
      if(esNumero(zr.laminaFaltante))puntos.push({clave:'lamina',nivel:'info',
        texto:`Para volver a capacidad de campo en los primeros ${zr.limite} cm faltan ${fmt1(zr.laminaFaltante)} mm de agua (la zona de raíces guarda ${fmt1(zr.laminaUtil)} mm cuando está llena).`});
      if(zr.estado.clave==='critico'||zr.estado.clave==='alerta')acciones.push(`Regar antes de lo programado o alargar el próximo riego: faltan ${fmt1(zr.laminaFaltante)} mm para dejar la zona de raíces en capacidad de campo.`);
      if(zr.estado.clave==='exceso')acciones.push('Acortar el tiempo de riego y repartirlo en más pulsos: el suelo ya está sobre capacidad de campo.');
    }else if(esNumero(zr.h)){
      puntos.push({clave:'humedad',nivel:'info',
        texto:`Zona de raíces (${zr.profundidades.join(', ')} cm): ${fmt1(zr.h)} % de humedad. Anota la textura del suelo para saber cuánta agua aprovechable queda.`});
    }
    /* Lo que hay bajo la zona de raíces se muestra siempre: es agua medida y
       dice si el riego se está pasando o dónde se van las sales. Lo que no
       corresponde es contarla como agua disponible para el árbol. */
    if(esNumero(br.h)||esNumero(br.ce)){
      const partes=[esNumero(br.h)?`${fmt1(br.h)} % de humedad`:null,
        esNumero(br.ce)?`${fmt2(br.ce)} mS/cm de CE`:null].filter(Boolean).join(' y ');
      puntos.push({clave:'bajo-raices',nivel:'info',
        texto:`Bajo la zona de raíces (${br.profundidades.join(', ')} cm): ${partes}. Ahí ya casi no hay raíz efectiva, así que esa agua no la toma el árbol; sirve para ver si el riego se pasa de largo y dónde se acumulan las sales.`});
    }
    if(r.frente&&r.frente.clave==='percola'){
      puntos.push({clave:'frente',nivel:'atencion',
        texto:`Bajo las raíces (${br.profundidades.join(', ')} cm) hay ${fmt1(r.frente.diferencia)} puntos más de humedad que en la zona de raíces: parte del riego se está yendo en profundidad.`});
      acciones.push('Reducir el tiempo de riego por pulso y aumentar la frecuencia, para mojar la zona de raíces sin pasarse al fondo.');
    }
    if(r.frente&&r.frente.clave==='humedo-abajo'){
      puntos.push({clave:'frente',nivel:'atencion',
        texto:`A ${r.frente.profAbajo.join(', ')} cm hay ${fmt1(r.frente.diferencia)} puntos más de humedad que a ${r.frente.profArriba.join(', ')} cm. El hoyo no pasó de la zona de raíces, así que no se puede afirmar que el agua se pierda; conviene profundizar la próxima calicata.`});
    }
    if(r.frente&&r.frente.clave==='corto'){
      puntos.push({clave:'frente',nivel:'atencion',
        texto:`El fondo está ${fmt1(Math.abs(r.frente.diferencia))} puntos más seco que arriba: el frente de humedad no alcanza a bajar.`});
      acciones.push('Alargar el riego o agregar un pulso: el bulbo se está quedando arriba.');
    }
    if(r.uniformidad&&r.uniformidad.clave!=='ok'){
      const peor=r.porProfundidad.filter(x=>esNumero(x.cvHumedad)).sort((a,b)=>b.cvHumedad-a.cvHumedad)[0];
      puntos.push({clave:'uniformidad',nivel:r.uniformidad.clave==='alerta'?'alerta':'atencion',
        texto:`Los tres puntos no coinciden: a ${peor.prof} cm van de ${fmt1(peor.hMin)} a ${fmt1(peor.hMax)} % (variación de ${Math.round(peor.cvHumedad)} %). El bulbo no está mojando parejo.`});
      acciones.push('Revisar goteros y presión en esa hilera: caudal disparejo, emisor tapado o gotero corrido respecto del árbol.');
    }
    if(r.unionBulbos==='no_unidos'||r.unionBulbos==='parcialmente_unidos'){
      puntos.push({clave:'bulbos',nivel:'atencion',
        texto:r.unionBulbos==='no_unidos'?'Los bulbos no se unen: quedan franjas secas entre goteros y raíces sin agua.':'Los bulbos se unen solo en parte: hay sectores de la hilera con menos agua que otros.'});
      acciones.push('Evaluar más emisores por árbol o menor distancia entre goteros antes de subir el tiempo de riego.');
    }
    if(r.sales&&r.sales.banda){
      puntos.push({clave:'sales',nivel:r.sales.banda.clave==='alerta'?'alerta':r.sales.banda.clave==='atencion'?'atencion':'info',
        texto:`CE en la zona de raíces ${fmt2(r.sales.enRaices)} mS/cm (${r.sales.banda.etiqueta.toLowerCase()}). ${r.sales.banda.nota}`});
      if(r.sales.lavando)puntos.push({clave:'sales-perfil',nivel:'info',
        texto:`La CE sube ${fmt2(r.sales.diferencia)} mS/cm hacia el fondo: las sales están siendo empujadas bajo la zona de raíces, que es lo esperable con riego suficiente.`});
      if(r.sales.subiendo){
        puntos.push({clave:'sales-perfil',nivel:'atencion',
          texto:`La CE es más alta arriba que abajo (${fmt2(Math.abs(r.sales.diferencia))} mS/cm de diferencia): las sales se están quedando en la zona de raíces.`});
        acciones.push('Aplicar un riego de lavado y revisar la conductividad del agua y la carga de fertilizante.');
      }
      const ref=r.referenciaCultivo;
      if(ref&&ref.umbral&&esNum(r.sales.enRaices)){
        const aviso=ref.umbral/FACTOR_SONDA;
        puntos.push({clave:'sales-cultivo',nivel:r.sales.enRaices>=aviso?'atencion':'info',
          texto:`${ref.etiqueta} es sensible a sales: pierde rendimiento sobre ${fmt1(ref.umbral)} dS/m de CE en extracto de saturación`+
            (ref.pendiente?` (−${Math.round(ref.pendiente)} % por cada dS/m de más)`:'')+
            `. Con sonda, eso equivale más o menos a ${fmt2(aviso)} mS/cm en suelo húmedo; hoy marca ${fmt2(r.sales.enRaices)}.`});
        if(r.sales.enRaices>=aviso)acciones.push(`Mandar una muestra de la zona de raíces a extracto de saturación: la lectura de sonda ya está en el orden del umbral del ${ref.etiqueta.toLowerCase()}.`);
      }
      if(r.sales.banda.clave==='alerta')acciones.push('Confirmar con un extracto de saturación de laboratorio antes de programar lavados: la sonda mide CE aparente y se dispara con el suelo húmedo.');
    }
    const fria=r.porProfundidad.filter(x=>esNumero(x.t)&&x.t<12);
    if(fria.length)puntos.push({clave:'temperatura',nivel:'info',
      texto:`Suelo bajo 12 °C a ${fria.map(x=>x.prof).join(', ')} cm: a esa temperatura la raíz absorbe poco, sobre todo fósforo.`});
    if(!acciones.length&&zr.estado&&zr.estado.clave==='ok')acciones.push('Mantener la pauta de riego: el bulbo está en rango y parejo.');
    return {puntos,acciones};
  }

  function esNumero(v){return esNum(v)}
  function fmt1(v){return v==null?'—':Number(v).toLocaleString('es-CL',{minimumFractionDigits:1,maximumFractionDigits:1})}
  function fmt2(v){return v==null?'—':Number(v).toLocaleString('es-CL',{minimumFractionDigits:2,maximumFractionDigits:2})}

  raiz.YoyeAgro={TEXTURAS,TEXTURAS_BASE,laminas,CE_BANDAS,CULTIVOS,FACTOR_SONDA,resumen,agotamiento,estadoHumedad,bandaCE,cv,
    claveCultivo,referenciaCultivo,ceSondaDeAviso,redondear:{r1,r2}};
})(typeof globalThis!=='undefined'?globalThis:window);
