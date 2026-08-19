const CACHE='yoye-shell-v13-offline-calicatas-admin';
const SHELL=['./','./index.html','./assets/private-app.css','./assets/app-enhancements-v3.css','./assets/app-enhancements-v3.js','./assets/shared-auth.js','./assets/home-dashboard.js','./assets/field-map-data.js','./assets/quarter-dashboard.css','./assets/quarter-dashboard.js','./assets/calicatas.css?v=20260819-audit-3','./assets/calicatas.js?v=20260819-audit-3','./assets/yoye-logo.svg','./assets/icons/favicon.svg','./assets/img/portada/cerezo.webp','./assets/img/portada/nogal.webp','./assets/img/portada/ciruelo.webp','./assets/img/portada/naranjo.webp','./assets/img/portada/duraznero.webp','./assets/img/portada/nectarino.webp','./manifest.webmanifest','./calicatas/','./calicatas/index.html','./cerezo/','./nogal/','./ciruelo/','./naranjo/','./duraznero/','./nectarino/','./cuarteles/'];
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
