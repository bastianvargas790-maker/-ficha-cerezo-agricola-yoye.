(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const DB_NAME = 'yoye-aforo-offline-v1', DB_VERSION = 1;
  const STORES = { queue: 'queue', quarters: 'quarters', meta: 'meta' };
  const LINEAS = [1, 2, 3, 4];
  const POSICIONES = [['inicio', 'Inicio'], ['un_tercio', '1/3'], ['dos_tercios', '2/3'], ['ultimo', 'Último']];

  let sb, localDb, session, profile, orgId, quarters = [], syncRunning = false;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, digits = 1) => n === null || n === undefined || n === '' || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('es-CL', { maximumFractionDigits: digits });
  const num = value => value === '' || value === null || value === undefined ? null : Number(value);
  const isFinite2 = v => v !== null && Number.isFinite(v);
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const seasonYear = () => { const d = new Date(); return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; };
  const uuid = () => globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 3 | 8); return v.toString(16); });
  const msg = (text, error = false) => { const el = $('#formMessage'); if (el) { el.textContent = text; el.classList.toggle('error', error); } };
  const status = text => { const el = $('#afSync'); if (el) el.textContent = text; };

  function openLocalDb() {
    if (localDb) return Promise.resolve(localDb);
    if (!('indexedDB' in window)) return Promise.reject(new Error('Este navegador no permite almacenamiento local.'));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => { const d = request.result; Object.values(STORES).forEach(name => { if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: 'id' }); }); };
      request.onsuccess = () => { localDb = request.result; resolve(localDb); };
      request.onerror = () => reject(request.error || new Error('No fue posible abrir el almacenamiento local.'));
    });
  }
  async function localPut(store, value) { const d = await openLocalDb(); return new Promise((resolve, reject) => { const r = d.transaction(store, 'readwrite').objectStore(store).put(value); r.onsuccess = () => resolve(value); r.onerror = () => reject(r.error); }); }
  async function localAll(store) { const d = await openLocalDb(); return new Promise((resolve, reject) => { const r = d.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result || []); r.onerror = () => reject(r.error); }); }
  async function localDelete(store, id) { const d = await openLocalDb(); return new Promise((resolve, reject) => { const r = d.transaction(store, 'readwrite').objectStore(store).delete(id); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); }); }

  function updateSyncLabel(pending = 0) {
    const offline = !navigator.onLine;
    status(offline ? `Sin conexión${pending ? ` · ${pending} pendiente(s)` : ''} · guardado en dispositivo` : syncRunning ? 'Sincronizando…' : pending ? `En línea · ${pending} pendiente(s)` : 'En línea · datos sincronizados');
    const banner = $('#afOfflineBanner');
    if (banner) {
      banner.hidden = !offline && !pending && !syncRunning;
      banner.textContent = offline ? 'Sin conexión: puedes seguir registrando aforos. Se guardarán en este dispositivo y se enviarán al recuperar internet.' : pending ? `${pending} aforo(s) esperan sincronización.` : syncRunning ? 'Enviando aforos pendientes…' : 'Los datos están sincronizados.';
    }
  }
  async function refreshSyncLabel() { try { const q = await localAll(STORES.queue); updateSyncLabel(q.filter(x => x.status !== 'synced').length); } catch { updateSyncLabel(0); } }

  // Cálculo de caudal/CU: única implementación en aforo-formulas.js, compartida
  // con el dashboard de Agrícola Yoye. No reimplementar acá.
  const F = globalThis.YOYE_AFORO_FORMULAS;
  function caudalLh(volumenMl, tiempoS) { return F.calcularCaudal(volumenMl, tiempoS); }
  function computeResultado(lecturas) { return F.calcularResultado(lecturas); }

  // --- Cuarteles: cargar y cachear para uso sin conexión ---
  async function cacheQuarters(list) { await Promise.all((list || []).map(q => localPut(STORES.quarters, { id: q.id, value: q }))); }
  async function cachedQuarters() { return (await localAll(STORES.quarters)).map(x => x.value); }
  async function loadQuarters() {
    try {
      const { data, error } = await sb.from('cuarteles').select('id,codigo,cultivo,caseta,equipo').eq('organizacion_id', orgId).eq('activo', true).order('codigo');
      if (error) throw error;
      quarters = data || [];
      await cacheQuarters(quarters);
    } catch (error) {
      console.warn('No se pudo cargar cuarteles en línea, usando caché', error);
      quarters = await cachedQuarters();
    }
    const options = quarters.map(q => `<option value="${esc(q.id)}">${esc(q.codigo)}${q.cultivo ? ` · ${esc(q.cultivo)}` : ''}</option>`).join('');
    const select = $('#afQuarter'); if (select) select.innerHTML = '<option value="">Selecciona un cuartel</option>' + options;
    const historySelect = $('#historyQuarter'); if (historySelect) historySelect.innerHTML = '<option value="">Todos los cuarteles</option>' + options;
  }

  // --- Perfil ---
  async function loadProfile() {
    try {
      const { data, error } = await sb.from('perfiles').select('*').eq('id', session.user.id).single();
      if (error) throw error;
      profile = data; orgId = data.organizacion_id;
    } catch (error) { console.warn('No se pudo cargar el perfil', error); }
    const el = $('#afProfile'); if (el) el.textContent = profile ? `${profile.nombre_completo || 'Usuario'} · ${profile.rol || 'Sin cargo'}` : 'Perfil no disponible';
  }

  // --- Matriz de 16 mediciones ---
  function buildMatrix() {
    const wrap = $('#afMatrix'); if (!wrap) return;
    wrap.innerHTML = LINEAS.map(linea => `
      <div class="reading-line" data-linea="${linea}">
        <b>Línea ${linea}</b>
        <div class="reading-cells">
          ${POSICIONES.map(([key, label]) => `
            <div class="reading-cell" data-posicion="${key}">
              <span>${esc(label)}</span>
              <input class="vol" type="number" min="0" step="1" inputmode="decimal" placeholder="Volumen mL" aria-label="Volumen en mL, línea ${linea}, posición ${esc(label)}">
              <div class="q-out">— L/h</div>
            </div>`).join('')}
        </div>
      </div>`).join('');
    if (wrap.dataset.bound !== 'true') { wrap.dataset.bound = 'true'; wrap.addEventListener('input', onMatrixInput); }
  }
  function onMatrixInput(event) {
    const cell = event.target.closest('.reading-cell');
    if (!cell) return;
    const vol = num(cell.querySelector('.vol').value), tiempo = num($('#afTiempoMedicion').value);
    const q = caudalLh(vol, tiempo);
    cell.querySelector('.q-out').textContent = q === null ? '— L/h' : `${fmt(q)} L/h`;
    renderResultado();
  }
  function readMatrix() {
    // El tiempo se cronometra una sola vez por aforo, no por celda -- confirmado
    // contra el 100% de los aforos históricos de DB_Aforos (ver reporte de
    // arquitectura). Cada lectura hereda el mismo tiempo_medicion_s.
    const tiempo_s = num($('#afTiempoMedicion').value);
    const lecturas = [];
    $$('.reading-line').forEach(lineEl => {
      const linea = Number(lineEl.dataset.linea);
      lineEl.querySelectorAll('.reading-cell').forEach(cell => {
        const volumen_ml = num(cell.querySelector('.vol').value);
        lecturas.push({ linea, posicion: cell.dataset.posicion, volumen_ml, tiempo_s, caudal_l_h: caudalLh(volumen_ml, tiempo_s) });
      });
    });
    return lecturas;
  }
  const CLASIFICACION_ESTILO = { Excelente: 'cu-excelente', Bueno: 'cu-bueno', Medio: 'cu-medio', Bajo: 'cu-bajo' };
  function renderResultado() {
    const { qMedio, q25, cu, clasificacion } = computeResultado(readMatrix());
    $('#resQMedio').textContent = fmt(qMedio); $('#resQ25').textContent = fmt(q25);
    $('#resCu').textContent = cu === null ? '—' : `${fmt(cu)}%`;
    $('#resClas').textContent = clasificacion;
    const cuCard = $('#resCuCard'); if (cuCard) cuCard.className = `result-card ${CLASIFICACION_ESTILO[clasificacion] || ''}`;
  }

  // --- Presiones por válvula ---
  function buildValves(n) {
    const wrap = $('#afValves'); if (!wrap) return;
    const rows = [];
    for (let i = 1; i <= n; i++) rows.push(`
      <div class="valve-grid" data-valve="${i}">
        <span class="head">V${i}</span>
        <div class="field"><label>Presión entrada (bar)</label><input class="pe" type="number" min="0" step="0.1" inputmode="decimal"></div>
        <div class="field"><label>Presión salida (bar)</label><input class="ps" type="number" min="0" step="0.1" inputmode="decimal"></div>
      </div>`);
    wrap.innerHTML = rows.join('') || '<p class="mini-status">Selecciona la cantidad de válvulas para registrar presiones.</p>';
  }
  function readValves() {
    // Se conserva la posición de cada válvula (con null si quedó sin medir)
    // para que presiones_entrada[i] siga correspondiendo a la válvula i+1.
    const pe = [], ps = [];
    $$('.valve-grid').forEach(row => { pe.push(num(row.querySelector('.pe').value)); ps.push(num(row.querySelector('.ps').value)); });
    const avg = arr => { const values = arr.filter(isFinite2); return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; };
    const peProm = avg(pe), psProm = avg(ps);
    const perdidaBar = isFinite2(peProm) && isFinite2(psProm) ? peProm - psProm : null;
    const perdidaPct = isFinite2(perdidaBar) && peProm > 0 ? (perdidaBar / peProm) * 100 : null;
    return { presiones_entrada: pe, presiones_salida: ps, presion_entrada_prom: peProm, presion_salida_prom: psProm, perdida_carga_bar: perdidaBar, perdida_carga_pct: perdidaPct };
  }

  // --- Guardar (offline-first) ---
  async function saveAforo(event) {
    event.preventDefault();
    const cuartelId = $('#afQuarter').value;
    if (!cuartelId) return msg('Selecciona un cuartel.', true);
    if (!$('#afFecha').value) return msg('Selecciona la fecha del aforo.', true);
    const lecturas = readMatrix();
    const { qMedio, q25, cu, clasificacion } = computeResultado(lecturas);
    const valvulas = readValves();
    // aforo_lecturas ya no guarda tiempo_s por fila -- el tiempo es único por
    // aforo y vive en aforos.tiempo_medicion_s (ver reporte de arquitectura).
    const lecturasParaGuardar = lecturas.map(({ tiempo_s, ...resto }) => resto);
    const record = {
      id: uuid(), cuartel_id: cuartelId, unidad_aforo: $('#afUnidad')?.value.trim() || null,
      temporada: num($('#afTemporada').value) || seasonYear(), fecha: $('#afFecha').value,
      equipo_riego: $('#afEquipo').value.trim() || null, n_valvulas: Number($('#afNValvulas').value) || 0,
      tiempo_medicion_s: num($('#afTiempoMedicion').value),
      ...valvulas, q_medio: qMedio, q_25: q25, cu, clasificacion,
      observaciones: $('#afObservaciones').value.trim() || null, ubicacion: null,
      creado_por: session?.user?.id, actualizado_por: session?.user?.id, organizacion_id: orgId,
      lecturas: lecturasParaGuardar,
    };
    const button = $('#saveAforo'); if (button) button.disabled = true;
    try {
      await localPut(STORES.queue, { id: record.id, status: 'pending', record, createdAt: new Date().toISOString() });
      msg('Aforo guardado. Sincronizando…');
      await refreshSyncLabel();
      resetForm();
      if (navigator.onLine) await syncQueue();
    } catch (error) {
      console.error('No se pudo guardar el aforo', error);
      msg('No fue posible guardar el aforo en este dispositivo.', true);
    } finally { if (button) button.disabled = false; }
  }

  async function syncQueue() {
    if (syncRunning || !navigator.onLine || !sb) return;
    syncRunning = true; await refreshSyncLabel();
    try {
      const queue = (await localAll(STORES.queue)).filter(item => item.status !== 'synced');
      for (const item of queue) {
        try {
          const { lecturas, ...aforo } = item.record;
          const { data, error } = await sb.from('aforos').upsert({ ...aforo }, { onConflict: 'id' }).select('id').single();
          if (error) throw error;
          const aforoId = data.id;
          const rows = lecturas.filter(l => l.volumen_ml !== null).map(l => ({ aforo_id: aforoId, ...l }));
          if (rows.length) { const { error: lecturasError } = await sb.from('aforo_lecturas').upsert(rows, { onConflict: 'aforo_id,linea,posicion' }); if (lecturasError) throw lecturasError; }
          await localDelete(STORES.queue, item.id);
        } catch (error) { console.error('No se pudo sincronizar un aforo', error); }
      }
    } finally { syncRunning = false; await refreshSyncLabel(); }
  }

  function resetForm() {
    const form = $('#aforoForm'); if (form) form.reset();
    $('#afFecha').value = todayIso(); $('#afTemporada').value = seasonYear();
    buildValves(0); buildMatrix();
    renderResultado();
  }

  // --- Historial ---
  async function loadHistory() {
    const cuartelId = $('#historyQuarter')?.value;
    const list = $('#historyList'); if (!list) return;
    list.innerHTML = '<div class="empty-state">Cargando historial…</div>';
    try {
      let query = sb.from('aforos').select('id,fecha,temporada,cu,clasificacion,cuarteles(codigo)').order('fecha', { ascending: false }).limit(60);
      if (cuartelId) query = query.eq('cuartel_id', cuartelId);
      const { data, error } = await query;
      if (error) throw error;
      list.innerHTML = data && data.length ? data.map(row => `
        <div class="history-row">
          <div><b>${esc(row.cuarteles?.codigo || 'Sin cuartel')} · Temporada ${esc(row.temporada)}</b><small>${esc(row.fecha)}</small></div>
          <div class="history-cu ${CLASIFICACION_ESTILO[F.clasificarCU(row.cu)] || ''}">${row.cu === null ? '—' : `${fmt(row.cu)}%`}</div>
        </div>`).join('') : '<div class="empty-state">Sin aforos registrados para este filtro.</div>';
    } catch (error) {
      console.error('No se pudo cargar el historial', error);
      list.innerHTML = '<div class="empty-state">No fue posible cargar el historial. Revisa tu conexión.</div>';
    }
  }

  function go(viewId) { $$('.view').forEach(v => v.classList.toggle('active', v.id === viewId)); if (viewId === 'view-historial') loadHistory(); if (viewId === 'view-nuevo') resetForm(); }

  function bind() {
    $('#goNuevo')?.addEventListener('click', () => go('view-nuevo'));
    $('#goHistorial')?.addEventListener('click', () => go('view-historial'));
    $$('[data-back]').forEach(btn => btn.addEventListener('click', () => go('view-inicio')));
    $('#afNValvulas')?.addEventListener('change', event => buildValves(Number(event.target.value) || 0));
    $('#afValves')?.addEventListener('input', renderResultado);
    $('#afTiempoMedicion')?.addEventListener('input', () => {
      const tiempo = num($('#afTiempoMedicion').value);
      $$('.reading-cell').forEach(cell => {
        const q = caudalLh(num(cell.querySelector('.vol').value), tiempo);
        cell.querySelector('.q-out').textContent = q === null ? '— L/h' : `${fmt(q)} L/h`;
      });
      renderResultado();
    });
    $('#aforoForm')?.addEventListener('submit', saveAforo);
    $('#historyQuarter')?.addEventListener('change', loadHistory);
    window.addEventListener('online', syncQueue);
    window.addEventListener('online', refreshSyncLabel);
    window.addEventListener('offline', refreshSyncLabel);
  }

  async function init(detail) {
    sb = detail.client; session = detail.session;
    if (!session) return;
    buildMatrix(); buildValves(0);
    $('#afFecha').value = todayIso(); $('#afTemporada').value = seasonYear();
    await loadProfile();
    await loadQuarters();
    await refreshSyncLabel();
    if (navigator.onLine) syncQueue();
  }

  bind();
  window.addEventListener('yoye-auth-ready', event => init(event.detail));
})();
