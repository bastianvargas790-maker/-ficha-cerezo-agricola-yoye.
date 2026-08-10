(()=>{'use strict';
const $=s=>document.querySelector(s);let channel;
function set(id,value){const el=$(id);if(el)el.textContent=value}
async function refresh(client,session){
  if(!client||!session)return;
  const [quarters,irrigations,probes,profile]=await Promise.all([
    client.from('cuarteles').select('id,cultivo,superficie_ha,caseta,equipo').eq('activo',true),
    client.from('registros_riego').select('id',{count:'exact',head:true}).eq('activo',true),
    client.from('sondas').select('id',{count:'exact',head:true}),
    client.from('perfiles').select('rol,estado').eq('id',session.user.id).maybeSingle()
  ]);
  if([quarters,irrigations,probes,profile].some(r=>r.error)){$('#homeSync').textContent='No fue posible sincronizar';return}
  set('#countQuarters',quarters.data?.length??0);set('#countIrrigations',irrigations.count??0);set('#countProbes',probes.count??0);
  set('#currentRole',({administrador:'Administrador',editor:'Editor',solo_lectura:'Solo lectura'})[profile.data?.rol]||'Sin perfil');
  const rows=quarters.data||[],known=rows.filter(q=>Number.isFinite(Number(q.superficie_ha))),registered=known.reduce((s,q)=>s+Number(q.superficie_ha),0);set('#totalSurface',registered?registered.toLocaleString('es-CL',{maximumFractionDigits:2})+' ha':'Sin información');
  const dialog=$('#homeDialog'),title=$('#dialogTitle'),body=$('#dialogBody');$('#roleCard').onclick=()=>{title.textContent='Perfil y permisos';body.innerHTML=`<p><b>Rol:</b> ${$('#currentRole').textContent}</p><p><b>Estado:</b> ${profile.data?.estado||'Sin información'}</p><p>Los permisos efectivos también son controlados por RLS en el servidor.</p>`;dialog.showModal()};$('#surfaceCard').onclick=()=>{const crops={};known.forEach(q=>crops[q.cultivo]=(crops[q.cultivo]||0)+Number(q.superficie_ha));title.textContent='Superficie del Fundo La Rinconada';body.innerHTML=`<p><b>Superficie registrada en ${known.length} cuarteles:</b> ${registered.toLocaleString('es-CL',{maximumFractionDigits:2})} ha.</p><p><b>Superficie KMZ:</b> archivo rinconada.kmz pendiente de adjuntar; no se muestra una cifra estimada.</p><p><b>Diferencia KMZ − cuarteles:</b> no calculable hasta procesar el polígono real.</p><h3>Por cultivo</h3><ul>${Object.entries(crops).sort().map(([c,v])=>`<li>${c}: ${v.toLocaleString('es-CL',{maximumFractionDigits:2})} ha</li>`).join('')}</ul>`;dialog.showModal()};
  $('#homeSync').textContent='Sincronizado · '+new Date().toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'});
  channel?.unsubscribe();channel=client.channel('yoye-inicio').on('postgres_changes',{event:'*',schema:'public',table:'cuarteles'},()=>refresh(client,session)).on('postgres_changes',{event:'*',schema:'public',table:'registros_riego'},()=>refresh(client,session)).on('postgres_changes',{event:'*',schema:'public',table:'sondas'},()=>refresh(client,session)).subscribe();
}
addEventListener('yoye-auth-ready',event=>refresh(event.detail.client,event.detail.session));
})();
