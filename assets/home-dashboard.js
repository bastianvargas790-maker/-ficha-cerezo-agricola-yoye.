(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const formatHa = value => Number(value).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ha';
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  let channel;

  function set(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value;
  }

  function fieldMapMarkup(map) {
    if (!map) return '<p class="map-warning">No fue posible cargar la capa geográfica.</p>';
    const lots = map.lots.map(lot => `<path class="field-lot" tabindex="0" d="${lot.path}" aria-label="${escapeHtml(lot.name)}, ${formatHa(lot.areaHa)}"><title>${escapeHtml(lot.name)} · ${formatHa(lot.areaHa)}</title></path>`).join('');
    return `<div class="field-map-wrap"><svg class="field-map" viewBox="0 0 1000 1000" role="img" aria-labelledby="fieldMapTitle fieldMapDesc"><title id="fieldMapTitle">Mapa de polígonos del Fundo La Rinconada</title><desc id="fieldMapDesc">Deslinde general y ${map.summary.lotCount} polígonos internos obtenidos de rinconada.kmz.</desc><path class="field-boundary" d="${map.boundary.path}"></path>${lots}</svg><p class="map-legend"><span><i class="boundary-swatch"></i> Deslinde general</span><span><i class="lot-swatch"></i> Polígonos internos</span></p><p class="map-help">Toca o enfoca un polígono para ver su nombre y superficie.</p></div>`;
  }

  async function refresh(client, session) {
    if (!client || !session) return;
    const [quarters, irrigations, probes, profile] = await Promise.all([
      client.from('cuarteles').select('id,cultivo,superficie_ha,caseta,equipo').eq('activo', true),
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
    set('#currentRole', ({ administrador: 'Administrador', editor: 'Editor', solo_lectura: 'Solo lectura' })[profile.data?.rol] || 'Sin perfil');

    const rows = quarters.data || [];
    const known = rows.filter(quarter => Number.isFinite(Number(quarter.superficie_ha)));
    const registered = known.reduce((sum, quarter) => sum + Number(quarter.superficie_ha), 0);
    const map = window.YOYE_FIELD_MAP;
    set('#totalSurface', map ? formatHa(map.summary.boundaryHa) : 'Sin información');

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
      const difference = map ? map.summary.boundaryHa - registered : null;
      title.textContent = 'Superficie del Fundo La Rinconada';
      body.innerHTML = `${fieldMapMarkup(map)}<div class="surface-kpis"><article><span>Deslinde KMZ</span><strong>${map ? formatHa(map.summary.boundaryHa) : 'Sin información'}</strong></article><article><span>Base compartida</span><strong>${known.length ? formatHa(registered) : 'Sin información'}</strong></article><article><span>Diferencia</span><strong>${difference === null ? 'Sin información' : formatHa(difference)}</strong></article><article><span>Unión polígonos KMZ</span><strong>${map ? formatHa(map.summary.lotsUnionHa) : 'Sin información'}</strong></article></div><p class="technical-note">El deslinde representa el predio completo. La unión de polígonos internos descuenta superposiciones; no reemplaza las superficies técnicas editables de la base compartida.</p><details><summary>Detalle del procesamiento geográfico</summary><ul><li>Archivo: ${escapeHtml(map?.summary.source || 'Sin información')}</li><li>Polígonos internos: ${map?.summary.lotCount ?? 'Sin información'}</li><li>Suma simple: ${map ? formatHa(map.summary.lotsSumHa) : 'Sin información'}</li><li>Solapamiento descontado: ${map ? formatHa(map.summary.overlapHa) : 'Sin información'}</li><li>Procesado: ${escapeHtml(map?.summary.processed || 'Sin información')}</li></ul></details><h3>Superficie registrada por cultivo</h3><ul>${Object.entries(crops).sort().map(([crop, value]) => `<li>${escapeHtml(crop)}: ${formatHa(value)}</li>`).join('')}</ul>`;
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
})();
