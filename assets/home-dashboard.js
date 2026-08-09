(()=>{'use strict';
const $=s=>document.querySelector(s);let channel;
function set(id,value){const el=$(id);if(el)el.textContent=value}
async function refresh(client,session){
  if(!client||!session)return;
  const [quarters,irrigations,probes,profile]=await Promise.all([
    client.from('cuarteles').select('id',{count:'exact',head:true}).eq('activo',true),
    client.from('registros_riego').select('id',{count:'exact',head:true}).eq('activo',true),
    client.from('sondas').select('id',{count:'exact',head:true}),
    client.from('perfiles').select('rol,estado').eq('id',session.user.id).maybeSingle()
  ]);
  if([quarters,irrigations,probes,profile].some(r=>r.error)){$('#homeSync').textContent='No fue posible sincronizar';return}
  set('#countQuarters',quarters.count??0);set('#countIrrigations',irrigations.count??0);set('#countProbes',probes.count??0);
  set('#currentRole',({administrador:'Administrador',editor:'Editor',solo_lectura:'Solo lectura'})[profile.data?.rol]||'Sin perfil');
  $('#homeSync').textContent='Sincronizado · '+new Date().toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'});
  channel?.unsubscribe();channel=client.channel('yoye-inicio').on('postgres_changes',{event:'*',schema:'public',table:'cuarteles'},()=>refresh(client,session)).on('postgres_changes',{event:'*',schema:'public',table:'registros_riego'},()=>refresh(client,session)).on('postgres_changes',{event:'*',schema:'public',table:'sondas'},()=>refresh(client,session)).subscribe();
}
addEventListener('yoye-auth-ready',event=>refresh(event.detail.client,event.detail.session));
})();
