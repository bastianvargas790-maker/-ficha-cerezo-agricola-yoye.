const CACHE='calicatas-campo-v23-official-logo';
const SHELL=[
  './',
  './index.html',
  './registro.html',
  './registro-v16.html',
  './manifest.webmanifest',
  '../assets/private-app.css?v=20260820-login-fix-1',
  '../assets/calicatas.css?v=20260819-audit-2',
  '../assets/supabase.js?v=20260821-supabase-global-1',
  '../assets/shared-auth.js?v=20260821-official-logo-1',
  '../assets/calicatas.js?v=20260821-offline-db-fix-1',
  '../assets/yoye-logo-official.png?v=20260821-official-logo-1',
  '../assets/icons/favicon.svg',
  '../assets/icons/pwa-192.png',
  '../assets/icons/pwa-512.png',
  '../assets/icons/maskable-512.png'
];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('calicatas-campo-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.hostname.includes('supabase.co')||url.pathname.includes('/auth/'))return;
  if(url.origin!==location.origin)return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok)caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));
    return response;
  }).catch(()=>caches.match(event.request).then(cached=>cached||caches.match('./registro-v16.html'))));
});
