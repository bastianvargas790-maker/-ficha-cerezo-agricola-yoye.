const CACHE='yoye-shell-v20260904-inicio';
const SHELL=['./','./index.html','./assets/private-app.css?v=20260904-inicio','./assets/app-enhancements-v3.css','./assets/app-enhancements-v3.js','./assets/supabase.js?v=20260904-inicio','./assets/shared-auth.js?v=20260904-inicio','./assets/home-yoye.js?v=20260904-inicio','./assets/yoye-app.css?v=20260904-inicio','./assets/field-map-data.js','./assets/quarter-dashboard.css','./assets/quarter-dashboard.js','./assets/calicatas.css?v=20260904-inicio','./assets/calicatas.js?v=20260904-inicio','./assets/yoye-logo.png','./assets/yoye-logo.png','./assets/icons/favicon.svg','./manifest.webmanifest','./assets/yoye-theme.css?v=20260904-inicio','./assets/campos.css?v=20260904-inicio','./assets/campos.js?v=20260904-inicio','./assets/aforo.js?v=20260904-inicio','./assets/campos/rinconada-plano.png','./assets/campos/rinconada-cerro.png','./assets/campos/mirador-plano.png','./assets/campos/mirador-cerro.png','./calicatas/','./aforo/','./calicatas/index.html','./calicatas/registro.html','./calicatas/registro-v16.html','./cerezo/','./nogal/','./ciruelo/','./naranjo/','./palto/','./mandarina/','./duraznero/','./nectarino/','./cuarteles/','./paneles/','./mas/','./cuarteles/lista.html','./assets/cuarteles-lista.js?v=20260904-inicio'];
const CDN_HOST='cdn.jsdelivr.net';
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.hostname.includes('supabase.co')||url.pathname.includes('/auth/'))return;
  const cacheable=url.origin===location.origin||(url.hostname===CDN_HOST&&url.pathname.includes('/npm/@supabase/supabase-js'));
  if(!cacheable)return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response}).catch(()=>caches.match('./index.html'))));
});
