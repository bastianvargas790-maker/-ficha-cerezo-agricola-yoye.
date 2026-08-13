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
function init(){
  prepareAll();
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