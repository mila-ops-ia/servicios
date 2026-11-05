// Cartera — app interna de gestión de préstamos. Una sola página con rutas por hash.

const $app = document.getElementById("app");
const $nav = document.getElementById("nav");
const $foot = document.getElementById("side-foot");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (s) => {
  if (!s) return "—";
  const d = parseDate(s);
  const opts = { day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("es-AR", opts).replace(".", "");
};

const state = { mes: monthOf(today()), mesCobros: monthOf(today()), filtro: "activos", busqueda: "", buscarP: "", lastPath: "" };

const SITUACION = {
  "al-dia": ["●", "Al día"],
  "por-vencer": ["▲", "Vence pronto"],
  mora: ["■", "En mora"],
  cancelado: ["✓", "Cancelado"],
  incobrable: ["✕", "Incobrable"],
};
const TIPOS_PAGO = { cuota: "Cuota", renovacion: "Renovación", cancelacion: "Cancelación", otro: "Pago parcial" };

const pill = (sit, extra = "") => {
  const [i, t] = SITUACION[sit] || ["", sit];
  return `<span class="pill ${sit}"><i aria-hidden="true">${i}</i>${t}${extra ? " · " + esc(extra) : ""}</span>`;
};
const cliente = (id) => db.data.clientes.find((c) => c.id === id) || { nombre: "Cliente borrado" };
// Código fijo de cada préstamo: P-001, P-002... (lo asigna la base, en orden)
const codigo = (p) => (p && p.numero ? "P-" + String(p.numero).padStart(3, "0") : "");
const codeTag = (p) => (codigo(p) ? `<span class="code">${codigo(p)}</span>` : "");
const prestamoDesc = (p) =>
  `${MODALIDADES[p.modalidad].label} · ${money(p.capital)}${p.modalidad === "semanal" ? ` · ${p.cuotas} cuotas` : ""}`;
const prestamoLabel = (p) => (codigo(p) ? codigo(p) + " · " : "") + prestamoDesc(p);
const analizarTodos = () => db.data.prestamos.map((p) => analizar(p, db.data.pagos));

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2400);
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, query] = raw.split("?");
  return { path, parts: path.split("/").filter(Boolean), q: new URLSearchParams(query || "") };
}

async function guard(fn) {
  try {
    await fn();
  } catch (e) {
    console.error(e);
    toast("No se pudo guardar: " + (e.message || e));
  }
}

// Marca el préstamo como cancelado cuando queda en cero (y lo reactiva si se borra un pago).
async function sincronizarEstado(p) {
  const r = analizar(p, db.data.pagos, "9999-12-31");
  if (p.estado === "activo" && r.saldo <= 0.5) await db.update("prestamos", p.id, { estado: "cancelado" });
  else if (p.estado === "cancelado" && r.saldo > 0.5) await db.update("prestamos", p.id, { estado: "activo" });
}

/* ───────────────────────── Navegación ───────────────────────── */

function renderNav(section) {
  const items = [
    ["", "◧", "Tablero"],
    ["salud", "♥", "Salud"],
    ["clientes", "◉", "Clientes"],
    ["prestamos", "◈", "Préstamos"],
    ["cobros", "↓", "Cobros"],
    ["datos", "⇅", "Datos"],
  ];
  // En el celu la contraseña queda en Datos y en el menú de Mili (abajo no entran más de 6)
  if (REMOTE && innerWidth > 900) items.push(["clave", "🔑", "Contraseña"]);
  $nav.innerHTML = items
    .map(
      ([k, i, t]) =>
        `<a href="#/${k}" class="${section === k ? "on" : ""}"><span class="ico" aria-hidden="true">${i}</span><span class="txt">${t}</span></a>`
    )
    .join("");
  const dark = document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  $foot.innerHTML = `
    <div>${REMOTE ? esc(db.user ? db.user.email : "") : `Demo · datos de ejemplo<br><a href="../" style="color:var(--accent);font-weight:700">← Volver a mila·ops</a>`}</div>
    <div class="row">
      <button class="icon-btn small" data-act="theme">${dark ? "☀ Modo claro" : "☾ Modo oscuro"}</button>
      ${REMOTE ? `<a class="icon-btn small" href="#/clave" style="text-decoration:none">🔑 Contraseña</a><button class="icon-btn small" data-act="logout">Salir</button>` : ""}
    </div>`;
}

/* ───────────────────────── Tablero ───────────────────────── */

function viewDashboard() {
  const data = db.data;
  const key = state.mes;
  const esActual = key === monthOf(today());
  const m = metricasMes(data, key);
  const prev = metricasMes(data, addMonthKey(key, -1));
  const A = analizarTodos();
  const activos = A.filter((r) => r.activo);
  const enMora = activos.filter((r) => r.situacion === "mora").sort((a, b) => b.diasAtraso - a.diasAtraso);
  const enCalle = esActual ? capitalEnCalle(data, today()) : m.capitalFin;
  const porCobrar = vencimientosDelMes(data, key);
  const perdida = sum(A.filter((r) => r.situacion === "incobrable"), "capitalPendiente");

  if (!data.prestamos.length) {
    return {
      html: `<div class="page">
        <div class="page-head"><div><h1>Tablero</h1><p>Todavía no hay préstamos cargados.</p></div></div>
        ${demoBanner()}
        <div class="card empty">
          <p>Empezá cargando un cliente y su préstamo. El tablero se arma solo con lo que cargues.</p>
          <div class="row" style="justify-content:center">
            <a class="btn" href="#/clientes/nuevo">+ Cliente</a>
            <a class="btn ghost" href="#/prestamos/nuevo">+ Préstamo</a>
          </div>
        </div></div>`,
    };
  }

  // Serie de hasta 12 meses que termina en el mes elegido, desde el primer préstamo.
  const primer = data.prestamos.map((p) => monthOf(p.fecha_entrega)).sort()[0];
  let desde = addMonthKey(key, -11);
  if (primer > desde) desde = primer;
  if (addMonthKey(desde, 5) > key) desde = addMonthKey(key, -5);
  const serie = [];
  for (let k = desde; k <= key; k = addMonthKey(k, 1)) serie.push(metricasMes(data, k));
  const corto = (k) => monthName(k, { month: "short" }).replace(".", "");

  const delta = (a, b) => {
    if (!b) return `<span class="muted small">Sin datos del mes anterior</span>`;
    const d = (a - b) / b;
    const cls = d >= 0 ? "up" : "down";
    return `<span class="delta ${cls}">${d >= 0 ? "▲" : "▼"} ${pct(Math.abs(d), 0)}</span> <span class="muted small">vs ${monthName(addMonthKey(key, -1), { month: "long" })}${esActual ? " · mes en curso" : ""}</span>`;
  };
  const deltaPts = (a, b) => {
    if (a == null || b == null) return "";
    const d = (a - b) * 100;
    return `<span class="delta ${d >= 0 ? "up" : "down"}">${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toLocaleString("es-AR", { maximumFractionDigits: 1 })} pts</span>`;
  };

  const gananciaChart = Charts.columns(
    serie.map((s) => ({
      key: s.key,
      label: corto(s.key),
      value: s.ganancia,
      sel: s.key === key,
      tip: { title: monthTitle(s.key), value: money(s.ganancia), sub: `Cobrado ${money(s.cobrado)} · Prestado ${money(s.prestado)}` },
    })),
    { fmt: moneyShort, w: 520 }
  );
  const rentaChart = Charts.line(
    serie.map((s) => ({
      key: s.key,
      label: corto(s.key),
      value: s.rentabilidad,
      sel: s.key === key,
      tip: {
        title: monthTitle(s.key),
        value: s.rentabilidad == null ? "Sin capital en la calle" : pct(s.rentabilidad),
        sub: `Ganancia ${money(s.ganancia)} sobre ${money((s.capitalInicio + s.capitalFin) / 2)} en la calle`,
      },
    })),
    { fmt: (v) => pct(v), fmtTick: (v) => pct(v, 0), w: 400 }
  );

  const porCliente = {};
  for (const r of activos) porCliente[r.p.cliente_id] = (porCliente[r.p.cliente_id] || 0) + r.capitalPendiente;
  const top = Object.entries(porCliente).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topMax = top.length ? top[0][1] : 1;

  return {
    html: `<div class="page">
      <div class="page-head">
        <div><h1>Tablero</h1><p>Cómo viene el negocio mes a mes.</p></div>
        <div class="row">
          <div class="month-nav">
            <button class="icon-btn" data-act="mes" data-d="-1" aria-label="Mes anterior">‹</button>
            <span>${monthTitle(key)}</span>
            <button class="icon-btn" data-act="mes" data-d="1" aria-label="Mes siguiente" ${esActual ? "disabled" : ""}>›</button>
          </div>
          <a class="btn ghost" href="#/prestamos/nuevo">+ Préstamo</a>
          <a class="btn" href="#/cobros/nuevo">+ Cobro</a>
        </div>
      </div>
      ${demoBanner()}
      ${esActual ? saludResumen() : ""}

      <div class="hero">
        <div class="card">
          <div class="label muted small" style="font-weight:700">Ganancia de ${monthName(key, { month: "long" })}</div>
          <div class="hero-num">${money(m.ganancia)}</div>
          <div>${delta(m.ganancia, prev.ganancia)}</div>
          <p class="muted small" style="margin:12px 0 0">Interés cobrado en el mes. En total entraron ${money(m.cobrado)} entre capital e interés.</p>
        </div>
        <div class="card">
          <div class="card-head"><div><h2>Ganancia por mes</h2><p>Interés cobrado en cada mes</p></div></div>
          ${gananciaChart}
        </div>
      </div>

      <div class="kpis">
        ${kpi("Capital en la calle", money(enCalle), esActual ? `${activos.length} préstamos activos` : "al cierre del mes")}
        ${kpi("Rentabilidad del mes", pct(m.rentabilidad), deltaPts(m.rentabilidad, prev.rentabilidad) || "ganancia ÷ capital en la calle")}
        ${kpi("Cobrado en el mes", money(m.cobrado), `capital ${money(m.cobrado - m.ganancia)}`)}
        ${kpi("Prestado en el mes", money(m.prestado), `${m.nuevos} préstamo${m.nuevos === 1 ? "" : "s"} nuevo${m.nuevos === 1 ? "" : "s"}`)}
        ${kpi("Ganancia por cobrar", money(sum(activos, "interesPendiente")), "interés pendiente de la cartera activa")}
        ${kpi("En mora", money(sum(enMora, "montoVencido")), `${enMora.length} préstamo${enMora.length === 1 ? "" : "s"}${perdida ? ` · incobrable ${moneyShort(perdida)}` : ""}`)}
      </div>

      <div class="grid g2">
        <div class="card">
          <div class="card-head"><div><h2>Rentabilidad mensual</h2><p>Ganancia del mes ÷ capital promedio en la calle</p></div></div>
          ${rentaChart}
        </div>
        <div class="card" id="dash-cobrar">
          <div class="card-head">
            <div><h2>A cobrar en ${monthName(key, { month: "long" })}</h2><p>Vencimientos pendientes del mes</p></div>
            <strong class="num">${money(sum(porCobrar, "monto"))}</strong>
          </div>
          <div class="list">${
            porCobrar.length
              ? porCobrar
                  .slice(0, 6)
                  .map(
                    (v) => `<a class="list-item" href="#/prestamos/${v.p.id}">
                      <div><div class="cell-title">${esc(cliente(v.p.cliente_id).nombre)}</div><div class="cell-sub">${codigo(v.p) ? codigo(v.p) + " · " : ""}${fmtDate(v.vence)} · ${esc(v.detalle)}</div></div>
                      <strong class="num">${money(v.monto)}</strong></a>`
                  )
                  .join("") + (porCobrar.length > 6 ? `<a class="list-item muted small" href="#/prestamos">Ver los ${porCobrar.length} vencimientos →</a>` : "")
              : `<div class="empty">No quedan vencimientos pendientes este mes.</div>`
          }</div>
        </div>
      </div>

      <div class="grid g2">
        <div class="card" id="dash-mora">
          <div class="card-head"><div><h2>En mora</h2><p>Préstamos con vencimientos sin pagar</p></div></div>
          <div class="list">${
            enMora.length
              ? enMora
                  .map(
                    (r) => `<a class="list-item" href="#/prestamos/${r.p.id}">
                      <div><div class="cell-title">${esc(cliente(r.p.cliente_id).nombre)}</div><div class="cell-sub">${pill("mora", `${r.diasAtraso} días`)} ${esc(prestamoLabel(r.p))}</div></div>
                      <strong class="num">${money(r.montoVencido)}</strong></a>`
                  )
                  .join("")
              : `<div class="empty">✓ Nadie está atrasado.</div>`
          }</div>
        </div>
        <div class="card">
          <div class="card-head"><div><h2>Dónde está la plata</h2><p>Capital en la calle por cliente</p></div></div>
          <div class="list">${
            top.length
              ? top
                  .map(
                    ([id, v]) => `<a class="list-item" href="#/clientes/${id}">
                      <div style="flex:1;min-width:0"><div class="cell-title">${esc(cliente(id).nombre)}</div>
                        <div style="height:6px;border-radius:3px;background:var(--surface-2);margin-top:6px"><div style="height:6px;border-radius:3px;background:var(--series-1);width:${Math.max(3, (v / topMax) * 100)}%"></div></div></div>
                      <strong class="num">${money(v)}</strong></a>`
                  )
                  .join("")
              : `<div class="empty">No hay capital en la calle.</div>`
          }</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h2>Resumen por mes</h2><p>Los mismos números de los gráficos, en tabla</p></div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Mes</th><th class="r">Prestado</th><th class="r">Cobrado</th><th class="r">Ganancia</th><th class="r">Capital en la calle (cierre)</th><th class="r">Rentabilidad</th></tr></thead>
          <tbody>${serie
            .slice()
            .reverse()
            .map(
              (s) => `<tr><td>${monthTitle(s.key)}</td><td class="r">${money(s.prestado)}</td><td class="r">${money(s.cobrado)}</td>
                <td class="r"><strong>${money(s.ganancia)}</strong></td><td class="r">${money(s.capitalFin)}</td><td class="r">${pct(s.rentabilidad)}</td></tr>`
            )
            .join("")}</tbody>
        </table></div>
      </div>
    </div>`,
  };
}

const kpi = (label, value, sub) =>
  `<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;

const demoBanner = () =>
  REMOTE
    ? ""
    : `<div class="banner"><span><strong>Esto es una demo:</strong> los clientes son inventados y lo que cargues queda solo en tu navegador. Tocá, cargá y borrá sin miedo. <a href="../#contacto" target="_top">¿Querés una así para tu negocio?</a></span>
       ${db.data.prestamos.length ? "" : `<button class="btn sm" data-act="sample">Cargar datos de ejemplo</button>`}</div>`;

/* ───────────────────────── Clientes ───────────────────────── */

function viewClientes() {
  const A = analizarTodos();
  const q = state.busqueda.toLowerCase();
  const rank = { mora: 0, "por-vencer": 1, "al-dia": 2 };
  const filas = db.data.clientes
    .filter((c) => !q || [c.nombre, c.dni, c.telefono].some((v) => String(v || "").toLowerCase().includes(q)))
    .map((c) => {
      const rs = A.filter((r) => r.p.cliente_id === c.id);
      const act = rs.filter((r) => r.activo);
      const peor = act.map((r) => r.situacion).sort((a, b) => rank[a] - rank[b])[0];
      return { c, rs, act, peor, enCalle: sum(act, "capitalPendiente"), ganancia: sum(rs, "intPag"), punt: puntualidad(rs) };
    })
    .sort((a, b) => b.enCalle - a.enCalle || a.c.nombre.localeCompare(b.c.nombre));

  return {
    html: `<div class="page">
      <div class="page-head">
        <div><h1>Clientes</h1><p>${db.data.clientes.length} clientes cargados</p></div>
        <div class="row">
          <input class="search" id="buscar" placeholder="Buscar por nombre, DNI o teléfono" value="${esc(state.busqueda)}" />
          <a class="btn" href="#/clientes/nuevo">+ Cliente</a>
        </div>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Cliente</th><th>Teléfono</th><th class="r">Activos</th><th class="r">En la calle</th><th class="r">Ganancia generada</th><th class="r">Puntualidad</th><th>Situación</th></tr></thead>
        <tbody>${
          filas.length
            ? filas
                .map(
                  (f) => `<tr class="click" data-href="#/clientes/${f.c.id}">
                    <td><div class="cell-title">${esc(f.c.nombre)}</div><div class="cell-sub">${esc(f.c.ocupacion || "")}</div></td>
                    <td>${esc(f.c.telefono || "—")}</td>
                    <td class="r">${f.act.length}</td>
                    <td class="r">${money(f.enCalle)}</td>
                    <td class="r">${money(f.ganancia)}</td>
                    <td class="r">${pct(f.punt, 0)}</td>
                    <td>${f.peor ? pill(f.peor) : `<span class="muted small">Sin préstamos activos</span>`}</td></tr>`
                )
                .join("")
            : `<tr><td colspan="7" class="empty">${q ? "No hay clientes que coincidan." : "Todavía no cargaste clientes."}</td></tr>`
        }</tbody>
      </table></div></div>
    </div>`,
    mount() {
      const el = document.getElementById("buscar");
      el.oninput = () => {
        state.busqueda = el.value;
        const pos = el.selectionStart;
        render();
        const again = document.getElementById("buscar");
        again.focus();
        again.setSelectionRange(pos, pos);
      };
    },
  };
}

function viewClienteForm(id) {
  const c = id ? db.data.clientes.find((x) => x.id === id) : {};
  if (id && !c) return notFound();
  const f = (name, label, opts = {}) => `<div class="field${opts.full ? " full" : ""}">
      <label for="f-${name}">${label}</label>
      ${
        opts.area
          ? `<textarea id="f-${name}" name="${name}">${esc(c[name])}</textarea>`
          : `<input id="f-${name}" name="${name}" type="${opts.type || "text"}" value="${esc(c[name] ?? "")}" ${opts.req ? "required" : ""} ${opts.attrs || ""}/>`
      }
      ${opts.hint ? `<span class="hint">${opts.hint}</span>` : ""}</div>`;
  return {
    html: `<div class="page" style="max-width:760px">
      <div class="page-head"><div><h1>${id ? "Editar cliente" : "Nuevo cliente"}</h1><p>Datos del solicitante</p></div></div>
      <form class="card" id="form">
        <div class="fields">
          ${f("nombre", "Nombre y apellido *", { req: true, full: true })}
          ${f("dni", "DNI")}
          ${f("telefono", "Teléfono / WhatsApp", { type: "tel" })}
          ${f("direccion", "Dirección", { full: true })}
          ${f("ocupacion", "Trabajo u ocupación")}
          ${f("ingreso_mensual", "Ingreso mensual aproximado", { type: "number", attrs: 'min="0" step="1000"' })}
          ${f("referencia", "Referencia o garante", { hint: "Nombre y teléfono de alguien que lo conozca" })}
          ${f("recomendado_por", "¿Cómo llegó?", { hint: "Quién lo recomendó" })}
          ${f("notas", "Notas", { area: true, full: true })}
        </div>
        <div class="form-actions">
          <a class="btn ghost" href="${id ? "#/clientes/" + id : "#/clientes"}">Volver</a>
          <button class="btn" type="submit">${id ? "Guardar cambios" : "Guardar cliente"}</button>
        </div>
      </form></div>`,
    mount() {
      document.getElementById("form").onsubmit = (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(e.target));
        fd.ingreso_mensual = fd.ingreso_mensual === "" ? null : Number(fd.ingreso_mensual);
        fd.nombre = fd.nombre.trim();
        guard(async () => {
          const saved = id ? await db.update("clientes", id, fd) : await db.insert("clientes", fd);
          toast(id ? "Cliente actualizado" : "Cliente guardado");
          if (!id) miliReact("cliente", saved);
          go("#/clientes/" + saved.id);
        });
      };
    },
  };
}

function viewCliente(id) {
  const c = db.data.clientes.find((x) => x.id === id);
  if (!c) return notFound();
  const rs = analizarTodos()
    .filter((r) => r.p.cliente_id === id)
    .sort((a, b) => b.p.fecha_entrega.localeCompare(a.p.fecha_entrega));
  const act = rs.filter((r) => r.activo);
  const dato = (k, label, fmt = esc) => (c[k] || c[k] === 0 ? `<dt>${label}</dt><dd>${fmt(c[k])}</dd>` : "");
  return {
    html: `<div class="page">
      <div class="page-head">
        <div><h1>${esc(c.nombre)}</h1><p>${esc(c.ocupacion || "Cliente")}${c.created_at ? " · desde " + fmtDate(c.created_at.slice(0, 10)) : ""}</p></div>
        <div class="row">
          <a class="btn ghost" href="#/clientes/${id}/editar">Editar</a>
          ${rs.length ? "" : `<button class="btn danger" data-act="borrarCliente" data-id="${id}">Eliminar</button>`}
          <a class="btn" href="#/prestamos/nuevo?cliente=${id}">+ Préstamo</a>
        </div>
      </div>
      <div class="kpis">
        ${kpi("Capital en la calle", money(sum(act, "capitalPendiente")), `${act.length} préstamo${act.length === 1 ? "" : "s"} activo${act.length === 1 ? "" : "s"}`)}
        ${kpi("Ganancia generada", money(sum(rs, "intPag")), "interés cobrado histórico")}
        ${kpi("Préstamos", String(rs.length), `${rs.filter((r) => r.situacion === "cancelado").length} cancelados`)}
        ${kpi("Puntualidad", pct(puntualidad(rs), 0), "vencimientos pagados a tiempo")}
      </div>
      ${miliCliente(rs)}
      <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,2fr)">
        <div class="card">
          <div class="card-head"><h2>Datos</h2></div>
          <dl class="dl">
            ${dato("dni", "DNI")}${dato("telefono", "Teléfono")}${dato("direccion", "Dirección")}
            ${dato("ingreso_mensual", "Ingreso aprox.", money)}${dato("referencia", "Referencia")}${dato("recomendado_por", "Cómo llegó")}
            ${dato("notas", "Notas")}
          </dl>
        </div>
        <div class="card">
          <div class="card-head"><h2>Préstamos</h2></div>
          ${tablaPrestamos(rs, false)}
        </div>
      </div>
    </div>`,
  };
}

/* ───────────────────────── Préstamos ───────────────────────── */

function tablaPrestamos(rs, conCliente = true) {
  if (!rs.length) return `<div class="empty">No hay préstamos para mostrar.</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Código</th>${conCliente ? "<th>Cliente</th>" : ""}<th>Préstamo</th><th>Entregado</th><th>Próximo venc.</th><th class="r">Cobrado</th><th class="r">Saldo</th><th>Situación</th></tr></thead>
    <tbody>${rs
      .map(
        (r) => `<tr class="click" data-href="#/prestamos/${r.p.id}">
          <td>${codeTag(r.p) || "—"}</td>
          ${conCliente ? `<td class="cell-title">${esc(cliente(r.p.cliente_id).nombre)}</td>` : ""}
          <td><div>${esc(prestamoDesc(r.p))}</div><div class="cell-sub">${pct(r.p.tasa, 0)}${r.renovaciones ? ` · renovado ${r.renovaciones}×` : ""}</div></td>
          <td>${fmtDate(r.p.fecha_entrega)}</td>
          <td>${r.activo && r.proxVence ? `${fmtDate(r.proxVence)} <span class="cell-sub">${money(r.proxMonto)}</span>` : "—"}</td>
          <td class="r">${money(r.pagado)}</td>
          <td class="r"><strong>${r.activo ? money(r.saldo) : "—"}</strong></td>
          <td>${pill(r.situacion, r.situacion === "mora" ? `${r.diasAtraso} d` : "")}</td></tr>`
      )
      .join("")}</tbody></table></div>`;
}

function viewPrestamos() {
  const A = analizarTodos().sort(
    (a, b) => (a.proxVence || "9999").localeCompare(b.proxVence || "9999") || b.p.fecha_entrega.localeCompare(a.p.fecha_entrega)
  );
  const filtros = {
    activos: ["Activos", (r) => r.activo],
    mora: ["En mora", (r) => r.situacion === "mora"],
    cancelado: ["Cancelados", (r) => r.situacion === "cancelado"],
    incobrable: ["Incobrables", (r) => r.situacion === "incobrable"],
    todos: ["Todos", () => true],
  };
  // Buscador: por código (P-008, 008 u 8) o por nombre del cliente
  const q = state.buscarP.trim().toLowerCase();
  const num = q.replace(/^p-?/, "").replace(/^0+/, "");
  const coincide = (r) =>
    !q || codigo(r.p).toLowerCase().includes(q) || (/^\d+$/.test(num) && String(r.p.numero) === num) ||
    cliente(r.p.cliente_id).nombre.toLowerCase().includes(q);
  const lista = A.filter((r) => (q ? true : filtros[state.filtro][1](r)) && coincide(r));
  return {
    html: `<div class="page">
      <div class="page-head">
        <div><h1>Préstamos</h1><p>${A.filter((r) => r.activo).length} activos · ${money(sum(A.filter((r) => r.activo), "saldo"))} por cobrar</p></div>
        <div class="row">
          <input class="search" id="buscar-p" placeholder="Buscar por código (P-008) o cliente" value="${esc(state.buscarP)}" />
          <a class="btn" href="#/prestamos/nuevo">+ Préstamo</a>
        </div>
      </div>
      ${q ? `<p class="small muted" style="margin:0">Buscando en todos los préstamos: ${lista.length} resultado${lista.length === 1 ? "" : "s"}.</p>` : ""}
      <div class="seg">${Object.entries(filtros)
        .map(([k, [t, fn]]) => `<button class="${state.filtro === k ? "on" : ""}" data-act="filtro" data-f="${k}">${t} <span class="muted">${A.filter(fn).length}</span></button>`)
        .join("")}</div>
      <div class="card">${tablaPrestamos(lista)}</div>
    </div>`,
    mount() {
      const el = document.getElementById("buscar-p");
      el.oninput = () => {
        state.buscarP = el.value;
        const pos = el.selectionStart;
        render();
        const again = document.getElementById("buscar-p");
        again.focus();
        again.setSelectionRange(pos, pos);
      };
    },
  };
}

function viewPrestamoForm(q) {
  if (!db.data.clientes.length)
    return {
      html: `<div class="page" style="max-width:760px"><div class="card empty">
        <p>Primero cargá al cliente que va a recibir el préstamo.</p>
        <a class="btn" href="#/clientes/nuevo">+ Cliente</a></div></div>`,
    };
  const f = {
    cliente_id: q.get("cliente") || "",
    modalidad: "mensual",
    capital: "",
    tasa: 30,
    cuotas: 4,
    monto_cuota: "",
    fecha_entrega: today(),
    primer_vencimiento: addMonths(today(), 1),
    notas: "",
  };
  const manual = { cuota: false, venc: false };
  const clientes = db.data.clientes.slice().sort((a, b) => a.nombre.localeCompare(b.nombre));

  return {
    html: `<div class="page" style="max-width:760px">
      <div class="page-head"><div><h1>Nuevo préstamo</h1><p>Cargá la entrega de dinero</p></div></div>
      <form class="card" id="form">
        <div class="fields">
          <div class="field full"><label for="f-cliente">Cliente *</label>
            <select id="f-cliente" name="cliente_id" required>
              <option value="">Elegí un cliente…</option>
              ${clientes.map((c) => `<option value="${c.id}" ${c.id === f.cliente_id ? "selected" : ""}>${esc(c.nombre)}</option>`).join("")}
            </select>
            <span class="hint">¿Es nuevo? <a href="#/clientes/nuevo">Cargalo primero</a></span></div>
          <div class="field full"><label>Modalidad</label>
            <div class="seg" id="modalidad">
              <button type="button" data-m="mensual" class="on">Mensual · un pago al mes</button>
              <button type="button" data-m="semanal">Semanal · cuotas fijas</button>
            </div></div>
          <div class="field"><label for="f-capital">Capital prestado *</label>
            <input id="f-capital" name="capital" type="number" min="1" step="1000" required placeholder="500000" /></div>
          <div class="field"><label for="f-tasa">Interés total (%)</label>
            <input id="f-tasa" name="tasa" type="number" min="0" step="0.5" value="30" />
            <span class="hint" id="tasa-hint">Se cobra al mes junto con el capital</span></div>
          <div class="field semanal-only" hidden><label for="f-cuotas">Cantidad de cuotas semanales</label>
            <input id="f-cuotas" name="cuotas" type="number" min="1" step="1" value="4" />
            <span class="hint">Por ejemplo, 4 cuotas para $ 500.000 o 6 para $ 800.000</span></div>
          <div class="field semanal-only" hidden><label for="f-cuota">Valor de cada cuota</label>
            <input id="f-cuota" name="monto_cuota" type="number" min="1" step="1" />
            <span class="hint">Se calcula solo, pero lo podés cambiar</span></div>
          <div class="field"><label for="f-entrega">Fecha de entrega</label>
            <input id="f-entrega" name="fecha_entrega" type="date" value="${f.fecha_entrega}" required /></div>
          <div class="field"><label for="f-venc" id="venc-label">Vencimiento</label>
            <input id="f-venc" name="primer_vencimiento" type="date" value="${f.primer_vencimiento}" required /></div>
          <div class="field full"><label for="f-notas">Notas</label><textarea id="f-notas" name="notas"></textarea></div>
        </div>
        <div class="preview" id="preview"></div>
        <div class="form-actions">
          <a class="btn ghost" href="#/prestamos">Volver</a>
          <button class="btn" type="submit">Guardar préstamo</button>
        </div>
      </form></div>`,
    mount() {
      const form = document.getElementById("form");
      const $ = (id) => document.getElementById(id);
      const update = () => {
        const cap = Number($("f-capital").value) || 0;
        const tasa = (Number($("f-tasa").value) || 0) / 100;
        const sem = f.modalidad === "semanal";
        const n = sem ? Math.max(1, Number($("f-cuotas").value) || 1) : 1;
        if (!manual.cuota) $("f-cuota").value = cap ? Math.round((cap * (1 + tasa)) / n) : "";
        if (!manual.venc) $("f-venc").value = sem ? addDays($("f-entrega").value || today(), 7) : addMonths($("f-entrega").value || today(), 1);
        const cuota = sem ? Number($("f-cuota").value) || 0 : Math.round(cap * (1 + tasa));
        const total = sem ? cuota * n : cuota;
        const ultimo = sem ? addDays($("f-venc").value, 7 * (n - 1)) : $("f-venc").value;
        $("preview").innerHTML = `
          <div><div class="label">Total a cobrar</div><div class="value">${money(total)}</div></div>
          <div><div class="label">Ganancia</div><div class="value">${money(total - cap)}</div></div>
          <div><div class="label">${sem ? `${n} cuotas de` : "Si renueva, paga por mes"}</div><div class="value">${money(sem ? cuota : Math.round(cap * tasa))}</div></div>
          <div><div class="label">${sem ? "Última cuota" : "Vence"}</div><div class="value">${ultimo ? fmtDate(ultimo) : "—"}</div></div>`;
      };
      $("modalidad").onclick = (e) => {
        const b = e.target.closest("button[data-m]");
        if (!b) return;
        f.modalidad = b.dataset.m;
        [...$("modalidad").children].forEach((x) => x.classList.toggle("on", x === b));
        const sem = f.modalidad === "semanal";
        document.querySelectorAll(".semanal-only").forEach((x) => (x.hidden = !sem));
        $("f-tasa").value = MODALIDADES[f.modalidad].tasa * 100;
        $("tasa-hint").textContent = sem ? "Se reparte en partes iguales entre las cuotas" : "Se cobra al mes junto con el capital";
        $("venc-label").textContent = sem ? "Primera cuota" : "Vencimiento";
        manual.cuota = manual.venc = false;
        update();
      };
      $("f-cuota").oninput = () => {
        manual.cuota = true;
        update();
      };
      $("f-venc").oninput = () => (manual.venc = true);
      form.oninput = (e) => {
        if (e.target.id !== "f-cuota" && e.target.id !== "f-venc") update();
      };
      update();
      form.onsubmit = (e) => {
        e.preventDefault();
        const sem = f.modalidad === "semanal";
        const cap = Number($("f-capital").value);
        const tasa = Number($("f-tasa").value) / 100;
        const row = {
          cliente_id: $("f-cliente").value,
          modalidad: f.modalidad,
          capital: cap,
          tasa,
          cuotas: sem ? Number($("f-cuotas").value) : 1,
          monto_cuota: sem ? Number($("f-cuota").value) : Math.round(cap * (1 + tasa)),
          fecha_entrega: $("f-entrega").value,
          primer_vencimiento: $("f-venc").value,
          estado: "activo",
          notas: $("f-notas").value,
        };
        guard(async () => {
          const saved = await db.insert("prestamos", row);
          toast("Préstamo guardado");
          miliReact("prestamo", { ganancia: saved.cuotas * saved.monto_cuota - saved.capital });
          go("#/prestamos/" + saved.id);
        });
      };
    },
  };
}

function viewPrestamo(id) {
  const p = db.data.prestamos.find((x) => x.id === id);
  if (!p) return notFound();
  const r = analizar(p, db.data.pagos);
  const c = cliente(p.cliente_id);
  const hoy = today();
  const mensual = p.modalidad === "mensual";
  const futuros = db.data.pagos.filter((x) => x.prestamo_id === id && x.fecha > hoy);
  const pagos = r.pagos.concat(futuros).slice().reverse();

  const estadoCuota = (q) => {
    if (q.pagadaEl) {
      const tarde = q.pagadaEl > q.vence ? daysBetween(q.vence, q.pagadaEl) : 0;
      return `${tarde ? `<span class="pill por-vencer"><i aria-hidden="true">▲</i>Pagada ${tarde} d tarde</span>` : `<span class="pill al-dia"><i aria-hidden="true">✓</i>Pagada</span>`} <span class="cell-sub">${fmtDate(q.pagadaEl)}${q.tipo && q.tipo !== "pendiente" ? " · " + TIPOS_PAGO[q.tipo] : ""}</span>`;
    }
    if (!r.activo) return `<span class="muted small">—</span>`;
    if (q.vence < hoy) return pill("mora", `${daysBetween(q.vence, hoy)} días`);
    return `<span class="muted small">Pendiente</span>`;
  };

  return {
    html: `<div class="page">
      <div class="page-head">
        <div>
          <h1>${codeTag(p)} Préstamo a <a href="#/clientes/${c.id}">${esc(c.nombre)}</a></h1>
          <p>${esc(prestamoDesc(p))} · ${pct(p.tasa, 0)} de interés · entregado el ${fmtDate(p.fecha_entrega)}</p>
        </div>
        <div class="row">${pill(r.situacion, r.situacion === "mora" ? `${r.diasAtraso} días` : "")}</div>
      </div>
      ${miliPrestamo(r)}
      ${
        r.activo
          ? `<div class="row">
          <a class="btn" href="#/cobros/nuevo?prestamo=${id}">Registrar cobro</a>
          ${
            mensual
              ? `<button class="btn ghost" data-act="renovar" data-id="${id}">Renovar · cobrar ${money(r.interesPeriodo)} de interés</button>
                 <button class="btn ghost" data-act="cancelar" data-id="${id}">Cancelar · cobrar ${money(r.proxMonto)}</button>`
              : `<button class="btn ghost" data-act="cuota" data-id="${id}">Cobrar cuota ${r.cuotasPagas + 1} · ${money(r.proxMonto)}</button>`
          }
          <button class="btn danger" data-act="incobrable" data-id="${id}">Marcar incobrable</button>
        </div>`
          : p.estado === "incobrable"
          ? `<div class="row"><button class="btn ghost" data-act="reactivar" data-id="${id}">Volver a activo</button></div>`
          : ""
      }
      <div class="kpis">
        ${kpi("Capital", money(p.capital), r.capitalPendiente ? `${money(r.capitalPendiente)} sin devolver` : "devuelto completo")}
        ${kpi("Cobrado", money(r.pagado), `${r.pagos.length} pago${r.pagos.length === 1 ? "" : "s"}`)}
        ${kpi("Ganancia cobrada", money(r.intPag), r.interesPendiente ? `${money(r.interesPendiente)} por cobrar` : "")}
        ${kpi("Saldo", r.activo ? money(r.saldo) : "—", r.activo && r.proxVence ? `próximo vencimiento ${fmtDate(r.proxVence)}` : "")}
      </div>
      <div class="grid g2">
        <div class="card">
          <div class="card-head"><div><h2>${mensual ? "Períodos" : "Cuotas"}</h2><p>${
            mensual ? "Cada mes paga el interés para renovar, o capital + interés para cancelar" : `${p.cuotas} cuotas semanales de ${money(p.monto_cuota)}`
          }</p></div></div>
          <div class="table-wrap"><table>
            <thead><tr><th>#</th><th>Vence</th><th class="r">Monto</th><th>Estado</th></tr></thead>
            <tbody>${r.cronograma
              .map((q) => `<tr><td>${q.n}</td><td>${fmtDate(q.vence)}</td><td class="r">${money(q.monto)}</td><td>${estadoCuota(q)}</td></tr>`)
              .join("") || `<tr><td colspan="4" class="empty">Sin períodos.</td></tr>`}</tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Cobros registrados</h2></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th class="r">Monto</th><th class="r">Interés</th><th></th></tr></thead>
            <tbody>${
              pagos.length
                ? pagos
                    .map(
                      (x) => `<tr><td>${fmtDate(x.fecha)}</td><td>${TIPOS_PAGO[x.tipo] || x.tipo}</td><td class="r">${money(x.monto)}</td>
                        <td class="r">${money(x.interes)}</td><td class="r"><button class="icon-btn small" data-act="borrarPago" data-id="${x.id}" aria-label="Borrar cobro">✕</button></td></tr>`
                    )
                    .join("")
                : `<tr><td colspan="5" class="empty">Todavía no hay cobros.</td></tr>`
            }</tbody>
          </table></div>
        </div>
      </div>
      ${p.notas ? `<div class="card"><h3>Notas</h3><p style="margin:6px 0 0">${esc(p.notas)}</p></div>` : ""}
      <div class="row"><button class="btn danger sm" data-act="borrarPrestamo" data-id="${id}">Eliminar préstamo y sus cobros</button></div>
    </div>`,
  };
}

/* ───────────────────────── Cobros ───────────────────────── */

function viewCobros() {
  const key = state.mesCobros;
  const lista = db.data.pagos
    .filter((x) => monthOf(x.fecha) === key)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  const prest = (id) => db.data.prestamos.find((p) => p.id === id);
  return {
    html: `<div class="page">
      <div class="page-head">
        <div><h1>Cobros</h1><p>Toda la plata que entró</p></div>
        <div class="row">
          <div class="month-nav">
            <button class="icon-btn" data-act="mesCobros" data-d="-1" aria-label="Mes anterior">‹</button>
            <span>${monthTitle(key)}</span>
            <button class="icon-btn" data-act="mesCobros" data-d="1" aria-label="Mes siguiente">›</button>
          </div>
          <a class="btn" href="#/cobros/nuevo">+ Cobro</a>
        </div>
      </div>
      <div class="kpis">
        ${kpi("Cobrado", money(sum(lista, "monto")), `${lista.length} cobro${lista.length === 1 ? "" : "s"}`)}
        ${kpi("Ganancia (interés)", money(sum(lista, "interes")), "")}
        ${kpi("Capital recuperado", money(sum(lista, "capital")), "")}
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Cliente</th><th>Préstamo</th><th>Tipo</th><th class="r">Monto</th><th class="r">Interés</th><th class="r">Capital</th></tr></thead>
        <tbody>${
          lista.length
            ? lista
                .map((x) => {
                  const p = prest(x.prestamo_id);
                  return `<tr class="click" data-href="#/prestamos/${x.prestamo_id}"><td>${fmtDate(x.fecha)}</td>
                    <td class="cell-title">${esc(p ? cliente(p.cliente_id).nombre : "—")}</td><td>${p ? esc(prestamoLabel(p)) : "—"}</td>
                    <td>${TIPOS_PAGO[x.tipo] || x.tipo}</td><td class="r"><strong>${money(x.monto)}</strong></td><td class="r">${money(x.interes)}</td><td class="r">${money(x.capital)}</td></tr>`;
                })
                .join("")
            : `<tr><td colspan="7" class="empty">No hay cobros en ${monthName(key)}.</td></tr>`
        }</tbody>
      </table></div></div>
    </div>`,
  };
}

function viewCobroForm(q) {
  const A = analizarTodos().filter((r) => r.activo);
  if (!A.length)
    return { html: `<div class="page" style="max-width:760px"><div class="card empty"><p>No hay préstamos activos para cobrar.</p><a class="btn" href="#/prestamos/nuevo">+ Préstamo</a></div></div>` };
  A.sort((a, b) => cliente(a.p.cliente_id).nombre.localeCompare(cliente(b.p.cliente_id).nombre));
  let sel = A.find((r) => r.p.id === q.get("prestamo")) || null;
  let tipo = null;
  let manual = false;

  return {
    html: `<div class="page" style="max-width:760px">
      <div class="page-head"><div><h1>Registrar cobro</h1><p>Entrada de dinero de un préstamo</p></div></div>
      <form class="card" id="form">
        <div class="fields">
          <div class="field full"><label for="f-prestamo">Préstamo *</label>
            <select id="f-prestamo" required>
              <option value="">Elegí el préstamo…</option>
              ${A.map(
                (r) =>
                  `<option value="${r.p.id}" ${sel && sel.p.id === r.p.id ? "selected" : ""}>${esc(cliente(r.p.cliente_id).nombre)} — ${esc(prestamoLabel(r.p))} · vence ${fmtDate(r.proxVence)}</option>`
              ).join("")}
            </select></div>
          <div class="field full" id="tipo-wrap"></div>
          <div class="field"><label for="f-monto">Monto cobrado *</label><input id="f-monto" type="number" min="1" step="1" required /></div>
          <div class="field"><label for="f-fecha">Fecha</label><input id="f-fecha" type="date" value="${today()}" required /></div>
          <details class="field full"><summary>Ajustar cuánto es interés y cuánto capital</summary>
            <div class="fields" style="margin-top:10px">
              <div class="field"><label for="f-int">Interés (ganancia)</label><input id="f-int" type="number" min="0" step="1" /></div>
              <div class="field"><label for="f-cap">Capital</label><input id="f-cap" type="number" min="0" step="1" readonly /></div>
            </div></details>
          <div class="field full"><label for="f-notas">Notas</label><input id="f-notas" placeholder="Efectivo, transferencia…" /></div>
        </div>
        <div class="preview" id="preview"></div>
        <div class="form-actions">
          <a class="btn ghost" href="${sel ? "#/prestamos/" + sel.p.id : "#/cobros"}">Volver</a>
          <button class="btn" type="submit">Guardar cobro</button>
        </div>
      </form></div>`,
    mount() {
      const $ = (id) => document.getElementById(id);
      const tiposDe = (r) =>
        r.p.modalidad === "mensual"
          ? [
              ["renovacion", `Renueva · solo interés (${moneyShort(r.interesPeriodo)})`],
              ["cancelacion", `Cancela todo (${moneyShort(r.proxMonto)})`],
              ["otro", "Pago parcial"],
            ]
          : [
              ["cuota", `1 cuota (${moneyShort(r.proxMonto)})`],
              ["cuotas2", "2 cuotas"],
              ["saldo", `Saldo total (${moneyShort(r.saldo)})`],
              ["otro", "Otro monto"],
            ];
      const montoDe = (r, t) => {
        if (r.p.modalidad === "mensual") return t === "otro" ? "" : sugerirPago(r, t, 0).monto;
        if (t === "cuota") return r.proxMonto;
        if (t === "cuotas2") return Math.min(r.saldo, r.proxMonto + r.p.monto_cuota);
        if (t === "saldo") return r.saldo;
        return "";
      };
      const split = () => {
        if (!sel) return;
        const monto = Number($("f-monto").value) || 0;
        if (!manual) {
          const t = sel.p.modalidad === "mensual" && tipo !== "otro" && monto !== montoDe(sel, tipo) ? "otro" : tipo;
          $("f-int").value = sugerirPago(sel, t, monto).interes;
        }
        $("f-cap").value = Math.max(0, monto - (Number($("f-int").value) || 0));
        const despues = Math.max(0, sel.saldo - monto);
        $("preview").innerHTML = `
          <div><div class="label">Ganancia de este cobro</div><div class="value">${money(Number($("f-int").value) || 0)}</div></div>
          <div><div class="label">Capital que vuelve</div><div class="value">${money(Number($("f-cap").value) || 0)}</div></div>
          <div><div class="label">${tipo === "renovacion" ? "Sigue prestado" : "Saldo después"}</div><div class="value">${money(
            tipo === "renovacion" ? sel.capitalPendiente : despues
          )}</div></div>
          ${tipo === "renovacion" ? `<div><div class="label">Nuevo vencimiento</div><div class="value">${fmtDate(addMonths(sel.proxVence, 1))}</div></div>` : ""}`;
      };
      const pickTipo = (t) => {
        tipo = t;
        manual = false;
        $("tipo-wrap").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
        $("f-monto").value = montoDe(sel, t);
        split();
      };
      const pickPrestamo = () => {
        sel = A.find((r) => r.p.id === $("f-prestamo").value) || null;
        if (!sel) {
          $("tipo-wrap").innerHTML = "";
          $("preview").innerHTML = "";
          return;
        }
        $("tipo-wrap").innerHTML = `<label>¿Qué paga?</label><div class="seg">${tiposDe(sel)
          .map(([k, t]) => `<button type="button" data-t="${k}">${esc(t)}</button>`)
          .join("")}</div>`;
        $("tipo-wrap").querySelector(".seg").onclick = (e) => {
          const b = e.target.closest("button[data-t]");
          if (b) pickTipo(b.dataset.t);
        };
        pickTipo(tiposDe(sel)[0][0]);
      };
      $("f-prestamo").onchange = pickPrestamo;
      $("f-monto").oninput = split;
      $("f-int").oninput = () => {
        manual = true;
        split();
      };
      if (sel) pickPrestamo();

      $("form").onsubmit = (e) => {
        e.preventDefault();
        if (!sel) return;
        const monto = Number($("f-monto").value);
        const interes = Math.min(monto, Number($("f-int").value) || 0);
        let t = tipo === "cuotas2" || tipo === "saldo" ? "cuota" : tipo;
        if (sel.p.modalidad === "semanal") t = "cuota";
        else if (t !== "otro" && monto !== montoDe(sel, t)) t = "otro";
        const row = { prestamo_id: sel.p.id, fecha: $("f-fecha").value, monto, interes, capital: monto - interes, tipo: t, notas: $("f-notas").value };
        guard(async () => {
          await db.insert("pagos", row);
          await sincronizarEstado(sel.p);
          toast(t === "renovacion" ? "Renovación registrada" : "Cobro registrado");
          miliReactPago(sel.p, row);
          go("#/prestamos/" + sel.p.id);
        });
      };
    },
  };
}

/* ───────────────────────── Datos ───────────────────────── */

function viewDatos() {
  const n = db.data;
  return {
    html: `<div class="page" style="max-width:860px">
      <div class="page-head"><div><h1>Datos</h1><p>Descargá todo como planilla o revisá la conexión</p></div></div>
      <div class="card">
        <div class="card-head"><div><h2>Exportar a Excel / Sheets</h2><p>Archivos CSV que se abren directo en Excel o Google Sheets</p></div></div>
        <div class="row">
          <button class="btn ghost" data-act="exportar" data-t="clientes">Clientes (${n.clientes.length})</button>
          <button class="btn ghost" data-act="exportar" data-t="prestamos">Préstamos (${n.prestamos.length})</button>
          <button class="btn ghost" data-act="exportar" data-t="pagos">Cobros (${n.pagos.length})</button>
          <button class="btn ghost" data-act="exportar" data-t="resumen">Resumen mensual</button>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Base de datos</h2><p>${REMOTE ? "Conectada a Supabase" : "Modo demo: los datos viven solo en este navegador"}</p></div></div>
        ${
          REMOTE
            ? `<p class="small muted" style="margin:0 0 12px">Las tablas <strong>clientes</strong>, <strong>prestamos</strong> y <strong>pagos</strong> se pueden ver y editar como planilla en Supabase → Table Editor. Las dos tienen acceso con su mail y contraseña.</p>
               <a class="btn ghost" href="#/clave">🔑 Cambiar mi contraseña</a>`
            : `<p class="small" style="margin:0 0 12px">En la versión real, los datos se guardan en una base privada en la nube y solo entran las personas que vos autorices, desde la compu o el celular. Acá podés volver a los datos de ejemplo o empezar de cero.</p>
               <div class="row">
                 <button class="btn ghost" data-act="sample">Cargar datos de ejemplo</button>
                 <button class="btn danger" data-act="clearDemo">Borrar todo</button>
               </div>`
        }
      </div>
    </div>`,
  };
}

function exportar(t) {
  const n = db.data;
  let rows;
  if (t === "resumen") {
    const meses = [...new Set(n.prestamos.map((p) => monthOf(p.fecha_entrega)).concat(n.pagos.map((x) => monthOf(x.fecha))))].sort();
    rows = [];
    if (meses.length)
      for (let k = meses[0]; k <= monthOf(today()); k = addMonthKey(k, 1)) {
        const m = metricasMes(n, k);
        rows.push({ mes: k, prestado: m.prestado, cobrado: m.cobrado, ganancia: m.ganancia, capital_en_la_calle: m.capitalFin, rentabilidad: m.rentabilidad == null ? "" : m.rentabilidad.toFixed(4) });
      }
  } else if (t === "prestamos") {
    rows = n.prestamos.map((p) => {
      const r = analizar(p, n.pagos);
      return { codigo: codigo(p), ...p, cliente: cliente(p.cliente_id).nombre, cobrado: r.pagado, ganancia_cobrada: r.intPag, saldo: r.activo ? r.saldo : 0, situacion: r.situacion, proximo_vencimiento: r.activo ? r.proxVence : "" };
    });
  } else if (t === "pagos") {
    rows = n.pagos.map((x) => {
      const p = n.prestamos.find((y) => y.id === x.prestamo_id);
      return { prestamo: p ? codigo(p) : "", ...x, cliente: p ? cliente(p.cliente_id).nombre : "" };
    });
  } else rows = n[t];
  if (!rows.length) return toast("No hay datos para exportar");
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [cols.join(";"), ...rows.map((r) => cols.map((c) => cell(r[c])).join(";"))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `cartera-${t}-${today()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ───────────────────────── Login y acciones ───────────────────────── */

// Mili acompaña: festeja lo que se carga (si el script de la guía está presente)
const miliReact = (kind, data) => typeof Mili !== "undefined" && Mili.react(kind, data);
function miliReactPago(p, pago) {
  const r = analizar(p, db.data.pagos, "9999-12-31");
  if (pago.tipo === "renovacion") miliReact("renovacion", { vence: r.proxVence });
  else if (r.saldo <= 0.5) miliReact("cancelado");
  else miliReact("cobro", pago);
}

// Traduce los errores de Supabase a algo que se entienda
function authError(err) {
  const m = (err && err.message) || "";
  if (/rate limit/i.test(m)) return "Ya se mandaron muchos mails en la última hora (Supabase deja 2 por hora). Esperá un rato, o entrá con tu contraseña si ya creaste una.";
  if (/signups|not allowed|Database error/i.test(m)) return "Ese mail no tiene acceso a Cartera.";
  if (/Invalid login credentials/i.test(m)) return "El mail o la contraseña no son correctos.";
  if (/expired|invalid|otp|token/i.test(m)) return "El link venció o ya se usó. Pedí uno nuevo.";
  return "No pudimos seguir: " + m;
}

// Después de un ingreso con contraseña: revisa el acceso y abre la app
async function enterApp() {
  if (!(await db.isMember())) return renderNoAccess();
  await db.load();
  document.querySelector(".side").hidden = false;
  state.lastPath = "";
  render();
}

const loginBrand = `<div class="brand" style="padding:0"><span class="brand-mark">$</span><span>Cartera<small>Gestión de préstamos</small></span></div>`;

// Se entra solo con mail y contraseña (sin links por mail)
function renderLogin(msg = "", email = "") {
  document.querySelector(".side").hidden = true;
  if (typeof Mili !== "undefined") Mili.hide();
  $app.innerHTML = `<div class="login"><form class="card" id="login">${loginBrand}
      <div class="field"><label for="l-email">Mail</label><input id="l-email" type="email" autocomplete="email" value="${esc(email)}" required /></div>
      <div class="field"><label for="l-pass">Contraseña</label><input id="l-pass" type="password" autocomplete="current-password" required /></div>
      ${msg ? `<p class="small" style="color:var(--critical-ink);margin:0">${esc(msg)}</p>` : ""}
      <button class="btn" type="submit">Entrar</button>
      <p class="small muted" style="margin:0;text-align:center">¿No tenés contraseña o te la olvidaste? Pedísela a quien administra la app.</p>
    </form></div>`;
  const form = document.getElementById("login");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const em = document.getElementById("l-email").value.trim();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Entrando…";
    try {
      await db.signInPassword(em, document.getElementById("l-pass").value);
      await enterApp();
    } catch (err) {
      renderLogin(authError(err), em);
    }
  };
}

// Crear o cambiar la contraseña (para no depender de los mails)
function viewClave() {
  return {
    html: `<div class="page" style="max-width:520px">
      <div class="page-head"><div><h1>Mi contraseña</h1><p>Con una contraseña entrás sin esperar mails</p></div></div>
      <form class="card" id="form">
        <div class="field"><label for="f-p1">Nueva contraseña</label><input id="f-p1" type="password" minlength="6" autocomplete="new-password" required /><span class="hint">Mínimo 6 caracteres</span></div>
        <div class="field"><label for="f-p2">Repetila</label><input id="f-p2" type="password" minlength="6" autocomplete="new-password" required /></div>
        <div class="form-actions"><button class="btn danger" type="button" data-act="logout">Salir de la cuenta</button><a class="btn ghost" href="#/">Volver</a><button class="btn" type="submit">Guardar contraseña</button></div>
      </form></div>`,
    mount() {
      document.getElementById("form").onsubmit = (e) => {
        e.preventDefault();
        const p1 = document.getElementById("f-p1").value;
        if (p1 !== document.getElementById("f-p2").value) return toast("Las dos contraseñas no coinciden");
        guard(async () => {
          await db.setPassword(p1);
          toast("Contraseña guardada. La próxima vez entrá con ella.");
          go("#/");
        });
      };
    },
  };
}

function renderNoAccess() {
  document.querySelector(".side").hidden = true;
  if (typeof Mili !== "undefined") Mili.hide();
  $app.innerHTML = `<div class="login"><div class="card">
      <h2>Sin acceso</h2>
      <p class="small" style="margin:0">${esc(db.user.email)} no está en la lista de miembros de Cartera.</p>
      <button class="btn ghost" data-act="logout">Probar con otro mail</button>
    </div></div>`;
}

const notFound = () => ({ html: `<div class="page"><div class="card empty"><p>No encontramos lo que buscabas.</p><a class="btn" href="#/">Ir al tablero</a></div></div>` });

const actions = {
  mes: (d) => {
    const k = addMonthKey(state.mes, Number(d.d));
    if (k <= monthOf(today())) state.mes = k;
    render();
  },
  mesCobros: (d) => {
    state.mesCobros = addMonthKey(state.mesCobros, Number(d.d));
    render();
  },
  filtro: (d) => {
    state.filtro = d.f;
    render();
  },
  theme: () => {
    const root = document.documentElement;
    const dark = root.dataset.theme === "dark" || (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    root.dataset.theme = dark ? "light" : "dark";
    try {
      localStorage.setItem("cartera:theme", root.dataset.theme);
    } catch (e) {}
    render();
  },
  logout: async () => {
    await db.signOut();
    renderLogin();
  },
  sample: () => {
    if (db.data.prestamos.length && !confirm("Esto reemplaza los datos del modo demo por los de ejemplo. ¿Seguimos?")) return;
    db.loadSample();
    toast("Datos de ejemplo cargados de nuevo");
    go("#/");
  },
  clearDemo: () => {
    if (!confirm("¿Borrar todos los datos del modo demo?")) return;
    db.clearDemo();
    toast("Datos borrados");
    render();
  },
  exportar: (d) => exportar(d.t),
  buscar: () => typeof Buscar !== "undefined" && Buscar.abrir(),
  renovar: (d) =>
    guard(async () => {
      const p = db.data.prestamos.find((x) => x.id === d.id);
      const r = analizar(p, db.data.pagos);
      if (!confirm(`Registrar hoy el cobro de ${money(r.interesPeriodo)} de interés. El préstamo sigue un mes más, con vencimiento el ${fmtDate(addMonths(r.proxVence, 1))}.`)) return;
      const pago = { prestamo_id: p.id, fecha: today(), ...sugerirPago(r, "renovacion", 0), tipo: "renovacion", notas: "" };
      await db.insert("pagos", pago);
      toast("Renovación registrada");
      miliReactPago(p, pago);
      render();
    }),
  cancelar: (d) =>
    guard(async () => {
      const p = db.data.prestamos.find((x) => x.id === d.id);
      const r = analizar(p, db.data.pagos);
      if (!confirm(`Registrar hoy el cobro de ${money(r.proxMonto)} (capital + interés) y cerrar el préstamo.`)) return;
      const pago = { prestamo_id: p.id, fecha: today(), ...sugerirPago(r, "cancelacion", 0), tipo: "cancelacion", notas: "" };
      await db.insert("pagos", pago);
      await sincronizarEstado(p);
      toast("Préstamo cancelado");
      miliReactPago(p, pago);
      render();
    }),
  cuota: (d) =>
    guard(async () => {
      const p = db.data.prestamos.find((x) => x.id === d.id);
      const r = analizar(p, db.data.pagos);
      if (!confirm(`Registrar hoy el cobro de la cuota ${r.cuotasPagas + 1} por ${money(r.proxMonto)}.`)) return;
      const pago = { prestamo_id: p.id, fecha: today(), ...sugerirPago(r, "cuota", r.proxMonto), tipo: "cuota", notas: "" };
      await db.insert("pagos", pago);
      await sincronizarEstado(p);
      toast("Cuota registrada");
      miliReactPago(p, pago);
      render();
    }),
  incobrable: (d) =>
    guard(async () => {
      if (!confirm("¿Marcar este préstamo como incobrable? Sale del capital en la calle y queda como pérdida.")) return;
      await db.update("prestamos", d.id, { estado: "incobrable" });
      miliReact("incobrable");
      render();
    }),
  reactivar: (d) =>
    guard(async () => {
      await db.update("prestamos", d.id, { estado: "activo" });
      await sincronizarEstado(db.data.prestamos.find((x) => x.id === d.id));
      render();
    }),
  borrarPago: (d) =>
    guard(async () => {
      if (!confirm("¿Borrar este cobro?")) return;
      const x = db.data.pagos.find((y) => y.id === d.id);
      await db.remove("pagos", d.id);
      await sincronizarEstado(db.data.prestamos.find((p) => p.id === x.prestamo_id));
      toast("Cobro borrado");
      render();
    }),
  borrarPrestamo: (d) =>
    guard(async () => {
      if (!confirm("¿Eliminar el préstamo y todos sus cobros? No se puede deshacer.")) return;
      const p = db.data.prestamos.find((x) => x.id === d.id);
      await db.remove("prestamos", d.id);
      toast("Préstamo eliminado");
      go("#/clientes/" + p.cliente_id);
    }),
  borrarCliente: (d) =>
    guard(async () => {
      if (!confirm("¿Eliminar este cliente?")) return;
      await db.remove("clientes", d.id);
      toast("Cliente eliminado");
      go("#/clientes");
    }),
};

document.addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]");
  if (act && actions[act.dataset.act]) {
    e.preventDefault();
    return actions[act.dataset.act](act.dataset);
  }
  const row = e.target.closest("tr[data-href]");
  if (row && !e.target.closest("a,button")) go(row.dataset.href);
});

/* ───────────────────────── Router ───────────────────────── */

// En el celu cada fila se ve como tarjeta: cada celda lleva el nombre de su columna
function etiquetarTablas() {
  $app.querySelectorAll(".table-wrap table").forEach((t) => {
    const heads = [...t.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    t.querySelectorAll("tbody tr").forEach((tr) =>
      [...tr.children].forEach((td, i) => {
        td.dataset.label = heads[i] || "";
        // Envolvemos el contenido para que en la tarjeta quede junto, a la derecha de la etiqueta
        if (!td.classList.contains("empty")) td.innerHTML = `<span class="tv">${td.innerHTML}</span>`;
      })
    );
  });
}

function render() {
  if (REMOTE && !db.user) return renderLogin();
  const { path, parts, q } = parseHash();
  const [a, b, c] = parts;
  let view;
  if (!a) view = viewDashboard();
  else if (a === "clientes") view = !b ? viewClientes() : b === "nuevo" ? viewClienteForm() : c === "editar" ? viewClienteForm(b) : viewCliente(b);
  else if (a === "prestamos") view = !b ? viewPrestamos() : b === "nuevo" ? viewPrestamoForm(q) : viewPrestamo(b);
  else if (a === "cobros") view = !b ? viewCobros() : viewCobroForm(q);
  else if (a === "datos") view = viewDatos();
  else if (a === "clave") view = viewClave();
  else if (a === "salud") view = viewSalud();
  else view = notFound();
  $app.innerHTML = view.html;
  etiquetarTablas();
  if (view.mount) view.mount();
  renderNav(a || "");
  if (state.lastPath !== path) {
    scrollTo(0, 0);
    if (typeof Mili !== "undefined") Mili.onRoute(parts);
  }
  state.lastPath = path;
}

addEventListener("hashchange", render);
Charts.bindTooltips();

(async () => {
  // El link del mail vuelve con la sesión (o con un error) después del "#": lo leemos y lo limpiamos
  const fromLink = /access_token=|error_description=/.test(location.hash);
  const linkError = fromLink && new URLSearchParams(location.hash.slice(1)).get("error_description");
  try {
    await db.session();
    if (fromLink || location.search.includes("code=")) history.replaceState(null, "", location.pathname + "#/");
    if (REMOTE && !db.user && linkError) return renderLogin(authError({ message: linkError }));
    if (REMOTE && db.user && !(await db.isMember())) return renderNoAccess();
    if (db.user) await db.load();
  } catch (e) {
    console.error(e);
    toast("No se pudo conectar con la base de datos");
  }
  render();
})();
