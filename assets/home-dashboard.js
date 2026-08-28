(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const formatHa = value => Number(value).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ha';
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  let channel, lastClient, lastSession;

  function set(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value;
  }

  function fieldMapMarkup(map) {
    if (!map) return '<p class="map-warning">No fue posible cargar la capa geográfica.</p>';
    const lots = map.lots.map(lot => `<path class="field-lot" tabindex="0" d="${lot.path}" aria-label="${escapeHtml(lot.name)}"><title>${escapeHtml(lot.name)}</title></path>`).join('');
    return `<div class="field-map-wrap"><svg class="field-map" viewBox="0 0 1000 1000" role="img" aria-labelledby="fieldMapTitle fieldMapDesc"><title id="fieldMapTitle">Mapa de polígonos del Fundo La Rinconada</title><desc id="fieldMapDesc">Deslinde general y ${map.summary.lotCount} polígonos internos obtenidos de rinconada.kmz.</desc><path class="field-boundary" d="${map.boundary.path}"></path>${lots}</svg><p class="map-legend"><span><i class="boundary-swatch"></i> Deslinde general</span><span><i class="lot-swatch"></i> Polígonos internos</span></p><p class="map-help">Toca o enfoca un polígono para ver su nombre.</p></div>`;
  }

  async function refresh(client, session) {
    if (!client || !session) return;
    lastClient = client; lastSession = session;
    // Los tiles cuentan lo del campo activo, no lo de toda la organización.
    // Con Mirador Cerro seleccionado, "Cuarteles activos" mostraba 53 y
    // "Superficie registrada" las 78,44 ha de Rinconada Plano, mientras el
    // resto de la pantalla decía Mirador Cerro.
    const campo = window.yoyeActiveCampo?.() || null;
    let quartersQuery = client.from('cuarteles').select('id,cultivo,superficie_ha,caseta,equipo').eq('activo', true);
    if (campo?.id) quartersQuery = quartersQuery.eq('campo_id', campo.id);
    const [quarters, irrigations, probes, profile] = await Promise.all([
      quartersQuery,
      client.from('registros_riego').select('id', { count: 'exact', head: true }).eq('activo', true),
      client.from('sondas').select('id', { count: 'exact', head: true }),
      client.from('perfiles').select('rol,estado').eq('id', session.user.id).maybeSingle()
    ]);
    if ([quarters, irrigations, probes, profile].some(result => result.error)) {
      set('#homeSync', 'No fue posible sincronizar');
      return;
    }

    set('#countQuarters', quarters.data?.length ?? 0);
    set('#countIrrigations', irrigations.count ?? 0);
    set('#countProbes', probes.count ?? 0);
    set('#currentRole', ({ administrador: 'Jefe de riego', editor: 'Editor', solo_lectura: 'Solo lectura' })[profile.data?.rol] || 'Sin perfil');

    const rows = quarters.data || [];
    const known = rows.filter(quarter => Number.isFinite(Number(quarter.superficie_ha)));
    const registered = known.reduce((sum, quarter) => sum + Number(quarter.superficie_ha), 0);
    const map = window.YOYE_FIELD_MAP;
    set('#totalSurface', known.length ? formatHa(registered) : 'Sin información');

    const dialog = $('#homeDialog');
    const title = $('#dialogTitle');
    const body = $('#dialogBody');
    $('#roleCard').onclick = () => {
      title.textContent = 'Perfil y permisos';
      body.innerHTML = `<p><b>Rol:</b> ${escapeHtml($('#currentRole').textContent)}</p><p><b>Estado:</b> ${escapeHtml(profile.data?.estado || 'Sin información')}</p><p>Los permisos efectivos también son controlados por RLS en el servidor.</p>`;
      dialog.showModal();
    };
    $('#surfaceCard').onclick = () => {
      const crops = {};
      known.forEach(quarter => { crops[quarter.cultivo || 'Sin información'] = (crops[quarter.cultivo || 'Sin información'] || 0) + Number(quarter.superficie_ha); });
      title.textContent = 'Superficie de ' + (campo?.nombre || 'los cuarteles');
      body.innerHTML = `${fieldMapMarkup(map)}<div class="surface-kpis"><article><span>Superficie registrada en cuarteles</span><strong>${known.length ? formatHa(registered) : 'Sin información'}</strong></article><article><span>Cuarteles con superficie registrada</span><strong>${known.length}</strong></article></div><p class="technical-note">El mapa KMZ se conserva únicamente como referencia visual del deslinde y los cuarteles. La superficie oficial mostrada se obtiene de los cuarteles guardados en la base compartida.</p><h3>Superficie registrada por cultivo</h3><ul>${Object.entries(crops).sort().map(([crop, value]) => `<li>${escapeHtml(crop)}: ${formatHa(value)}</li>`).join('')}</ul>`;
      dialog.showModal();
    };

    set('#homeSync', 'Sincronizado · ' + new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }));
    channel?.unsubscribe();
    channel = client.channel('yoye-inicio')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cuarteles' }, () => refresh(client, session))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registros_riego' }, () => refresh(client, session))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sondas' }, () => refresh(client, session))
      .subscribe();
  }

  addEventListener('yoye-auth-ready', event => refresh(event.detail.client, event.detail.session));
  // campos.js carga los campos de forma asincrona y recien entonces
  // yoyeActiveCampo() devuelve algo. Como este modulo tambien arranca en
  // yoye-auth-ready, el primer refresh corre antes de que exista campo activo y
  // la consulta sale sin filtro: por eso el primer render de cada sesion
  // mostraba los 53 cuarteles y solo se corregia si alguien cambiaba de campo
  // a mano. Hay que recontar tambien cuando los campos quedan listos.
  document.addEventListener('yoye-campo-ready', () => refresh(lastClient, lastSession));
  document.addEventListener('yoye-campo-changed', () => refresh(lastClient, lastSession));
})();
