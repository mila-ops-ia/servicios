// Salud del negocio: interpreta los números con un semáforo y da consejos en criollo.
// Se usa en la pantalla #/salud y en el resumen del tablero.

const NIVELES = {
  verde: { cls: "al-dia", icon: "●", label: "Bien", frase: "Tu negocio está sano" },
  amarillo: { cls: "por-vencer", icon: "▲", label: "Atención", frase: "Hay cosas para mirar" },
  rojo: { cls: "mora", icon: "■", label: "Alerta", frase: "Hay que actuar ya" },
  gris: { cls: "cancelado", icon: "○", label: "Sin datos", frase: "Todavía no hay datos suficientes" },
};
const ORDEN = { verde: 0, amarillo: 1, rojo: 2 };

// Elige el color según dos cortes. "masEsMejor" para indicadores donde un número alto es bueno.
function nivel(valor, corte1, corte2, masEsMejor = false) {
  if (valor == null || !isFinite(valor)) return "gris";
  if (masEsMejor) return valor >= corte1 ? "verde" : valor >= corte2 ? "amarillo" : "rojo";
  return valor <= corte1 ? "verde" : valor <= corte2 ? "amarillo" : "rojo";
}

function calcularSalud(hoy = today()) {
  const A = analizarTodos();
  const activos = A.filter((r) => r.activo);
  const enCalle = sum(activos, "capitalPendiente");

  // 1) Mora: qué parte de la plata prestada está en préstamos atrasados
  const enMora = activos.filter((r) => r.situacion === "mora").sort((a, b) => b.montoVencido - a.montoVencido);
  const pctMora = enCalle ? sum(enMora, "capitalPendiente") / enCalle : null;

  // 2) Cobranza: de lo que venció en los últimos 30 días, cuánto se pagó
  const desde = addDays(hoy, -30);
  const vencidos = A.filter((r) => r.situacion !== "incobrable").flatMap((r) => r.cronograma.filter((c) => c.vence >= desde && c.vence < hoy));
  const pagados = vencidos.filter((c) => c.pagadaEl);
  const pctCobranza = vencidos.length ? pagados.length / vencidos.length : null;

  // 3) Concentración: cuánto de la plata tiene el cliente más grande
  const porCliente = {};
  for (const r of activos) porCliente[r.p.cliente_id] = (porCliente[r.p.cliente_id] || 0) + r.capitalPendiente;
  const [topId, topMonto] = Object.entries(porCliente).sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const pctTop = enCalle ? topMonto / enCalle : null;

  // 4) Rendimiento esperado: si todos pagan, cuánto deja la cartera sobre lo prestado
  const rend = enCalle ? sum(activos, "interesPendiente") / enCalle : null;

  // 5) Pérdidas: capital que quedó incobrable sobre todo lo prestado
  const prestadoTotal = sum(db.data.prestamos, "capital");
  const perdida = sum(A.filter((r) => r.situacion === "incobrable"), "capitalPendiente");
  const pctPerdida = prestadoTotal ? perdida / prestadoTotal : null;

  // Para los consejos
  const semana = vencimientosDelMes(db.data, monthOf(hoy))
    .concat(vencimientosDelMes(db.data, addMonthKey(monthOf(hoy), 1)))
    .filter((v) => v.vence >= hoy && v.vence <= addDays(hoy, 7));
  const gan30 = sum(db.data.pagos.filter((x) => x.fecha > desde && x.fecha <= hoy), "interes");

  const ind = [
    {
      key: "mora",
      titulo: "Mora",
      pregunta: "¿Cuánta plata está atrasada?",
      valor: pct(pctMora, 0),
      nivel: nivel(pctMora, 0.05, 0.15),
      explica: pctMora == null ? "Todavía no hay plata prestada." : !enMora.length ? "Nadie está atrasado: <b>ningún</b> préstamo tiene pagos vencidos sin cobrar." :
        `De cada 100 que tenés prestados, <b>${Math.round(pctMora * 100)}</b> están en préstamos atrasados (${enMora.length} préstamo${enMora.length === 1 ? "" : "s"}, deben ${money(sum(enMora, "montoVencido"))}).`,
      consejo: {
        verde: "Casi nadie está atrasado. Seguí recordando los vencimientos el día antes.",
        amarillo: "Hay plata atrasada. Llamá hoy a quienes deben y no les prestes más hasta que se pongan al día.",
        rojo: "Mucha plata atrasada. Antes de prestar de nuevo, enfocate en cobrar lo que ya está afuera.",
      },
      meta: "Ideal: menos de 5 %",
    },
    {
      key: "cobranza",
      titulo: "Cobranza",
      pregunta: "¿Te pagan lo que vence?",
      valor: pct(pctCobranza, 0),
      nivel: nivel(pctCobranza, 0.9, 0.75, true),
      explica: pctCobranza == null ? "En los últimos 30 días todavía no venció ningún pago." :
        vencidos.length === 1 ? `En los últimos 30 días venció <b>1</b> pago y ${pagados.length ? "<b>se cobró</b>" : "<b>no se cobró</b>"}.` :
        `De los <b>${vencidos.length}</b> pagos que vencieron en los últimos 30 días, se cobraron <b>${pagados.length}</b>.`,
      consejo: {
        verde: "La gente paga lo que vence. ¡Muy bien!",
        amarillo: "Algunos pagos se están quedando. Mandá un recordatorio el día anterior al vencimiento.",
        rojo: "Se cobra poco de lo que vence. Revisá a quién le prestás y pedí referencias antes de prestar.",
      },
      meta: "Ideal: 90 % o más",
    },
    {
      key: "concentracion",
      titulo: "Concentración",
      pregunta: "¿Está la plata muy en una sola persona?",
      valor: pct(pctTop, 0),
      nivel: nivel(pctTop, 0.25, 0.4),
      explica: pctTop == null ? "Todavía no hay plata prestada." :
        `<b>${esc(cliente(topId).nombre)}</b> tiene el <b>${Math.round(pctTop * 100)} %</b> de toda la plata en la calle (${money(topMonto)}).`,
      consejo: {
        verde: "La plata está bien repartida entre varias personas.",
        amarillo: `Si ${esc(topId ? cliente(topId).nombre : "esa persona")} no paga, el golpe es grande. Mejor no prestarle más hasta que devuelva una parte.`,
        rojo: `Demasiada plata en ${esc(topId ? cliente(topId).nombre : "una sola persona")}. Repartí los próximos préstamos entre más clientes.`,
      },
      meta: "Ideal: menos de 25 % por persona",
    },
    {
      key: "rendimiento",
      titulo: "Rendimiento esperado",
      pregunta: "¿Cuánto va a dejar lo prestado?",
      valor: pct(rend, 0),
      nivel: nivel(rend, 0.25, 0.15, true),
      explica: rend == null ? "Todavía no hay plata prestada." :
        `Si todos pagan, la cartera activa deja <b>${money(sum(activos, "interesPendiente"))}</b> de ganancia sobre ${money(enCalle)} prestados.`,
      consejo: {
        verde: "Las tasas están rindiendo bien.",
        amarillo: "Hay préstamos que rinden poco (por ejemplo, pagos parciales). Revisá las condiciones de los nuevos.",
        rojo: "La cartera rinde poco. Revisá si se están cobrando los intereses acordados.",
      },
      meta: "Con 30 % y 32 % lo normal es 25 % o más",
    },
    {
      key: "perdidas",
      titulo: "Pérdidas",
      pregunta: "¿Cuánta plata no volvió?",
      valor: pct(pctPerdida, 1),
      nivel: nivel(pctPerdida, 0.03, 0.08),
      explica: pctPerdida == null ? "Todavía no hay plata prestada." :
        perdida ? `Quedaron <b>${money(perdida)}</b> como incobrables, el ${pct(pctPerdida, 1)} de todo lo prestado.` : "No hay préstamos incobrables. ¡Excelente!",
      consejo: {
        verde: "Casi no hay pérdidas.",
        amarillo: "Las pérdidas empiezan a pesar. Pedí más datos y referencias a los clientes nuevos.",
        rojo: "Se está perdiendo mucha plata. Achicá los montos a clientes nuevos hasta que demuestren que pagan.",
      },
      meta: "Ideal: menos de 3 %",
    },
  ];

  // Semáforo general: manda el peor de los indicadores de riesgo
  const riesgo = ind.filter((i) => ["mora", "cobranza", "concentracion", "perdidas"].includes(i.key) && i.nivel !== "gris");
  const general = riesgo.length ? riesgo.reduce((a, i) => (ORDEN[i.nivel] > ORDEN[a] ? i.nivel : a), "verde") : "gris";

  // Consejos concretos de Mili, de lo más urgente a lo menos
  const consejos = [];
  for (const r of enMora.slice(0, 3))
    consejos.push({ icon: "📞", href: "#/prestamos/" + r.p.id, texto: `Llamá a <b>${esc(cliente(r.p.cliente_id).nombre)}</b> (${codigo(r.p)}): debe ${money(r.montoVencido)} hace ${r.diasAtraso} días.` });
  if (enMora.length > 3) consejos.push({ icon: "⚠️", href: "mora", texto: `Hay ${enMora.length - 3} préstamo${enMora.length - 3 === 1 ? "" : "s"} más en mora. Revisalos en Préstamos → En mora.` });
  if (semana.length)
    consejos.push({ icon: "📲", href: "semana", texto: `Esta semana vencen <b>${semana.length}</b> cobro${semana.length === 1 ? "" : "s"} por ${money(sum(semana, "monto"))}. Mandales un recordatorio el día antes.` });
  const conc = ind.find((i) => i.key === "concentracion");
  if (conc.nivel !== "verde" && conc.nivel !== "gris")
    consejos.push({ icon: "⚖️", href: "#/clientes/" + topId, texto: conc.consejo[conc.nivel] });
  if (!enMora.length && activos.length) consejos.push({ icon: "🎉", texto: "Nadie está atrasado. ¡Así da gusto!" });
  if (gan30) consejos.push({ icon: "💸", texto: `En los últimos 30 días cobraron <b>${money(gan30)}</b> de ganancia.` });
  if (!activos.length) consejos.push({ icon: "🤝", href: "#/prestamos/nuevo", texto: "Todavía no hay préstamos activos. Cargá el primero para empezar a medir." });

  return { ind, general, consejos, enCalle };
}

// Mili da el "semáforo": su cara cambia según cómo estamos (con texto, nunca solo color)
const MOOD_NIVEL = { verde: "risa", amarillo: "pensando", rojo: "sorpresa", gris: "feliz" };
const miliCara = (n, size = "") => `<img class="mili-cara ${n} ${size}" src="img/avatar/${MOOD_NIVEL[n]}.png" alt="Mili: ${NIVELES[n].label}" />`;
const estado = (n) => `<span class="estado ${n}"><i aria-hidden="true">${NIVELES[n].icon}</i>${NIVELES[n].label}</span>`;
// Globito de Mili con su comentario; se reutiliza en otras pantallas
const miliDice = (n, texto, size = "") =>
  `<div class="mili-dice ${n}">${miliCara(n, size)}<div class="mili-globo"><span class="who">Mili ${estado(n)}</span>${texto}</div></div>`;

const FRASE_MILI = {
  verde: "¡Vamos muy bien! 😄 La plata vuelve, la gente paga y no hay nada urgente.",
  amarillo: "Vamos bien, pero hay cosas para mirar esta semana 🤔 Te dejo abajo qué hacer.",
  rojo: "¡Ojo! 😮 Hay plata en riesgo. Antes de prestar de nuevo, enfoquémonos en cobrar.",
  gris: "Todavía no tengo datos suficientes para decirte cómo van. Cargá préstamos y cobros y te cuento 😉",
};

function viewSalud() {
  const s = calcularSalud();
  return {
    html: `<div class="page">
      <div class="page-head"><div><h1>Salud del negocio</h1><p>Mili te explica los números y te dice cómo vamos</p></div></div>
      <div class="card salud-hero ${s.general}">
        ${miliCara(s.general, "xl")}
        <div class="mili-globo grande">
          <span class="who">Mili · cómo estamos hoy ${estado(s.general)}</span>
          <div class="salud-frase">${NIVELES[s.general].frase}</div>
          <p style="margin:6px 0 0">${FRASE_MILI[s.general]}</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h2>💡 Lo que te aconsejo hacer ahora</h2><p>De lo más urgente a lo menos</p></div></div>
        <div class="list">${s.consejos
          .map((c) => (c.href ? `<a class="list-item consejo" href="${c.href.startsWith("#") ? c.href : "#/salud"}" data-consejo="${c.href}">` : `<div class="list-item consejo">`) +
            `<span class="consejo-ico">${c.icon}</span><span style="flex:1">${c.texto}</span>${c.href ? `<span class="muted">›</span></a>` : "</div>"}`)
          .join("")}</div>
      </div>

      <div class="salud-grid">${s.ind
        .map((i) => `<div class="card indicador ${i.nivel}">
            <div class="row between"><h3>${i.titulo}</h3>${estado(i.nivel)}</div>
            <div class="ind-pregunta">${i.pregunta}</div>
            <div class="ind-valor">${i.valor}</div>
            <p class="ind-explica">${i.explica}</p>
            ${miliDice(i.nivel, i.nivel !== "gris" ? i.consejo[i.nivel] : "Cuando haya datos, te cuento.", "sm")}
            <div class="ind-meta">${i.meta}</div>
          </div>`)
        .join("")}</div>

      ${resumenHTML(s)}

      <div class="card">
        <h3>Cómo leer a Mili</h3>
        <div class="leyenda">
          <span>${miliCara("verde", "sm")} <b>Se ríe:</b> todo bien, seguí así</span>
          <span>${miliCara("amarillo", "sm")} <b>Piensa:</b> mirarlo esta semana</span>
          <span>${miliCara("rojo", "sm")} <b>Se sorprende:</b> actuar ya</span>
        </div>
      </div>
    </div>`,
    mount() {
      document.querySelectorAll("[data-consejo]").forEach((a) =>
        a.addEventListener("click", (e) => {
          const h = a.dataset.consejo;
          if (h === "mora") { e.preventDefault(); state.filtro = "mora"; state.buscarP = ""; location.hash = "#/prestamos"; }
          else if (h === "semana") { e.preventDefault(); location.hash = "#/"; setTimeout(() => { const c = document.getElementById("dash-cobrar"); c && c.scrollIntoView({ behavior: "smooth" }); }, 300); }
        })
      );
    },
  };
}

// Resumen chico para el tablero: Mili con su veredicto y el consejo más urgente
function saludResumen() {
  const s = calcularSalud();
  const top = s.consejos[0];
  return `<a class="card salud-mini ${s.general}" href="#/salud">
      ${miliCara(s.general, "md")}
      <div style="flex:1;min-width:0">
        <div class="who">Mili · salud del negocio ${estado(s.general)}</div>
        <div class="salud-mini-frase">${FRASE_MILI[s.general]}</div>
        ${top ? `<div class="small" style="margin-top:4px">${top.icon} ${top.texto}</div>` : ""}
      </div>
      <span class="salud-mini-ver">Ver detalle ›</span>
    </a>`;
}

// Comentario de Mili para la ficha de un préstamo
function miliPrestamo(r) {
  const c = esc(cliente(r.p.cliente_id).nombre);
  if (r.situacion === "mora") return miliDice("rojo", `${c} lleva <b>${r.diasAtraso} días</b> de atraso y debe ${money(r.montoVencido)}. Llamá hoy; cuando pague, registrá el cobro acá.`);
  if (r.situacion === "por-vencer") return miliDice("amarillo", `Vence el <b>${fmtDate(r.proxVence)}</b> (${money(r.proxMonto)}). Mandale un recordatorio el día antes 📲`);
  if (r.situacion === "al-dia") {
    const g = r.intPag ? ` Ya nos dejó ${money(r.intPag)} de ganancia.` : "";
    return miliDice("verde", `Va al día 😄 Próximo vencimiento: <b>${fmtDate(r.proxVence)}</b>.${g}`);
  }
  if (r.situacion === "cancelado") return miliDice("verde", `Préstamo terminado: volvió todo y dejó <b>${money(r.intPag)}</b> de ganancia 🎉`);
  return miliDice("rojo", `Quedó como incobrable: se perdieron ${money(r.capitalPendiente)}. Si algún día paga, lo reactivás.`);
}

// Comentario de Mili para la ficha de un cliente
function miliCliente(rs) {
  const act = rs.filter((r) => r.activo);
  const mora = act.filter((r) => r.situacion === "mora");
  const p = puntualidad(rs);
  if (mora.length) return miliDice("rojo", `Tiene <b>${mora.length}</b> préstamo${mora.length === 1 ? "" : "s"} atrasado${mora.length === 1 ? "" : "s"}. No le prestes más hasta que se ponga al día.`);
  if (rs.some((r) => r.situacion === "incobrable")) return miliDice("rojo", "Ya tuvo un préstamo incobrable. Si le volvés a prestar, que sea un monto chico.");
  if (p == null) return miliDice("gris", rs.length ? "Todavía no le venció ningún pago, así que no sé si es puntual. Te cuento más adelante." : "Todavía no tiene préstamos. ¿Le cargamos uno?");
  if (p >= 0.9) return miliDice("verde", `Paga muy bien: el <b>${pct(p, 0)}</b> de sus vencimientos los pagó a tiempo 😄 Es de confiar para seguir prestando.`);
  if (p >= 0.7) return miliDice("amarillo", `Paga, pero a veces tarde (<b>${pct(p, 0)}</b> a tiempo). Recordale los vencimientos el día antes.`);
  return miliDice("rojo", `Se atrasa seguido (solo <b>${pct(p, 0)}</b> a tiempo). Pensalo dos veces antes de prestarle más.`);
}

// ── Resumen del negocio en palabras: Mili responde las preguntas de siempre con los datos de hoy ──
function resumenNegocio(s, hoy = today()) {
  const data = db.data;
  const A = analizarTodos();
  const activos = A.filter((r) => r.activo);
  const ind = Object.fromEntries(s.ind.map((i) => [i.key, i]));
  const n = (x, uno, varios) => `${x} ${x === 1 ? uno : varios}`;
  const primer = data.prestamos.map((p) => p.fecha_entrega).sort()[0];
  if (!primer) return [{ q: "¿Cómo nos está yendo?", nivel: "gris", texto: "Todavía no hay préstamos cargados. Cuando cargues los primeros, te armo este resumen 😉" }];
  const dias = daysBetween(primer, hoy);

  // Ventanas de 30 días para comparar "ahora" contra "antes"
  const ventana = (desde, hasta) => {
    const pagos = data.pagos.filter((x) => x.fecha > desde && x.fecha <= hasta);
    const vencidos = A.filter((r) => r.situacion !== "incobrable").flatMap((r) => r.cronograma.filter((c) => c.vence > desde && c.vence <= hasta && c.vence < hoy));
    return {
      gan: sum(pagos, "interes"),
      cobrado: sum(pagos, "monto"),
      cobranza: vencidos.length ? vencidos.filter((c) => c.pagadaEl).length / vencidos.length : null,
      mora: data.prestamos.filter((p) => p.fecha_entrega <= hasta && p.estado !== "incobrable" && analizar({ ...p, estado: "activo" }, data.pagos, hasta).situacion === "mora").length,
      calle: capitalEnCalle(data, hasta),
    };
  };
  const d30 = addDays(hoy, -30);
  const ahora = ventana(d30, hoy);
  const antes = ventana(addDays(hoy, -60), d30);
  const comparable = dias >= 45;

  const enMora = activos.filter((r) => r.situacion === "mora");
  const clientesAct = new Set(activos.map((r) => r.p.cliente_id)).size;
  const capTotal = sum(data.prestamos, "capital");
  const ganCobrada = sum(A, "intPag");
  const ganPend = sum(activos, "interesPendiente");
  const perdida = sum(A.filter((r) => r.situacion === "incobrable"), "capitalPendiente");
  const renovaciones = data.pagos.filter((x) => x.tipo === "renovacion").length;
  const vuelven = vencimientosDelMes(data, monthOf(hoy))
    .concat(vencimientosDelMes(data, addMonthKey(monthOf(hoy), 1)))
    .filter((v) => v.vence >= hoy && v.vence <= addDays(hoy, 30));
  const mes = metricasMes(data, monthOf(hoy));
  const mesAnt = metricasMes(data, addMonthKey(monthOf(hoy), -1));
  const nombre = (id) => esc(cliente(id).nombre);
  const buenos = [...new Set(A.map((r) => r.p.cliente_id))]
    .map((id) => ({ id, rs: A.filter((r) => r.p.cliente_id === id) }))
    .filter((x) => x.rs.flatMap((r) => r.eventos).length && puntualidad(x.rs) >= 0.9 && !x.rs.some((r) => r.situacion === "mora" || r.situacion === "incobrable"))
    .map((x) => nombre(x.id));
  const sinDatos = data.clientes.filter((c) => !c.telefono || !c.dni).length;

  const out = [];

  // 1) ¿Cómo nos está yendo?
  out.push({
    q: "¿Cómo nos está yendo?",
    nivel: s.general,
    texto: `<b>${NIVELES[s.general].frase}.</b> Hoy hay <b>${money(s.enCalle)}</b> prestados en ${n(activos.length, "préstamo activo", "préstamos activos")} a ${n(clientesAct, "persona", "personas")}. ${
      enMora.length ? `${n(enMora.length, "préstamo está atrasado", "préstamos están atrasados")}.` : "Nadie está atrasado."
    } En los últimos 30 días entraron <b>${money(ahora.cobrado)}</b>, de los cuales <b>${money(ahora.gan)}</b> fueron ganancia.`,
  });

  // 2) ¿Estamos siendo rentables?
  const total100 = Math.round(((ganCobrada + ganPend) / capTotal) * 100);
  out.push({
    q: "¿Estamos siendo rentables?",
    nivel: ind.perdidas.nivel === "rojo" ? "rojo" : ind.rendimiento.nivel,
    texto: `${ind.rendimiento.nivel === "verde" ? "<b>Sí.</b> Las tasas que cobran (30 % mensual y 32 % en cuotas) dejan muy buena ganancia." : "Más o menos: la cartera está rindiendo menos de lo que permiten las tasas."} En total, estos préstamos van a dejar un <b>${total100} %</b> de ganancia sobre lo prestado: ya cobraron ${money(ganCobrada)} y, si todos pagan, faltan ${money(ganPend)}.${
      perdida ? ` Lo que quedó incobrable (${money(perdida)}) se come parte de esa ganancia.` : " Y no hay pérdidas por incobrables."
    }${dias < 60 ? ` Como la cartera arrancó hace ${dias} días, la mayor parte de la ganancia todavía está por cobrar.` : ""}`,
  });

  // 3) ¿Estamos teniendo buena ganancia?
  const bajo = comparable && antes.gan > 0 && ahora.gan < antes.gan * 0.8;
  out.push({
    q: "¿Estamos teniendo buena ganancia?",
    nivel: bajo ? "amarillo" : ganPend || ahora.gan ? "verde" : "gris",
    texto: `En lo que va de ${monthName(monthOf(hoy), { month: "long" })} cobraron <b>${money(mes.ganancia)}</b> de ganancia${
      mesAnt.ganancia ? ` (en ${monthName(mesAnt.key, { month: "long" })} fueron ${money(mesAnt.ganancia)})` : ""
    }. ${comparable ? `En los últimos 30 días la ganancia fue ${money(ahora.gan)}, ${ahora.gan >= antes.gan ? "más" : "menos"} que los 30 días anteriores (${money(antes.gan)}). ` : ""}Lo más importante: hay <b>${money(ganPend)}</b> de ganancia esperando en los préstamos activos.${
      renovaciones ? ` Además, ${n(renovaciones, "renovación ya dejó", "renovaciones ya dejaron")} interés sin tener que prestar plata nueva 👏` : ""
    }`,
  });

  // 4) ¿Podemos seguir prestando?
  const motivos = [];
  if (enMora.length) motivos.push(`primero cobrar a ${enMora.slice(0, 3).map((r) => nombre(r.p.cliente_id)).join(", ")}`);
  if (ind.concentracion.nivel !== "verde" && ind.concentracion.nivel !== "gris") {
    const porCli = {};
    for (const r of activos) porCli[r.p.cliente_id] = (porCli[r.p.cliente_id] || 0) + r.capitalPendiente;
    const topId = Object.entries(porCli).sort((a, b) => b[1] - a[1])[0][0];
    motivos.push(`no prestarle más a <b>${nombre(topId)}</b> (tiene el ${ind.concentracion.valor} de la plata) hasta que devuelva una parte`);
  }
  if (ind.cobranza.nivel === "amarillo" || ind.cobranza.nivel === "rojo") motivos.push("asegurarse de que paguen lo que vence antes de sumar préstamos");
  const sigue = s.general === "rojo" ? "rojo" : motivos.length ? "amarillo" : "verde";
  out.push({
    q: "¿Podemos seguir prestando?",
    nivel: sigue,
    texto: `${sigue === "verde" ? "<b>Sí 👍</b> Los números acompañan." : sigue === "amarillo" ? "<b>Sí, con cuidado.</b>" : "<b>Por ahora, mejor frenar.</b>"}${
      motivos.length ? ` Conviene ${motivos.join("; y ")}.` : ""
    } En los próximos 30 días vencen <b>${money(sum(vuelven, "monto"))}</b> (capital + interés, si todos devuelven; si alguien renueva, entra solo el interés y la plata sigue prestada). Esa es la plata para volver a prestar sin poner más de su bolsillo.${
      buenos.length ? ` Las personas que mejor pagan hasta ahora: <b>${buenos.slice(0, 5).join(", ")}</b>.` : ""
    }`,
  });

  // 5) ¿En qué mejoramos últimamente?
  const mejoras = [];
  if (comparable) {
    if (ahora.gan > antes.gan) mejoras.push(`la ganancia subió: ${money(ahora.gan)} en los últimos 30 días contra ${money(antes.gan)} antes`);
    if (ahora.cobranza != null && antes.cobranza != null && ahora.cobranza > antes.cobranza) mejoras.push(`se cobra mejor lo que vence: ${pct(ahora.cobranza, 0)} contra ${pct(antes.cobranza, 0)}`);
    if (ahora.mora < antes.mora) mejoras.push(`hay menos préstamos atrasados (${ahora.mora} contra ${antes.mora})`);
    if (ahora.calle > antes.calle) mejoras.push(`la cartera creció: hay ${money(ahora.calle)} en la calle contra ${money(antes.calle)} hace un mes`);
  }
  const buenas = [];
  if (!enMora.length && activos.length) buenas.push("nadie está atrasado");
  if (ind.cobranza.nivel === "verde") buenas.push(`se cobró el ${ind.cobranza.valor} de lo que venció`);
  if (!perdida) buenas.push("no hay incobrables");
  if (renovaciones) buenas.push(`${n(renovaciones, "cliente renovó", "clientes renovaron")}`);
  out.push({
    q: "¿En qué mejoramos últimamente?",
    nivel: mejoras.length || buenas.length ? "verde" : "gris",
    texto: comparable
      ? mejoras.length ? `Comparando los últimos 30 días con los anteriores:<ul>${mejoras.map((m) => `<li>${m.charAt(0).toUpperCase() + m.slice(1)}.</li>`).join("")}</ul>` : "Comparando con el mes anterior no veo mejoras claras todavía."
      : `Todavía es pronto para comparar: la cartera arrancó el ${fmtDate(primer)} (hace ${dias} días). Cuando haya dos meses de historia, acá te digo qué mejoró.${
          buenas.length ? ` Lo bueno de este arranque: ${buenas.join(", ")} 😄` : ""
        }`,
  });

  // 6) ¿Qué deberíamos mejorar?
  const mejorar = s.ind.filter((i) => i.nivel === "amarillo" || i.nivel === "rojo").map((i) => `<b>${i.titulo}:</b> ${i.consejo[i.nivel]}`);
  if (comparable && ahora.gan < antes.gan) mejorar.push(`<b>Ganancia:</b> bajó respecto de los 30 días anteriores. Revisá si hay cobros sin cargar.`);
  if (sinDatos) mejorar.push(`<b>Datos de clientes:</b> a ${n(sinDatos, "cliente le falta", "clientes les falta")} el teléfono o el DNI. Si alguien se atrasa, lo vas a necesitar: completalo en la ficha de cada uno.`);
  if (!data.pagos.length) mejorar.push("<b>Cobros:</b> todavía no hay cobros cargados. Cargá cada plata que entra para que la ganancia se vea.");
  out.push({
    q: "¿Qué deberíamos mejorar?",
    nivel: mejorar.some((m) => /Mora|Cobranza|Pérdidas/.test(m)) && s.general === "rojo" ? "rojo" : mejorar.length ? "amarillo" : "verde",
    texto: mejorar.length ? `<ul>${mejorar.map((m) => `<li>${m}</li>`).join("")}</ul>` : "¡Nada urgente! Seguí cargando cada cobro y recordando los vencimientos el día antes 💙",
  });

  return out;
}

function resumenHTML(s) {
  return `<div class="card resumen">
      <div class="card-head"><div><h2>📝 Resumen del negocio</h2><p>Mili lo escribe con los datos de hoy, ${fmtDate(today())}</p></div></div>
      <div class="resumen-lista">${resumenNegocio(s)
        .map((r) => `<div class="resumen-item"><h3>${r.q}</h3>${miliDice(r.nivel, r.texto, "sm")}</div>`)
        .join("")}</div>
    </div>`;
}
