# Validación previa a merge

No fusionar `agent/modulo-calicatas` a `main` hasta completar una prueba funcional real.

Criterios mínimos:

- login autorizado funciona
- lista de cuarteles carga desde Supabase
- guardar una calicata crea cabecera y lecturas
- fotos suben al bucket privado
- historial recupera la misma evaluación
- gráficas responden al filtro de profundidad
- no se exponen claves privadas
- no se crean datos demo ni duplicados.