// Búsqueda rápida global: se abre con la lupita, Ctrl/⌘+K o "/".
// Busca préstamos (por código o cliente) y clientes (nombre, DNI, teléfono), y ofrece accesos rápidos.

const Buscar = (() => {
  const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  let root = null;
  let items = []; // [{ href, html, extra? }]
  let sel = 0;

  function accesos() {
    const A = analizarTodos();
    const hoy = today();
    const mora = A.filter((r) => r.situacion === "mora").length;
    const semana = vencimientosDelMes(db.data, monthOf(hoy))
      .concat(vencimientosDelMes(db.data, addMonthKey(monthOf(hoy), 1)))
      .filter((v) => v.vence <= addDays(hoy, 7));
    return [
      { href: "#/cobros/nuevo", icon: "💵", title: "Registrar un cobro", sub: "Entrada de dinero de un préstamo" },
      { href: "#/prestamos/nuevo", icon: "🤝", title: "Nuevo préstamo", sub: "Cargar una entrega de dinero" },
      { href: "#/clientes/nuevo", icon: "👤", title: "Nuevo cliente", sub: "Datos del solicitante" },
      { href: "mora", icon: "⚠️", title: "Préstamos en mora", sub: mora ? `${mora} atrasado${mora === 1 ? "" : "s"}` : "Nadie atrasado" },
      { href: "semana", icon: "📅", title: "Vencen esta semana", sub: semana.length ? `${semana.length} cobro${semana.length === 1 ? "" : "s"} · ${money(sum(semana, "monto"))}` : "Nada en los próximos 7 días" },
      { href: "#/cobros", icon: "↓", title: "Cobros del mes", sub: "Toda la plata que entró" },
    ].map((a) => ({
      href: a.href,
      html: `<span class="qs-ico">${a.icon}</span><span class="qs-main"><b>${a.title}</b><small>${esc(a.sub)}</small></span>`,
    }));
  }

  function resultados(q) {
    const t = sinTildes(q.trim());
    const num = t.replace(/^p-?/, "").replace(/^0+/, "");
    const out = [];
    const prestamos = analizarTodos()
      .filter((r) => {
        const c = cliente(r.p.cliente_id);
        return (/^\d+$/.test(num) && String(r.p.numero) === num) || sinTildes(codigo(r.p)).includes(t) || sinTildes(c.nombre).includes(t);
      })
      .sort((a, b) => (b.activo - a.activo) || (b.p.numero || 0) - (a.p.numero || 0))
      .slice(0, 6);
    if (prestamos.length) out.push({ head: "Préstamos" });
    for (const r of prestamos) {
      const c = cliente(r.p.cliente_id);
      out.push({
        href: "#/prestamos/" + r.p.id,
        html: `<span class="qs-ico">${codeTag(r.p) || "◈"}</span><span class="qs-main"><b>${esc(c.nombre)}</b><small>${esc(prestamoDesc(r.p))}${r.activo ? ` · saldo ${money(r.saldo)}` : ""}</small></span>${pill(r.situacion, r.situacion === "mora" ? `${r.diasAtraso} d` : "")}`,
        extra: r.activo ? { href: "#/cobros/nuevo?prestamo=" + r.p.id, label: "Cobrar" } : null,
      });
    }
    // DNI y teléfono se comparan solo por los números, y desde 3 dígitos (así "8" no trae a todos)
    const dig = t.replace(/\D/g, "");
    const clientes = db.data.clientes
      .filter((c) => sinTildes(c.nombre).includes(t) || (dig.length >= 3 && [c.dni, c.telefono].some((v) => String(v || "").replace(/\D/g, "").includes(dig))))
      .slice(0, 5);
    if (clientes.length) out.push({ head: "Clientes" });
    for (const c of clientes) {
      const n = db.data.prestamos.filter((p) => p.cliente_id === c.id).length;
      out.push({
        href: "#/clientes/" + c.id,
        html: `<span class="qs-ico">👤</span><span class="qs-main"><b>${esc(c.nombre)}</b><small>${esc([c.telefono, c.dni && "DNI " + c.dni].filter(Boolean).join(" · ") || "Sin datos de contacto")} · ${n} préstamo${n === 1 ? "" : "s"}</small></span>`,
        extra: { href: "#/prestamos/nuevo?cliente=" + c.id, label: "+ Préstamo" },
      });
    }
    return out;
  }

  function pintar() {
    const q = root.querySelector("input").value;
    const lista = q.trim() ? resultados(q) : [{ head: "Accesos rápidos" }, ...accesos()];
    items = lista.filter((x) => !x.head);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    let i = -1;
    root.querySelector(".qs-list").innerHTML = lista.length
      ? lista
          .map((x) =>
            x.head
              ? `<div class="qs-head">${x.head}</div>`
              : `<div class="qs-item${++i === sel ? " on" : ""}" data-i="${i}" role="option">
                   <a href="${x.href}" data-go="${x.href}">${x.html}</a>
                   ${x.extra ? `<a class="btn sm ghost qs-extra" href="${x.extra.href}" data-go="${x.extra.href}">${x.extra.label}</a>` : ""}
                 </div>`
          )
          .join("")
      : `<div class="qs-empty">No encontramos nada con “${esc(q)}”.<br><small>Probá con el código (ej. 8 o P-008), el nombre, el DNI o el teléfono.</small></div>`;
    const on = root.querySelector(".qs-item.on");
    if (on) on.scrollIntoView({ block: "nearest" });
  }

  function ir(href) {
    cerrar();
    if (href === "mora") {
      state.filtro = "mora";
      state.buscarP = "";
      location.hash === "#/prestamos" ? render() : (location.hash = "#/prestamos");
    } else if (href === "semana") {
      const mostrar = () => {
        const c = document.getElementById("dash-cobrar");
        if (c) c.scrollIntoView({ behavior: "smooth", block: "start" });
      };
      if (location.hash === "#/" || !location.hash) mostrar();
      else { location.hash = "#/"; setTimeout(mostrar, 300); }
    } else {
      location.hash === href ? render() : (location.hash = href);
    }
  }

  function abrir() {
    if (REMOTE && !db.user) return;
    if (root) return root.querySelector("input").focus();
    root = document.createElement("div");
    root.className = "qs";
    root.innerHTML = `<div class="qs-box" role="dialog" aria-label="Búsqueda rápida">
        <div class="qs-bar"><span aria-hidden="true">🔍</span>
          <input type="search" placeholder="Código (P-008), cliente, DNI o teléfono" autocomplete="off" enterkeyhint="go" />
          <button class="icon-btn" data-close aria-label="Cerrar"><span class="k-desk">Esc</span><span class="k-mob">Cerrar</span></button></div>
        <div class="qs-list" role="listbox"></div>
        <div class="qs-foot">↑↓ para moverte · Enter para abrir · Esc para cerrar</div>
      </div>`;
    document.body.appendChild(root);
    document.body.classList.add("qs-open");
    const input = root.querySelector("input");
    sel = 0;
    pintar();
    input.focus();
    input.addEventListener("input", () => { sel = 0; pintar(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); pintar(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); pintar(); }
      else if (e.key === "Enter") { e.preventDefault(); if (items[sel]) ir(items[sel].href); }
    });
    root.addEventListener("click", (e) => {
      const go = e.target.closest("[data-go]");
      if (go) { e.preventDefault(); e.stopPropagation(); return ir(go.dataset.go); }
      if (e.target === root || e.target.closest("[data-close]")) cerrar();
    });
  }

  function cerrar() {
    if (!root) return;
    root.remove();
    root = null;
    document.body.classList.remove("qs-open");
  }

  // Atajos de teclado: Ctrl/⌘+K desde cualquier lado, "/" cuando no se está escribiendo
  document.addEventListener("keydown", (e) => {
    const escribiendo = /input|textarea|select/i.test(document.activeElement && document.activeElement.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); root ? cerrar() : abrir(); }
    else if (e.key === "/" && !escribiendo && !root) { e.preventDefault(); abrir(); }
    else if (e.key === "Escape" && root) cerrar();
  });

  return { abrir, cerrar };
})();
