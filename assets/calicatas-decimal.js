(()=>{'use strict';
const DECIMAL_SELECTOR='.humidity,.ce,.temp,#horasRiego,#duracionRiego';
function prepare(input){
  if(!input||!input.matches?.(DECIMAL_SELECTOR)) return;
  if(input.type==='number') input.type='text';
  input.inputMode='decimal';
  input.autocomplete='off';
  input.setAttribute('pattern','[0-9]+([,.][0-9]+)?');
}
function normalize(input){
  if(!input||!input.matches?.(DECIMAL_SELECTOR)) return;
  input.value=input.value.replace(/\s/g,'').replace(',','.');
}
function prepareAll(root=document){root.querySelectorAll?.(DECIMAL_SELECTOR).forEach(prepare)}
function bindSmoothNavigation(){
  document.querySelectorAll('.action-card[data-view]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const target=document.getElementById(btn.dataset.view+'View');
      if(!target)return;
      setTimeout(()=>target.scrollIntoView({behavior:'smooth',block:'start'}),80);
    });
  });
}
function normalizeUnionSelect(){
  const select=document.querySelector('#unionBulbos');
  if(!select)return;
  const map={
    'Unidos':'unidos',
    'Parcialmente unidos':'parcialmente_unidos',
    'No unidos':'no_unidos',
    'No evaluado':'no_determinado'
  };
  [...select.options].forEach(opt=>{if(map[opt.textContent.trim()])opt.value=map[opt.textContent.trim()]});
}
function init(){
  prepareAll();
  bindSmoothNavigation();
  normalizeUnionSelect();
  const readings=document.querySelector('#readings');
  if(readings)new MutationObserver(()=>prepareAll(readings)).observe(readings,{childList:true,subtree:true});
  document.addEventListener('focusin',e=>prepare(e.target));
  document.addEventListener('input',e=>{
    const el=e.target;
    if(!el.matches?.(DECIMAL_SELECTOR))return;
    el.value=el.value.replace(/[^0-9,.-]/g,'').replace(/([,.].*)[,.]/g,'$1');
  });
  const form=document.querySelector('#calicataForm');
  form?.addEventListener('submit',()=>form.querySelectorAll(DECIMAL_SELECTOR).forEach(normalize),true);
}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init):init();
})();