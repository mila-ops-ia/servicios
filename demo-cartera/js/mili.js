// Mili, la guía de Cartera: explica cada pantalla, festeja los cobros, avisa la mora y propone el paso siguiente.
// Es el mismo avatar de "De Cero a Estratégico". Expresiones: feliz, risa, sorpresa, pensando (img/avatar/*.png).

const Mili = (() => {
  const MOODS = ["feliz", "risa", "sorpresa", "pensando"];
  const PREF_KEY = "cartera:mili"; // "on" | "quiet"
  const POS_KEY = "cartera:mili-pos"; // { side, bottom }
  const SEEN_KEY = "cartera:mili-seen";
  const TOUR_KEY = "cartera:mili-tour";
  const NOMBRES = {};
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  let pref = store.get(PREF_KEY, "on");
  let pos = store.get(POS_KEY, { side: "right", bottom: 18 });
  let seen = {};
  try { seen = JSON.parse(sessionStorage.getItem(SEEN_KEY) || "{}"); } catch (e) {}

  const root = document.createElement("div");
  root.className = "mili-widget entering";
  root.innerHTML = `
    <div class="mili-bubble" role="status" aria-live="polite"><p></p><div class="mili-actions"></div><button class="mili-x" aria-label="Cerrar mensaje">×</button></div>
    <div class="mili-menu" hidden></div>
    <button class="mili-face" aria-label="Hablar con Mili" aria-expanded="false">
      <span class="mili-tilt">${MOODS.map((m) => `<img src="img/avatar/${m}.png" alt="" data-mood="${m}" draggable="false" />`).join("")}</span>
    </button>`;
  root.hidden = true; // aparece recién cuando hay una pantalla de la app (no en el ingreso)
  document.body.appendChild(root);

  const $bubble = root.querySelector(".mili-bubble");
  const $text = $bubble.querySelector("p");
  const $actions = $bubble.querySelector(".mili-actions");
  const $menu = root.querySelector(".mili-menu");
  const $face = root.querySelector(".mili-face");
  const $tilt = root.querySelector(".mili-tilt");
  let current = "feliz";
  let hideTimer, moodTimer, typeTimer, flapTimer, homeTimer;
  let away = false; // está "de viaje" sobre algún elemento
  let flewAt = 0;
  let tour = null;
  let busyUntil = 0; // después de festejar algo, no la pisamos con el consejo de la pantalla nueva

  const nombre = () => (db.user && NOMBRES[(db.user.email || "").toLowerCase()]) || "";

  // ── Posición base (arrastrable) ──
  function applyPos() {
    root.style.bottom = pos.bottom + "px";
    root.style.left = pos.side === "left" ? "18px" : "auto";
    root.style.right = pos.side === "right" ? "18px" : "auto";
    root.classList.toggle("on-left", pos.side === "left");
  }
  applyPos();

  // ── Expresiones ──
  function mood(m) {
    current = m;
    root.querySelectorAll(".mili-face img").forEach((img) => img.classList.toggle("on", img.dataset.mood === m));
  }

  function anim(name) {
    if (reduced) return;
    $face.classList.remove("hop", "shake", "spin", "wave");
    void $face.offsetWidth; // reinicia la animación
    $face.classList.add(name);
  }

  // Mueve la "boca" mientras escribe: alterna la expresión con otra parecida
  function startTalking(m) {
    stopTalking();
    if (reduced) return;
    const alt = m === "risa" ? "feliz" : m === "sorpresa" ? "feliz" : "risa";
    let open = false;
    root.classList.add("talking");
    flapTimer = setInterval(() => {
      open = !open;
      root.querySelectorAll(".mili-face img").forEach((img) => img.classList.toggle("on", img.dataset.mood === (open ? alt : m)));
    }, 150);
  }

  function stopTalking() {
    clearInterval(flapTimer);
    root.classList.remove("talking");
    mood(current);
  }

  // ── Globo de diálogo ──
  function say(text, m = "feliz", ms = 5500, actions = []) {
    mood(m);
    anim(m === "sorpresa" ? "shake" : "hop");
    clearTimeout(moodTimer);
    moodTimer = setTimeout(() => !tour && mood("feliz"), ms + 600);
    if (pref === "quiet" && !actions.length) return;
    closeMenu();
    clearTimeout(hideTimer);
    clearTimeout(typeTimer);
    $actions.innerHTML = actions.map((a, i) => `<button data-act="${i}" class="${i ? "ghost" : ""}">${a.label}</button>`).join("");
    $actions.onclick = (e) => {
      const b = e.target.closest("[data-act]");
      if (b) actions[Number(b.dataset.act)].run();
    };
    $bubble.classList.add("show");
    placeBubble();

    // Escribe letra por letra
    const plain = text.replace(/<[^>]+>/g, "");
    const chars = Array.from(plain); // por letra real, así los emojis no se cortan a la mitad
    if (reduced) {
      $text.innerHTML = text;
    } else {
      let i = 0;
      startTalking(m);
      const step = () => {
        i += 2;
        $text.textContent = chars.slice(0, i).join("");
        if (i < chars.length) typeTimer = setTimeout(step, 22);
        else { $text.innerHTML = text; stopTalking(); }
      };
      step();
    }
    if (ms) hideTimer = setTimeout(hideBubble, ms + plain.length * 11);
  }

  function hideBubble() {
    $bubble.classList.remove("show");
    clearTimeout(typeTimer);
    stopTalking();
  }

  // Acomoda el globo según dónde esté la cara: abajo si está arriba, a la derecha si no entra a la izquierda
  function placeBubble() {
    const r = $face.getBoundingClientRect();
    const w = Math.min(310, innerWidth - 36);
    root.classList.toggle("bubble-below", r.top < 240);
    root.classList.toggle("bubble-start", pos.side === "left" || r.right - w < 8);
  }

  // Un consejo por pantalla y por sesión, para no repetir
  function once(key) {
    if (seen[key]) return false;
    seen[key] = 1;
    try { sessionStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) {}
    return true;
  }

  // ── Viajar hasta un elemento de la página ──
  function flyTo(el, { offsetY = 0 } = {}) {
    if (!el || reduced) return;
    const r = el.getBoundingClientRect();
    const f = $face.getBoundingClientRect();
    const baseX = f.left + f.width / 2 - currentShift.x;
    const baseY = f.top + f.height / 2 - currentShift.y;
    const x = Math.min(Math.max(r.right - 30, 60), innerWidth - 60);
    const y = Math.min(Math.max(r.top + 30 + offsetY, 110), innerHeight - 60);
    shift(x - baseX, y - baseY);
    away = true;
    flewAt = Date.now();
    setTimeout(placeBubble, 650);
  }

  const currentShift = { x: 0, y: 0 };
  function shift(x, y) {
    currentShift.x = x;
    currentShift.y = y;
    root.style.transform = x || y ? `translate(${x}px, ${y}px)` : "";
  }

  function goHome() {
    away = false;
    shift(0, 0);
    setTimeout(placeBubble, 650);
  }

  function homeLater(ms) {
    clearTimeout(homeTimer);
    homeTimer = setTimeout(() => !tour && goHome(), ms);
  }

  // Si la persona se desplaza, vuelve a su lugar (salvo cuando el desplazamiento lo hizo Mili)
  let autoScrolling = false;
  addEventListener("scroll", () => {
    if (away && !tour && !autoScrolling && Date.now() - flewAt > 800) { hideBubble(); goHome(); }
  }, { passive: true });

  // Lleva la página hasta un elemento (sin scroll suave: el movimiento lo pone el vuelo de Mili)
  function scrollToEl(el, done) {
    autoScrolling = true;
    el.scrollIntoView({ behavior: "instant", block: "center" });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setTimeout(() => (autoScrolling = false), 200);
      done();
    }));
  }

  // Viaja a un elemento, dice algo y vuelve sola
  function point(el, text, m = "feliz", ms = 6000, actions = []) {
    if (el) {
      flyTo(el);
      setTimeout(() => say(text, m, ms, actions), reduced ? 0 : 550);
      if (ms) homeLater(ms + 2500);
    } else {
      say(text, m, ms, actions);
    }
  }

  // ── Confeti ──
  function confetti() {
    if (reduced) return;
    const f = $face.getBoundingClientRect();
    const colors = ["#2a78d6", "#1baf7a", "#eda100", "#e87ba4", "#6250d6", "#eb6834"];
    for (let i = 0; i < 26; i++) {
      const p = document.createElement("i");
      p.className = "mili-confetti";
      const a = Math.random() * Math.PI * 2;
      const d = 60 + Math.random() * 90;
      p.style.cssText = `left:${f.left + f.width / 2}px;top:${f.top + f.height / 2}px;background:${colors[i % colors.length]};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 60}px;--r:${Math.random() * 720 - 360}deg`;
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 1100);
    }
  }

  // ── Mira hacia el puntero ──
  let tiltFrame = null;
  if (!reduced && matchMedia("(pointer: fine)").matches) {
    addEventListener("pointermove", (e) => {
      if (tiltFrame) return;
      tiltFrame = requestAnimationFrame(() => {
        tiltFrame = null;
        const f = $face.getBoundingClientRect();
        const dx = e.clientX - (f.left + f.width / 2);
        const dy = e.clientY - (f.top + f.height / 2);
        const ry = Math.max(-16, Math.min(16, dx / 30));
        const rx = Math.max(-12, Math.min(12, -dy / 30));
        $tilt.style.transform = `rotateY(${ry}deg) rotateX(${rx}deg)`;
      });
    });
  }

  // ── Arrastrar y cosquillas ──
  let drag = null;
  let pokes = [];
  $face.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: false };
    $face.setPointerCapture(e.pointerId);
  });
  $face.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 8) return;
    drag.moved = true;
    root.classList.add("dragging");
    hideBubble();
    closeMenu();
    shift(currentShift.x + dx, currentShift.y + dy);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  $face.addEventListener("pointerup", () => {
    if (!drag) return;
    const wasDrag = drag.moved;
    drag = null;
    root.classList.remove("dragging");
    if (!wasDrag) return onFaceClick();
    // Se pega al costado más cercano
    const r = $face.getBoundingClientRect();
    pos = {
      side: r.left + r.width / 2 < innerWidth / 2 ? "left" : "right",
      bottom: Math.round(Math.min(Math.max(innerHeight - r.bottom, 12), innerHeight - 200)),
    };
    store.set(POS_KEY, pos);
    root.classList.add("snapping");
    shift(0, 0);
    applyPos();
    away = false;
    setTimeout(() => root.classList.remove("snapping"), 400);
    say("¡Me quedo acá! 😄", "risa", 1800);
  });

  function onFaceClick() {
    const now = Date.now();
    pokes = pokes.filter((t) => now - t < 1200).concat(now);
    if (pokes.length >= 3) {
      pokes = [];
      anim("spin");
      confetti();
      return say(["¡Ey, me hacés cosquillas! 😂", "¡Jajaja, pará! 🙈", "¡Ok, ok, estoy atenta a los cobros! 😆"][Math.floor(Math.random() * 3)], "risa", 2500);
    }
    $menu.hidden ? openMenu() : (closeMenu(), mood("feliz"));
  }

  // ── Menú rápido ──
  function menuItems() {
    const enMora = analizarTodos().filter((r) => r.situacion === "mora").length;
    return [
      ["buscar", "🔍 Buscar préstamo o cliente"],
      ["#/salud", "♥ ¿Cómo va el negocio?"],
      ["help", "💡 Explicame esta pantalla"],
      ["#/cobros/nuevo", "💵 Registrar un cobro"],
      ["#/prestamos/nuevo", "🤝 Cargar un préstamo"],
      ["#/clientes/nuevo", "👤 Cargar un cliente"],
      ["mora", enMora ? `⚠️ Ver la mora (${enMora})` : "✅ ¿Hay alguien atrasado?"],
      ...(REMOTE ? [["#/clave", "🔑 Crear mi contraseña"]] : []),
      ["tour", "✨ Mostrame la app"],
      ["quiet", pref === "quiet" ? "🔔 Volver a hablarme" : "🔕 Silenciar mensajes"],
    ];
  }

  function openMenu() {
    hideBubble();
    const n = nombre();
    $menu.innerHTML = `<b>${n ? `¿En qué te ayudo, ${esc(n)}?` : "¿En qué te ayudo?"}</b>` +
      menuItems().map(([href, label]) => `<button data-go="${href}">${label}</button>`).join("");
    $menu.hidden = false;
    $face.setAttribute("aria-expanded", "true");
    mood("pensando");
    anim("hop");
    placeBubble();
  }

  function closeMenu() {
    $menu.hidden = true;
    $face.setAttribute("aria-expanded", "false");
  }

  $face.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFaceClick(); }
  });
  $bubble.querySelector(".mili-x").addEventListener("click", () => {
    hideBubble();
    if (tour) endTour();
  });
  $menu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (!b) return;
    const go = b.dataset.go;
    closeMenu();
    if (go === "quiet") {
      pref = pref === "quiet" ? "on" : "quiet";
      store.set(PREF_KEY, pref);
      pref === "on" ? say("¡Acá estoy de nuevo! 💙", "risa") : mood("feliz");
    } else if (go === "tour") {
      goTo("#/", startTour);
    } else if (go === "buscar") {
      typeof Buscar !== "undefined" && Buscar.abrir();
    } else if (go === "help") {
      tip(parseHash().parts, true);
    } else if (go === "mora") {
      state.filtro = "mora";
      goTo("#/prestamos", () => {
        const n = analizarTodos().filter((r) => r.situacion === "mora").length;
        point(document.querySelector(".page .card"), n ? `Estos son los ${n} préstamos atrasados. Tocá uno para ver cuánto debe y registrar el cobro.` : "¡Nadie está atrasado! 🎉", n ? "pensando" : "risa");
      });
    } else {
      location.hash = go;
    }
  });
  document.addEventListener("click", (e) => {
    if (!root.contains(e.target)) closeMenu();
  });

  // Navega y, cuando la pantalla nueva ya está dibujada, sigue
  function goTo(hash, then) {
    if (location.hash === hash || (hash === "#/" && !location.hash)) return render(), then && setTimeout(then, 100);
    location.hash = hash;
    if (then) setTimeout(then, 450);
  }

  // ── Recorrido guiado por el tablero ──
  const TOUR = [
    [".hero .card", "Arriba está la <b>ganancia del mes</b>: el interés que cobramos. Te dice si subió o bajó contra el mes pasado.", "feliz"],
    [".kpis", "<b>Capital en la calle</b> es la plata prestada que todavía no volvió. <b>Rentabilidad</b> es cuánto ganamos sobre esa plata.", "pensando"],
    ["#dash-cobrar", "Esta es tu <b>agenda de cobros</b> del mes: quién paga, cuándo y cuánto.", "feliz"],
    ["#dash-mora", "Acá aparece quien está <b>en mora</b>, con los días de atraso. Yo también te aviso 😉", "sorpresa"],
    ['.page-head a[href="#/prestamos/nuevo"]', "Para prestar plata: primero cargás al cliente y después el préstamo, acá.", "feliz"],
    ['.page-head a[href="#/cobros/nuevo"]', "Y <b>cada plata que entra</b> se carga como cobro. Así la ganancia sale exacta.", "risa"],
    [null, "¡Eso es todo! Cuando me necesites, tocame. Y si te molesto, arrastrame a otro costado 💙", "risa"],
  ];

  function startTour() {
    tour = { i: 0 };
    store.set(TOUR_KEY, 1);
    tourStep();
  }

  function tourStep() {
    if (!tour) return;
    let step = TOUR[tour.i];
    // Si una parte no está en pantalla (por ejemplo, el tablero vacío), la salteamos
    while (step && step[0] && !document.querySelector(step[0])) step = TOUR[++tour.i];
    if (!step) return endTour();
    const [sel, text, m] = step;
    const el = sel && document.querySelector(sel);
    const last = tour.i === TOUR.length - 1;
    const next = { label: last ? "¡Listo!" : "Siguiente →", run: () => { tour.i++; last ? endTour() : tourStep(); } };
    const skip = { label: "Saltear", run: endTour };
    document.querySelectorAll(".mili-spot").forEach((x) => x !== el && x.classList.remove("mili-spot"));
    if (el) {
      el.classList.add("mili-spot");
      scrollToEl(el, () => { flyTo(el); setTimeout(() => say(text, m, 0, [next, skip]), 450); });
    } else {
      goHome();
      setTimeout(() => { say(text, m, 0, [next]); confetti(); }, 500);
    }
  }

  function endTour() {
    tour = null;
    document.querySelectorAll(".mili-spot").forEach((x) => x.classList.remove("mili-spot"));
    hideBubble();
    goHome();
    mood("feliz");
  }

  // ── Consejos de cada pantalla ──
  // force = true cuando la persona pide ayuda desde el menú (aunque ya lo haya visto)
  function tip(parts, force = false) {
    const [p0, p1, p2] = parts;
    const show = (key, fn) => (force || once(key)) && setTimeout(fn, force ? 0 : 700);
    const $ = (s) => document.querySelector(s);

    if (!p0) {
      if (!db.data.prestamos.length) {
        return show("vacio", () => say(`¡Hola${nombre() ? ", " + esc(nombre()) : ""}! 👋 Soy Mili y te ayudo con la cartera. Empecemos: cargá tu primer cliente.`, "risa", 0, [
          { label: "Cargar cliente", run: () => (location.hash = "#/clientes/nuevo") },
          { label: "Después", run: hideBubble },
        ]));
      }
      if (!force && !store.get(TOUR_KEY, 0) && once("tour-oferta")) {
        return setTimeout(() => {
          anim("wave");
          say(`¡Hola${nombre() ? ", " + esc(nombre()) : ""}! Soy Mili 👋 ¿Te muestro el tablero en 30 segundos?`, "risa", 0, [
            { label: "¡Dale!", run: startTour },
            { label: "Ahora no", run: () => { store.set(TOUR_KEY, 1); say("¡Listo! Si me necesitás, tocame 💙", "feliz", 3000); } },
          ]);
        }, 900);
      }
      return show("home", () => {
        const hoy = today();
        const pronto = vencimientosDelMes(db.data, monthOf(hoy)).concat(vencimientosDelMes(db.data, addMonthKey(monthOf(hoy), 1)))
          .filter((v) => v.vence <= addDays(hoy, 2));
        const mora = analizarTodos().filter((r) => r.situacion === "mora");
        const partes = [];
        if (pronto.length) partes.push(`entre hoy y pasado mañana vencen <b>${pronto.length}</b> cobro${pronto.length === 1 ? "" : "s"} por ${money(sum(pronto, "monto"))}`);
        if (mora.length) partes.push(`hay <b>${mora.length}</b> préstamo${mora.length === 1 ? "" : "s"} en mora`);
        const hola = `¡Hola${nombre() ? ", " + esc(nombre()) : ""}!`;
        // Mi cara es el semáforo: me río si vamos bien, pienso si hay que mirar algo, me sorprendo si hay que actuar
        const salud = typeof calcularSalud === "function" ? calcularSalud() : null;
        const cara = salud ? MOOD_NIVEL[salud.general] : mora.length ? "pensando" : "feliz";
        const veredicto = salud && salud.general !== "gris" ? ` <b>${NIVELES[salud.general].frase}.</b>` : "";
        const verSalud = { label: "¿Cómo vamos?", run: () => { hideBubble(); location.hash = "#/salud"; } };
        if (!partes.length) return say(`${hola}${veredicto} Por ahora no hay nada urgente ✅`, cara, 0, [verSalud, { label: "Gracias", run: hideBubble }]);
        say(`${hola}${veredicto} Te cuento: ${partes.join(" y ")}.`, cara, 0, [
          mora.length
            ? { label: "Ver la mora", run: () => { state.filtro = "mora"; hideBubble(); location.hash = "#/prestamos"; } }
            : { label: "Ver la agenda", run: () => { hideBubble(); const c = $("#dash-cobrar"); c && scrollToEl(c, () => flyTo(c)); homeLater(4000); } },
          verSalud,
        ]);
      });
    }

    if (p0 === "clientes" && !p1)
      return show("clientes", () => point($('.page-head a[href="#/clientes/nuevo"]'), "Acá están todas las personas. La <b>puntualidad</b> te dice qué tan a tiempo paga cada una. Para sumar a alguien, tocá <b>+ Cliente</b>.", "feliz"));
    if (p0 === "clientes" && (p1 === "nuevo" || p2 === "editar"))
      return show("cliente-form", () => point($("#f-nombre"), "Solo el <b>nombre</b> es obligatorio, pero el DNI, el teléfono y una referencia te salvan si después hay que buscarlo 😉", "pensando", 7000));
    if (p0 === "clientes" && p1) {
      const tiene = db.data.prestamos.some((p) => p.cliente_id === p1);
      return show("cliente-" + (tiene ? "con" : "sin"), () => point($('.page-head a[href^="#/prestamos/nuevo"]'), tiene ? "Acá ves todo su historial: cuánto le prestamos, cuánto nos dejó y si paga a tiempo." : "Todavía no tiene préstamos. ¿Le cargamos uno? Tocá <b>+ Préstamo</b>.", "feliz"));
    }

    if (p0 === "prestamos" && !p1) {
      const n = analizarTodos().filter((r) => r.situacion === "mora").length;
      return show("prestamos", () => point($(".seg"), n ? `Ojo: hay <b>${n}</b> en mora. Tocá <b>En mora</b> para verlos.` : "Filtrá por activos, en mora o cancelados. Tocá cualquiera para ver su ficha.", n ? "sorpresa" : "feliz"));
    }
    if (p0 === "prestamos" && p1 === "nuevo") {
      watchModalidad();
      return show("prestamo-form", () => point($("#modalidad"), "Elegí la modalidad. <b>Mensual</b>: 30 % y devuelve todo al mes. <b>Semanal</b>: 32 % en cuotas fijas. Abajo te hago la cuenta 🧮", "pensando", 8000));
    }
    if (p0 === "prestamos" && p1) {
      const p = db.data.prestamos.find((x) => x.id === p1);
      if (!p) return;
      const r = analizar(p, db.data.pagos);
      if (r.situacion === "mora")
        return (force || once("mora-" + p1)) && setTimeout(() => point($(".page > .row"), `Está atrasado <b>${r.diasAtraso} días</b> y debe ${money(r.montoVencido)}. Cuando pague, registralo acá.`, "sorpresa", 8000), force ? 0 : 700);
      if (r.activo && p.modalidad === "mensual")
        return show("detalle-mensual", () => point($('[data-act="renovar"]'), "Si paga <b>solo el interés</b>, tocá <b>Renovar</b>: sigue con el mismo capital un mes más. Si devuelve todo, <b>Cancelar</b>.", "pensando", 8000));
      if (r.activo)
        return show("detalle-semanal", () => point($('[data-act="cuota"]'), "Cada semana, cuando paga, tocá <b>Cobrar cuota</b> y listo. La cuota queda marcada como pagada ✓", "feliz", 7000));
      return;
    }

    if (p0 === "cobros" && p1)
      return show("cobro-form", () => point($("#f-prestamo"), "Elegí el préstamo y qué paga. Yo separo sola cuánto es <b>ganancia</b> y cuánto es <b>capital</b> 💡", "pensando", 7000));
    if (p0 === "cobros")
      return show("cobros", () => point($(".kpis"), "Acá está toda la plata que entró en el mes, separada en ganancia y capital.", "feliz"));
    if (p0 === "salud")
      return show("salud", () => point($(".salud-hero"), "Acá te explico cómo va el negocio. Mi cara te dice el estado: me río si vamos bien, pienso si hay que mirar algo y me sorprendo si hay que actuar 😉", "feliz", 8000));
    if (p0 === "datos")
      return show("datos", () => point($(".card .row"), "Desde acá bajás todo a planilla para Excel o Google Sheets. Viene bien como respaldo una vez por mes 📁", "feliz"));
  }

  // En el formulario de préstamo, explica la modalidad elegida
  function watchModalidad() {
    const seg = document.getElementById("modalidad");
    if (!seg) return;
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-m]");
      if (!b) return;
      const prev = document.getElementById("preview");
      setTimeout(() => point(prev, b.dataset.m === "semanal"
        ? "Semanal: con $ 500.000 son <b>4 cuotas de 165.000</b>, y con 800.000, <b>6 de 176.000</b>. Si hace falta, cambiá el valor de la cuota."
        : "Mensual: al mes devuelve capital + 30 %. Si solo paga el interés, después lo <b>renovás</b>.", "pensando", 7000), 150);
    });
  }

  // ── Reacciones a la navegación ──
  function onRoute(parts) {
    if (root.hidden) {
      root.hidden = false;
      requestAnimationFrame(() => setTimeout(() => root.classList.remove("entering"), 50));
    }
    if (tour && parts[0]) endTour();
    if (away && !tour) goHome();
    if (Date.now() < busyUntil) return;
    tip(parts);
  }

  // ── Reacciones a lo que se carga ──
  function react(kind, d = {}) {
    busyUntil = Date.now() + 7000;
    const later = (fn) => setTimeout(fn, 500);
    if (kind === "cliente")
      later(() => say(`¡${esc(d.nombre)} ya está cargada/o! ¿Le cargamos el préstamo?`, "risa", 0, [
        { label: "Cargar préstamo", run: () => { hideBubble(); location.hash = "#/prestamos/nuevo?cliente=" + d.id; } },
        { label: "Después", run: hideBubble },
      ]));
    else if (kind === "prestamo")
      later(() => { confetti(); say(`¡Préstamo cargado! Si paga todo, nos deja ${money(d.ganancia)} de ganancia. Te aviso en el tablero cuando venza 📅`, "risa", 6000); });
    else if (kind === "cobro")
      later(() => { confetti(); say(`¡Entraron ${money(d.monto)}! 💸 De eso, ${money(d.interes)} es ganancia.`, "risa", 5000); });
    else if (kind === "renovacion")
      later(() => say(`Renovado ✓ Sigue un mes más, ahora vence el <b>${fmtDate(d.vence)}</b>.`, "feliz", 5000));
    else if (kind === "cancelado")
      later(() => { confetti(); anim("spin"); say("¡Préstamo cancelado completo! 🎉 Volvió todo el capital con su ganancia.", "risa", 5500); });
    else if (kind === "incobrable")
      later(() => say("Lo marqué como incobrable. Sale del capital en la calle y queda como pérdida. Si algún día paga, lo reactivás 🙏", "sorpresa", 6500));
  }

  // En la pantalla de ingreso no aparece
  function hide() {
    root.hidden = true;
    hideBubble();
  }

  mood("feliz");
  return { say, react, onRoute, hide, startTour };
})();
