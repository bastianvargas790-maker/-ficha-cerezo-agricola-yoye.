-- La vía de aplicación no se pregunta en el formulario de terreno: el registro
-- es cuartel, fecha, producto y cantidad. Dejar 'fertirriego' por omisión
-- habría guardado como dato algo que nadie anotó, y una aplicación foliar
-- habría quedado registrada como fertirriego. Se agrega 'sin_dato' y pasa a ser
-- el valor por omisión; cuando el formulario pregunte la vía, los registros
-- nuevos la traerán y los viejos seguirán diciendo la verdad: que no se anotó.
alter table public.fert_aplicaciones drop constraint if exists fert_aplicaciones_via_check;
alter table public.fert_aplicaciones
  add constraint fert_aplicaciones_via_check
  check (via in ('fertirriego','foliar','suelo','sin_dato'));
alter table public.fert_aplicaciones alter column via set default 'sin_dato';
