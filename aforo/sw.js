const CACHE='aforo-campo-v20260907-movil';
const SHELL=[
  './',
  './index.html',
  './manifest.webmanifest',
  '../assets/yoye-theme.css?v=20260907-movil',
  '../assets/private-app.css?v=20260907-movil',
  '../assets/campos.css?v=20260907-movil',
  '../assets/supabase.js?v=20260907-movil',
  '../assets/shared-auth.js?v=20260907-movil',
  '../assets/campos.js?v=20260907-movil',
  '../assets/aforo.js?v=20260907-movil',
  '../assets/yoye-logo.png',
  '../assets/icons/favicon.svg',
  '../assets/icons/aforo-192.png',
  '../assets/icons/aforo-512.png',
  '../assets/icons/aforo-maskable-512.png'
];
self.addEventListener('install',event=>event.waitUntil(precargar().then(()=>self.skipWaiting())))
/* addAll es todo-o-nada: si un solo recurso falla (un archivo renombrado, la
   red que se corta a medias) no se cachea NADA y la app no abre sin conexión.
   Guardando de a uno, lo que sí llegó queda disponible. */
async function precargar(){
  const cache=await caches.open(CACHE);
  await Promise.all(SHELL.map(u=>cache.add(u).catch(()=>{})));
};
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('aforo-campo-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.hostname.includes('supabase.co')||url.pathname.includes('/auth/'))return;
  if(url.origin!==location.origin)return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok)caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));
    return response;
  }).catch(()=>caches.match(event.request).then(cached=>cached||(event.request.mode==='navigate'?caches.match('./index.html'):undefined))));
});
