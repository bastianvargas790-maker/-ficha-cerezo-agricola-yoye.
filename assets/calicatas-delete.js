(()=>{'use strict';
let db=null,session=null,profile=null;
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function ensurePanel(){
  if($('#deleteManager')) return $('#deleteManager');
  const history=$('#historyList');
  if(!history) return null;
  const box=document.createElement('section');
  box.id='deleteManager';
  box.style.cssText='margin-top:22px;padding-top:18px;border-top:1px solid #d7dfd2';
  box.innerHTML='<div class="section-title sub"><div><span class="kicker">Gestión</span><h2>Eliminar calicatas</h2></div></div><p class="empty-note" id="deleteHelp">Selecciona un cuartel para gestionar sus registros.</p><div id="deleteList" class="history-list"></div>';
  history.parentNode.appendChild(box);
  return box;
}
async function load(){
  ensurePanel();
  const qid=$('#historyQuarter')?.value;
  const list=$('#deleteList'),help=$('#deleteHelp');
  if(!list||!help) return;
  if(!db||!session||!profile||!qid){list.innerHTML='';help.textContent='Selecciona un cuartel para gestionar sus registros.';return;}
  help.textContent='Los registros eliminados se ocultan del historial y gráficos, pero quedan recuperables en Supabase.';
  list.innerHTML='<p class="empty-note">Cargando registros…</p>';
  const {data,error}=await db.from('calicatas').select('id,fecha,hora,ubicacion,responsable,creado_en').eq('organizacion_id',profile.organizacion_id).eq('cuartel_id',qid).eq('activo',true).order('fecha',{ascending:false}).order('creado_en',{ascending:false});
  if(error){list.innerHTML=`<p class="message error">${esc(error.message)}</p>`;return;}
  if(!data?.length){list.innerHTML='<p class="empty-note">No hay registros activos para eliminar.</p>';return;}
  list.innerHTML=data.map(r=>`<div class="history-item" style="padding:14px;margin-bottom:10px"><div style="display:flex;gap:12px;align-items:center;justify-content:space-between"><div><b>${esc(r.fecha)}</b><div class="history-meta">${esc(r.ubicacion||'Sin ubicación')} · ${esc(r.responsable||'Sin responsable')}</div></div><button type="button" class="delete-cal" data-id="${r.id}" data-label="${esc(r.fecha)}" style="border:1px solid #b85a50;background:#fff;color:#923b34;border-radius:12px;padding:10px 12px;font-weight:700">Eliminar</button></div></div>`).join('');
  list.querySelectorAll('.delete-cal').forEach(btn=>btn.onclick=()=>remove(btn));
}
async function remove(btn){
  const id=btn.dataset.id,label=btn.dataset.label;
  if(!confirm(`¿Eliminar la calicata del ${label}?\n\nSe ocultará del historial y gráficos, pero podrá recuperarse desde Supabase.`)) return;
  btn.disabled=true;btn.textContent='Eliminando…';
  const {error}=await db.from('calicatas').update({activo:false,actualizado_por:session.user.id}).eq('id',id).eq('organizacion_id',profile.organizacion_id);
  if(error){alert('No fue posible eliminar: '+error.message);btn.disabled=false;btn.textContent='Eliminar';return;}
  const select=$('#historyQuarter');
  if(select){select.dispatchEvent(new Event('change',{bubbles:true}));}
  await load();
}
async function authReady(e){
  db=e.detail.client;session=e.detail.session;if(!session)return;
  const {data}=await db.from('perfiles').select('organizacion_id,rol,estado').eq('id',session.user.id).maybeSingle();
  profile=data||null;ensurePanel();load();
}
addEventListener('yoye-auth-ready',authReady);
document.addEventListener('change',e=>{if(e.target?.id==='historyQuarter')setTimeout(load,150)});
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',ensurePanel):ensurePanel();
})();