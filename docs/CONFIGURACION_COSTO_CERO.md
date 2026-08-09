# Configuración de costo cero

- Usar el proyecto Supabase gratuito existente y vigilar los límites desde el panel.
- No crear ramas de base de datos, porque tienen cobro horario.
- No activar complementos pagados ni cambiar el plan sin autorización expresa.
- Mantener GitHub Pages para el sitio estático.
- Servir fotografías, iconos, CSS y JavaScript desde el repositorio; no usar almacenamiento de pago.
- Mantener una sola base central. Realtime, Auth y RLS operan dentro de las cuotas gratuitas vigentes.
- Si se alcanza un límite gratuito, la aplicación debe informar el fallo de sincronización y no confirmar guardado hasta que el servidor responda.

La configuración busca costo de plataforma de $0 mientras el uso permanezca dentro de las cuotas del plan gratuito. No garantiza costo cero si Supabase o GitHub cambian sus planes o si el consumo supera sus límites.
