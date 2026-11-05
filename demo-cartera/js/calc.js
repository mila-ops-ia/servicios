// Cálculos de la cartera: fechas, plata, estado de cada préstamo y métricas del negocio.
// Las fechas se manejan como texto "AAAA-MM-DD" en horario local para no correrse por zona horaria.

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const today = () => iso(new Date());
const addDays = (s, n) => {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const addMonths = (s, n) => {
  const d = parseDate(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return iso(d);
};
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
const monthOf = (s) => s.slice(0, 7);
const addMonthKey = (key, n) => addMonths(key + "-01", n).slice(0, 7);
const monthEnd = (key) => iso(new Date(+key.slice(0, 4), +key.slice(5, 7), 0));
const monthName = (key, opts = { month: "long", year: "numeric" }) =>
  parseDate(key + "-01").toLocaleDateString("es-AR", opts);
const monthTitle = (key) => {
  const s = monthName(key);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const sum = (arr, f) => arr.reduce((t, x) => t + (Number(typeof f === "function" ? f(x) : x[f]) || 0), 0);
// Todo en pesos, sin decimales: "$ 500.000"
const money = (n) => "$ " + Math.round(n || 0).toLocaleString("es-AR");
const moneyShort = (n) => {
  const a = Math.abs(n);
  if (a >= 1e6) return "$ " + (n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + " M";
  if (a >= 1e3) return "$ " + Math.round(n / 1e3).toLocaleString("es-AR") + " mil";
  return "$ " + Math.round(n);
};
const pct = (x, digits = 1) =>
  x == null || !isFinite(x) ? "—" : (x * 100).toLocaleString("es-AR", { maximumFractionDigits: digits }) + " %";

const MODALIDADES = {
  mensual: { label: "Mensual", tasa: 0.3 },
  semanal: { label: "Semanal", tasa: 0.32 },
};

// Estado completo de un préstamo a una fecha dada (por defecto, hoy).
function analizar(p, pagos, hoy = today()) {
  const ps = pagos
    .filter((x) => x.prestamo_id === p.id && x.fecha <= hoy)
    .sort((a, b) => (a.fecha + (a.created_at || "")).localeCompare(b.fecha + (b.created_at || "")));
  const pagado = sum(ps, "monto");
  const capPag = sum(ps, "capital");
  const intPag = sum(ps, "interes");
  const r = { p, pagos: ps, pagado, capPag, intPag, cronograma: [], eventos: [] };

  if (p.modalidad === "semanal") {
    const total = p.cuotas * p.monto_cuota;
    const cuotas = [];
    for (let i = 0; i < p.cuotas; i++)
      cuotas.push({ n: i + 1, vence: addDays(p.primer_vencimiento, 7 * i), monto: p.monto_cuota, pagadaEl: null });
    let acum = 0;
    let idx = 0;
    for (const x of ps) {
      acum += Number(x.monto);
      while (idx < cuotas.length && acum + 0.5 >= (idx + 1) * p.monto_cuota) cuotas[idx++].pagadaEl = x.fecha;
    }
    const parcial = Math.max(0, acum - idx * p.monto_cuota);
    const prox = cuotas.find((c) => !c.pagadaEl);
    const atrasadas = cuotas.filter((c) => !c.pagadaEl && c.vence < hoy);
    Object.assign(r, {
      cronograma: cuotas,
      totalACobrar: total,
      interesTotal: total - p.capital,
      saldo: Math.max(0, total - pagado),
      capitalPendiente: Math.max(0, p.capital - capPag),
      interesPendiente: Math.max(0, total - p.capital - intPag),
      proxVence: prox ? prox.vence : null,
      proxMonto: prox ? prox.monto - parcial : 0,
      montoVencido: Math.max(0, atrasadas.length * p.monto_cuota - parcial),
      primerAtraso: atrasadas[0] ? atrasadas[0].vence : null,
      cuotasPagas: idx,
      eventos: cuotas
        .filter((c) => c.pagadaEl || c.vence < hoy)
        .map((c) => ({ vence: c.vence, aTiempo: !!c.pagadaEl && c.pagadaEl <= c.vence })),
    });
  } else {
    // Mensual: cada renovación paga el interés y corre el vencimiento un mes.
    const capRest = Math.max(0, p.capital - capPag);
    const cierres = ps.filter((x) => x.tipo === "renovacion" || x.tipo === "cancelacion");
    const proxVence = capRest > 0 ? addMonths(p.primer_vencimiento, ps.filter((x) => x.tipo === "renovacion").length) : null;
    const interesPeriodo = Math.round(capRest * p.tasa);
    const vencido = proxVence && proxVence < hoy;
    const cronograma = cierres.map((x, k) => ({
      n: k + 1,
      vence: addMonths(p.primer_vencimiento, k),
      monto: x.monto,
      pagadaEl: x.fecha,
      tipo: x.tipo,
    }));
    if (proxVence)
      cronograma.push({ n: cronograma.length + 1, vence: proxVence, monto: capRest + interesPeriodo, pagadaEl: null, tipo: "pendiente" });
    Object.assign(r, {
      cronograma,
      capitalPendiente: capRest,
      interesPeriodo,
      interesPendiente: capRest > 0 ? interesPeriodo : 0,
      saldo: capRest > 0 ? capRest + interesPeriodo : 0,
      totalACobrar: pagado + (capRest > 0 ? capRest + interesPeriodo : 0),
      interesTotal: intPag + (capRest > 0 ? interesPeriodo : 0),
      proxVence,
      proxMonto: capRest > 0 ? capRest + interesPeriodo : 0,
      montoVencido: vencido ? capRest + interesPeriodo : 0,
      primerAtraso: vencido ? proxVence : null,
      renovaciones: ps.filter((x) => x.tipo === "renovacion").length,
      eventos: cronograma
        .filter((c) => c.pagadaEl || c.vence < hoy)
        .map((c) => ({ vence: c.vence, aTiempo: !!c.pagadaEl && c.pagadaEl <= c.vence })),
    });
  }

  if (p.estado !== "activo") r.situacion = p.estado;
  else if (r.saldo <= 0.5) r.situacion = "cancelado";
  else if (r.primerAtraso) r.situacion = "mora";
  else if (r.proxVence && daysBetween(hoy, r.proxVence) <= 3) r.situacion = "por-vencer";
  else r.situacion = "al-dia";
  r.diasAtraso = r.primerAtraso ? daysBetween(r.primerAtraso, hoy) : 0;
  r.activo = r.situacion !== "cancelado" && r.situacion !== "incobrable";
  return r;
}

// Propone cómo dividir un cobro entre capital e interés.
function sugerirPago(r, tipo, monto) {
  const p = r.p;
  if (p.modalidad === "semanal") {
    const ratio = r.interesTotal / r.totalACobrar;
    const interes = Math.min(Math.round(monto * ratio), r.interesPendiente);
    return { monto, interes, capital: monto - interes };
  }
  if (tipo === "renovacion") return { monto: r.interesPeriodo, interes: r.interesPeriodo, capital: 0 };
  if (tipo === "cancelacion")
    return { monto: r.capitalPendiente + r.interesPeriodo, interes: r.interesPeriodo, capital: r.capitalPendiente };
  const interes = Math.min(monto, r.interesPendiente);
  return { monto, interes, capital: Math.max(0, monto - interes) };
}

// Capital prestado que todavía no volvió, a una fecha (sin contar incobrables).
function capitalEnCalle(data, fecha) {
  let t = 0;
  for (const p of data.prestamos) {
    if (p.estado === "incobrable" || p.fecha_entrega > fecha) continue;
    const devuelto = sum(data.pagos.filter((x) => x.prestamo_id === p.id && x.fecha <= fecha), "capital");
    t += Math.max(0, p.capital - devuelto);
  }
  return t;
}

// Métricas de un mes "AAAA-MM".
function metricasMes(data, key) {
  const pagosMes = data.pagos.filter((x) => monthOf(x.fecha) === key);
  const inicio = capitalEnCalle(data, addDays(key + "-01", -1));
  const fin = capitalEnCalle(data, monthEnd(key));
  const promedio = (inicio + fin) / 2;
  const ganancia = sum(pagosMes, "interes");
  return {
    key,
    ganancia,
    cobrado: sum(pagosMes, "monto"),
    prestado: sum(data.prestamos.filter((p) => monthOf(p.fecha_entrega) === key), "capital"),
    nuevos: data.prestamos.filter((p) => monthOf(p.fecha_entrega) === key).length,
    capitalInicio: inicio,
    capitalFin: fin,
    rentabilidad: promedio > 0 ? ganancia / promedio : null,
  };
}

// Lo que vence dentro de un mes, préstamo por préstamo (para "a cobrar este mes").
function vencimientosDelMes(data, key, hoy = today()) {
  const out = [];
  for (const p of data.prestamos) {
    if (p.estado !== "activo") continue;
    const r = analizar(p, data.pagos, hoy);
    if (!r.activo) continue;
    if (p.modalidad === "semanal") {
      r.cronograma
        .filter((c) => !c.pagadaEl && monthOf(c.vence) === key)
        .forEach((c) => out.push({ p, r, vence: c.vence, monto: c.monto, detalle: `Cuota ${c.n} de ${p.cuotas}` }));
    } else if (r.proxVence && monthOf(r.proxVence) === key) {
      out.push({ p, r, vence: r.proxVence, monto: r.proxMonto, detalle: `Capital + interés (o ${moneyShort(r.interesPeriodo)} si renueva)` });
    }
  }
  return out.sort((a, b) => a.vence.localeCompare(b.vence));
}

// Puntualidad: porcentaje de vencimientos ya cumplidos que se pagaron a tiempo.
function puntualidad(analisis) {
  const ev = analisis.flatMap((r) => r.eventos);
  if (!ev.length) return null;
  return ev.filter((e) => e.aTiempo).length / ev.length;
}
