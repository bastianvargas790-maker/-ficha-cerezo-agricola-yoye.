import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.2";

/* Recibe el programa de fertilización desde la planilla del campo.
 *
 * Lo manda el Apps Script de la planilla (docs/fertilizacion/subir-programa.gs)
 * cuando el jefe de riego aprieta "Subir programa". Va en sentido contrario a
 * sync-calicata y sync-aforo-rinconada, que escriben EN la planilla; por eso
 * no viaja con la sesión de un usuario, sino con el mismo secreto compartido
 * que ya usan esas dos, en el encabezado X-Yoye-Sync-Secret.
 *
 * Se puede llamar las veces que sea: cada línea se identifica por cuartel,
 * producto, fecha y temporada. Lo que ya estaba se actualiza y lo que
 * desapareció de la planilla queda con activo=false, nunca borrado.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-yoye-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/* Nombre normalizado del producto: es la llave con la que se evita que
   "QropMix", "Qropmix urea" y "qropmix" terminen siendo tres productos. */
const claveProducto = (s: string) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();

type Fila = { cuartel: string; producto: string; fecha: string; cantidad: number; temporada: string };

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const syncSecret = Deno.env.get("GOOGLE_SHEETS_SYNC_SECRET");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Configuración de Supabase incompleta" }, 500);
  if (!syncSecret) return json({ error: "Falta el secreto compartido con la planilla" }, 503);

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const enviado = request.headers.get("X-Yoye-Sync-Secret") || (typeof body.sync_secret === "string" ? body.sync_secret : "");
  /* Comparación de largo constante: con una comparación normal, el tiempo de
     respuesta filtra cuántos caracteres del secreto van bien. */
  const iguales = (a: string, b: string) => {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  };
  if (!iguales(enviado, syncSecret)) return json({ error: "Secreto inválido" }, 401);

  const filas = Array.isArray(body.filas) ? body.filas as Fila[] : [];
  if (!filas.length) return json({ error: "No llegó ninguna línea del programa" }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: org } = await admin.from("organizaciones").select("id").order("creado_en").limit(1).maybeSingle();
  if (!org) return json({ error: "No hay organización" }, 500);
  const { data: admin1 } = await admin.from("perfiles").select("id")
    .eq("organizacion_id", org.id).eq("rol", "administrador").order("creado_en").limit(1).maybeSingle();
  if (!admin1) return json({ error: "No hay un perfil administrador para registrar el programa" }, 500);

  // Equivalencias hoja → cuartel y catálogo de productos.
  const { data: mapa } = await admin.from("fert_hoja_cuartel").select("hoja,cuartel_id").eq("activo", true);
  const porHoja = new Map((mapa || []).map((m) => [String(m.hoja).trim().toLowerCase(), m.cuartel_id as string]));
  const { data: productos } = await admin.from("fert_productos").select("id,clave,unidad").eq("organizacion_id", org.id);
  const porClave = new Map((productos || []).map((p) => [p.clave as string, p]));

  const sinCuartel = new Set<string>();
  const temporadas = new Set<string>();
  const cuartelesTocados = new Set<string>();
  const aGuardar: Record<string, unknown>[] = [];

  for (const f of filas) {
    const cuartelId = porHoja.get(String(f.cuartel || "").trim().toLowerCase());
    if (!cuartelId) { sinCuartel.add(String(f.cuartel)); continue; }
    const cantidad = Number(f.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.fecha || ""))) continue;

    const clave = claveProducto(f.producto);
    if (!clave) continue;
    let producto = porClave.get(clave);
    if (!producto) {
      /* Producto que el asesor agregó a la planilla y no está en el catálogo:
         se crea sin ley de nutrientes y se deja anotado, para que nadie crea
         que sus unidades de N o K están calculadas. */
      const nuevo = await admin.from("fert_productos").insert({
        organizacion_id: org.id, nombre: String(f.producto).trim(), clave, unidad: "kg",
        notas: "Llegó en el programa de la planilla; falta su ley de nutrientes.",
        creado_por: admin1.id, actualizado_por: admin1.id,
      }).select("id,clave,unidad").single();
      if (nuevo.error || !nuevo.data) continue;
      producto = nuevo.data;
      porClave.set(clave, producto);
    }
    const temporada = String(f.temporada || "").trim() || "sin temporada";
    temporadas.add(temporada);
    cuartelesTocados.add(cuartelId);
    aGuardar.push({
      organizacion_id: org.id, cuartel_id: cuartelId, producto_id: producto.id,
      temporada, fecha: f.fecha, cantidad, unidad: producto.unidad === "L" ? "L" : "kg",
      activo: true, creado_por: admin1.id, actualizado_por: admin1.id, actualizado_en: new Date().toISOString(),
    });
  }

  if (!aGuardar.length) {
    return json({ ok: true, guardadas: 0, sin_cuartel: [...sinCuartel] });
  }

  const { error } = await admin.from("fert_plan").upsert(aGuardar, {
    onConflict: "cuartel_id,producto_id,fecha,temporada", ignoreDuplicates: false,
  });
  if (error) return json({ error: error.message }, 500);

  /* Lo que el asesor sacó de la planilla tiene que desaparecer del programa, o
     la app seguiría sugiriendo una aplicación que ya nadie va a hacer. Se da de
     baja (activo=false), nunca se borra, y solo dentro de los cuarteles y
     temporadas que vinieron en esta subida. */
  let dadasDeBaja = 0;
  if (body.ultima === true && cuartelesTocados.size) {
    const vivas = new Set(aGuardar.map((r) => `${r.cuartel_id}|${r.producto_id}|${r.fecha}|${r.temporada}`));
    const { data: existentes } = await admin.from("fert_plan")
      .select("id,cuartel_id,producto_id,fecha,temporada")
      .in("cuartel_id", [...cuartelesTocados]).in("temporada", [...temporadas])
      .eq("activo", true).not("fecha", "is", null);
    const sobran = (existentes || [])
      .filter((r) => !vivas.has(`${r.cuartel_id}|${r.producto_id}|${r.fecha}|${r.temporada}`))
      .map((r) => r.id);
    if (sobran.length) {
      const baja = await admin.from("fert_plan")
        .update({ activo: false, actualizado_por: admin1.id, actualizado_en: new Date().toISOString() })
        .in("id", sobran);
      if (!baja.error) dadasDeBaja = sobran.length;
    }
  }

  return json({
    ok: true, guardadas: aGuardar.length, dadas_de_baja: dadasDeBaja,
    cuarteles: cuartelesTocados.size, temporadas: [...temporadas],
    sin_cuartel: [...sinCuartel],
  });
});
