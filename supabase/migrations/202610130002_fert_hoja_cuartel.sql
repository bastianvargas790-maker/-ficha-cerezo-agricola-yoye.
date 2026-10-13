-- Qué hoja de la planilla es cada cuartel.
--
-- Las hojas se llaman "7", "13 a", "20-18", "nogales 15", "29"; los cuarteles
-- de la base son "C-7", "C-13A", "C-20-18", "C-15", "C-29 antiguo". Adivinarlo
-- con reglas de texto funciona para la mayoría y falla justo donde importa:
-- "29" y "39" existen dos veces (antiguo y nuevo) y "nogales 15" no empieza con
-- el número. Por eso la equivalencia se guarda y se puede corregir sin tocar
-- código: si el asesor renombra una hoja, se arregla una fila.
create table if not exists public.fert_hoja_cuartel (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  hoja text not null,
  cuartel_id uuid not null references public.cuarteles(id) on delete cascade,
  nota text,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
create unique index if not exists fert_hoja_cuartel_hoja_idx
  on public.fert_hoja_cuartel (organizacion_id, lower(hoja));

alter table public.fert_hoja_cuartel enable row level security;
create policy fert_hoja_read   on public.fert_hoja_cuartel for select to authenticated using (private.es_miembro(organizacion_id));
create policy fert_hoja_insert on public.fert_hoja_cuartel for insert to authenticated with check (private.puede_editar(organizacion_id));
create policy fert_hoja_update on public.fert_hoja_cuartel for update to authenticated using (private.puede_editar(organizacion_id)) with check (private.puede_editar(organizacion_id));
create policy fert_hoja_delete on public.fert_hoja_cuartel for delete to authenticated using (private.es_admin(organizacion_id));

-- Carga de las equivalencias conocidas de Rinconada Plano. Los cuarteles se
-- buscan por código, no por id, para que la migración no dependa de ids.
do $$
declare
  v_org uuid := (select id from public.organizaciones order by creado_en limit 1);
  v_campo uuid := (select id from public.campos where slug = 'rinconada-plano' limit 1);
  par text[];
  pares text[][] := array[
    ['7','C-7'],['17','C-17'],['20-18','C-20-18'],['16','C-16'],['22','C-22'],
    ['23','C-23'],['31','C-31'],['5','C-5'],['21','C-21'],['34','C-34'],
    ['19','C-19'],['27','C-27'],['24','C-24'],['33','C-33'],['3','C-3'],
    ['26','C-26'],['26 injerto','C-26'],['40','C-40'],['6','C-6'],
    ['14 A lapins','C-14A'],['14 B  santina','C-14B'],['30-32','C-30-32'],
    ['29','C-29 antiguo'],['28','C-28'],['35','C-35'],['39','C-39 antiguo'],
    ['38','C-38'],['36','C-36'],['37','C-37'],['2','C-2'],['13 a','C-13A'],
    ['13 b','C-13B'],['nogales 15','C-15'],['34 -1','C-34'],['1','C-1']
  ];
  v_cuartel uuid;
begin
  foreach par slice 1 in array pares loop
    select id into v_cuartel from public.cuarteles
      where codigo = par[2] and activo
        and (v_campo is null or campo_id = v_campo)
      limit 1;
    if v_cuartel is not null then
      insert into public.fert_hoja_cuartel (organizacion_id, hoja, cuartel_id, nota)
      values (v_org, par[1], v_cuartel,
        case when par[1] in ('26 injerto','34 -1')
          then 'Pedazo del cuartel: sus kilos se suman al cuartel principal' end)
      on conflict (organizacion_id, lower(hoja)) do nothing;
    end if;
  end loop;
end $$;
