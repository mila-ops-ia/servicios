// Datos: Supabase si está configurado; si no, modo demo guardado en este navegador.

const CFG = window.CARTERA_CONFIG || {};
const REMOTE = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase);
// Flujo "implicit": el link del mail trae la sesión en la dirección y sirve en cualquier navegador
// (con PKCE solo funcionaba en el mismo navegador donde se pidió, y desde WhatsApp/Gmail fallaba).
const sb = REMOTE ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { flowType: "implicit" } }) : null;

const TABLES = ["clientes", "prestamos", "pagos"];
const NUMERIC = ["capital", "tasa", "cuotas", "monto_cuota", "monto", "interes", "ingreso_mensual", "numero"];
const DEMO_KEY = "cartera:demo";

const normalize = (row) => {
  for (const k of NUMERIC) if (row[k] != null && row[k] !== "") row[k] = Number(row[k]);
  return row;
};
const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2);

const db = {
  data: { clientes: [], prestamos: [], pagos: [] },
  user: null,

  async session() {
    if (!REMOTE) return (this.user = { email: "modo demo" });
    const { data } = await sb.auth.getSession();
    return (this.user = data.session ? data.session.user : null);
  },

  // Con contraseña no se gasta ningún mail (Supabase gratis manda solo 2 por hora).
  async signInPassword(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.user = data.user;
  },

  async setPassword(password) {
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw error;
  },

  async isMember() {
    const { data, error } = await sb.rpc("es_miembro");
    if (error) throw error;
    return data === true;
  },

  async signOut() {
    if (REMOTE) await sb.auth.signOut();
    this.user = null;
  },

  async load() {
    if (REMOTE) {
      const res = await Promise.all(TABLES.map((t) => sb.from(t).select("*").order("created_at")));
      res.forEach((r, i) => {
        if (r.error) throw r.error;
        this.data[TABLES[i]] = r.data.map(normalize);
      });
    } else {
      try {
        const saved = JSON.parse(localStorage.getItem(DEMO_KEY) || "null");
        if (saved) this.data = saved;
        else this.loadSample();
      } catch (e) {}
    }
  },

  saveDemo() {
    try {
      localStorage.setItem(DEMO_KEY, JSON.stringify(this.data));
    } catch (e) {}
  },

  async insert(table, row) {
    let saved;
    if (REMOTE) {
      const { data, error } = await sb.from(table).insert(row).select().single();
      if (error) throw error;
      saved = normalize(data);
    } else {
      saved = normalize({ id: uuid(), created_at: new Date().toISOString(), ...row });
      // En modo demo numeramos los préstamos acá (en Supabase lo hace la base)
      if (table === "prestamos") saved.numero = Math.max(0, ...this.data.prestamos.map((p) => p.numero || 0)) + 1;
    }
    this.data[table].push(saved);
    if (!REMOTE) this.saveDemo();
    return saved;
  },

  async update(table, id, patch) {
    let saved;
    if (REMOTE) {
      const { data, error } = await sb.from(table).update(patch).eq("id", id).select().single();
      if (error) throw error;
      saved = normalize(data);
    }
    const list = this.data[table];
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) list[i] = saved || normalize({ ...list[i], ...patch });
    if (!REMOTE) this.saveDemo();
    return list[i];
  },

  async remove(table, id) {
    if (REMOTE) {
      const { error } = await sb.from(table).delete().eq("id", id);
      if (error) throw error;
    }
    this.data[table] = this.data[table].filter((x) => x.id !== id);
    if (table === "prestamos") this.data.pagos = this.data.pagos.filter((x) => x.prestamo_id !== id);
    if (!REMOTE) this.saveDemo();
  },

  // ── Solo modo demo ──
  clearDemo() {
    this.data = { clientes: [], prestamos: [], pagos: [] };
    this.saveDemo();
  },

  loadSample() {
    const hoy = today();
    const nombres = [
      ["Carla Benítez", "Comerciante", 900000],
      ["Diego Ferreyra", "Albañil", 750000],
      ["Lucía Romero", "Empleada de comercio", 820000],
      ["Martín Acosta", "Remisero", 1100000],
      ["Sofía Giménez", "Peluquera", 680000],
      ["Ramón Ledesma", "Feriante", 950000],
      ["Valeria Ortiz", "Administrativa", 1000000],
      ["Nicolás Paz", "Delivery", 600000],
    ];
    const data = { clientes: [], prestamos: [], pagos: [] };
    const stamp = (f) => f + "T12:00:00.000Z";
    nombres.forEach(([nombre, ocupacion, ingreso], i) => {
      data.clientes.push({
        id: uuid(),
        nombre,
        dni: String(30000000 + i * 1234567).replace(/\B(?=(\d{3})+(?!\d))/g, "."),
        telefono: "11 5" + (100 + i * 37) + "-" + (2000 + i * 311),
        direccion: "",
        ocupacion,
        ingreso_mensual: ingreso,
        referencia: "",
        recomendado_por: i % 3 === 0 ? "Boca en boca" : "",
        notas: "",
        created_at: stamp(addMonths(hoy, -7)),
      });
    });
    const C = data.clientes;
    const prestamo = (cli, modalidad, capital, entregaHace, extra = {}) => {
      const entrega = addDays(hoy, -entregaHace);
      const tasa = MODALIDADES[modalidad].tasa;
      const cuotas = modalidad === "semanal" ? (capital >= 800000 ? 6 : 4) : 1;
      const p = {
        id: uuid(),
        cliente_id: cli.id,
        modalidad,
        capital,
        tasa,
        cuotas,
        monto_cuota: Math.round((capital * (1 + tasa)) / cuotas),
        fecha_entrega: entrega,
        primer_vencimiento: modalidad === "semanal" ? addDays(entrega, 7) : addMonths(entrega, 1),
        estado: "activo",
        notas: "",
        created_at: stamp(entrega),
        ...extra,
      };
      data.prestamos.push(p);
      return p;
    };
    const pago = (p, fecha, monto, interes, tipo) =>
      data.pagos.push({ id: uuid(), prestamo_id: p.id, fecha, monto, interes, capital: monto - interes, tipo, notas: "", created_at: stamp(fecha) });
    const pagarSemanal = (p, cuantas, atraso = 0) => {
      const ratio = (p.monto_cuota * p.cuotas - p.capital) / (p.monto_cuota * p.cuotas);
      for (let k = 0; k < cuantas; k++) {
        const f = addDays(p.primer_vencimiento, 7 * k + atraso);
        if (f <= hoy) pago(p, f, p.monto_cuota, Math.round(p.monto_cuota * ratio), "cuota");
      }
    };
    const renovar = (p, veces, cancelar = false) => {
      for (let k = 0; k < veces; k++) {
        const f = addMonths(p.primer_vencimiento, k);
        if (f <= hoy) pago(p, f, Math.round(p.capital * p.tasa), Math.round(p.capital * p.tasa), "renovacion");
      }
      if (cancelar) {
        const f = addMonths(p.primer_vencimiento, veces);
        const int = Math.round(p.capital * p.tasa);
        pago(p, f, p.capital + int, int, "cancelacion");
        p.estado = "cancelado";
      }
    };

    // Historial de los últimos meses: préstamos cerrados, renovaciones y cartera activa.
    renovar(prestamo(C[0], "mensual", 300000, 200), 3, true);
    renovar(prestamo(C[0], "mensual", 400000, 75), 1);
    const s1 = prestamo(C[1], "semanal", 500000, 170);
    pagarSemanal(s1, 4);
    s1.estado = "cancelado";
    pagarSemanal(prestamo(C[1], "semanal", 800000, 30), 4);
    renovar(prestamo(C[2], "mensual", 200000, 150), 2, true);
    renovar(prestamo(C[2], "mensual", 250000, 50), 1);
    const s2 = prestamo(C[3], "semanal", 800000, 120);
    pagarSemanal(s2, 6, 2);
    s2.estado = "cancelado";
    pagarSemanal(prestamo(C[3], "semanal", 500000, 12), 1);
    renovar(prestamo(C[4], "mensual", 150000, 45), 0);
    pagarSemanal(prestamo(C[5], "semanal", 500000, 40), 2, 3);
    renovar(prestamo(C[6], "mensual", 500000, 95), 2, true);
    renovar(prestamo(C[6], "mensual", 600000, 20), 0);
    const s3 = prestamo(C[7], "semanal", 500000, 90);
    pagarSemanal(s3, 1, 5);
    s3.estado = "incobrable";

    data.prestamos
      .slice()
      .sort((a, b) => a.fecha_entrega.localeCompare(b.fecha_entrega))
      .forEach((p, i) => (p.numero = i + 1));

    this.data = data;
    this.saveDemo();
  },
};
