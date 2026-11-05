// Gráficos SVG livianos (columnas y línea) con tooltip al pasar el mouse.
// Cada punto: { key, label, value, tip: { title, value, sub } }. "sel" marca el mes elegido, que lleva etiqueta directa.

const Charts = (() => {
  let W = 640;
  const H = 230;
  const M = { t: 22, r: 12, b: 28, l: 66 };
  const escA = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  function frame(points, max, fmtTick) {
    const ih = H - M.t - M.b;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
    let g = "";
    for (const t of ticks) {
      const y = M.t + ih - (t / max) * ih;
      g += `<line class="${t === 0 ? "base" : "grid-line"}" x1="${M.l}" x2="${W - M.r}" y1="${y}" y2="${y}"/>`;
      g += `<text x="${M.l - 8}" y="${y + 4}" text-anchor="end">${escA(fmtTick(t))}</text>`;
    }
    const band = (W - M.l - M.r) / points.length;
    points.forEach((p, i) => {
      g += `<text x="${M.l + band * i + band / 2}" y="${H - 8}" text-anchor="middle"${p.sel ? ' class="lbl"' : ""}>${escA(p.label)}</text>`;
    });
    return { g, ih, band, y: (v) => M.t + ih - (v / max) * ih };
  }

  const tipAttrs = (p) =>
    `data-tip-title="${escA(p.tip.title)}" data-tip-value="${escA(p.tip.value)}" data-tip-sub="${escA(p.tip.sub || "")}"`;

  function columns(points, { fmt, fmtTick, w = 640 }) {
    W = w;
    const max = niceMax(Math.max(...points.map((p) => p.value), 0) * 1.1);
    const f = frame(points, max, fmtTick || fmt);
    const bw = Math.min(24, f.band * 0.6);
    let g = f.g;
    points.forEach((p, i) => {
      const cx = M.l + f.band * i + f.band / 2;
      const x = cx - bw / 2;
      const y0 = f.y(0);
      const y1 = f.y(p.value);
      const h = y0 - y1;
      g += `<rect class="hover-band" x="${M.l + f.band * i}" y="${M.t}" width="${f.band}" height="${f.ih}"/>`;
      if (h > 0.5) {
        const r = Math.min(4, h, bw / 2);
        g += `<path class="bar" d="M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + bw - r}Q${x + bw},${y1} ${x + bw},${y1 + r}V${y0}Z"/>`;
      }
      if (p.sel && p.value > 0) g += `<text class="lbl" x="${cx}" y="${y1 - 7}" text-anchor="middle">${escA(fmt(p.value))}</text>`;
      g += `<rect class="hit" x="${M.l + f.band * i}" y="${M.t}" width="${f.band}" height="${f.ih + M.b}" ${tipAttrs(p)}/>`;
    });
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg></div>`;
  }

  function line(points, { fmt, fmtTick, w = 640 }) {
    W = w;
    const vals = points.filter((p) => p.value != null);
    const max = niceMax(Math.max(...vals.map((p) => p.value), 0) * 1.15);
    const f = frame(points, max, fmtTick || fmt);
    const xs = (i) => M.l + f.band * i + f.band / 2;
    let g = f.g;
    const seg = points.map((p, i) => (p.value == null ? null : [xs(i), f.y(p.value)])).filter(Boolean);
    if (seg.length > 1) {
      const d = seg.map((pt, i) => (i ? "L" : "M") + pt[0] + "," + pt[1]).join("");
      g += `<path class="area" d="${d}L${seg[seg.length - 1][0]},${f.y(0)}L${seg[0][0]},${f.y(0)}Z"/>`;
      g += `<path class="line" d="${d}"/>`;
    }
    points.forEach((p, i) => {
      g += `<rect class="hover-band" x="${M.l + f.band * i}" y="${M.t}" width="${f.band}" height="${f.ih}"/>`;
      if (p.value != null) {
        g += `<circle class="dot" cx="${xs(i)}" cy="${f.y(p.value)}" r="${p.sel ? 5 : 4}"/>`;
        if (p.sel) g += `<text class="lbl" x="${xs(i)}" y="${f.y(p.value) - 11}" text-anchor="middle">${escA(fmt(p.value))}</text>`;
      }
      g += `<rect class="hit" x="${M.l + f.band * i}" y="${M.t}" width="${f.band}" height="${f.ih + M.b}" ${tipAttrs(p)}/>`;
    });
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg></div>`;
  }

  // Tooltip compartido: lee los data-tip-* del elemento bajo el mouse.
  function bindTooltips() {
    const tip = document.getElementById("tip");
    let band = null;
    const hide = () => {
      tip.classList.remove("show");
      if (band) band.classList.remove("on");
      band = null;
    };
    document.addEventListener("pointermove", (e) => {
      const t = e.target.closest && e.target.closest("[data-tip-title]");
      if (!t) return hide();
      tip.innerHTML = `<b>${escA(t.dataset.tipTitle)}</b><div class="tv">${escA(t.dataset.tipValue)}</div>${
        t.dataset.tipSub ? `<div class="ts">${escA(t.dataset.tipSub)}</div>` : ""
      }`;
      const prev = t.previousElementSibling;
      let b = prev;
      while (b && !b.classList.contains("hover-band")) b = b.previousElementSibling;
      if (band !== b) {
        if (band) band.classList.remove("on");
        band = b;
        if (band) band.classList.add("on");
      }
      tip.classList.add("show");
      const w = tip.offsetWidth;
      const x = e.clientX + 14 + w > innerWidth ? e.clientX - w - 14 : e.clientX + 14;
      tip.style.left = x + "px";
      tip.style.top = Math.max(8, e.clientY - tip.offsetHeight - 10) + "px";
    });
    document.addEventListener("pointerleave", hide);
    addEventListener("scroll", hide, { passive: true });
  }

  return { columns, line, bindTooltips };
})();
