/* Revisión del panel "Todos los campos" en el navegador.
 *
 * Mide lo que no se ve leyendo el archivo: que los medidores quepan en su
 * tarjeta -- el porcentaje quedaba cortado y se leía "9" en vez de "92%" --,
 * que en el escritorio las tarjetas se repartan de a cuatro y en el teléfono
 * una abajo de otra, y que un campo sin datos diga que no los tiene en vez de
 * dibujar una barra en cero, que se lee como "cero por ciento hecho".
 *
 * Uso:
 *   python3 -m http.server 8899   (desde la raíz del repo)
 *   node pruebas/paneles/revisar-todos-los-campos.mjs
 */
import { chromium } from 'playwright';
const stub = () => {
  const CAMPOS=[
    {id:'c1',slug:'rinconada-plano',nombre:'Rinconada Plano',superficie_ha:78.44,orden:1},
    {id:'c2',slug:'rinconada-cerro',nombre:'Rinconada Cerro',superficie_ha:41.2,orden:2},
    {id:'c3',slug:'mirador-plano',nombre:'Mirador Plano',superficie_ha:56.9,orden:3},
    {id:'c4',slug:'mirador-cerro',nombre:'Mirador Cerro',superficie_ha:33.5,orden:4}];
  const mk=(campo,n,ha)=>Array.from({length:n},(_,i)=>({id:`${campo}-q${i}`,campo_id:campo,
    superficie_ha: campo==='c1'? +(ha/n).toFixed(2) : null, activo:true}));
  const CUARTELES=[...mk('c1',36,78.44),...mk('c2',55),...mk('c3',19),...mk('c4',33)];
  const SECTORES=[...Array(39).keys()].map(i=>({id:'s1-'+i,campo_id:'c1',activo:true}))
    .concat([...Array(55).keys()].map(i=>({id:'s2-'+i,campo_id:'c2',activo:true})))
    .concat([...Array(19).keys()].map(i=>({id:'s3-'+i,campo_id:'c3',activo:true})))
    .concat([...Array(33).keys()].map(i=>({id:'s4-'+i,campo_id:'c4',activo:true})));
  const AFOROS=[...Array(36).keys()].map(i=>({cuartel_id:'c1-q'+i,sector_aforo_id:'s1-'+i,
    coeficiente_uniformidad: 68+(i%30), fecha_evaluacion:'2025-11-0'+(1+i%9), temporada:2025}));
  const CAL=[];
  const porCampo={c1:[14,21],c2:[3,3],c3:[6,9],c4:[3,3]};
  Object.entries(porCampo).forEach(([c,[cuar,tot]])=>{
    for(let i=0;i<tot;i++)CAL.push({id:`${c}-k${i}`,cuartel_id:`${c}-q${i%cuar}`,fecha:'2026-10-0'+(1+i%8),activo:true});
  });
  const ACIDO=Array.from({length:37},(_,i)=>({campo_id:'c1',superficie_ha:2.12,
    litros_requeridos:21.2, litros_aplicados: i<24?21.2:0,
    estado_aplicacion: i<24?'Aplicado':'Pendiente',
    estado_descole: i<28?'Descolado':'Sin aplicación',
    fecha_aplicacion:'2026-08-11',actualizado_en:'2026-10-13'}));
  const FILAS={cuarteles:CUARTELES,sectores_aforo:SECTORES,calicatas:CAL,aplicaciones_acido:ACIDO,
    aforos:AFOROS,perfiles:[{id:'u1',organizacion_id:'org1',rol:'administrador'}],campos:CAMPOS};
  const tabla=n=>{const filas=FILAS[n]||[];const o={};
    o.select=()=>o;['eq','in','neq','is','not','gte','lte','limit','order'].forEach(m=>o[m]=()=>o);
    o.then=r=>Promise.resolve({data:filas.slice(),error:null}).then(r);
    o.maybeSingle=()=>Promise.resolve({data:filas[0]||null,error:null});o.single=o.maybeSingle;
    return o};
  const client={from:tabla,channel:()=>({on:()=>({subscribe:()=>({})}),subscribe:()=>({})}),
    removeChannel:()=>{},storage:{from:()=>({})},
    auth:{getSession:()=>Promise.resolve({data:{session:{user:{id:'u1'}}}})}};
  window.yoyeCampos=CAMPOS;
  window.yoyeActiveCampo=()=>({id:'c1',nombre:'Rinconada Plano',slug:'rinconada-plano'});
  try{localStorage.setItem('yoye_campo_activo','rinconada-plano')}catch{}
  addEventListener('DOMContentLoaded',()=>setTimeout(()=>dispatchEvent(new CustomEvent('yoye-auth-ready',
    {detail:{client,session:{user:{id:'u1',email:'b@y.cl'}}}})),30));
};
const fallas=[];
const revisar=(ok,que)=>{console.log(`${ok?'  ok  ':' FALLA'}  ${que}`);if(!ok)fallas.push(que)};
const nav=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
for(const [nombre,w,h] of [['pc',1440,1000],['movil',390,844]]){
  const ctx=await nav.newContext({viewport:{width:w,height:h},locale:'es-CL',deviceScaleFactor:1});
  await ctx.addInitScript(stub);
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,160)));
  await p.goto('http://localhost:8899/paneles/#panel-campos',{waitUntil:'domcontentloaded'});
  await p.waitForSelector('.pd-cuerpo',{timeout:15000}); await p.waitForTimeout(700);
  await p.evaluate(()=>document.querySelector('#sharedAuthScreen')?.remove());
  const el=await p.$('.pd-cuerpo');
  if(el) await el.screenshot({path:`/tmp/claude-0/scratch/campos-${nombre}.png`});
  const info=await p.evaluate(()=>({
    tarjetas:document.querySelectorAll('.pd-campo-card').length,
    medidores:document.querySelectorAll('.pd-medidor').length,
    vacios:document.querySelectorAll('.pd-medidor-vacio').length,
    kpis:[...document.querySelectorAll('.pd-kpi')].map(k=>k.textContent.replace(/\s+/g,' ').trim()),
    cols:getComputedStyle(document.querySelector('.pd-campos-grid')).gridTemplateColumns.split(' ').length,
    ancho:document.documentElement.clientWidth,
    /* El porcentaje de cada medidor tiene que caber dentro de su tarjeta. */
    recorte:[...document.querySelectorAll('.pd-medidor-cab u')].filter(u=>{
      const tarjeta=u.closest('.pd-campo-card').getBoundingClientRect();
      const r=u.getBoundingClientRect();
      return r.right>tarjeta.right-6||r.width<18;
    }).map(u=>u.closest('.pd-medidor').querySelector('b').textContent+' '+u.textContent),
    desborde:Math.max(0,...[...document.querySelectorAll('.pd-cuerpo *')]
      .filter(e=>!e.closest('.pd-tabla-wrap')).map(e=>e.getBoundingClientRect().right))
  }));
  console.log(`\n— ${nombre} —`);
  revisar(info.tarjetas===4,`hay una tarjeta por campo (${info.tarjetas})`);
  revisar(info.medidores===16,`cada campo trae sus cuatro medidores (${info.medidores})`);
  revisar(info.vacios===6,`los campos sin datos lo dicen en vez de dibujar un cero (${info.vacios} medidores en blanco)`);
  revisar(info.cols===(nombre==='pc'?4:1),`las tarjetas se reparten de a ${nombre==='pc'?'cuatro en el escritorio':'una en el teléfono'} (${info.cols})`);
  revisar(info.recorte.length===0,
    `ningún porcentaje queda cortado por el borde de su tarjeta${info.recorte.length?': '+info.recorte.join(', '):''}`);
  revisar(info.desborde<=info.ancho+1,`nada del panel se sale de la pantalla (${Math.round(info.desborde)} ≤ ${info.ancho})`);
  revisar(info.kpis.length>=4,`los indicadores de arriba dicen cuántos de cuántos (${info.kpis.length})`);
  revisar(/de 146 sectores/.test(info.kpis.join(' ')),'el avance del aforo dice sobre cuántos sectores');
  revisar(!errs.length,'sin errores de JavaScript'+(errs.length?': '+errs.join(' · '):''));
  await ctx.close();
}
await nav.close();
console.log(fallas.length?`\n${fallas.length} falla(s)`:'\nTodo pasa');
process.exit(fallas.length?1:0);
