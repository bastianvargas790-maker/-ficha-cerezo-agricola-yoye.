const CACHE='aforo-campo-v20260907-paneles';
const SHELL=[
  './',
  './index.html',
  './manifest.webmanifest',
  '../assets/yoye-theme.css?v=20260907-paneles',
  '../assets/private-app.css?v=20260907-paneles',
  '../assets/campos.css?v=20260907-paneles',
  '../assets/supabase.js?v=20260907-paneles',
  '../assets/shared-auth.js?v=20260907-paneles',
  '../assets/campos.js?v=20260907-paneles',
  '../assets/aforo.js?v=20260907-paneles',
  '../assets/yoye-logo.png',
  '../assets/icons/favicon.svg',
  '../assets/icons/aforo-192.png',
  '../assets/icons/aforo-512.png',
  '../assets/icons/aforo-maskable-512.png'
];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('aforo-campo-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.hostname.includes('supabase.co')||url.pathname.includes('/auth/'))return;
  if(url.origin!==location.origin)return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok)caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));
    return response;
  }).catch(()=>caches.match(event.request).then(cached=>cached||caches.match('./index.html'))));
});
