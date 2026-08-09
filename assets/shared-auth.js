(()=>{'use strict';
const PROJECT_URL='https://yfpjbjewehusimetwuyc.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_ApOoDOJ8XBLVb56yzExAfw_L_lDEnyd';
const $=(s,r=document)=>r.querySelector(s);
function screen(){
  let el=$('#sharedAuthScreen');
  if(el)return el;
  el=document.createElement('section');
  el.id='sharedAuthScreen';
  el.className='auth-screen shared-auth';
  el.innerHTML='<article class="auth-card"><div class="eyebrow" style="color:var(--green)">Acceso privado</div><h1 style="font-family:Georgia,serif;margin:.35em 0">Agrícola Yoye</h1><p>Inicia sesión con el correo autorizado para consultar esta ficha.</p><form id="sharedLogin"><div class="field"><label>Correo electrónico</label><input id="sharedEmail" type="email" autocomplete="username" required></div><div class="field" style="margin-top:10px"><label>Contraseña</label><input id="sharedPassword" type="password" minlength="8" autocomplete="current-password" required></div><button class="btn" style="width:100%;margin-top:14px" type="submit">Ingresar</button><p id="sharedAuthMessage" class="storage-status" role="status"></p></form><p class="mini-note">El acceso inicial se crea desde la ficha de Nogal. No compartas tu contraseña.</p></article>';
  document.body.prepend(el);
  return el;
}
function showApp(session){
  document.documentElement.classList.remove('auth-pending');
  const gate=screen(),main=$('main');
  gate.hidden=!!session;
  if(main)main.hidden=!session;
  if(session&&!$('#sharedSignOut')){
    const b=document.createElement('button');
    b.id='sharedSignOut';b.className='btn secondary small';b.type='button';b.textContent='Cerrar sesión';
    b.style.cssText='position:fixed;right:12px;top:12px;z-index:90';
    b.onclick=async()=>{await window.yoyeSupabase.auth.signOut();location.reload()};
    document.body.append(b);
  }
}
async function init(){
  if(!window.supabase){document.documentElement.classList.remove('auth-pending');return}
  window.yoyeSupabase=window.yoyeSupabase||window.supabase.createClient(PROJECT_URL,PUBLISHABLE_KEY);
  const {data}=await window.yoyeSupabase.auth.getSession();
  showApp(data.session);
  window.yoyeSupabase.auth.onAuthStateChange((_event,session)=>showApp(session));
  const form=$('#sharedLogin')||screen().querySelector('#sharedLogin');
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const msg=$('#sharedAuthMessage'),button=form.querySelector('button');
    button.disabled=true;msg.textContent='Comprobando acceso…';
    const {error}=await window.yoyeSupabase.auth.signInWithPassword({email:$('#sharedEmail').value.trim(),password:$('#sharedPassword').value});
    button.disabled=false;
    msg.textContent=error?'No fue posible ingresar. Revisa el correo, la contraseña y la confirmación del correo.':'Acceso correcto.';
  });
}
document.documentElement.classList.add('auth-pending');
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init):init();
})();