const CACHE='aforo-rinconada-v2';
const SHELL=[
  './',
  './index.html',
  './manifest.webmanifest',
  '../assets/private-app.css?v=20260820-login-fix-1',
  '../assets/aforo.css?v=20260823-2',
  '../assets/supabase.js?v=20260821-supabase-global-1',
  '../assets/shared-auth.js?v=20260821-official-logo-1',
  '../assets/aforo-formulas.js?v=20260823-2',
  '../assets/aforo.js?v=20260823-2',
  '../assets/yoye-logo-official.png?v=20260821-official-logo-1',
  '../assets/icons/favicon.svg',
  '../assets/icons/pwa-192.png',
  '../assets/icons/pwa-512.png',
  '../assets/icons/maskable-512.png'
];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('aforo-rinconada-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.hostname.includes('supabase.co')||url.pathname.includes('/auth/'))return;
  if(url.origin!==location.origin)return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok)caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));
    return response;
  }).catch(()=>caches.match(event.request).then(cached=>cached||caches.match('./index.html'))));
});
