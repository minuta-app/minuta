/* Minuta — visor portable (HTML/CSS/JS puro, sin dependencias).
   Funciona dentro de la app de Mac (WKWebView), en Windows y Linux (Electron) o en un navegador con datos de ejemplo
   (demo.json). Entrada de datos: window.Minuta.cargar({...}). Lo común viene de piezas de Pieza (cargadas antes en index.html):
   host.js (el puente), i18n.js (idiomas), tema.js (claro/oscuro) y componentes.js (avisos y diálogos accesibles). */
(() => {
  "use strict";

  // ───────────────────────── Estado ─────────────────────────
  const E = {
    notas: [], temas: [], temaId: "cine", sel: null, vista: "puntos", seccion: "reuniones", busqueda: "",
    lateral: true, galeria: false, plataforma: "web", cargado: false, borrar: null, corr: null, correcciones: [], votos: {}, forja: null, votoAbierto: null, menu: false, avisos: null, ajustes: { avisarDeteccion: true, avisarCalendario: true, avisarFin: true, avisarNotas: true, alTocar: "grabar", avisarPrep: true, avisarCompromisos: true, coachVivo: true, avisoMonologo: true },
  };
  const VISTAS = [["puntos", "Resumen"], ["feedback", "Tu desempeño"], ["transcripcion", "Transcripción"]];
  const SECCIONES = [["reuniones", "📋", "Reuniones"], ["agenda", "📅", "Agenda"], ["personas", "👥", "Personas"], ["progreso", "🎯", "Foco"], ["logros", "🏆", "Logros"]];
  const ATAJO = { agenda: 4, progreso: 5, logros: 6, personas: 7 };
  const PREFERENCIAS = ["preferencias", "⚙️", "Preferencias"];

  // ───────────────────────── Categorías de reunión (configurables) ─────────────────────────
  const CATEGORIAS_BASE = [
    { id: "Personal", nombre: "Personal", emoji: "🏡", color: "#a855f7", descripcion: "conversaciones personales", enfoque: "Es una reunión o conversación personal. Da feedback de comunicación general, breve y amable.", dominios: [], palabras: [], apps: [] },
    { id: "Otra", nombre: "Otra", emoji: "💬", color: "#94a3b8", descripcion: "feedback general", enfoque: "Evalúa la comunicación en general: claridad, escucha, preguntas y cierre.", dominios: [], palabras: [], apps: [] },
  ];
  const COLORES_CAT = ["#22c55e", "#f97316", "#a855f7", "#3b82f6", "#ef4444", "#eab308", "#14b8a6", "#ec4899", "#94a3b8"];
  E.categorias = CATEGORIAS_BASE.map((c) => ({ ...c }));
  const categoria = (id) => E.categorias.find((c) => c.id === id) || { id, nombre: id || "Sin tipo", emoji: "•", color: "#94a3b8", descripcion: "" };
  const nombreTipo = (id) => categoria(id).nombre;
  function estiloCategorias() {
    let el = document.getElementById("css-categorias");
    if (!el) { el = document.createElement("style"); el.id = "css-categorias"; document.head.appendChild(el); }
    el.textContent = E.categorias.map((c) => `.t-${CSS.escape(c.id)}{background:${c.color} !important}`).join("\n");
  }

  // ───────────────────────── Puente con el contenedor ─────────────────────────
  // Pieza «host-ui»: {accion, datos} a webkit.messageHandlers.minuta (Mac) o window.minutaEscritorio (Electron); en el navegador
  // responde simular() (más abajo), con copias JSON como la app.
  const host = PiezaHost.crearHost({ nombre: "minuta", global: "Minuta", simular: (accion, datos, ctx) => simular(accion, datos, ctx) });

  // ───────────────────────── Ventana propia ─────────────────────────
  const RAIZ = document.documentElement;
  const VENTANA = !host.esWeb || /ventana/.test(location.hash);
  /** Windows y Linux (Electron): ventana rectangular del sistema, sin la forma recortada de cada universo. */
  const ESCRITORIO = host.esEscritorio;
  if (VENTANA) RAIZ.classList.add("ventana", ESCRITORIO ? "escritorio" : "forma");
  if (ESCRITORIO) RAIZ.classList.add(`so-${host.plataforma}`);
  if (VENTANA && host.esWeb) RAIZ.classList.add("emulada");
  const TITULO_VENTANA = {
    starwars: "Terminal de misión", harrypotter: "Pensadero", senoranillos: "Crónicas de la Tierra Media", marvel: "Archivo S.H.I.E.L.D.",
    rapidoyfurioso: "Garaje de la familia", dragonball: "Bitácora Capsule Corp.", simpsons: "Actas de Springfield", gameofthrones: "Consejo Privado",
    shrek: "Muy, muy lejano", piratas: "Bitácora del capitán", toystory: "El cuarto de Andy", cine: "Función continua",
  };

  /** Borde de pergamino rasgado (determinista, para que no cambie entre aperturas). */
  const rasgado = (() => {
    let semilla = 7;
    const azar = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);
    const pts = [];
    let d = 2;
    const paso = () => (d = Math.max(0, Math.min(6, d + (azar() - 0.5) * 3.2)));
    for (let i = 0; i <= 64; i++) pts.push(`${(i / 64 * 100).toFixed(2)}% ${paso().toFixed(1)}px`);
    for (let i = 1; i <= 48; i++) pts.push(`calc(100% - ${paso().toFixed(1)}px) ${(i / 48 * 100).toFixed(2)}%`);
    for (let i = 63; i >= 0; i--) pts.push(`${(i / 64 * 100).toFixed(2)}% calc(100% - ${paso().toFixed(1)}px)`);
    for (let i = 47; i >= 1; i--) pts.push(`${paso().toFixed(1)}px ${(i / 48 * 100).toFixed(2)}%`);
    return `polygon(${pts.join(", ")})`;
  })();
  RAIZ.style.setProperty("--rasgado", rasgado);

  /** Le dice al contenedor dónde se arrastra la ventana y dónde se cambia su tamaño. */
  let _regionesPend = 0;
  function regiones() {
    if (host.esWeb) return;
    cancelAnimationFrame(_regionesPend);
    _regionesPend = requestAnimationFrame(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; };
      const barra = document.getElementById("barra");
      host.enviar("regiones", {
        arrastre: barra ? [r(barra)] : [],
        excluir: [...document.querySelectorAll("#barra button, #barra input, #barra a")].map(r),
        bordes: RAIZ.classList.contains("pantalla") ? [] : [...document.querySelectorAll("#bordes i")].map((e) => [...r(e), e.dataset.lado]),
      });
    });
  }
  addEventListener("resize", regiones);

  // ───────────────────────── Utilidades ─────────────────────────
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  // ───────────────────────── Universos: solo datos ─────────────────────────
  // Los universos vienen de afuera (catálogo público, propuestas de la comunidad, la IA de la persona) y varias partes de la
  // interfaz los pintan como HTML o CSS. Por eso se limpian al entrar: en los textos (y claves) < > " pasan a ‹ › “ ”, sin `
  // ni caracteres de control, y el estilo solo lleva valores CSS esperados (colores, números, fuentes y patrones conocidos).
  // Así un universo nunca ejecuta nada.
  const COLOR_CSS = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/+-]{1,60}\)|[a-z]{3,20})$/i;
  function limpiarDato(v, prof = 0) {
    if (typeof v === "string") {
      let abre = true; // "cita" → “cita”: se ve igual y no puede cerrar un atributo HTML
      return v.replace(/"/g, () => ((abre = !abre) ? "”" : "“")).replace(/</g, "‹").replace(/>/g, "›").replace(/[`\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
    }
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (typeof v === "boolean" || v == null) return v;
    if (prof > 6) return null;
    if (Array.isArray(v)) return v.slice(0, 200).map((x) => limpiarDato(x, prof + 1));
    if (typeof v === "object") {
      const o = {};
      for (const [k, x] of Object.entries(v)) if (k !== "__proto__" && k !== "constructor" && k !== "prototype") o[limpiarDato(k)] = limpiarDato(x, prof + 1);
      return o;
    }
    return null;
  }
  function limpiarEstilo(e) {
    if (!e || typeof e !== "object") return e;
    const o = { ...e };
    for (const k of ["fondo", "fondo2", "panel", "texto", "suave", "linea", "acento", "acento_texto", "acento2"])
      if (k in o && !(typeof o[k] === "string" && COLOR_CSS.test(o[k].trim()))) delete o[k];
    for (const k of ["radio", "peso"]) if (k in o) { const n = Number(o[k]); if (Number.isFinite(n)) o[k] = Math.max(0, Math.min(k === "peso" ? 1000 : 60, n)); else delete o[k]; }
    if ("fuente" in o && !(typeof o.fuente === "string" && /^[\p{L}\p{N} _-]{1,40}$/u.test(o.fuente))) o.fuente = "ui-rounded";
    if ("modo" in o && o.modo !== "claro") o.modo = "oscuro";
    if ("patron" in o && typeof o.patron !== "string") delete o.patron;
    return o;
  }
  function limpiarUniverso(u) {
    if (!u || typeof u !== "object" || Array.isArray(u)) return null;
    const o = limpiarDato(u);
    o.id = String(o.id ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
    if (!o.id) return null;
    if (o.estilo) o.estilo = limpiarEstilo(o.estilo);
    return o;
  }
  const limpiarUniversos = (lista) => (Array.isArray(lista) ? lista.map(limpiarUniverso).filter(Boolean) : []);
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const mismoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  // ───────────────────────── Idiomas de la interfaz ─────────────────────────
  // El español es el idioma del código. Cada paquete (ui/idiomas/en.json incluido, el resto del catálogo) es
  // { codigo, nombre, textos: { "texto en español": "traducción" } }. Los números se escriben {n} en la clave.
  // Se traduce el DOM ya pintado: solo textos de la app, nunca el contenido de tus notas. Lo hace la pieza «i18n» (valida el
  // paquete: solo texto, los mismos marcadores que la clave); aquí solo se le pasa el idioma que manda la app.
  E.idioma = { codigo: "es", textos: {}, instalados: [{ codigo: "es", nombre: "Español", bandera: "🇪🇸", incluido: true }] };
  /** Zonas con contenido de la persona (notas, transcripción, chat…): sus textos no se traducen. */
  const NO_TRADUCIR = ".notas, .turnos, .gy-chat, .co-veredicto, .co-habito p, .fila-titulo, .pe-ficha h2, .pe-fila b, .ag-lista, .ag-comps, .ag-txt, .pr-respuesta, .env-caja textarea, .cita, h1.nota-titulo, .rv-carta h2, .rv-carta p, .universo .u-nombre, .u-previa";
  /** Donde ni los atributos se traducen (title con el nombre de una nota, por ejemplo). */
  const SIN_ATRIBUTOS = ".notas, .turnos, [data-sin-traducir]";
  const i18n = PiezaI18n.crear({ noTraducir: NO_TRADUCIR });
  let _textosUsados = null;
  /** Pasa a la pieza el idioma de E.idioma (lo manda la app en cargar, o lo carga la vista previa) si cambió. */
  function sincronizarIdioma() {
    const { codigo, textos, palabras, nombre } = E.idioma;
    if (_textosUsados === textos && i18n.idioma === codigo) return;
    _textosUsados = textos;
    i18n.usar(codigo === "es" ? null : { codigo, nombre: nombre || codigo, textos: textos || {}, palabras: palabras || undefined });
  }
  /** Traduce un texto de la interfaz (si no hay traducción, queda en español). */
  function tr(t) { sincronizarIdioma(); return i18n.tr(t); }
  function traducirDOM(raiz) {
    if (!raiz) return;
    sincronizarIdioma();
    if (i18n.idioma === "es") return;
    i18n.traducirDOM(raiz);
    // La pieza no traduce los atributos dentro de una zona de NO_TRADUCIR ni el placeholder de un textarea; en Minuta sí
    // (un botón «Abrir nota» dentro de la agenda, «Escribe aquí…» en el gimnasio). Solo se saltan los de SIN_ATRIBUTOS.
    for (const el of raiz.querySelectorAll("[placeholder],[title],[aria-label]")) {
      if (el.closest(SIN_ATRIBUTOS) || !(el.matches("textarea") || el.closest(NO_TRADUCIR))) continue;
      for (const a of ["placeholder", "title", "aria-label"]) { const v = el.getAttribute(a); if (v) { const x = i18n.tr(v); if (x !== v) el.setAttribute(a, x); } }
    }
  }

  // Pieza «componentes»: avisos en cola (#toast) y el foco y Esc de las ventanas (role="dialog" con aria-modal).
  const ui = PiezaComponentes.crear({ i18n, host, app: "Minuta", cerrar: () => cerrarArriba() });
  /** Un aviso breve: el texto en español (ya armado) se traduce aquí, como el resto de la interfaz. */
  const toast = (texto, o = {}) => ui.aviso(tr(String(texto ?? "")), { ...o, traducido: true });

  // ───────────────────────── Notas ─────────────────────────
  /** Solo el nombre: "Ana (PO, la separación de voces…)" → "Ana" (igual que perfil.limpiar_nombre en Python). */
  function limpiarNombre(t) {
    let b = String(t || "").trim();
    b = b.split("(")[0].trim() || b.replace(/[()]/g, "");
    b = b.split(/\s+[—–-]\s+|[,;:]|\s+\/\s+/)[0].replace(/["“”«»]/g, "").replace(/^[\s'‘’.?¿!¡*_`]+|[\s'‘’.?¿!¡*_`]+$/g, "");
    return b && b.length <= 40 && b.split(/\s+/).length <= 4 && !/\d/.test(b) && !/^(yo|ellos|equipo|persona\s*\d+|desconocid\w*|varios|todos)$/i.test(b) ? b : "";
  }
  /** Participantes del frontmatter: lista JSON (notas nuevas) o el formato antiguo, que se rompía con comas dentro de los nombres. */
  function leerParticipantes(bruto) {
    const t = String(bruto || "").trim();
    let lista;
    try { lista = JSON.parse(t); } catch { lista = t.match(/"(.*?)"(?=\s*,\s*"|\s*\]$)/g)?.map((x) => x.slice(1, -1)) || t.replace(/^\[|\]$/g, "").split(","); }
    const vistos = new Set();
    return (Array.isArray(lista) ? lista : []).map(limpiarNombre).filter((n) => n && !vistos.has(n.toLowerCase()) && vistos.add(n.toLowerCase()));
  }
  function parsearNota(ruta, texto) {
    let fm = {}, cuerpo = texto;
    if (texto.startsWith("---\n")) {
      const fin = texto.indexOf("\n---\n", 4);
      if (fin > 0) {
        texto.slice(4, fin).split("\n").forEach((l) => {
          const i = l.indexOf(":");
          if (i > 0) fm[l.slice(0, i).trim()] = l.slice(i + 1).trim();
        });
        cuerpo = texto.slice(fin + 5);
      }
    }
    const t = cuerpo.split("\n").find((l) => l.startsWith("# "));
    const titulo = t ? t.slice(2).trim() : ruta.split("/").pop().replace(/\.md$/, "");
    const [y, m, d] = (fm.fecha || "").split("-").map(Number);
    const [hh, mm] = (fm.hora || "00:00").split(":").map(Number);
    const fecha = y ? new Date(y, m - 1, d, hh || 0, mm || 0) : new Date();
    const participantes = leerParticipantes(fm.participantes);
    return { ruta, titulo, fecha, tipo: fm.tipo || "", duracion: parseFloat(fm.duracion_min) || 0, participantes, fm, cuerpo, texto };
  }

  function secciones(nota) {
    let cuerpo = nota.cuerpo.replace(/^# .*\n/m, "");
    const sacar = (titulo) => {
      const re = new RegExp(`(^|\\n)## ${titulo}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`);
      const m = cuerpo.match(re);
      if (!m) return "";
      cuerpo = cuerpo.replace(m[0], "\n");
      return m[2];
    };
    const transcripcion = sacar("Transcripción");
    const metricas = sacar("Métricas");
    const feedback = sacar("Feedback para");
    const personas = sacar("Personas");
    return { puntos: cuerpo.trim(), feedback, metricas, transcripcion, personas };
  }

  // ───────────────────────── Markdown ─────────────────────────
  function inline(s) {
    let t = esc(s);
    t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/(^|[^\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, "$1<em>$2</em>");
    t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
    t = t.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a);
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
    return t;
  }

  function md(texto, claseTop) {
    let out = "", parrafo = [], tabla = [];
    const pila = [];
    const cerrarP = () => { if (parrafo.length) { out += `<p>${inline(parrafo.join(" "))}</p>`; parrafo = []; } };
    const cerrarL = (nivel = -1) => { while (pila.length && pila[pila.length - 1] > nivel) { out += "</li></ul>"; pila.pop(); } };
    const cerrarT = () => {
      if (!tabla.length) return;
      const filas = tabla.filter((f) => f.replace(/[\s|:\-]/g, ""));
      out += "<table>" + filas.map((f, i) => "<tr>" + f.trim().replace(/^\||\|$/g, "").split("|")
        .map((c) => `<${i ? "td" : "th"}>${inline(c.trim())}</${i ? "td" : "th"}>`).join("") + "</tr>").join("") + "</table>";
      tabla = [];
    };
    for (const cruda of texto.split("\n")) {
      const linea = cruda.replace(/\t/g, "    ");
      const r = linea.trim();
      if (r.startsWith("|")) { cerrarP(); cerrarL(); tabla.push(r); continue; }
      cerrarT();
      if (!r) { cerrarP(); continue; }
      let m;
      if ((m = r.match(/^(#{1,6}) (.*)$/))) { cerrarP(); cerrarL(); const n = m[1].length; out += `<h${n}>${inline(m[2])}</h${n}>`; continue; }
      if ((m = linea.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/))) {
        cerrarP();
        const sangria = m[1].length;
        let txt = m[3], clase = "";
        let dataT = "";
        if (txt.startsWith("[ ] ")) { clase = "tarea"; dataT = txt.slice(4); txt = `<span class="check" title="Marcar como hecho"></span>${inline(txt.slice(4).replace(/\s*\(\d{4}-\d{2}-\d{2}\)/, ""))}`; }
        else if (/^\[x\] /i.test(txt)) { clase = "tarea hecha"; dataT = txt.slice(4); txt = `<span class="check" title="Marcar como pendiente">✓</span>${inline(txt.slice(4).replace(/\s*\(\d{4}-\d{2}-\d{2}\)/, ""))}`; }
        else txt = inline(txt);
        if (!pila.length || sangria > pila[pila.length - 1]) { out += "<ul>"; pila.push(sangria); }
        else { cerrarL(sangria); if (!pila.length) { out += "<ul>"; pila.push(sangria); } else out += "</li>"; }
        if (!clase && pila.length === 1 && claseTop) clase = claseTop;
        out += `<li${clase ? ` class="${clase}"` : ""}${dataT ? ` data-tarea="${esc(dataT)}"` : ""}>${txt}`;
        continue;
      }
      if (r.startsWith(">")) { cerrarP(); cerrarL(); out += `<blockquote>${inline(r.replace(/^>+\s*/, ""))}</blockquote>`; continue; }
      if (pila.length && linea.startsWith("  ")) { out += " " + inline(r); continue; }
      cerrarL();
      parrafo.push(r);
    }
    cerrarP(); cerrarL(); cerrarT();
    return out;
  }

  function tarjetasSecciones(texto) {
    const bloques = [[]];
    texto.split("\n").forEach((l) => { if (/^#{2,3} /.test(l)) bloques.push([]); bloques[bloques.length - 1].push(l); });
    return bloques.map((b) => b.join("\n").trim()).filter(Boolean)
      .map((b, i) => `<section class="card" style="--i:${i}">${md(b)}</section>`).join("");
  }

  function tarjetasMetricas(texto) {
    let out = '<div class="metricas">';
    let i = 0;
    texto.split("\n").filter((l) => l.startsWith("|")).forEach((l) => {
      const c = l.trim().replace(/^\||\|$/g, "").split("|").map((s) => s.trim());
      if (c.length < 2 || c[0] === "Métrica" || /^-+$/.test(c[0]) || c[0] === "Muletillas") return;
      let valor = c[1], detalle = "";
      const p = valor.indexOf("(");
      if (p > 0) { detalle = valor.slice(p).replace(/^\(|\)$/g, ""); valor = valor.slice(0, p).trim(); }
      out += `<div class="metrica${valor.length > 10 ? " ancha" : ""}" style="--i:${i++}"><div class="valor">${inline(valor)}</div><div class="nombre">${esc(c[0])}</div>${detalle ? `<div class="detalle">${esc(detalle)}</div>` : ""}</div>`;
    });
    return out + "</div>";
  }

  function tablaMuletillas(n) {
    const s = stats(n);
    const filas = Object.entries(s.muletillas).sort((a, b) => b[1] - a[1]);
    if (!filas.length) return `<div class="subtitulo">Muletillas</div><div class="card sin-muletillas">🧼 Ninguna muletilla detectada en esta reunión. ¡Impecable!</div>`;
    const max = filas[0][1];
    return `<div class="subtitulo">Muletillas</div><div class="card tabla-card"><table class="tabla">
      <thead><tr><th>Muletilla</th><th class="num">Veces</th><th class="num">Cada 10 min hablados</th><th>Peso</th></tr></thead><tbody>
      ${filas.map(([k, v]) => `<tr><td><b>“${esc(k)}”</b></td><td class="num">${v}</td><td class="num">${s.hablaMin ? (v / s.hablaMin * 10).toFixed(1) : "—"}</td>
        <td><div class="barrita"><div style="--p:${v / max}"></div></div></td></tr>`).join("")}
      <tr class="total"><td>Total</td><td class="num">${s.totalMul}</td><td class="num">${s.hablaMin ? s.mulPor10.toFixed(1) : "—"}</td><td></td></tr>
      </tbody></table></div>`;
  }

  // ───────────────────────── Estadísticas por reunión ─────────────────────────
  function stats(n) {
    const linea = n.cuerpo.split("\n").find((l) => l.startsWith("| Muletillas |")) || "";
    const muletillas = {};
    linea.split("|")[2]?.split(",").forEach((x) => { const m = x.trim().match(/^(.+?)\s*×\s*(\d+)$/); if (m) muletillas[m[1]] = +m[2]; });
    const totalMul = Object.values(muletillas).reduce((a, b) => a + b, 0);
    const hablaMin = num(n, "habla_yo_min");
    return {
      n, fecha: n.fecha, dur: n.duracion, hablaMin, pct: num(n, "habla_yo_pct"), ppm: num(n, "palabras_por_min_yo"),
      turnos: num(n, "turnos_yo"), mono: num(n, "monologo_max_seg"), preg: num(n, "preguntas_yo"), interr: num(n, "interrupciones_yo"),
      muletillas, totalMul, mulPor10: hablaMin ? totalMul / hablaMin * 10 : 0, p: puntajes(n),
    };
  }

  // ───────────────────────── Gráficos SVG (sin librerías) ─────────────────────────
  const COLORES = ["var(--acento)", "var(--acento2)", "#22c55e", "#f472b6", "#a78bfa", "#fb923c"];
  function sparkline(vals, { w = 120, h = 34, color = "var(--acento)", relleno = true } = {}) {
    const v = vals.filter((x) => x != null);
    if (v.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}"></svg>`;
    const min = Math.min(...v), max = Math.max(...v), r = max - min || 1;
    const pts = v.map((x, i) => [i / (v.length - 1) * (w - 4) + 2, h - 3 - (x - min) / r * (h - 8)]);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
    const id = "g" + Math.random().toString(36).slice(2, 8);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      ${relleno ? `<path d="${d}L${pts[pts.length - 1][0]},${h}L${pts[0][0]},${h}Z" fill="url(#${id})"/>` : ""}
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="trazo"/>
      <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="3" fill="${color}"/></svg>`;
  }

  function graficoLineas(series, etiquetas, { alto = 230, min = 0, max = 10, sufijo = "" } = {}) {
    const W = 760, H = alto, L = 34, R = 14, T = 14, B = 28;
    const x = (i) => L + (etiquetas.length < 2 ? 0 : i / (etiquetas.length - 1) * (W - L - R));
    const y = (v) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
    const pasos = 5, rejilla = Array.from({ length: pasos + 1 }, (_, k) => min + (max - min) * k / pasos);
    const cadaEtiqueta = Math.max(1, Math.ceil(etiquetas.length / 8));
    return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img">
      ${rejilla.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="rejilla"/><text x="${L - 8}" y="${y(v) + 4}" class="eje" text-anchor="end">${Math.round(v)}${sufijo}</text>`).join("")}
      ${etiquetas.map((e, i) => i % cadaEtiqueta === 0 || i === etiquetas.length - 1 ? `<text x="${x(i)}" y="${H - 8}" class="eje" text-anchor="middle">${esc(e)}</text>` : "").join("")}
      ${series.map((s, k) => {
        const pts = s.valores.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
        if (!pts.length) return "";
        const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
        return `<path d="${d}" fill="none" stroke="${s.color || COLORES[k]}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" class="trazo" style="--k:${k}"/>
          ${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.4" fill="var(--fondo)" stroke="${s.color || COLORES[k]}" stroke-width="2"/>`).join("")}`;
      }).join("")}
    </svg>
    <div class="leyenda">${series.map((s, k) => `<span><i style="background:${s.color || COLORES[k]}"></i>${esc(s.nombre)}</span>`).join("")}</div>`;
  }

  function radar(antes, ahora, ejes) {
    const S = 260, c = S / 2, R = 92, n = ejes.length;
    const pt = (i, v) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [c + Math.cos(a) * R * v / 10, c + Math.sin(a) * R * v / 10]; };
    const poli = (vals) => vals.map((v, i) => pt(i, v).map((z) => z.toFixed(1)).join(",")).join(" ");
    return `<svg class="radar" viewBox="0 0 ${S} ${S}">
      ${[2, 4, 6, 8, 10].map((v) => `<polygon points="${poli(ejes.map(() => v))}" class="rejilla" fill="none"/>`).join("")}
      ${ejes.map((e, i) => { const [x2, y2] = pt(i, 10); const [tx, ty] = pt(i, 12.6); return `<line x1="${c}" y1="${c}" x2="${x2}" y2="${y2}" class="rejilla"/><text x="${tx}" y="${ty + 4}" class="eje fuerte" text-anchor="middle">${esc(e)}</text>`; }).join("")}
      ${antes ? `<polygon points="${poli(antes)}" fill="var(--acento2)" fill-opacity=".18" stroke="var(--acento2)" stroke-width="2" stroke-dasharray="5 4"/>` : ""}
      <polygon points="${poli(ahora)}" fill="var(--acento)" fill-opacity=".3" stroke="var(--acento)" stroke-width="2.5" class="radar-ahora"/>
    </svg>`;
  }

  function heatmap(notas, semanas = 13) {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const inicio = new Date(hoy); inicio.setDate(inicio.getDate() - ((inicio.getDay() + 6) % 7) - (semanas - 1) * 7);
    const porDia = {};
    notas.forEach((n) => { const k = n.fecha.toDateString(); porDia[k] = (porDia[k] || 0) + (n.duracion || 30); });
    const max = Math.max(60, ...Object.values(porDia));
    let celdas = "";
    for (let s = 0; s < semanas; s++) for (let d = 0; d < 7; d++) {
      const f = new Date(inicio); f.setDate(f.getDate() + s * 7 + d);
      if (f > hoy) continue;
      const v = porDia[f.toDateString()] || 0;
      celdas += `<rect x="${s * 15}" y="${d * 15}" width="12" height="12" rx="3" class="dia" style="--v:${v ? 0.25 + 0.75 * v / max : 0}"><title>${f.getDate()} ${MESES[f.getMonth()].slice(0, 3)}: ${Math.round(v)} min</title></rect>`;
    }
    return `<svg class="heatmap" viewBox="-28 0 ${semanas * 15 + 30} ${7 * 15}">${["L", "", "M", "", "V", "", "D"].map((t, d) => t ? `<text x="-8" y="${d * 15 + 10}" class="eje" text-anchor="end">${t}</text>` : "").join("")}${celdas}</svg>`;
  }

  function contar(el) {
    el.querySelectorAll("[data-contar]").forEach((x) => {
      const fin = parseFloat(x.dataset.contar), dec = +(x.dataset.dec || 0), t0 = performance.now();
      const paso = (t) => { const k = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - k, 3); x.textContent = (fin * e).toFixed(dec); if (k < 1) requestAnimationFrame(paso); };
      requestAnimationFrame(paso);
    });
  }

  // ───────────────────────── Dashboard de progreso ─────────────────────────
  function panelProgreso() {
    const t = tema();
    const lista = [...E.notas].sort((a, b) => a.fecha - b.fecha).map(stats);
    if (lista.length < 2) {
      return `<h1>${txt("ico_progreso", "📈")} ${esc(txt("titulo_progreso", "Tu progreso"))}</h1><div class="vacio grande"><div>${t?.emoji || "🌱"}</div><h2>Necesito al menos 2 reuniones</h2>
        <p>Llevas ${lista.length}. Cuando tengas más, aquí verás cómo cambian tus muletillas, tu tiempo de habla, tus preguntas y tus puntajes.</p></div>`;
    }
    const k = Math.max(1, Math.min(5, Math.floor(lista.length / 2)));
    const antes = lista.slice(0, k), ahora = lista.slice(-k);
    const prom = (arr, f) => { const v = arr.map(f).filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const suma = (f) => lista.reduce((a, s) => a + (f(s) || 0), 0);
    const logros = calcularLogros(E.notas).filter((e) => e.fecha).length;
    const desde = lista[0].fecha, hasta = lista[lista.length - 1].fecha;
    const fmtF = (d) => `${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`;

    const kpis = [
      ["Reuniones", lista.length, 0, ""], ["Horas en reuniones", suma((s) => s.dur) / 60, 1, "h"], ["Minutos hablando tú", suma((s) => s.hablaMin), 0, ""],
      ["Preguntas hechas", suma((s) => s.preg), 0, ""], ["Muletillas totales", suma((s) => s.totalMul), 0, ""], ["Logros", logros, 0, `/${LOGROS.length}`],
    ];
    const metricasComp = [
      { nombre: "Muletillas cada 10 min", f: (s) => s.mulPor10, mejor: "baja", dec: 1, ico: "🗣️" },
      { nombre: "Tu % de habla", f: (s) => s.pct || null, mejor: "baja", dec: 0, suf: "%", ico: "🎙️" },
      { nombre: "Preguntas por reunión", f: (s) => s.preg, mejor: "sube", dec: 1, ico: "❓" },
      { nombre: "Interrupciones", f: (s) => s.interr, mejor: "baja", dec: 1, ico: "✋" },
      { nombre: "Monólogo más largo", f: (s) => s.mono || null, mejor: "baja", dec: 0, suf: " s", ico: "⏱️" },
      { nombre: "Velocidad (palabras/min)", f: (s) => s.ppm || null, mejor: "baja", dec: 0, ico: "⚡" },
      { nombre: "Puntaje promedio", f: (s) => (s.p ? xpDe(s.p) / 40 : null), mejor: "sube", dec: 1, ico: "⭐" },
      { nombre: "Duración de reunión", f: (s) => s.dur || null, mejor: "baja", dec: 0, suf: " min", ico: "🕒" },
    ];
    const comp = metricasComp.map((m) => {
      const a = prom(antes, m.f), b = prom(ahora, m.f);
      let clase = "neutro", delta = "";
      if (a != null && b != null) {
        const dif = b - a, rel = a ? dif / Math.abs(a) * 100 : 0;
        const bueno = m.mejor === "baja" ? dif < 0 : m.mejor === "sube" ? dif > 0 : Math.abs(rel) < 10;
        clase = Math.abs(rel) < 3 ? "neutro" : bueno ? "bueno" : "malo";
        delta = `${dif > 0 ? "▲" : dif < 0 ? "▼" : "■"} ${Math.abs(rel).toFixed(0)}%`;
      }
      const f = (v) => (v == null ? "—" : v.toFixed(m.dec) + (m.suf || ""));
      return `<div class="comp ${clase}"><div class="comp-cab"><span>${m.ico} ${m.nombre}</span><span class="delta">${delta}</span></div>
        <div class="comp-vals"><div><small>Antes</small><b>${f(a)}</b></div><div class="flecha">→</div><div><small>Ahora</small><b class="ahora">${f(b)}</b></div></div>
        ${sparkline(lista.map(m.f), { color: clase === "malo" ? "#ef4444" : clase === "bueno" ? "#22c55e" : "var(--texto-suave)" })}</div>`;
    }).join("");

    // Puntajes en el tiempo y radar
    const conP = lista.filter((s) => s.p);
    const etiquetas = conP.map((s) => fmtF(s.fecha));
    const series = APARTADOS.map((a, i) => ({ nombre: `${t ? icoApartado(t, a) : a.emoji} ${a.titulo}`, valores: conP.map((s) => s.p[a.clave]), color: COLORES[i] }));
    const radarAntes = conP.length >= 2 ? APARTADOS.map((a) => prom(conP.slice(0, k), (s) => s.p[a.clave])) : null;
    const radarAhora = APARTADOS.map((a) => prom(conP.slice(-k), (s) => s.p[a.clave]) || 0);
    const mejorApartado = radarAntes ? APARTADOS.map((a, i) => [a, radarAhora[i] - radarAntes[i]]).sort((x, y) => y[1] - x[1])[0] : null;

    // Muletillas
    const todas = {};
    lista.forEach((s) => Object.entries(s.muletillas).forEach(([m, v]) => { todas[m] = (todas[m] || 0) + v; }));
    const filasMul = Object.entries(todas).sort((a, b) => b[1] - a[1]).map(([m, total]) => {
      const pa = prom(antes, (s) => (s.hablaMin ? (s.muletillas[m] || 0) / s.hablaMin * 10 : null));
      const pb = prom(ahora, (s) => (s.hablaMin ? (s.muletillas[m] || 0) / s.hablaMin * 10 : null));
      const clase = pa == null || pb == null || Math.abs(pb - pa) < 0.05 ? "neutro" : pb < pa ? "bueno" : "malo";
      return `<tr><td><b>“${esc(m)}”</b></td><td class="num">${total}</td><td class="num">${pa == null ? "—" : pa.toFixed(1)}</td><td class="num">${pb == null ? "—" : pb.toFixed(1)}</td>
        <td class="num ${clase}">${pa != null && pb != null ? (pb < pa ? "▼ mejoraste" : pb > pa ? "▲ subió" : "=") : ""}</td><td>${sparkline(lista.map((s) => s.muletillas[m] || 0), { w: 110, h: 26, relleno: false })}</td></tr>`;
    }).join("");

    // Por tipo
    const tipos = {};
    lista.forEach((s) => (tipos[s.n.tipo || "Otra"] ||= []).push(s));
    const filasTipo = Object.entries(tipos).sort((a, b) => b[1].length - a[1].length).map(([tp, arr]) => {
      const pp = prom(arr, (s) => (s.p ? xpDe(s.p) / 40 : null));
      return `<div class="tipo-card"><div class="tipo-cab"><span class="tipo-barra t-${esc(tp)}"></span><b>${esc(nombreTipo(tp))}</b><small>${arr.length} reuniones</small></div>
        <div class="tipo-stats"><div><b>${pp == null ? "—" : pp.toFixed(1)}</b><small>puntaje</small></div><div><b>${(prom(arr, (s) => s.pct || null) ?? 0).toFixed(0)}%</b><small>tu habla</small></div>
        <div><b>${(prom(arr, (s) => s.preg) ?? 0).toFixed(1)}</b><small>preguntas</small></div><div><b>${(prom(arr, (s) => s.mulPor10) ?? 0).toFixed(1)}</b><small>muletillas/10'</small></div></div></div>`;
    }).join("");

    // Semanas
    const semanas = {};
    lista.forEach((s) => { const l = new Date(s.fecha); l.setHours(0, 0, 0, 0); l.setDate(l.getDate() - ((l.getDay() + 6) % 7)); const k2 = l.getTime(); (semanas[k2] ||= { n: 0, min: 0 }); semanas[k2].n++; semanas[k2].min += s.dur; });
    const ks = Object.keys(semanas).map(Number).sort((a, b) => a - b).slice(-12);
    const maxMin = Math.max(...ks.map((x) => semanas[x].min), 1);
    const barras = ks.map((x, i) => { const s = semanas[x], d = new Date(x); return `<div class="barra-sem" style="--h:${s.min / maxMin};--i:${i}" title="${s.n} reuniones · ${(s.min / 60).toFixed(1)} h"><span>${(s.min / 60).toFixed(1)}h</span><i></i><small>${d.getDate()}/${d.getMonth() + 1}</small></div>`; }).join("");

    return `<div class="dash">
      <div class="dash-hero"><div><h1>${txt("ico_progreso", "📈")} ${esc(txt("titulo_progreso", "Tu progreso"))}</h1><p>${lista.length} reuniones · del ${fmtF(desde)} al ${fmtF(hasta)} · comparando tus primeras ${k} con tus últimas ${k}</p></div>
        ${mejorApartado && mejorApartado[1] > 0 ? `<div class="destacado"><small>Donde más creciste</small><b>${t ? icoApartado(t, mejorApartado[0]) : ""} ${mejorApartado[0].titulo}</b><span>+${mejorApartado[1].toFixed(1)} puntos</span></div>` : ""}</div>
      <div class="kpis">${kpis.map(([n, v, d, suf], i) => `<div class="kpi" style="--i:${i}"><b><span data-contar="${v}" data-dec="${d}">0</span>${suf}</b><small>${n}</small></div>`).join("")}</div>

      <div class="subtitulo">Antes vs ahora</div>
      <div class="comps">${comp}</div>

      <div class="dash-fila">
        <div class="card grafico-card"><div class="card-tit">Tus puntajes reunión a reunión</div>${graficoLineas(series, etiquetas, { min: 0, max: 10 })}</div>
        <div class="card radar-card"><div class="card-tit">Antes vs ahora</div>${radar(radarAntes, radarAhora, APARTADOS.map((a) => a.titulo))}
          <div class="leyenda"><span><i style="background:var(--acento2)"></i>Primeras ${k}</span><span><i style="background:var(--acento)"></i>Últimas ${k}</span></div></div>
      </div>

      <div class="subtitulo">Muletillas</div>
      <div class="card tabla-card">${filasMul ? `<table class="tabla"><thead><tr><th>Muletilla</th><th class="num">Total</th><th class="num">Antes /10'</th><th class="num">Ahora /10'</th><th class="num">Cambio</th><th>Tendencia</th></tr></thead><tbody>${filasMul}</tbody></table>` : `<p class="vacio">🧼 Sin muletillas registradas. Impecable.</p>`}</div>

      <div class="dash-fila">
        <div class="card"><div class="card-tit">Horas en reuniones por semana</div><div class="barras-sem">${barras}</div></div>
        <div class="card"><div class="card-tit">Calendario de actividad</div>${heatmap(E.notas)}</div>
      </div>

      <div class="subtitulo">Por tipo de reunión</div>
      <div class="tipos">${filasTipo}</div>
    </div>`;
  }

  // ───────────────────────── Juego ─────────────────────────
  const APARTADOS = [
    { clave: "claridad", titulo: "Claridad", emoji: "💬" }, { clave: "escucha", titulo: "Escucha", emoji: "👂" },
    { clave: "preguntas", titulo: "Preguntas", emoji: "❓" }, { clave: "cierre", titulo: "Cierre", emoji: "🎯" },
  ];
  const UMBRALES = [0, 300, 800, 1500, 2500, 3800, 5400, 7300, 9500, 12000];
  const XP_LOGRO = 100;
  const ent = (v) => `${Math.floor(v)}`, hrs = (v) => `${(v / 60).toFixed(1)} h`, mins = (v) => `${Math.floor(v)} min`;
  // Logros: premian comportamientos que mejoran tu comunicación, no solo asistir.
  const LOGROS = [
    ["primera_reunion", "🎬", 1, ent], ["reuniones_10", "🔟", 10, ent], ["reuniones_50", "🥈", 50, ent],
    ["habito_1", "🎯", 1, ent], ["habito_racha_3", "🔥", 3, ent], ["habito_10", "🏹", 10, ent],
    ["cierre_racha_3", "🤝", 3, ent], ["muletillas_racha_3", "🫧", 3, ent], ["habla_racha_5", "⚖️", 5, ent],
    ["monologo_racha_5", "⏱️", 5, ent], ["preguntas_racha_3", "❓", 3, ent], ["cero_interrupciones_5", "🤐", 5, ent],
    ["preguntas_10_en_una", "🔎", 10, ent], ["escucha_activa", "👂", 1, null], ["sin_muletillas", "🧼", 1, null],
    ["express", "⚡", 1, null], ["todo_verde", "🟢", 1, null], ["equilibrio", "💎", 1, null],
    ["reunion_9", "🌟", 1, null], ["puntaje_perfecto", "💯", 1, null], ["remontada", "🚀", 1, null],
    ["mejora_cierre", "📈", 1, null], ["mejora_debil", "🧗", 1, null], ["semana_8", "🏆", 1, null],
  ].map(([id, emoji, objetivo, formato]) => ({ id, emoji, objetivo, formato }));

  /** Nombre y criterio por defecto (si el universo aún no tiene nombre propio para el logro). */
  const LOGRO_BASE = {
    primera_reunion: ["Primera reunión", "Completaste tu primera reunión."], reuniones_10: ["10 reuniones", "Completaste 10 reuniones."],
    reuniones_50: ["50 reuniones", "Completaste 50 reuniones."], habito_1: ["Primer hábito", "Cumpliste por primera vez el hábito que te dejó Minuta."],
    habito_racha_3: ["Hábito en racha", "Cumpliste tu hábito 3 reuniones seguidas."], habito_10: ["Diez hábitos", "Cumpliste 10 hábitos en total."],
    cierre_racha_3: ["Cierre de acero", "3 reuniones seguidas con cierre de 8 o más."], muletillas_racha_3: ["Habla limpia", "3 reuniones seguidas con menos de 3 muletillas cada 10 minutos."],
    habla_racha_5: ["Justo y equilibrado", "5 reuniones seguidas con tu tiempo de habla en rango."], monologo_racha_5: ["Al grano", "5 reuniones seguidas sin hablar más de 60 segundos de corrido."],
    preguntas_racha_3: ["Curioso constante", "3 reuniones seguidas con al menos 1 pregunta cada 10 minutos."], cero_interrupciones_5: ["Dejas terminar", "5 reuniones seguidas sin interrumpir a nadie."],
    preguntas_10_en_una: ["Interrogatorio", "Hiciste 10 o más preguntas en una sola reunión."], escucha_activa: ["Oído fino", "Hablaste 35% o menos en una reunión de 15+ minutos."],
    sin_muletillas: ["Cero muletillas", "Reunión de 15+ minutos sin ninguna muletilla."], express: ["Express", "Reunión de 15 minutos o menos con cierre de 8 o más."],
    todo_verde: ["Todo en verde", "Una reunión con todas tus métricas de cómo hablaste en rango."], equilibrio: ["Equilibrio total", "Los 4 apartados en 8 o más en una misma reunión."],
    reunion_9: ["Reunión de 9", "Promedio de 9 o más en una reunión."], puntaje_perfecto: ["Diez perfecto", "Sacaste un 10 en algún apartado."],
    remontada: ["Remontada", "Después de una reunión bajo 6, la siguiente sobre 8."], mejora_cierre: ["Mejor cierre", "Tu cierre promedio subió 2+ puntos vs. tus 5 reuniones anteriores."],
    mejora_debil: ["Superaste tu punto débil", "Tu apartado más débil subió 2+ puntos en promedio en las siguientes 5 reuniones."],
    semana_8: ["Semana de 8", "Una semana con 3+ reuniones y promedio de 8 o más."],
  };
  const logroTexto = (t, id) => { const l = t?.logros?.[id], b = LOGRO_BASE[id] || [id, ""]; return { nombre: l?.nombre || b[0], descripcion: l?.descripcion && l?.nombre ? l.descripcion : b[1] }; };

  const _cachePuntajes = new Map();
  function puntajes(n) {
    if (_cachePuntajes.has(n.ruta + n.cuerpo.length)) return _cachePuntajes.get(n.ruta + n.cuerpo.length);
    const linea = n.cuerpo.split("\n").find((l) => l.includes("Puntajes"));
    let res = null;
    if (linea) {
      const p = {};
      for (const a of APARTADOS) {
        const m = linea.match(new RegExp(`${a.titulo}[^0-9\\n]{0,25}?(\\d{1,2})`, "i"));
        if (m) p[a.clave] = Math.min(10, Math.max(1, +m[1]));
      }
      if (Object.keys(p).length === 4) res = p;
    }
    _cachePuntajes.set(n.ruta + n.cuerpo.length, res);
    return res;
  }
  const personaje = (n) => { const l = n.cuerpo.split("\n").find((x) => x.includes("**Personaje:**")); return l ? l.split("**Personaje:**").pop().trim() : null; };
  const num = (n, k) => parseFloat(n.fm[k]) || 0;
  const sinMuletillas = (n) => n.cuerpo.split("\n").some((l) => l.startsWith("| Muletillas |") && l.includes("—"));
  const xpDe = (p) => Object.values(p).reduce((a, b) => a + b, 0) * 10;
  const tema = () => E.temas.find((t) => t.id === E.temaId) || E.temas.find((t) => t.id === "cine") || E.temas[0];
  const arquetipo = (t, clave, v) => t.apartados[clave]?.[Math.min(9, Math.max(0, Math.round(v) - 1))];
  const rango = (t, xp) => { let i = 0; UMBRALES.forEach((u, k) => { if (xp >= u) i = k; }); return { i, r: t.rangos[i], sig: UMBRALES[i + 1] ?? null }; };
  const icoLogro = (t, def) => t.iconos_logros?.[def.id] || def.emoji;
  const icoApartado = (t, a) => t.iconos_apartados?.[a.clave] || a.emoji;
  const icoRango = (t, i) => t.iconos_rangos?.[i] || t.emoji;

  function calcularLogros(notas, hasta) {
    const est = LOGROS.map((def) => ({ def, progreso: 0, fecha: null, nota: null }));
    const orden = notas.filter((n) => !hasta || n.fecha <= hasta).sort((a, b) => a.fecha - b.fecha);
    const v = {}, racha = {}, mejor = (k, ok) => { racha[k] = ok ? (racha[k] || 0) + 1 : 0; v[k] = Math.max(v[k] || 0, racha[k]); };
    let c = 0, hab = 0, ultimoProm = null;
    const conP = [], semanas = {};
    for (const n of orden) {
      const dur = n.duracion, st = stats(n), refs = referencias(n), p = puntajes(n), ant = analizarFeedback(n).anterior;
      c++;
      if (ant && ant.estado !== "na") { if (ant.estado === "si") hab++; mejor("habito_racha_3", ant.estado === "si"); }
      v.primera_reunion = v.reuniones_10 = v.reuniones_50 = c;
      v.habito_1 = v.habito_10 = hab;
      const ref = (id) => refs.find((m) => m.id === id);
      if (st.hablaMin) mejor("muletillas_racha_3", st.mulPor10 <= 3);
      if (ref("habla")) mejor("habla_racha_5", ref("habla").estado === "bien");
      if (st.mono) mejor("monologo_racha_5", st.mono <= 60);
      if (dur) mejor("preguntas_racha_3", (st.preg || 0) / dur * 10 >= 1);
      mejor("cero_interrupciones_5", (st.interr || 0) === 0);
      v.preguntas_10_en_una = Math.max(v.preguntas_10_en_una || 0, st.preg || 0);
      if (dur >= 15 && st.pct > 0 && st.pct <= 35) v.escucha_activa = 1;
      if (dur >= 15 && sinMuletillas(n)) v.sin_muletillas = 1;
      if (refs.length >= 4 && refs.every((m) => m.estado === "bien")) v.todo_verde = 1;
      if (p) {
        const prom = promP(p);
        mejor("cierre_racha_3", p.cierre >= 8);
        if (Object.values(p).includes(10)) v.puntaje_perfecto = 1;
        if (prom >= 9) v.reunion_9 = 1;
        if (APARTADOS.every((a) => p[a.clave] >= 8)) v.equilibrio = 1;
        if (dur > 0 && dur <= 15 && p.cierre >= 8) v.express = 1;
        if (ultimoProm != null && ultimoProm < 6 && prom > 8) v.remontada = 1;
        ultimoProm = prom;
        conP.push(p);
        if (conP.length >= 10) {
          const u = conP.slice(-5), a = conP.slice(-10, -5), m = (arr, k) => arr.reduce((x, y) => x + y[k], 0) / arr.length;
          if (m(u, "cierre") - m(a, "cierre") >= 2) v.mejora_cierre = 1;
          const debil = [...APARTADOS].sort((x, y) => m(a, x.clave) - m(a, y.clave))[0].clave;
          if (m(u, debil) - m(a, debil) >= 2) v.mejora_debil = 1;
        }
        const lunes = new Date(n.fecha); lunes.setHours(0, 0, 0, 0); lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7));
        const k = lunes.toISOString().slice(0, 10), sem = (semanas[k] ||= []);
        sem.push(prom);
        if (sem.length >= 3 && sem.reduce((x, y) => x + y, 0) / sem.length >= 8) v.semana_8 = 1;
      }
      for (const e of est) {
        e.progreso = v[e.def.id] || 0;
        if (!e.fecha && e.progreso >= e.def.objetivo) { e.fecha = n.fecha; e.nota = n.ruta; }
      }
    }
    for (const e of est) if (e.def.id in racha) { e.racha = true; e.actual = racha[e.def.id]; }
    return est;
  }

  const xpTotal = (notas, hasta) =>
    notas.filter((n) => !hasta || n.fecha <= hasta).map(puntajes).filter(Boolean).reduce((a, p) => a + xpDe(p), 0)
    + calcularLogros(notas, hasta).filter((e) => e.fecha).length * XP_LOGRO;

  // ───────────────────────── Tema visual ─────────────────────────
  const PATRONES = {
    estrellas: () => {
      const s = [[20, 30, 1], [130, 80, 1.2], [210, 170, 1.6], [300, 40, 1], [380, 220, 1.3], [60, 200, 0.9], [250, 110, 0.8], [340, 140, 1.1]];
      return [s.map(([x, y, r]) => `radial-gradient(${r}px ${r}px at ${x}px ${y}px, rgba(255,255,255,.8), transparent)`).join(","), s.map(() => "400px 260px").join(",")];
    },
    pergamino: () => ["radial-gradient(ellipse at 50% -10%, rgba(212,175,55,.18), transparent 55%), radial-gradient(ellipse at 50% 120%, rgba(0,0,0,.5), transparent 60%)", "100% 100%, 100% 100%"],
    runas: () => ["radial-gradient(ellipse at 50% -10%, rgba(201,162,39,.15), transparent 55%), repeating-linear-gradient(45deg, rgba(201,162,39,.04) 0 1px, transparent 1px 24px)", "100% 100%, auto"],
    comic: () => ["radial-gradient(rgba(230,36,41,.16) 1px, transparent 1.7px), radial-gradient(ellipse at 100% 0%, rgba(230,36,41,.25), transparent 45%)", "9px 9px, 100% 100%"],
    velocidad: () => ["repeating-linear-gradient(100deg, transparent 0 46px, rgba(255,106,0,.07) 46px 48px, transparent 48px 130px), radial-gradient(ellipse at 100% 0%, rgba(0,229,255,.14), transparent 45%)", "auto, 100% 100%"],
    ki: () => ["radial-gradient(circle at 88% -8%, rgba(248,91,26,.32), transparent 42%), radial-gradient(circle at -8% 108%, rgba(30,91,184,.18), transparent 45%), repeating-conic-gradient(from 0deg at 88% -8%, rgba(248,91,26,.05) 0 6deg, transparent 6deg 14deg)", "100% 100%, 100% 100%, 100% 100%"],
    nubes: () => ["radial-gradient(70px 32px at 9% 7%, rgba(255,255,255,.95), transparent 70%), radial-gradient(100px 44px at 16% 10%, rgba(255,255,255,.9), transparent 70%), radial-gradient(90px 38px at 82% 5%, rgba(255,255,255,.95), transparent 70%), radial-gradient(120px 50px at 90% 9%, rgba(255,255,255,.85), transparent 70%)", "100% 700px, 100% 700px, 100% 700px, 100% 700px"],
    hielo: () => ["linear-gradient(180deg, rgba(159,201,230,.16), transparent 260px), repeating-linear-gradient(60deg, rgba(159,201,230,.035) 0 1px, transparent 1px 32px)", "100% 100%, auto"],
    pantano: () => ["radial-gradient(ellipse at 15% 110%, rgba(123,179,46,.3), transparent 50%), radial-gradient(ellipse at 95% 105%, rgba(139,90,43,.18), transparent 45%)", "100% 100%, 100% 100%"],
    olas: () => ["repeating-radial-gradient(circle at 50% 150%, transparent 0 30px, rgba(46,139,139,.07) 30px 32px), radial-gradient(ellipse at 50% -10%, rgba(200,161,90,.14), transparent 55%)", "auto, 100% 100%"],
    film: () => ["radial-gradient(ellipse at 50% -25%, rgba(245,183,0,.2), transparent 55%)", "100% 100%"],
    mapa: () => ["radial-gradient(ellipse at 50% 45%, transparent 50%, rgba(110,70,25,.38) 100%), radial-gradient(circle at 18% 28%, rgba(140,95,40,.10), transparent 22%), radial-gradient(circle at 78% 70%, rgba(140,95,40,.09), transparent 25%), radial-gradient(circle at 60% 18%, rgba(140,95,40,.07), transparent 18%), repeating-linear-gradient(0deg, transparent 0 79px, rgba(51,36,15,.06) 79px 80px), repeating-linear-gradient(90deg, transparent 0 79px, rgba(51,36,15,.06) 79px 80px)", "100% 100%, 100% 100%, 100% 100%, 100% 100%, auto, auto"],
  };
  const radioControl = (r) => (r >= 18 ? 15 : r >= 12 ? 10 : r >= 8 ? 6 : r >= 2 ? 2 : 0);
  const txt = (clave, def) => tema()?.estilo?.textos?.[clave] || def;
  /** Texto sobre el color de acento: blanco o casi negro, el que más contraste dé (WCAG). */
  function sobreAcento(hex) {
    const v = parseInt(String(hex).replace("#", "").slice(0, 6), 16);
    if (Number.isNaN(v)) return "#fff";
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
    return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.0569) ? "#fff" : "#111";
  }
  function luminancia(hex) {
    const v = parseInt(hex.replace("#", ""), 16);
    return 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
  }

  /** Pieza «tema»: <html data-tema="claro|oscuro"> y los tokens comunes. Los colores del universo van directo a los tokens. */
  const apariencia = PiezaTema.crear();
  apariencia.aplicar("oscuro");
  function aplicarTema() {
    const t = tema();
    if (!t) return;
    const e = t.estilo || {};
    const r = document.documentElement.style;
    const fuente = e.fuente === "ui-rounded" ? "ui-rounded, system-ui" : `"${e.fuente}", system-ui`;
    const vars = {
      "--fondo": e.fondo, "--fondo2": e.fondo2, "--panel": e.panel, "--texto": e.texto, "--texto-suave": e.suave, "--linea": e.linea,
      "--acento": e.acento, "--acento-t": e.acento_texto, "--acento2": e.acento2, "--radio": `${e.radio}px`,
      "--radio-chico": `${radioControl(e.radio)}px`, "--fuente-t": fuente, "--peso-t": e.peso, "--mayus": e.mayusculas ? "uppercase" : "none",
      "--cursiva": e.cursiva ? "italic" : "normal", "--sobre-acento": sobreAcento(e.acento || "#888888"),
    };
    Object.entries(vars).forEach(([k, v]) => v !== undefined && r.setProperty(k, v));
    const [img, tam] = (Object.hasOwn(PATRONES, e.patron || "") ? PATRONES[e.patron] : () => ["", ""])();
    r.setProperty("--patron", img || "none");
    r.setProperty("--patron-tam", tam || "auto");
    apariencia.aplicar(e.modo === "claro" ? "claro" : "oscuro");  // cada universo decide su modo (no hay «Apariencia»)
    document.documentElement.dataset.u = t.id;
    document.documentElement.dataset.patron = e.patron || "";
    document.documentElement.dataset.mayus = e.mayusculas ? "1" : "0";
    particulas.configurar(e.patron, e);
    const bu = document.querySelector(".bt-u");
    if (bu) bu.textContent = TITULO_VENTANA[t.id] || e.ventana?.titulo || t.nombre;
    if (e.kit) document.documentElement.dataset.kit = e.kit; else delete document.documentElement.dataset.kit;
    const bd = document.querySelector(".bt-der");
    if (bd) bd.textContent = e.kit ? (e.ventana?.derecha || "") : "";
    if (_temaVentana !== t.id) { _temaVentana = t.id; regiones(); setTimeout(regiones, 300); }
  }
  let _temaVentana = "";

  // ───────────────────────── Partículas de fondo ─────────────────────────
  const particulas = (() => {
    const cv = document.getElementById("particulas");
    const ctx = cv.getContext("2d");
    let items = [], tipo = "", colores = {}, raf = 0, w = 0, h = 0;
    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const conf = {
      estrellas: { n: 90, f: () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.4 + 0.3, fase: Math.random() * 6.28, vel: 0.01 + Math.random() * 0.03 }) },
      ki: { n: 40, f: () => ({ x: Math.random() * w, y: h + Math.random() * h, r: Math.random() * 2.5 + 1, vy: 0.3 + Math.random() * 0.8, fase: Math.random() * 6.28 }) },
      velocidad: { n: 26, f: () => ({ x: Math.random() * w, y: Math.random() * h, l: 40 + Math.random() * 120, vx: 4 + Math.random() * 7 }) },
      hielo: { n: 70, f: () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.8 + 0.6, vy: 0.2 + Math.random() * 0.6, fase: Math.random() * 6.28 }) },
      pergamino: { n: 30, f: () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.6 + 0.6, fase: Math.random() * 6.28, vy: -0.1 - Math.random() * 0.25 }) },
      runas: { n: 30, f: () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.6 + 0.6, fase: Math.random() * 6.28, vy: -0.1 - Math.random() * 0.25 }) },
      pantano: { n: 26, f: () => ({ x: Math.random() * w, y: h * 0.4 + Math.random() * h * 0.6, r: Math.random() * 1.8 + 0.8, fase: Math.random() * 6.28, vy: -0.05 - Math.random() * 0.15 }) },
      olas: { n: 30, f: () => ({ x: Math.random() * w, y: h + Math.random() * h, r: Math.random() * 3 + 1, vy: 0.2 + Math.random() * 0.5, fase: Math.random() * 6.28 }) },
      film: { n: 40, f: () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.2 + 0.3, fase: Math.random() * 6.28, vy: 0.05 }) },
      nubes: { n: 6, f: () => ({ x: Math.random() * w, y: 30 + Math.random() * h * 0.5, r: 40 + Math.random() * 60, vx: 0.08 + Math.random() * 0.15 }) },
      comic: { n: 0, f: () => ({}) },
    };
    function medir() { w = cv.width = innerWidth * devicePixelRatio; h = cv.height = innerHeight * devicePixelRatio; }
    function rgba(hex, a) { const v = parseInt((hex || "#ffffff").replace("#", ""), 16); return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`; }
    function paso() {
      ctx.clearRect(0, 0, w, h);
      const d = devicePixelRatio;
      for (const p of items) {
        switch (tipo) {
          case "estrellas":
            p.fase += p.vel; ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.45 * Math.sin(p.fase)})`;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r * d, 0, 6.28); ctx.fill(); break;
          case "ki": case "olas":
            p.y -= p.vy * d; p.fase += 0.03; p.x += Math.sin(p.fase) * 0.4 * d;
            if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
            ctx.fillStyle = rgba(tipo === "ki" ? colores.acento : colores.acento2, tipo === "ki" ? 0.35 : 0.18);
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r * d, 0, 6.28); ctx.fill(); break;
          case "velocidad":
            p.x += p.vx * d; if (p.x - p.l * d > w) { p.x = -p.l * d; p.y = Math.random() * h; }
            const g = ctx.createLinearGradient(p.x - p.l * d, 0, p.x, 0);
            g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, rgba(Math.random() > 0.5 ? colores.acento : colores.acento2, 0.35));
            ctx.strokeStyle = g; ctx.lineWidth = 1.2 * d; ctx.beginPath(); ctx.moveTo(p.x - p.l * d, p.y); ctx.lineTo(p.x, p.y); ctx.stroke(); break;
          case "hielo":
            p.y += p.vy * d; p.fase += 0.02; p.x += Math.sin(p.fase) * 0.3 * d;
            if (p.y > h + 5) { p.y = -5; p.x = Math.random() * w; }
            ctx.fillStyle = "rgba(220,240,255,.55)"; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * d, 0, 6.28); ctx.fill(); break;
          case "pergamino": case "runas": case "pantano": case "film":
            p.y += p.vy * d; p.fase += 0.03;
            if (p.y < -5) { p.y = h + 5; p.x = Math.random() * w; }
            if (p.y > h + 5) { p.y = -5; }
            ctx.fillStyle = rgba(tipo === "pantano" ? "#c6f06a" : tipo === "film" ? "#ffffff" : colores.acento, (0.25 + 0.35 * Math.sin(p.fase)) * (tipo === "film" ? 0.5 : 1));
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r * d, 0, 6.28); ctx.fill(); break;
          case "nubes":
            p.x += p.vx * d; if (p.x - p.r * 3 * d > w) p.x = -p.r * 3 * d;
            ctx.fillStyle = "rgba(255,255,255,.55)";
            for (const [dx, dy, k] of [[0, 0, 1], [p.r * 0.9, -p.r * 0.3, 0.8], [p.r * 1.8, 0, 0.9]]) {
              ctx.beginPath(); ctx.ellipse(p.x + dx * d, p.y + dy * d, p.r * k * d, p.r * 0.55 * k * d, 0, 0, 6.28); ctx.fill();
            }
            break;
        }
      }
      raf = requestAnimationFrame(paso);
    }
    addEventListener("resize", () => { medir(); configurar(tipo, colores, true); });
    function configurar(nuevo, estilo, forzar) {
      if (nuevo === tipo && !forzar) { colores = estilo || colores; return; }
      tipo = nuevo; colores = estilo || {};
      cancelAnimationFrame(raf);
      if (!w) medir();
      const c = conf[tipo];
      items = c && !reducido ? Array.from({ length: c.n }, c.f) : [];
      if (items.length) paso(); else ctx.clearRect(0, 0, w, h);
    }
    return { configurar };
  })();

  // ───────────────────────── Render ─────────────────────────
  const notaActual = () => E.notas.find((n) => n.ruta === E.sel);

  function filtradas() {
    const q = E.busqueda.trim().toLowerCase();
    return q ? E.notas.filter((n) => n.titulo.toLowerCase().includes(q) || n.cuerpo.toLowerCase().includes(q)) : E.notas;
  }

  function grupos() {
    const hoy = new Date(), ayer = new Date(Date.now() - 864e5), mapa = new Map();
    for (const n of filtradas()) {
      const k = mismoDia(n.fecha, hoy) ? "Hoy" : mismoDia(n.fecha, ayer) ? "Ayer" : cap(`${DIAS[n.fecha.getDay()]} ${n.fecha.getDate()} de ${MESES[n.fecha.getMonth()]}`);
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(n);
    }
    return [...mapa];
  }

  function hud() {
    const t = tema();
    if (!t) return "";
    const xp = xpTotal(E.notas);
    const { i, r, sig } = rango(t, xp);
    const prog = sig ? (xp - UMBRALES[i]) / (sig - UMBRALES[i]) : 1;
    const logros = calcularLogros(E.notas).filter((e) => e.fecha).length;
    return `<button class="hud" data-accion="galeria" title="Tu nivel · clic para cambiar de universo (⌘U)">
      <div class="hud-fila">
        <div class="hud-avatar"><span>${icoRango(t, i)}</span></div>
        <div class="hud-info"><div class="hud-rango">Rango ${i + 1} · ${esc(t.nombre)}</div><div class="hud-nombre">${esc(r.nombre)}</div></div>
        <div class="hud-logros" title="${logros} logros desbloqueados"><b>${logros}</b><span>logros</span></div>
      </div>
      <div class="hud-barra"><div style="--p:${Math.max(0.03, Math.min(1, prog))}"></div></div>
      <div class="hud-xp" title="${xp} ${esc(t.xp)}${sig ? ` · faltan ${sig - xp} para ${esc(t.rangos[i + 1].nombre)}` : ""}">${sig ? `${sig - xp} ${esc(t.xp)} para el rango ${i + 2}` : "Rango máximo"}</div>
    </button>`;
  }

  function lateral() {
    const lista = grupos().map(([k, ns]) => `<div class="grupo">${esc(k)}</div>` + ns.map((n) => `
      <div class="fila-env"><button class="fila${n.ruta === E.sel && E.seccion === "reuniones" ? " elegida" : ""}" data-nota="${esc(n.ruta)}">
        <span class="tipo-barra t-${esc(n.tipo || "Otra")}"></span>
        <span class="fila-txt"><span class="fila-titulo">${esc(n.titulo)}</span>
        <span class="fila-det">${hhmm(n.fecha)}${n.duracion ? ` · ${Math.round(n.duracion)} min` : ""}${n.tipo ? ` · ${esc(nombreTipo(n.tipo))}` : ""}</span></span>
      </button><button class="fila-borrar" data-borrar="${esc(n.ruta)}" title="Borrar reunión" aria-label="Borrar ${esc(n.titulo)}">🗑</button></div>`).join("")).join("");
    const nav = `<nav class="secciones">${SECCIONES.map(([id, ico, nombre], i) =>
      `<button class="seccion${E.seccion === id ? " activa" : ""}" data-seccion="${id}" title="${nombre} · ${id === "reuniones" ? "⌘1–⌘3" : `⌘${ATAJO[id]}`}"><span class="s-ico">${id === "progreso" ? ico : txt("ico_" + id, ico)}</span><span>${id === "progreso" ? nombre : txt(id, nombre)}</span></button>`).join("")}</nav>`;
    return `<aside class="lateral">
      ${hud()}
      ${nav}
      ${focoMini()}
      <label class="buscador"><span class="lupa">⌕</span><input id="buscar" type="search" title="Escribe una pregunta y presiona ↵ para preguntarle a tu IA (⌘K)" placeholder="${esc(txt("buscar", "Buscar en reuniones"))} · ⌘K pregunta" value="${esc(E.busqueda)}" autocomplete="off"></label>
      <nav class="lista">${lista || `<div class="vacio-lista"><div>${tema()?.emoji || "🎙️"}</div>${E.notas.length ? "Sin resultados" : `Aún no hay reuniones.<br>${ESCRITORIO ? "Graba una desde el ícono de Minuta en la bandeja del sistema." : "Graba una desde la barra de menú."}`}</div>`}</nav>
    </aside>`;
  }

  /** La primera vez que se ve una nota en la sesión, los botones muestran su nombre ~2,5 s (después solo al pasar el mouse). */
  function presentarAcciones() {
    if (E._accionesHasta === undefined && innerWidth >= 1320) {
      E._accionesHasta = Date.now() + 2600;
      setTimeout(() => document.querySelector(".acciones.presentar")?.classList.remove("presentar"), 2700);
    }
    return Date.now() < E._accionesHasta;
  }

  function superior() {
    const n = notaActual();
    const [, icoBase, nombreBase] = SECCIONES.find((s) => s[0] === E.seccion) || PREFERENCIAS;
    const ico = E.seccion === "progreso" ? icoBase : txt("ico_" + E.seccion, icoBase), nombre = E.seccion === "progreso" ? nombreBase : txt(E.seccion, nombreBase);
    const enReunion = E.seccion === "reuniones";
    return `<header class="superior${enReunion ? "" : " global"}">
      <div class="sup-izq">
        <button class="boton" data-accion="lateral" title="Barra lateral (⌘\\)">☰</button>
        <div class="migas"><span class="m-ico">${ico}</span><span class="m-sec">${nombre}</span></div>
      </div>
      ${enReunion && n ? `<div class="pestanas" role="tablist">${VISTAS.map(([id, nom], i) =>
        `<button role="tab" class="pestana${E.vista === id ? " activa" : ""}" data-vista="${id}" title="⌘${i + 1}">${nom}</button>`).join("")}</div>` : "<div></div>"}
      <div class="acciones${enReunion && n && presentarAcciones() ? " presentar" : ""}">
        ${enReunion && n ? `<button class="boton boton-et" style="--i:1" data-accion="copiar" title="Copiar para ti (incluye notas privadas; para enviar a otros usa Enviar)"><i>⧉</i><span>Copiar</span></button>
        <button class="boton boton-et principal" data-accion="enviar" title="Enviar resumen por correo, Teams o WhatsApp"><i>✉︎</i><span>Enviar</span></button>` : ""}
        <button class="boton boton-et${E.menu ? " activo" : ""}" style="--i:2" data-accion="menu" title="Más opciones" aria-haspopup="menu" aria-expanded="${!!E.menu}"><i>⋯</i><span>Más</span></button>
        ${E.menu ? `<div class="menu-mas" role="menu">
          ${enReunion && n ? `<button role="menuitem" data-accion="corregir-ia"><span>✎</span>Corregir la nota con tu IA</button>
          <button role="menuitem" data-accion="corregir"><span>Aa</span>Cambiar una palabra en toda la nota</button>
          <button role="menuitem" data-accion="obsidian"><span>↗</span>Abrir en Obsidian</button>
          ${E.plataforma === "web" ? "" : `<button role="menuitem" data-accion="finder"><span>▤</span>Mostrar en la carpeta</button>`}
          <button role="menuitem" data-accion="comentar-nota"><span>🗨</span>Comentar el feedback de esta nota</button><hr>` : ""}
          <button role="menuitem" data-accion="preguntar"><span>✦</span>Pregúntale a tus reuniones<kbd>⌘K</kbd></button>
          <button role="menuitem" data-abrir-gym=""><span>🥊</span>Gimnasio: ensaya una reunión<kbd>⌘G</kbd></button>
          <button role="menuitem" data-accion="galeria"><span>${tema()?.emoji || "✨"}</span>Cambiar de universo<kbd>⌘U</kbd></button>
          <button role="menuitem" data-seccion="preferencias"><span>⚙</span>Preferencias<kbd>⌘,</kbd></button>
          <button role="menuitem" data-accion="comentarios"><span>💬</span>Enviar comentarios</button>
          ${enReunion && n ? `<hr><button role="menuitem" class="peligro" data-accion="borrar"><span>🗑</span>Borrar reunión<kbd>⌘⌫</kbd></button>` : ""}
        </div>` : ""}
      </div>
    </header>`;
  }

  function cabeceraNota(n) {
    const f = n.fecha;
    const chips = [`${cap(DIAS[f.getDay()])} ${f.getDate()} de ${MESES[f.getMonth()]} · ${hhmm(f)}`];
    if (n.duracion) chips.push(`${Math.round(n.duracion)} min`);
    return `<h1>${esc(n.titulo)}</h1><div class="chips">${chips.map((c) => `<span>${esc(c)}</span>`).join("")}
      <span class="tipo-cambiar"><button class="chip-tipo${n.tipo ? ` t-${esc(n.tipo)}` : ""}" data-cambiar-tipo title="Cambiar el tipo de reunión">${n.tipo ? `${esc(categoria(n.tipo).emoji)} ${esc(nombreTipo(n.tipo))}` : "＋ Tipo"} <i>▾</i></button>
        ${E.menuTipo === n.ruta ? `<div class="menu-mas menu-tipo" role="menu">${E.categorias.map((c) => `<button role="menuitemradio" aria-checked="${n.tipo === c.id}" data-poner-tipo="${esc(c.id)}">${esc(c.emoji)} ${esc(c.nombre)}${n.tipo === c.id ? " ✓" : ""}</button>`).join("")}</div>` : ""}</span>
      ${n.participantes.length ? `<span>👥 ${esc(n.participantes.join(", "))}</span>` : ""}</div>`;
  }

  function panelJuego(n) {
    const t = tema(), p = puntajes(n);
    if (!t || !p) return `<p class="vacio">Esta reunión no tiene puntajes de feedback.</p>`;
    const total = xpTotal(E.notas, n.fecha);
    const nuevos = calcularLogros(E.notas, n.fecha).filter((e) => e.nota === n.ruta);
    const xpR = xpDe(p) + nuevos.length * XP_LOGRO;
    const { i, r } = rango(t, total), antes = rango(t, total - xpR).i;
    const prom = xpDe(p) / 40;
    const elogio = t.elogios?.[prom >= 8 ? 0 : prom >= 6 ? 1 : prom >= 4 ? 2 : 3] || "";
    let texto = personaje(n) ? inline(personaje(n)) : "";
    if (!texto) {
      const mejor = APARTADOS.reduce((a, b) => (p[b.clave] > p[a.clave] ? b : a));
      const a = arquetipo(t, mejor.clave, p[mejor.clave]);
      texto = `Fuiste como <strong>${esc(a.nombre)}</strong> (<em>${esc(a.referencia)}</em>): ${esc(a.frase)}`;
    }
    let h = `<div class="juego"><div class="personaje"><div class="etiqueta">${t.emoji} Personaje de la reunión · ${esc(elogio)}<span class="xp-chip">+${xpR} ${esc(t.xp)}</span></div><div class="texto">${texto}</div>${opinion(n, t, texto)}</div>`;
    if (nuevos.length || i > antes) {
      h += `<div class="nuevos">`;
      if (i > antes) h += `<div class="etiqueta">⬆ ¡Subiste de rango!</div><div class="nuevo"><span class="emo">${icoRango(t, i)}</span><div><div class="nombre-rango">${esc(r.nombre)}</div><div class="frase">${esc(r.frase)}</div></div></div>`;
      if (nuevos.length) {
        h += `<div class="etiqueta" style="margin-top:${i > antes ? 12 : 0}px">🏆 Logros desbloqueados</div>`;
        nuevos.forEach((e) => { const l = logroTexto(t, e.def.id); h += `<div class="nuevo"><span class="emo">${icoLogro(t, e.def)}</span><div><strong>${esc(l.nombre)}</strong><div class="frase">${esc(l.descripcion)}</div></div><span class="xp">+${XP_LOGRO}</span></div>`; });
      }
      h += `</div>`;
    }
    const ult = E.notas.filter((x) => x.fecha <= n.fecha).sort((a, b) => a.fecha - b.fecha).map(puntajes).filter(Boolean).slice(-5);
    h += `<div class="apartados">` + APARTADOS.map((a, k) => {
      const v = p[a.clave], arq = arquetipo(t, a.clave, v);
      const promA = ult.reduce((s, x) => s + x[a.clave], 0) / Math.max(1, ult.length);
      const prox = v < 10 ? t.apartados[a.clave][v].nombre : null;
      const pie = (ult.length <= 1 ? "Primera reunión" : `Promedio últimas ${ult.length}: ${promA.toFixed(1)}`) + (prox ? ` · Próximo: ${esc(prox)}` : " · ¡Nivel máximo!");
      return `<div class="apartado" style="--i:${k}"><div class="cabeza"><span><span class="ico">${icoApartado(t, a)}</span> ${a.titulo}</span><span class="puntos">${v}<small>/10</small></span></div>
        <div class="segmentos">${Array.from({ length: 10 }, (_, s) => `<i class="${s < v ? "on" : ""}" style="--s:${s}"></i>`).join("")}</div>
        <div class="arq"><strong>${esc(arq.nombre)}</strong> · <em>${esc(arq.referencia)}</em></div><div class="frase">${esc(arq.frase)}</div><div class="pie">${pie}</div></div>`;
    }).join("") + `</div></div>`;
    return h;
  }

  function panelLogros() {
    const t = tema();
    if (!t) return "";
    const est = calcularLogros(E.notas), listos = est.filter((e) => e.fecha).length, xp = xpTotal(E.notas), { i, r } = rango(t, xp);
    const fmt = (d) => `${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
    const orden = [...est].sort((a, b) => (a.fecha ? 0 : 1) - (b.fecha ? 0 : 1) || (a.fecha || 0) - (b.fecha || 0) || (b.progreso / b.def.objetivo) - (a.progreso / a.def.objetivo));
    return `<h1>${txt("ico_logros", t.emoji)} ${esc(txt("logros", "Logros"))}</h1><div class="chips"><span class="chip-tipo">${esc(t.nombre)}</span><span>Cada logro suma ${XP_LOGRO} ${esc(t.xp)}</span></div>
      <div class="resumen"><div class="metrica"><div class="valor">${listos}<small>/${est.length}</small></div><div class="nombre">Logros desbloqueados</div></div>
      <div class="metrica"><div class="valor">${icoRango(t, i)} ${i + 1}</div><div class="nombre">${esc(r.nombre)}</div></div>
      <div class="metrica"><div class="valor">${xp}</div><div class="nombre">${esc(t.xp)} acumulados</div></div></div>
      ${(() => {
        const cerca = est.filter((e) => !e.fecha && e.def.objetivo > 1 && !e.def.id.startsWith("reuniones_")).map((e) => ({ e, act: e.racha ? e.actual : e.progreso }))
          .sort((a, b) => b.act / b.e.def.objetivo - a.act / a.e.def.objetivo).slice(0, 3);
        if (!cerca.length) return "";
        return `<div class="subtitulo">Lo que tienes al alcance</div><div class="alcance">${cerca.map(({ e, act }) => {
          const l = logroTexto(t, e.def.id), falta = e.def.objetivo - act;
          return `<div class="alcance-i"><span class="alcance-emo">${icoLogro(t, e.def)}</span><div><b>${esc(l.nombre)}</b>
            <p>${e.racha ? (act ? `Llevas <b>${act}</b> de ${e.def.objetivo} seguidas. ` : "Racha en 0. ") : `Llevas <b>${act}</b> de ${e.def.objetivo}. `}${esc(l.descripcion)}</p>
            <div class="barra"><div style="--p:${Math.max(0.04, act / e.def.objetivo)}"></div></div>
            <small>${falta === 1 ? "¡Te falta 1!" : `Te faltan ${falta}`}${e.racha ? " (si se corta, parte de cero)" : ""}</small></div></div>`;
        }).join("")}</div><div class="subtitulo">Todos los logros</div>`;
      })()}
      <div class="logros">${orden.map((e, k) => {
        const l = logroTexto(t, e.def.id), pct = Math.min(1, e.progreso / e.def.objetivo);
        const estado = e.fecha ? `✓ Desbloqueado el ${fmt(e.fecha)}` : e.racha ? `Racha actual: ${e.actual} de ${e.def.objetivo}` : e.def.objetivo > 1 ? `${e.def.formato(Math.min(e.progreso, e.def.objetivo))} de ${e.def.formato(e.def.objetivo)}` : "🔒 Bloqueado";
        return `<div class="logro ${e.fecha ? "listo" : "bloqueado"}" style="--i:${Math.min(k, 16)}"${e.fecha ? ` data-revivir="${e.def.id}" title="Volver a verlo"` : ""}><div class="emo">${icoLogro(t, e.def)}</div><div class="info"><strong>${esc(l.nombre || e.def.id)}</strong><div class="frase">${esc(l.descripcion || "")}</div>
          ${!e.fecha && e.def.objetivo > 1 ? `<div class="barra"><div style="--p:${Math.max(0.02, e.racha ? e.actual / e.def.objetivo : pct)}"></div></div>` : ""}<div class="pie">${estado}</div></div></div>`;
      }).join("")}</div>`;
  }

  function contenido() {
    if (E.seccion === "logros") return panelLogros();
    if (E.seccion === "progreso") return panelFoco();
    if (E.seccion === "preferencias") return panelPreferencias();
    if (E.seccion === "agenda") return panelAgenda();
    if (E.seccion === "personas") return panelPersonas();
    const n = notaActual();
    if (!n) return `<div class="vacio grande"><div>${tema()?.emoji || "📝"}</div><h2>Elige una reunión</h2><p>${ESCRITORIO ? "O graba una nueva desde el ícono de Minuta en la bandeja del sistema." : "O graba una nueva desde la barra de menú."}</p></div>`;
    const s = secciones(n);
    let h = cabeceraNota(n);
    if (E.vista === "puntos") h += `<article class="notas">${tarjetasSecciones(s.puntos)}</article>`;
    if (E.vista === "feedback" || E.vista === "metricas") h += panelDesempeno(n);
    if (E.vista === "transcripcion") {
      const filas = s.transcripcion.split("\n").map((l) => l.replace(/^[>\s]+/, "")).map((l) => l.match(/^\[(\d{2}:\d{2}:\d{2})\] ([^:]+): (.*)$/)).filter(Boolean)
        .map(([, hora, quien, txt]) => `<div class="turno"><span class="hora">${hora}</span><span class="quien${quien === "Yo" ? " yo" : ""}">${esc(quien)}</span><span>${esc(txt)}</span></div>`).join("");
      h += filas ? `<div class="turnos">${filas}</div>` : `<p class="vacio">Esta reunión no tiene transcripción guardada.</p>`;
    }
    return h;
  }

  /** Variables CSS para pintar una tarjeta con los colores de un universo (instalado o del catálogo). */
  function varsUniverso(e = {}) {
    const [img, tam] = (Object.hasOwn(PATRONES, e.patron || "") ? PATRONES[e.patron] : () => ["", ""])();
    return `--u-fondo:${e.fondo};--u-fondo2:${e.fondo2};--u-texto:${e.texto};--u-suave:${e.suave};--u-acento:${e.acento};--u-acento2:${e.acento2};--u-radio:${e.radio}px;--u-fuente:${e.fuente === "ui-rounded" ? "ui-rounded" : `'${e.fuente}'`};--u-mayus:${e.mayusculas ? "uppercase" : "none"};--u-cursiva:${e.cursiva ? "italic" : "normal"};--u-patron:${img || "none"};--u-patron-tam:${tam || "auto"}`;
  }
  E.catU = { estado: "", lista: [] };
  function pedirCatalogo(tipo = "universos") {
    const c = tipo === "idiomas" ? (E.catI ||= { estado: "", lista: [] }) : E.catU;
    if (c.estado === "cargando") return;
    c.estado = "cargando";
    host.enviar("catalogo", { tipo });
  }
  const CATALOGO_RAW = "https://raw.githubusercontent.com/minuta-app/minuta-catalogo/main/";
  function descargarUniverso(id, usar) {
    E.catU.bajando = id; render({ mantenerScroll: true });
    host.enviar("descargarUniverso", { id, usar: !!usar });
  }

  /** Votos de la comunidad: cada universo tiene un issue en el catálogo y los votos son sus reacciones 👍/👎 en GitHub. */
  const VOTOS_API = "https://api.github.com/repos/minuta-app/minuta-catalogo/issues?labels=votos&state=open&per_page=100";
  E.votosU = null;
  function pedirVotos() {
    if (E.votosU) return;
    E.votosU = {};
    fetch(VOTOS_API).then((r) => (r.ok ? r.json() : [])).then((lista) => {
      for (const i of Array.isArray(lista) ? lista : []) {
        const m = /\[([a-z0-9_-]+)\]\s*$/.exec(i.title || "");
        if (m && /^https:\/\/github\.com\//.test(i.html_url || "")) E.votosU[m[1]] = { si: +(i.reactions?.["+1"] || 0), no: +(i.reactions?.["-1"] || 0), url: i.html_url };
      }
      if (E.galeria) render({ mantenerScroll: true });
    }).catch(() => {});
  }
  const puntajeVotos = (id) => { const v = E.votosU?.[id]; return v ? v.si - v.no : 0; };
  const chipVotos = (id) => { const v = E.votosU?.[id]; return v && (v.si || v.no) ? `<span class="u-votos" title="Votos de la comunidad">👍 ${v.si}</span>` : ""; };
  function abrirVoto(id, voto) {
    const v = E.votosU?.[id]; if (!v?.url) return;
    const numero = +(/\/issues\/(\d+)/.exec(v.url)?.[1] || 0);
    // Con su cuenta de GitHub conectada, el voto queda como reacción sin salir de la app.
    if (E.comentCuenta && numero && voto && !host.esWeb) { host.enviar("votarUniverso", { id, numero, positivo: voto === "si" }); return; }
    host.enviar("abrirURL", { url: v.url });
  }

  function galeria() {
    if (!E.galeria) return "";
    if (!E.catU.estado) setTimeout(() => pedirCatalogo("universos"), 0);
    if (!E.votosU) setTimeout(pedirVotos, 0);
    pedirCuenta();
    const instalados = new Set(E.temas.map((t) => t.id));
    // Categorías: las del archivo o, en universos bajados antes de que existieran, las del catálogo.
    const catDe = (u) => u.categorias || E.catU.lista.find((x) => x.id === u.id)?.categorias || [];
    const q = norm(E.uBusca || ""), cat = E.uCat || "";
    const calza = (u) => (!cat || catDe(u).includes(cat)) && (!q || norm([u.nombre, u.id, u.xp, u.descripcion, ...catDe(u), ...catDe(u).map(tr)].join(" ")).includes(q));
    const todasCats = [...new Set([...E.temas, ...E.catU.lista].flatMap(catDe))].sort((a, b) => tr(a).localeCompare(tr(b)));
    const propios = E.temas.filter(calza);
    const porBajar = E.catU.lista.filter((u) => !instalados.has(u.id) && calza(u)).sort((a, b) => puntajeVotos(b.id) - puntajeVotos(a.id));
    const sinNada = (q || cat) && !propios.length && !porBajar.length && E.catU.estado !== "cargando";
    const prev = E.previa && E.catU.lista.find((u) => u.id === E.previa);
    return `<div class="galeria" data-accion="cerrar-galeria"><div class="galeria-caja" role="dialog" aria-modal="true" aria-label="Elige tu universo">
      <div class="galeria-cab"><div><h2>Elige tu universo</h2><p>Cambia colores, formas, personajes, rangos y logros.</p></div><button class="boton" data-accion="cerrar-galeria" title="Cerrar (Esc)">✕</button></div>
      ${forja()}
      <div class="u-filtros">
        <label class="u-buscador"><span aria-hidden="true">⌕</span><input id="u-busca" type="search" value="${esc(E.uBusca || "")}" placeholder="Buscar universo: Naruto, autos, anime…" autocomplete="off" aria-label="Buscar universo"></label>
        ${todasCats.length ? `<div class="u-cats" role="group" aria-label="Categorías"><button class="u-cat${cat ? "" : " activa"}" data-u-cat="">Todas</button>${todasCats.map((c) => `<button class="u-cat${cat === c ? " activa" : ""}" data-u-cat="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : ""}
      </div>
      ${sinNada ? `<div class="u-nada"><div class="u-nada-emoji">🌌</div><b>${q ? `Aún no existe nada de «${esc((E.uBusca || "").trim())}»` : `Aún no hay universos de ${esc(cat)}`}</b>
        <p>${q ? "¿Quieres crearlo? Tu IA lo arma en unos minutos, con sus personajes, rangos y logros." : "¿Creas el primero? Tu IA lo arma en unos minutos."}</p>
        <button class="boton-txt aplicar" data-crear-desde="${esc(q ? (E.uBusca || "").trim() : "")}">⚒️ ${q ? "Crearlo" : "Crear un universo"}</button></div>` : ""}
      ${propios.length || !(q || cat) ? `<div class="u-sub">Tus universos</div>
      <div class="galeria-grid">${propios.map((t) => {
        const borrable = !t.incluido && t.id !== "cine";
        return `<div class="u-celda"><button class="universo${t.id === E.temaId ? " elegido" : ""}" data-universo="${t.id}" style="${varsUniverso(t.estilo)}">
          <span class="u-emoji">${t.emoji}</span><span class="u-nombre">${esc(t.nombre)}</span><span class="u-xp">XP: ${esc(t.xp)}${t.creado ? "" : chipVotos(t.id)}</span>
          <span class="u-iconos">${(t.iconos_rangos || []).slice(0, 7).join(" ")}</span>${t.id === E.temaId ? '<span class="u-check">✓</span>' : ""}${t.creado ? '<span class="u-creado">⚒️ creado</span>' : t.incluido ? "" : '<span class="u-creado">⬇ descargado</span>'}</button>
          ${borrable ? `<button class="boton-mini u-quitar" data-forja="borrar-u" data-id="${esc(t.id)}" title="Quitar este universo">🗑</button>` : ""}
          ${t.creado ? `<button class="boton-mini u-proponer" data-proponer-u="${esc(t.id)}" title="Proponerlo al catálogo para que otros lo usen">📤</button>` : ""}</div>`;
      }).join("")}${q || cat ? "" : `<button class="universo u-nuevo" data-forja="abrir"><span class="u-emoji">＋</span><span class="u-nombre">Crear universo</span><span class="u-xp">Con tu IA, en ~5 min</span></button>`}</div>` : ""}
      ${porBajar.length || !(q || cat) ? `<div class="u-sub">Más universos para descargar ${E.catU.estado === "cargando" ? `<small>cargando…</small>` : E.catU.error && !E.catU.lista.length ? `<small>sin conexión al catálogo</small>` : `<small>${porBajar.length} disponibles · gratis</small>`}</div>
      ${porBajar.length ? `<div class="galeria-grid">${porBajar.map((u) => `<div class="u-celda"><button class="universo u-catalogo" data-previa="${esc(u.id)}" style="${varsUniverso(u.estilo)}" title="Ver cómo es">
          <span class="u-emoji">${u.emoji}</span><span class="u-nombre">${esc(u.nombre)}</span><span class="u-xp">XP: ${esc(u.xp)}${chipVotos(u.id)}</span>
          <span class="u-iconos">${(u.muestra?.iconos_rangos || []).slice(0, 7).join(" ")}</span><span class="u-creado">👁 ver</span></button>
          <button class="boton-mini u-bajar" data-bajar-u="${esc(u.id)}" title="Descargar">${E.catU.bajando === u.id ? "…" : "⬇"}</button></div>`).join("")}</div>`
        : E.catU.estado === "listo" ? `<p class="cat-ayuda">Ya tienes todos los universos del catálogo. 🎉</p>` : ""}` : ""}
      ${prev ? previaUniverso(prev) : ""}
    </div></div>`;
  }
  /** Vista previa de un universo del catálogo, con sus colores, rangos, arquetipos y logros, sin descargarlo. */
  function previaUniverso(u) {
    const m = u.muestra || {};
    return `<div class="u-previa" style="${varsUniverso(u.estilo)}" role="dialog" aria-modal="true" aria-label="Vista previa de ${esc(u.nombre)}">
      <div class="up-cab"><span class="up-emoji">${u.emoji}</span><div><h3>${esc(u.nombre)}</h3><p>${esc(u.descripcion || "")}</p>${E.votosU?.[u.id] ? `<div class="up-votos"><span>${E.comentCuenta ? "¿Te gusta?" : "¿Te gusta? Vota en GitHub:"}</span><button class="boton-mini${E.votosU[u.id].mio === "si" ? " activo" : ""}" data-votar-u="${esc(u.id)}" data-voto="si" title="${E.comentCuenta ? "Votar a favor" : "Abre GitHub para votar"}">👍 ${E.votosU[u.id].si}</button><button class="boton-mini${E.votosU[u.id].mio === "no" ? " activo" : ""}" data-votar-u="${esc(u.id)}" data-voto="no" title="${E.comentCuenta ? "Votar en contra" : "Abre GitHub para votar"}">👎 ${E.votosU[u.id].no}</button><button class="boton-mini" data-comentar-u="${esc(u.id)}" title="Comentar este universo">💬</button></div>` : ""}</div><button class="boton-mini" data-previa-cerrar title="Cerrar">✕</button></div>
      ${m.elogio ? `<blockquote class="up-elogio">“${esc(m.elogio)}”</blockquote>` : ""}
      <div class="up-cols">
        <div><div class="up-eti">Rangos</div><ol class="up-rangos">${(m.rangos || []).map((r, i) => `<li><span>${esc(m.iconos_rangos?.[i] || "")}</span>${esc(r)}</li>`).join("")}</ol></div>
        <div><div class="up-eti">Así te describiría</div>${(m.arquetipos || []).map((a) => `<div class="up-arq"><b>${esc(a.nombre)}</b> <em>${esc(a.referencia || "")}</em><p>${esc(a.frase || "")}</p></div>`).join("")}
          <div class="up-eti">Algunos logros</div>${(m.logros || []).map((l) => `<div class="up-logro"><b>${esc(l.nombre)}</b> · ${esc(l.descripcion)}</div>`).join("")}</div>
      </div>
      <div class="up-acc"><small>Los puntos se llaman «${esc(u.xp)}» · ${Math.round((u.bytes || 0) / 1024)} KB</small>
        <button class="boton-txt" data-bajar-u="${esc(u.id)}">⬇ Descargar</button><button class="boton-txt aplicar" data-bajar-u="${esc(u.id)}" data-usar="1">⬇ Descargar y usar</button></div>
    </div>`;
  }

  // ───────────────────────── Panel de la barra de menú ─────────────────────────
  const PANEL = !!window.MINUTA_PANEL || /panel/.test(location.hash);
  if (PANEL) RAIZ.classList.add("panel");
  E.pan = { fase: "inactiva", desde: 0, detectada: null, titulo: "", tipo: "", estado: "", inicio: false };
  E.panVista = "inicio";
  const GRABAR = {
    starwars: ["Iniciar transmisión", "Cortar transmisión"], harrypotter: ["Al pensadero", "Sacar el recuerdo"],
    senoranillos: ["Comenzar la crónica", "Cerrar el capítulo"], marvel: ["¡Vengadores, a grabar!", "Fin del episodio"],
    rapidoyfurioso: ["Arrancar motores", "Bandera a cuadros"], dragonball: ["¡Cargar el ki!", "Liberar el ki"],
    simpsons: ["¡Ay, caramba, a grabar!", "Fin del capítulo"], gameofthrones: ["Convocar al consejo", "Levantar la sesión"],
    shrek: ["Grabar en el pantano", "Fin del cuento"], piratas: ["¡Leven anclas!", "Echar el ancla"],
    toystory: ["¡Al infinito… y a grabar!", "Volver a la caja"], cine: ["¡Acción!", "¡Corte!"],
  };
  const PROCESANDO = {
    starwars: "Descifrando la transmisión…", harrypotter: "El pensadero está ordenando el recuerdo…", senoranillos: "Los escribas pasan la crónica en limpio…",
    marvel: "JARVIS está escribiendo el informe…", rapidoyfurioso: "En boxes: afinando tus notas…", dragonball: "Entrenando en la Habitación del Tiempo…",
    simpsons: "Escribiendo el episodio…", gameofthrones: "El maestre redacta las actas…", shrek: "Los ogros escriben el cuento…",
    piratas: "Anotando en la bitácora…", toystory: "Los juguetes ordenan tus notas…", cine: "En la sala de edición…",
  };
  const reloj = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
  const haceCuanto = (d) => {
    const m = Math.round((Date.now() - d) / 60000);
    if (m < 1) return "recién"; if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60); if (h < 24) return `hace ${h} h`;
    const dd = Math.round(h / 24); return dd === 1 ? "ayer" : `hace ${dd} días`;
  };

  function semana() {
    const ahora = Date.now(), D = 7 * 864e5;
    const de = (a, b) => E.notas.filter((n) => n.fecha >= ahora - a && n.fecha < ahora - b).map(stats);
    const esta = de(D, 0), antes = de(2 * D, D);
    const suma = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
    const mul = (arr) => { const h = suma(arr, (x) => x.hablaMin); return h ? suma(arr, (x) => x.totalMul) / h * 10 : null; };
    const flecha = (a, b, mejorBaja) => {
      if (a == null || b == null || b === 0) return "";
      const d = (a - b) / b; if (Math.abs(d) < 0.05) return `<i class="igual">=</i>`;
      const bien = mejorBaja ? d < 0 : d > 0;
      return `<i class="${bien ? "bien" : "mal"}">${d > 0 ? "▲" : "▼"}</i>`;
    };
    const mE = mul(esta), mA = mul(antes);
    return `<div class="pn-kpis card">
      <div><b>${esta.length}${flecha(esta.length, antes.length)}</b><span>reuniones</span></div>
      <div><b>${Math.round(suma(esta, (x) => x.dur))}<small>min</small></b><span>en reuniones</span></div>
      <div><b>${mE == null ? "—" : mE.toFixed(1)}${flecha(mE, mA, true)}</b><span>muletillas /10 min</span></div>
    </div>`;
  }

  /** Tu nivel en una sola fila: rango, lo que falta y logros. Tocarlo abre los universos. */
  function nivelPanel() {
    const t = tema(); if (!t) return "";
    const xp = xpTotal(E.notas), { i, r, sig } = rango(t, xp);
    const prog = sig ? (xp - UMBRALES[i]) / (sig - UMBRALES[i]) : 1;
    const logros = calcularLogros(E.notas).filter((e) => e.fecha).length;
    return `<button class="pn-nivel card" data-pn-vista="universos" title="${esc(t.nombre)} · cambiar de universo">
      <span class="pn-nivel-ico">${icoRango(t, i)}</span>
      <span class="pn-nivel-txt"><b>${esc(r.nombre)}</b><small>Rango ${i + 1}${sig ? ` · faltan ${sig - xp} ${esc(t.xp)}` : " · rango máximo"}</small></span>
      <span class="pn-nivel-logros" title="${logros} logros desbloqueados"><b>${logros}</b>🏅</span>
      <i class="pn-nivel-barra" style="--p:${Math.max(0.03, Math.min(1, prog))}"></i></button>`;
  }
  /** Elige el tipo de reunion desde el panel (clic o teclas 1–9). */
  function elegirTipoPanel(id) {
    E.pan.tipo = id; E.pan.tipoAuto = false; E.pnTipoMenu = false;
    host.enviar("tipo", { tipo: id }); render({ mantenerScroll: true });
  }
  function panelInicio() {
    const t = tema(), p = E.pan, vv = t?.estilo?.ventana || {};
    const [verbo, parar] = GRABAR[t?.id] || [vv.grabar || "Grabar reunión", vv.parar || "Detener"];
    let bloque = "";
    if (p.fase === "grabando") {
      bloque = `<section class="pn-grabando card">
        <div class="pn-onda" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="pn-reloj" data-desde="${p.desde}">${reloj(Date.now() - p.desde)}</div>
        ${E.ajustes.coachVivo === false ? "" : `<div class="pn-vivo" id="pn-vivo">${vivoHTML()}</div>`}
        <div class="pn-que">${esc(p.titulo || "Reunión sin título")}${p.plataforma ? ` · ${esc(p.plataforma)}` : ""}</div>
        <div class="pestanas pn-tipos pn-tipos-mini" role="radiogroup" aria-label="Tipo de reunión (puedes cambiarlo)">${E.categorias.map((c) =>
          `<button role="radio" aria-checked="${p.tipo === c.id}" class="pestana${p.tipo === c.id ? " activa" : ""}" data-pn-tipo="${esc(c.id)}" title="${esc(c.descripcion || c.nombre)}"><span class="pn-emo">${esc(c.emoji)}</span>${esc(c.nombre)}</button>`).join("")}</div>
        <button class="pn-parar" data-pn="detener"><span class="pn-cuadro"></span><span class="pn-parar-txt"><b>${esc(parar)}</b><small>Detener y generar notas</small></span></button>
      </section>`;
    } else if (p.fase === "procesando") {
      bloque = `<section class="pn-procesando card"><div class="pn-cargando" aria-hidden="true"><i></i></div>
        <div><b>${esc(PROCESANDO[t?.id] || t?.estilo?.ventana?.procesando || "Generando tus notas…")}</b><small>Transcribo, separo voces y escribo el feedback. Te aviso al terminar.</small></div></section>`;
    } else {
      bloque = `${p.detectada ? `<div class="pn-alerta"><span class="pn-punto"></span><div><b>Reunión detectada en ${esc(p.detectada)}</b><small>¿La grabo?</small></div></div>` : ""}
        <div class="pn-fila-titulo">
          <label class="buscador pn-campo"><span class="lupa">✎</span><input id="pn-titulo" placeholder="Título (opcional)" value="${esc(p.titulo)}" autocomplete="off" aria-label="Título de la reunión (opcional, lo saco del calendario)"></label>
          <div class="pn-tipo-sel">${(() => { const c = categoria(p.tipo); return `<button class="pestana activa pn-tipo-btn" data-pn-tipomenu aria-haspopup="menu" aria-expanded="${!!E.pnTipoMenu}" title="Tipo de reunión · tu IA evaluará: ${esc(c.descripcion || c.nombre)}"><span class="pn-emo">${esc(c.emoji || "💬")}</span><span class="pn-tipo-nom">${esc(c.nombre || "Tipo")}</span>${p.tipoAuto ? '<sup title="Elegido solo por el calendario o la app">auto</sup>' : ""}<span class="pn-flecha">▾</span></button>`; })()}
            ${E.pnTipoMenu ? `<div class="menu-mas pn-tipo-menu" role="menu" aria-label="Tipo de reunión">${E.categorias.map((c, i) =>
              `<button role="menuitemradio" aria-checked="${p.tipo === c.id}" data-pn-tipo="${esc(c.id)}"><span>${esc(c.emoji)}</span><span class="pn-tm-txt"><b>${esc(c.nombre)}</b><small>Tu IA evaluará: ${esc(c.descripcion || "comunicación general")}</small></span>${p.tipo === c.id ? "<kbd>✓</kbd>" : ""}${i < 9 ? `<kbd>${i + 1}</kbd>` : ""}</button>`).join("")}
              <hr><button data-pn="preferencias"><span>✎</span>Editar tipos de reunión</button></div>` : ""}</div>
        </div>
        <button class="pn-grabar" data-pn="grabar"><span class="pn-rec"></span><span class="pn-verbo">${esc(verbo)}</span></button>`;
    }
    const recientes = E.notas.slice(0, 3).map((n) => `<div class="fila-env"><button class="fila" data-pn-nota="${esc(n.ruta)}"><span class="tipo-barra t-${esc(n.tipo || "Otra")}"></span>
      <span class="fila-txt"><span class="fila-titulo">${esc(n.titulo)}</span><span class="fila-det">${haceCuanto(n.fecha)}${n.duracion ? ` · ${Math.round(n.duracion)} min` : ""}</span></span></button>
      <button class="fila-borrar" data-borrar="${esc(n.ruta)}" title="Borrar reunión" aria-label="Borrar ${esc(n.titulo)}">🗑</button></div>`).join("");
    const cola = p.procesando || [];
    const enFondo = cola.length ? `<section class="pn-procesando pn-fondo card"><div class="pn-cargando" aria-hidden="true"><i></i></div>
        <div><b>${esc(PROCESANDO[t?.id] || t?.estilo?.ventana?.procesando || "Generando tus notas…")}</b><small>«${esc(cola[0])}»${cola.length > 1 ? ` · y ${cola.length - 1} más en espera` : ""} · en segundo plano, puedes grabar otra reunión.</small></div></section>` : "";
    return `${nivelPanel()}
      ${p.fase === "inactiva" ? proximaPanel() : ""}
      ${bloque}
      ${enFondo}
      ${p.estado && p.fase !== "procesando" ? `<div class="pn-estado">${esc(p.estado)}${/^Lista:/.test(p.estado) && E.notas[0] ? ` <button class="pn-link" data-pn-enviar="${esc(E.notas[0].ruta)}">✉︎ Enviar resumen</button>` : ""}</div>` : ""}
      ${p.fase !== "grabando" ? `${E.notas.length ? `<div class="pn-tit">Tu semana<button class="pn-link" data-pn="semana" ${p.fase !== "inactiva" ? "disabled" : ""} title="Resumen de la semana con tu IA">📅 Resumen</button></div>${semana()}` : ""}
      ${recientes ? `<div class="pn-tit">${esc(txt("reuniones", "Recientes"))}</div><nav class="lista pn-lista">${recientes}</nav>` : ""}` : ""}`;
  }

  function panelUniversos() {
    return `<div class="pn-tit">Elige tu universo<button class="pn-link" data-pn-vista="inicio">← Volver</button></div>
      <div class="pn-universos">${E.temas.map((t) => {
        const e = t.estilo || {};
        return `<button class="pn-u${t.id === E.temaId ? " elegido" : ""}" data-universo="${t.id}" title="${esc(t.nombre)}" style="--u-fondo:${e.fondo};--u-fondo2:${e.fondo2};--u-acento:${e.acento};--u-texto:${e.texto};--u-radio:${Math.min(e.radio, 14)}px">
          <span>${t.emoji}</span><small>${esc(t.nombre.replace(/ \(.*\)/, ""))}</small></button>`;
      }).join("")}</div>`;
  }

  function panelAjustes() {
    return `<div class="pn-tit">Ajustes<button class="pn-link" data-pn-vista="inicio">← Volver</button></div>
      <button class="pn-opcion card" data-pn="inicio"><span>Abrir Minuta al iniciar sesión</span><span class="pn-interruptor${E.pan.inicio ? " on" : ""}"><i></i></span></button>
      <button class="pn-opcion card peligro" data-pn="salir" ${E.pan.fase === "grabando" ? "disabled" : ""}><span>Salir de Minuta</span><kbd>⏻</kbd></button>`;
  }

  function panel() {
    const t = tema(), p = E.pan;
    const nueva = p.actualizacion?.hay && p.fase === "inactiva" && !(p.procesando || []).length;
    const cuerpo = E.panVista === "universos" ? panelUniversos() : E.panVista === "ajustes" ? panelAjustes() : panelInicio();
    return `<div class="pn${E.pan.fase === "grabando" ? " en-vivo" : ""}">
      <header class="pn-cab">
        <div class="pn-marca"><span class="pn-logo">${E.pan.fase === "grabando" ? '<span class="pn-rec chico"></span>' : t?.emoji || "🎙️"}</span><b>Minuta</b><span class="pn-sub">${esc(TITULO_VENTANA[t?.id] || t?.estilo?.ventana?.titulo || "")}</span></div>
        <div class="pn-acc">
          <button class="boton${E.panVista === "ajustes" ? " activo" : ""}" data-pn-vista="${E.panVista === "ajustes" ? "inicio" : "ajustes"}" title="Ajustes">⚙</button>
          <button class="boton" data-pn="visor" title="Abrir Minuta">↗</button>
        </div>
      </header>
      ${nueva ? `<button class="pn-act-fila" data-act="instalar" title="Tus notas, perfil y universos no se tocan"><span>⬆</span><b>Actualización pendiente</b><em>Instalar</em></button>` : ""}
      <div class="pn-cuerpo">${cuerpo}</div>
    </div>`;
  }

  /** Medidores del coach en vivo (se actualizan sin redibujar todo el panel). */
  function vivoHTML() {
    const v = E.vivo || {}, ev = proximos(1).find((e) => e.inicio <= Date.now());
    const np = Math.max(2, (ev?.asistentes?.length || 2) + 1), justo = 100 / np, hi = Math.round(Math.min(75, justo * 1.35 + 5));
    const pct = v.pct ?? -1, r = v.racha || 0;
    const semPct = pct < 0 ? "" : pct <= hi ? "bien" : pct <= hi + 12 ? "ojo" : "mal";
    const semR = r < 60 ? "bien" : r < 90 ? "ojo" : "mal";
    return `<div class="vv"><span class="vv-eti">Tu habla</span><b class="${semPct}">${pct < 0 ? "…" : pct + "%"}</b><small>ideal ≤ ${hi}%</small></div>
      <div class="vv"><span class="vv-eti">${v.hablandoAhora ? "🎙️ Hablando" : "De corrido"}</span><b class="${semR}">${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}</b><small>máx ${Math.floor((v.rachaMax || 0) / 60)}:${String((v.rachaMax || 0) % 60).padStart(2, "0")}</small></div>
      <div class="vv" title="Cuenta solo cuando tomas la palabra y la otra persona se calla. Un «sí» o «ya» no cuenta."><span class="vv-eti">Cortaste a alguien</span><b class="${(v.interrupciones || 0) <= 1 ? "bien" : (v.interrupciones || 0) <= 3 ? "ojo" : "mal"}">${v.interrupciones || 0}</b><small>aprox.</small></div>`;
  }
  let _relojPanel = 0;
  function tic() {
    clearInterval(_relojPanel);
    if (E.pan.fase !== "grabando") return;
    _relojPanel = setInterval(() => { const r = $(".pn-reloj"); if (r) r.textContent = reloj(Date.now() - E.pan.desde); }, 1000);
  }
  function reportarAlto() {
    if (!PANEL) return;
    requestAnimationFrame(() => {
      const pn = $(".pn"); if (!pn) return;
      const cs = getComputedStyle(document.body);
      const extra = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      host.enviar("panelAlto", { alto: Math.ceil(pn.getBoundingClientRect().height + extra + 2 * (parseFloat(getComputedStyle($("#lienzo")).top) || 0)) });
    });
  }

  // ───────────────────────── Borrar reuniones ─────────────────────────
  function confirmarBorrado() {
    const n = E.notas.find((x) => x.ruta === E.borrar);
    if (!n) return "";
    return `<div class="galeria borrar-fondo" data-accion="cancelar-borrar"><div class="galeria-caja borrar-caja" role="alertdialog" aria-modal="true" aria-label="Borrar reunión">
      <div class="borrar-ico">🗑</div>
      <h2>¿Borrar esta reunión?</h2>
      <p class="borrar-nota"><span class="tipo-barra t-${esc(n.tipo || "Otra")}"></span><b>${esc(n.titulo)}</b><small>${hhmm(n.fecha)}${n.duracion ? ` · ${Math.round(n.duracion)} min` : ""}${n.tipo ? ` · ${esc(nombreTipo(n.tipo))}` : ""}</small></p>
      ${E.perfil?.respaldo ? `<p class="borrar-det">Tus notas se respaldan en <b>${E.perfil.respaldo === "gitlab" ? "GitLab" : "GitHub"}</b>. ¿Qué hago con esta?</p>
      <div class="borrar-opciones">
        <button class="borrar-op" data-accion="si-borrar" data-del-respaldo="0"><b>Solo quitarla de Minuta</b><small>Sigue en tu respaldo, en la carpeta «archivadas» de tus notas.</small></button>
        <button class="borrar-op peligro" data-accion="si-borrar" data-del-respaldo="1"><b>Borrarla también del respaldo</b><small>Va a la Papelera y se quita del repositorio (git conserva su historial).</small></button>
      </div>
      <div class="borrar-botones uno"><button class="boton-txt" data-accion="cancelar-borrar">Cancelar</button></div>`
      : `<p class="borrar-det">La nota se va a la <b>Papelera</b> (puedes recuperarla desde ahí). Tu nivel y tus logros se recalculan sin ella.</p>
      <div class="borrar-botones"><button class="boton-txt" data-accion="cancelar-borrar">Cancelar</button><button class="boton-txt peligro" data-accion="si-borrar">Borrar</button></div>`}
    </div></div>`;
  }
  function borrarNota(ruta, delRespaldo = true) {
    const i = E.notas.findIndex((n) => n.ruta === ruta);
    if (i < 0) return;
    const [n] = E.notas.splice(i, 1); marcarCambioNotas();
    if (E.sel === ruta) E.sel = (E.notas[i] || E.notas[i - 1])?.ruta || null;
    _cachePuntajes.clear();
    E.borrar = null;
    host.enviar("borrar", { ruta, delRespaldo });
    if (E.sel && !PANEL) host.enviar("seleccion", { ruta: E.sel });
    render({ mantenerScroll: true });
    const corto = n.titulo.length > 38 ? n.titulo.slice(0, 36) + "…" : n.titulo;
    toast(E.perfil?.respaldo && !delRespaldo ? `“${corto}” archivada (sigue en tu respaldo)` : `“${corto}” a la Papelera`);
  }

  // ───────────────────────── Preferencias: categorías ─────────────────────────
  const IDIOMAS_NOTAS = [["español", "Español"], ["español de Chile", "Español (Chile)"], ["español de México", "Español (México)"], ["español de España", "Español (España)"],
    ["English", "English"], ["português do Brasil", "Português (Brasil)"], ["français", "Français"], ["deutsch", "Deutsch"], ["italiano", "Italiano"]];
  const IDIOMAS_AUDIO = [["auto", "Detectar solo"], ["es", "Español"], ["en", "English"], ["pt", "Português"], ["fr", "Français"], ["de", "Deutsch"], ["it", "Italiano"]];
  /** Tú e idiomas: lo que antes estaba fijo en el código ahora es tu perfil (~/minuta/perfil.json). */
  function seccionPerfil() {
    const p = E.perfil || {}, I = E.idioma, cat = (E.catI && E.catI.lista) || [];
    if (!E.catI) setTimeout(() => pedirCatalogo("idiomas"), 0);
    const inst = new Set((I.instalados || []).map((x) => x.codigo));
    const opcion = (lista, actual) => lista.map(([v, n]) => `<option value="${esc(v)}"${v === actual ? " selected" : ""}>${esc(n)}</option>`).join("");
    const notasOtra = p.idioma && !IDIOMAS_NOTAS.some(([v]) => v === p.idioma);
    return `<div class="subtitulo">Tú e idiomas</div>
      <p class="pref-intro">Con esto tu IA sabe a quién le da feedback y en qué idioma escribirte. Se guarda solo en tu computador.</p>
      <section class="card pref-perfil">
        <div class="pp-fila">
          <label class="cat-campo"><span>Tu nombre</span><input data-perfil="nombre" value="${esc(p.nombre || "")}" placeholder="ej: Ana"></label>
          <label class="cat-campo"><span>Nombre completo <small>para reconocerte en las invitaciones</small></span><input data-perfil="nombre_completo" value="${esc(p.nombre_completo || "")}" placeholder="ej: Ana Pérez"></label>
        </div>
        <label class="cat-campo"><span>Qué haces <small>le da contexto al feedback</small></span><input data-perfil="descripcion" value="${esc(p.descripcion || "")}" placeholder="ej: Product Manager en una startup"></label>
        <div class="pp-fila">
          <label class="cat-campo"><span>Idioma de la app</span><select data-idioma-ui>${(I.instalados || []).map((x) => `<option value="${esc(x.codigo)}"${x.codigo === I.codigo ? " selected" : ""}>${esc(x.bandera || "")} ${esc(x.nombre)}</option>`).join("")}</select></label>
          <label class="cat-campo"><span>Idioma de tus notas <small>lo que escribe tu IA</small></span><select data-perfil-sel="idioma">${opcion(IDIOMAS_NOTAS, p.idioma)}${notasOtra ? `<option selected>${esc(p.idioma)}</option>` : ""}</select></label>
          <label class="cat-campo"><span>Idioma de tus reuniones <small>para transcribir</small></span><select data-perfil-sel="idioma_audio">${opcion(IDIOMAS_AUDIO, p.idioma_audio || "auto")}</select></label>
        </div>
        ${cat.filter((x) => !inst.has(x.codigo)).length ? `<div class="pp-idiomas"><small>Más idiomas para la app:</small> ${cat.filter((x) => !inst.has(x.codigo)).map((x) =>
          `<button class="boton-mini pp-bajar" data-bajar-idioma="${esc(x.codigo)}">${E.catI.bajando === x.codigo ? "…" : `⬇ ${esc(x.bandera || "")} ${esc(x.nombre)}`}</button>`).join(" ")}</div>` : ""}
      </section>
      <section class="card pref-comentarios"><div><b>🧭 Bienvenida</b><p>Vuelve a revisar tu IA, el modelo de transcripción, tus notas y su respaldo.</p></div>
        <button class="boton-txt" data-accion="bienvenida">Abrir la bienvenida</button></section>
      <section class="card pref-comentarios"><div><b>✨ Versión ${esc(E.version || "")}</b><p><span>${E.act.hay ? "Hay una versión nueva lista para instalar." : E.act.alDia ? "✓ Estás en la última versión." : "Minuta revisa sola si hay versiones nuevas."}</span> <span>Tus notas, perfil y universos no se tocan al actualizar.</span></p></div>
        <button class="boton-txt${E.act.hay ? " aplicar" : ""}" data-act="${E.act.hay ? "instalar" : "buscar"}" ${E.act.buscando ? "disabled" : ""}>${E.act.hay ? "Actualizar ahora" : E.act.buscando ? "Buscando…" : "Buscar actualizaciones"}</button></section>
      <section class="card pref-comentarios"><div><b>💬 ¿Algo no funciona o tienes una idea?</b><p>Cuéntanos: llega como un reporte público en GitHub. No incluyas datos de tus reuniones.</p></div>
        <button class="boton-txt aplicar" data-accion="comentarios">Enviar comentarios</button></section>
      ${acercaDe()}`;
  }
  /** Créditos y enlaces: quién hace Minuta, con qué está hecha y dónde está el código. */
  const ENLACES = [["🌐", "Sitio web", "https://minuta-app.github.io/minuta/"], ["🧾", "Código en GitHub", "https://github.com/minuta-app/minuta"],
    ["🌌", "Catálogo de universos e idiomas", "https://github.com/minuta-app/minuta-catalogo"], ["🤖", "Guía de tu IA", "https://minuta-app.github.io/minuta/ia.html"],
    ["💬", "Comunidad", "https://github.com/minuta-app/minuta/discussions"], ["🙌", "Quiénes la hacen", "https://github.com/minuta-app/minuta/graphs/contributors"]];
  function acercaDe() {
    return `<section class="card acerca"><div><b>🎙️ Acerca de Minuta</b><p><span data-sin-traducir>Minuta ${esc(E.version || "")}</span> <span>es gratis y de código abierto (licencia AGPL-3.0), hecha por su comunidad. Sin servidores ni cuentas: todo es tuyo.</span></p></div>
      <div class="acerca-enlaces">${ENLACES.map(([i, n, u]) => `<button class="boton-mini" data-bv-url="${u}">${i} ${n}</button>`).join("")}</div>
      <p class="acerca-creditos">Hecha con <b>whisper.cpp</b> (transcripción), <b>${ESCRITORIO ? "sherpa-onnx" : "FluidAudio"}</b> (separación de voces), <b>Python</b>${ESCRITORIO ? " y <b>Electron</b>" : " y <b>SwiftUI</b>"}. Los universos son homenajes de fans creados por la comunidad; las marcas y personajes pertenecen a sus dueños.</p></section>`;
  }

  function panelPreferencias() {
    const uso = (id) => E.notas.filter((n) => n.tipo === id).length;
    const lista = (a) => esc((a || []).join(", "));
    const cats = E.categorias.map((c, i) => `
      <section class="card cat" data-cat="${i}" style="--cat:${esc(c.color)};--i:${i}">
        <div class="cat-cab">
          <input class="cat-emoji" data-campo="emoji" value="${esc(c.emoji)}" maxlength="4" aria-label="Emoji">
          <input class="cat-nombre" data-campo="nombre" value="${esc(c.nombre)}" placeholder="Nombre" aria-label="Nombre de la categoría">
          <span class="cat-uso">${uso(c.id)} reuniones</span>
          <button class="boton cat-borrar" data-cat-borrar="${i}" title="${E.categorias.length > 1 ? "Eliminar categoría" : "Debe quedar al menos una"}" ${E.categorias.length > 1 ? "" : "disabled"}>🗑</button>
        </div>
        <div class="cat-colores" role="radiogroup" aria-label="Color">${COLORES_CAT.map((col) =>
          `<button class="cat-color${col === c.color ? " elegido" : ""}" data-cat-color="${i}|${col}" style="background:${col}" aria-label="Color ${col}"></button>`).join("")}</div>
        <label class="cat-campo"><span>Descripción corta <small>se muestra al grabar</small></span><input data-campo="descripcion" value="${esc(c.descripcion)}" placeholder="ej: ventas y demos"></label>
        <label class="cat-campo"><span>¿Qué debe evaluar tu IA? <small>el enfoque del feedback</small></span><textarea data-campo="enfoque" rows="3" placeholder="ej: Es una reunión de ventas. Evalúa si descubrí necesidades, manejé objeciones y cerré con un siguiente paso.">${esc(c.enfoque)}</textarea></label>
        <details class="cat-reglas"${(c.dominios?.length || c.palabras?.length || c.apps?.length) ? "" : ""}><summary>Elegirla sola cuando…</summary>
          <label class="cat-campo"><span>Los invitados tienen correo de</span><input data-campo="dominios" data-lista value="${lista(c.dominios)}" placeholder="empresa.cl, otra.com"></label>
          <label class="cat-campo"><span>El título de la reunión contiene</span><input data-campo="palabras" data-lista value="${lista(c.palabras)}" placeholder="demo, sprint, cliente"></label>
          <label class="cat-campo"><span>La reunión es en la app</span><input data-campo="apps" data-lista value="${lista(c.apps)}" placeholder="Microsoft Teams, zoom.us"></label>
          <p class="cat-ayuda">Separa con comas. Si varias calzan, gana el correo, luego el título y al final la app. Si tú eliges otra, se respeta.</p>
        </details>
      </section>`).join("");
    return `<h1>${txt("ico_preferencias", "⚙️")} Preferencias</h1>

      ${seccionPerfil()}
      ${seccionAvisos()}
      <div class="subtitulo">Categorías de reunión</div>
      <p class="pref-intro">Las <b>categorías</b> le dicen a tu IA con qué lente evaluar cada reunión y separan tu progreso por tipo.
      Minuta elige una sola usando tu calendario; siempre puedes cambiarla antes de grabar.</p>
      <div class="cats">${cats}</div>
      <button class="boton-txt cat-nueva" data-cat-nueva>＋ Nueva categoría</button>
      <div class="subtitulo">Correcciones automáticas</div>
      <p class="pref-intro">Palabras que la transcripción escribe mal y Minuta corrige sola en cada reunión nueva. Se agregan desde una nota con ✎ (⌘E) o seleccionando el texto.</p>
      ${E.correcciones.length ? `<div class="corr-lista">${E.correcciones.map((c) => `<span class="corr-regla"><del>${esc(c.de)}</del> → <b>${esc(c.a)}</b><button class="boton-mini" data-quitar-corr="${esc(c.de)}" title="Quitar">✕</button></span>`).join("")}</div>` : `<p class="cat-ayuda">Todavía no hay correcciones.</p>`}
      <p class="cat-ayuda pie">Se guardan solas en <code>~/minuta/categorias.json</code>. Las reuniones ya grabadas conservan su categoría aunque la renombres.</p>`;
  }
  let _guardarCat = 0;
  function guardarCategorias(inmediato) {
    clearTimeout(_guardarCat);
    const ir = () => { host.enviar("categorias", { lista: E.categorias }); toast("Categorías guardadas ✓"); };
    if (inmediato) ir(); else _guardarCat = setTimeout(ir, 700);
  }

  // ───────────────────────── Corregir palabras en la nota ─────────────────────────
  const escRx = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function rxCorr(c, global = true) {
    if (!c?.de?.trim()) return null;
    const cuerpo = escRx(c.de.trim());
    try { return new RegExp(c.palabra ? `(?<![\\p{L}\\p{N}_])${cuerpo}(?![\\p{L}\\p{N}_])` : cuerpo, `${global ? "g" : ""}${c.mayus ? "" : "i"}u`); } catch { return null; }
  }
  const partes = (texto) => { const i = texto.startsWith("---\n") ? texto.indexOf("\n---\n", 4) : -1; return i > 0 ? [texto.slice(0, i + 5), texto.slice(i + 5)] : ["", texto]; };
  const ocurrencias = (rx, t) => (rx && t ? (t.match(rx) || []).length : 0);
  function conteoCorr() {
    const c = E.corr, n = notaActual(), rx = rxCorr(c);
    if (!rx || !n) return { total: 0, detalle: "", otras: 0, notasOtras: 0, ejemplo: "" };
    const s = secciones(n);
    const det = [["puntos", s.puntos], ["feedback", s.feedback], ["métricas", s.metricas], ["transcripción", s.transcripcion]]
      .map(([k, t]) => [k, ocurrencias(rx, t)]).filter(([, v]) => v);
    const total = ocurrencias(rx, partes(n.texto)[1]);
    let otras = 0, notasOtras = 0;
    for (const x of E.notas) if (x.ruta !== n.ruta) { const k = ocurrencias(rx, partes(x.texto)[1]); if (k) { otras += k; notasOtras++; } }
    const cuerpo = partes(n.texto)[1], m = rxCorr(c, false).exec(cuerpo);
    let ejemplo = "";
    if (m) {
      const a = Math.max(0, m.index - 38), b = Math.min(cuerpo.length, m.index + m[0].length + 38);
      const ctx = (x) => esc(x.replace(/\*\*|__|`/g, "").replace(/(^|\n)\s*(#+|>|-)\s*/g, " ").replace(/\s+/g, " "));
      ejemplo = `<div class="corr-ej"><span>${a > 0 ? "…" : ""}${ctx(cuerpo.slice(a, m.index))}<del>${esc(m[0])}</del><ins>${esc(c.a || "∅")}</ins>${ctx(cuerpo.slice(m.index + m[0].length, b))}${b < cuerpo.length ? "…" : ""}</span></div>`;
    }
    return { total, detalle: det.map(([k, v]) => `${v} en ${k}`).join(" · "), otras, notasOtras, ejemplo };
  }
  function htmlConteo() {
    const k = conteoCorr(), c = E.corr;
    if (!c.de.trim()) return `<p class="corr-info">Escribe la palabra que quedó mal.</p>`;
    if (!k.total) return `<p class="corr-info nada">No aparece «${esc(c.de)}» en esta nota${c.palabra ? " como palabra completa" : ""}.</p>`;
    return `<p class="corr-info"><b>${k.total} ${k.total === 1 ? "vez" : "veces"}</b> en esta nota${k.detalle ? ` <small>(${k.detalle})</small>` : ""}</p>${k.ejemplo}
      ${k.otras ? `<label class="corr-op"><input type="checkbox" data-corr="todas" ${c.todas ? "checked" : ""}> Corregir también en otras ${k.notasOtras} ${k.notasOtras === 1 ? "nota" : "notas"} <small>(${k.otras} más)</small></label>` : ""}`;
  }
  function dialogoCorregir() {
    const c = E.corr;
    if (!c || !notaActual()) return "";
    return `<div class="galeria borrar-fondo" data-accion="cancelar-corr"><div class="galeria-caja borrar-caja corr-caja" role="dialog" aria-modal="true" aria-label="Corregir palabra">
      <h2>✎ Corregir en toda la nota</h2>
      <p class="borrar-det">Cambia la palabra en los puntos, el feedback, las métricas y la transcripción.</p>
      <div class="corr-campos">
        <label class="cat-campo"><span>Dice</span><input id="corr-de" value="${esc(c.de)}" placeholder="CUA" autocomplete="off" spellcheck="false"></label>
        <span class="corr-flecha">→</span>
        <label class="cat-campo"><span>Debería decir</span><input id="corr-a" value="${esc(c.a)}" placeholder="QA" autocomplete="off" spellcheck="false"></label>
      </div>
      <div id="corr-conteo">${htmlConteo()}</div>
      <div class="corr-opciones">
        <label class="corr-op"><input type="checkbox" data-corr="palabra" ${c.palabra ? "checked" : ""}> Solo palabra completa</label>
        <label class="corr-op"><input type="checkbox" data-corr="mayus" ${c.mayus ? "checked" : ""}> Distinguir mayúsculas</label>
        <label class="corr-op destacada"><input type="checkbox" data-corr="recordar" ${c.recordar ? "checked" : ""}> Recordarlo en próximas reuniones <small>la transcripción lo escribirá bien</small></label>
      </div>
      <div class="borrar-botones"><button class="boton-txt" data-accion="cancelar-corr">Cancelar</button><button class="boton-txt aplicar" data-accion="aplicar-corr">Corregir</button></div>
    </div></div>`;
  }
  // ── Corregir con tu IA: se dice en palabras qué está mal y la IA lo arregla en toda la nota ──
  E.corrIA = null;
  function dialogoCorregirIA() {
    const c = E.corrIA;
    if (!c) return "";
    if (c.listo) return `<div class="galeria borrar-fondo" data-accion="cerrar-corria"><div class="galeria-caja borrar-caja corr-caja" role="dialog" aria-modal="true" aria-label="Nota corregida">
      <h2>✓ Nota corregida</h2><p class="borrar-det" data-sin-traducir>${esc(c.listo.cambios || "")}</p>
      ${c.listo.recordados?.length ? `<p class="corr-info">Lo recordaré en las próximas reuniones:</p><ul class="corria-rec" data-sin-traducir>${c.listo.recordados.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <p class="corr-info nada">Guardé una copia de la nota anterior por si quieres volver atrás.</p>
      <div class="borrar-botones"><span></span><button class="boton-txt aplicar" data-accion="cerrar-corria">Listo</button></div></div></div>`;
    return `<div class="galeria borrar-fondo" data-accion="cerrar-corria"><div class="galeria-caja borrar-caja corr-caja" role="dialog" aria-modal="true" aria-label="Corregir la nota con tu IA">
      <h2>✎ Corregir la nota con tu IA</h2>
      <p class="borrar-det">Dile qué está mal, como se lo dirías a una persona. Tu IA lo arregla en el resumen, los próximos pasos, las personas, el feedback y quién habla en la transcripción, y lo recuerda para las próximas reuniones.</p>
      <label class="cat-campo"><span>¿Qué hay que corregir?</span><textarea id="corria-txt" rows="4" ${c.trabajando ? "disabled" : ""} placeholder="ej: Matías no es el PO, es el Scrum Master. La Persona 2 es Ana y ella es la PO.">${esc(c.texto || "")}</textarea></label>
      ${c.error ? `<p class="forja-error">${esc(c.error)}</p>` : ""}
      ${c.trabajando ? `<div class="pr-pensando"><span></span><span></span><span></span> Tu IA está corrigiendo la nota…</div>` : ""}
      <div class="borrar-botones"><button class="boton-txt" data-accion="a-palabra" ${c.trabajando ? "disabled" : ""}>Solo cambiar una palabra</button><button class="boton-txt aplicar" data-accion="aplicar-corria" ${c.trabajando ? "disabled" : ""}>Corregir</button></div>
    </div></div>`;
  }
  function aplicarCorregirIA() {
    const c = E.corrIA; if (!c || c.trabajando) return;
    c.texto = ($("#corria-txt")?.value || "").trim();
    if (!c.texto) { $("#corria-txt")?.focus(); return; }
    c.trabajando = true; c.error = "";
    render({ mantenerScroll: true });
    host.enviar("corregirIA", { ruta: c.ruta, instruccion: c.texto });
  }
  function abrirCorregir(de = "") {
    E.corr = { de, a: "", palabra: true, mayus: /[A-ZÁÉÍÓÚÑ]/.test(de) && de === de.toUpperCase(), recordar: true, todas: false };
    ocultarFlotante();
    render({ mantenerScroll: true });
    setTimeout(() => $(de ? "#corr-a" : "#corr-de")?.focus(), 30);
  }
  function aplicarCorregir() {
    const c = E.corr, rx = rxCorr(c);
    if (!rx || c.a.trim() === c.de.trim()) return;
    const objetivo = notaActual();
    const lista = c.todas ? E.notas : [objetivo];
    let cambios = 0, notas = 0;
    for (const n of lista) {
      const [fm, cuerpo] = partes(n.texto), k = ocurrencias(rx, cuerpo);
      if (!k) continue;
      const nuevo = fm + cuerpo.replace(rx, () => c.a);
      host.enviar("reescribir", { ruta: n.ruta, texto: nuevo });
      E.notas[E.notas.indexOf(n)] = parsearNota(n.ruta, nuevo); marcarCambioNotas();
      cambios += k; notas++;
    }
    if (c.recordar && c.de.trim() && c.a.trim()) {
      const regla = { de: c.de.trim(), a: c.a.trim(), palabra: c.palabra, mayus: c.mayus };
      E.correcciones = [...E.correcciones.filter((x) => x.de !== regla.de), regla];
      host.enviar("correccion", regla);
    }
    _cachePuntajes.clear();
    E.corr = null;
    render({ mantenerScroll: true });
    toast(cambios ? `✓ ${cambios} ${cambios === 1 ? "cambio" : "cambios"}${notas > 1 ? ` en ${notas} notas` : ""}${c.recordar ? " · lo recordaré" : ""}` : "No había nada que cambiar");
  }
  // Botón flotante al seleccionar texto
  function ocultarFlotante() { $("#corr-flot")?.remove(); }
  document.addEventListener("mouseup", (ev) => {
    if (PANEL || ev.target.closest("#corr-flot, .galeria")) return;
    setTimeout(() => {
      const sel = getSelection(), texto = sel?.toString().trim() || "";
      ocultarFlotante();
      if (!texto || texto.length > 60 || /\n/.test(texto) || !sel.anchorNode?.parentElement?.closest(".hoja") || E.seccion !== "reuniones") return;
      const r = sel.getRangeAt(0).getBoundingClientRect(), base = $("#lienzo").getBoundingClientRect();
      const b = document.createElement("button");
      b.id = "corr-flot"; b.className = "corr-flot"; b.dataset.corrDe = texto;
      b.innerHTML = `✎ Corregir «${esc(texto.length > 22 ? texto.slice(0, 21) + "…" : texto)}»`;
      b.style.left = `${Math.max(8, r.left - base.left + r.width / 2)}px`; b.style.top = `${r.top - base.top - 8}px`;
      $("#lienzo").appendChild(b);
    }, 10);
  });
  document.addEventListener("scroll", ocultarFlotante, true);

  // ───────────────────────── ¿Te gustó el personaje? ─────────────────────────
  const MOTIVOS = ["No conozco al personaje", "No tiene que ver con cómo me fue", "No me hizo gracia", "Ya me salió muchas veces"];
  function opinion(n, t, texto) {
    const plano = texto.replace(/<[^>]+>/g, "");
    const quien = (plano.match(/como ([^(:]+?)\s*[(:]/) || [])[1]?.trim() || "este personaje";
    const clave = `${t.id}|personaje|${n.ruta}`, v = E.votos[clave];
    const extra = { tema: t.id, tipo: "personaje", personaje: quien, texto: plano.slice(0, 300), nota: n.titulo };
    const datos = `data-clave="${esc(clave)}" data-extra="${esc(JSON.stringify(extra))}"`;
    if (v?.v > 0) return `<div class="opinion hecha" ${datos}><span>😄 Te gustó la comparación con <b>${esc(quien)}</b>.</span><button class="op-link" data-op="0">Cambiar</button></div>`;
    if (v?.v < 0 && E.votoAbierto !== clave) return `<div class="opinion hecha" ${datos}><span>🙈 Anotado: <b>${esc(v.c || "no calzó")}</b>. Lo uso para mejorar los personajes de ${esc(t.nombre)}.</span><button class="op-link" data-op="0">Cambiar</button></div>`;
    if (E.votoAbierto === clave) return `<div class="opinion" ${datos}><span class="op-preg">¿Qué no te gustó de la comparación con <b>${esc(quien)}</b>?</span>
      <div class="op-motivos">${MOTIVOS.map((m) => `<button class="op-chip" data-op-motivo="${esc(m)}">${esc(m)}</button>`).join("")}</div>
      <span class="voto-coment"><input id="voto-txt" placeholder="u otra cosa (opcional)…" maxlength="200"><button class="voto-ok" data-voto-ok>Listo</button></span></div>`;
    return `<div class="opinion" ${datos}><span class="op-preg">¿Te gustó que te comparara con <b>${esc(quien)}</b>?</span>
      <button class="op-btn" data-op="1">😄 Sí, me hizo gracia</button><button class="op-btn" data-op="-1">🙈 No calza</button></div>`;
  }
  function opinar(el, valor, motivo) {
    const caja = el.closest(".opinion"), clave = caja.dataset.clave, extra = JSON.parse(caja.dataset.extra || "{}");
    if (valor === 0) { delete E.votos[clave]; E.votoAbierto = null; host.enviar("voto", { clave, v: 0 }); render({ mantenerScroll: true }); return; }
    if (valor > 0) { E.votos[clave] = { v: 1, ...extra }; E.votoAbierto = null; host.enviar("voto", { clave, ...E.votos[clave] }); render({ mantenerScroll: true }); return; }
    if (motivo === undefined) { E.votoAbierto = clave; render({ mantenerScroll: true }); setTimeout(() => $("#voto-txt")?.focus(), 20); return; }
    E.votos[clave] = { v: -1, c: motivo || "no calzó", ...extra }; E.votoAbierto = null;
    host.enviar("voto", { clave, ...E.votos[clave] }); render({ mantenerScroll: true });
  }
  function cerrarComentario() {
    const inp = $("#voto-txt"), el = inp?.closest(".opinion");
    if (el) opinar(el, -1, inp.value.trim()); else { E.votoAbierto = null; render({ mantenerScroll: true }); }
  }

  // ───────────────────────── Crear universos ─────────────────────────
  function forja() {
    const f = E.forja;
    if (!f) return "";
    if (f.estado === "trabajando") return `<div class="forja trabajando"><div class="forja-yunque">⚒️</div><h2>Forjando «${esc(f.nombre)}»…</h2>
      <p>Tu IA está escribiendo 40 arquetipos, 10 rangos, 24 logros, la paleta y la ventana. Tarda unos 5 minutos; puedes seguir usando Minuta y te aviso al terminar.</p><div class="forja-barra"><i></i></div></div>`;
    if (f.estado === "listo") return `<div class="forja listo"><div class="forja-yunque">✨</div><h2>¡${esc(f.nombreFinal || f.nombre)} está listo!</h2>
      <p>Ya aparece en la galería. Si un personaje no te calza, dímelo en la tarjeta "Personaje de la reunión" y lo voy puliendo.</p>
      <div class="borrar-botones"><button class="boton-txt" data-forja="cerrar">Seguir viendo</button><button class="boton-txt aplicar" data-universo="${esc(f.id)}">Probarlo ahora</button></div></div>`;
    return `<div class="forja"><h2>＋ Crear un universo</h2>
      <p>Escribe una saga, serie, película, videojuego o lo que quieras. Tu IA arma los personajes, rangos, logros, colores y la forma de la ventana.</p>
      ${f.estado === "error" ? `<p class="forja-error">No resultó: ${esc(f.error || "error desconocido")}. Intenta de nuevo.</p>` : ""}
      <label class="cat-campo"><span>Universo</span><input id="forja-nombre" value="${esc(f.nombre)}" placeholder="Pokémon, Breaking Bad, Stranger Things, Mundial 2026…" autocomplete="off"></label>
      <label class="cat-campo"><span>Indicaciones <small>opcional</small></span><textarea id="forja-notas" rows="2" placeholder="ej: más humor chileno, solo personajes de la primera temporada, estética retro de los 80">${esc(f.notas)}</textarea></label>
      <div class="borrar-botones"><button class="boton-txt" data-forja="cerrar">Cancelar</button><button class="boton-txt aplicar" data-forja="crear" ${E.plataforma === "web" ? "disabled title=\"Solo en la app de Mac\"" : ""}>⚒️ Forjar universo</button></div></div>`;
  }

  // ───────────────────────── Preferencias: avisos ─────────────────────────
  function seccionAvisos() {
    const a = E.avisos, j = E.ajustes, web = E.plataforma === "web";
    const fila = (ok, titulo, detalle, boton) => `<div class="av-fila ${ok === true ? "ok" : ok === false ? "mal" : "neutro"}">
      <span class="av-ico">${ok === true ? "✓" : ok === false ? "!" : "·"}</span><div class="av-txt"><b>${titulo}</b><small>${detalle}</small></div>${boton || ""}</div>`;
    let estado = "";
    if (web) estado = fila(null, "Estado de los permisos", "Disponible en la app de Mac.");
    else if (!a) estado = fila(null, "Revisando permisos…", "");
    else if (ESCRITORIO) {
      // Windows y Linux: sin permisos que pedir; el calendario se conecta con su dirección iCal secreta (solo lectura).
      estado += a.permiso === "si" ? fila(true, "Notificaciones permitidas", "Minuta puede avisarte.")
        : fila(false, "Notificaciones desactivadas", "Actívalas en la configuración del sistema.", `<button class="boton-txt aplicar" data-av="abrirAjustesAvisos">Abrir configuración</button>`);
      estado += a.calendario === "si" ? fila(true, "Calendario conectado", "Para avisarte 1 minuto antes y ponerle nombre a las reuniones.", `<button class="boton-txt" data-ics-quitar>Desconectar</button>`)
        : `${fila(false, a.calendario === "no" ? "No pude leer tu calendario" : "Conecta tu calendario", "Pega la dirección secreta en formato iCal: en Google Calendar, Configuración → tu calendario → «Dirección secreta en formato iCal»; en Outlook, Configuración → Calendario → Calendarios compartidos → Publicar → enlace ICS. Se guarda cifrada en tu computador.")}
          <div class="av-ics"><input id="ics-url" type="url" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" autocomplete="off"><button class="boton-txt aplicar" data-ics-conectar>Conectar</button></div>`;
    }
    else {
      estado += a.permiso === "si" ? fila(true, "Notificaciones permitidas", "Minuta puede avisarte.")
        : a.permiso === "no" ? fila(false, "Notificaciones bloqueadas", "Actívalas en Ajustes del Sistema para recibir los avisos.", `<button class="boton-txt aplicar" data-av="abrirAjustesAvisos">Abrir Ajustes</button>`)
        : fila(false, "Falta dar permiso", "macOS te preguntará una vez.", `<button class="boton-txt aplicar" data-av="pedirAvisos">Permitir</button>`);
      if (a.permiso === "si") estado += a.estilo === "alertas" ? fila(true, "Estilo: Alertas", "Los avisos se quedan en pantalla hasta que los tocas.")
        : fila(false, a.estilo === "banners" ? "Estilo: Banners (desaparecen en 5 s)" : "Estilo: Ninguno (no se ven en pantalla)",
          "Recomendado: <b>Alertas</b>, así no se te pasa una reunión. En Ajustes, elige «Alertas» en <i>Estilo de las alertas de Minuta</i>.",
          `<button class="boton-txt aplicar" data-av="abrirAjustesAvisos">Cambiar a Alertas…</button>`);
      estado += a.calendario === "si" ? fila(true, "Acceso al calendario", "Para avisarte 1 minuto antes y ponerle nombre a las reuniones.")
        : a.calendario === "no" ? fila(false, "Sin acceso al calendario", "Sin él no hay aviso previo ni títulos automáticos.", `<button class="boton-txt" data-av="abrirAjustesCalendario">Abrir Ajustes</button>`)
        : fila(false, "Falta acceso al calendario", "Para avisarte antes de cada reunión.", `<button class="boton-txt aplicar" data-av="pedirCalendario">Dar acceso</button>`);
    }
    const sw = (clave, titulo, detalle) => `<button class="av-op" data-ajuste="${clave}" role="switch" aria-checked="${!!j[clave]}">
      <span class="av-txt"><b>${titulo}</b><small>${detalle}</small></span><span class="pn-interruptor${j[clave] ? " on" : ""}"><i></i></span></button>`;
    return `<div class="subtitulo">Notificaciones</div>
      <div class="card av">
        ${estado}
        <div class="av-sep"></div>
        ${sw("avisarDeteccion", "Cuando empieza una reunión", "Teams, Zoom, Meet, Slack, FaceTime… al activar el micrófono")}
        ${sw("avisarCalendario", "1 minuto antes de las reuniones del calendario", "Solo las que tienen invitados o enlace de videollamada")}
        ${sw("avisarFin", "Preguntar si terminó la reunión", "Si la app suelta el micrófono mientras grabas")}
        ${sw("avisarNotas", "Cuando las notas estén listas", "Tocar el aviso abre la nota")}
        ${sw("avisarPrep", "Prepárate: 5 minutos antes", "Con lo que pasó la última vez y los compromisos abiertos con esas personas")}
        ${sw("avisarCompromisos", "Resumen de compromisos cada mañana", "A partir de las 9:00, si tienes algo para hoy o vencido")}
        ${sw("coachVivo", "Coach en vivo mientras grabas", "Tu % de habla, cuánto llevas de corrido e interrupciones en el panel; y tu hábito a 10 min del final")}
        ${sw("avisoMonologo", "Avisarme si llevo 90 s hablando de corrido", "Un aviso silencioso, sin sonido")}
        <div class="av-op estatico"><span class="av-txt"><b>Al tocar el aviso de reunión</b><small>"Grabar ahora" siempre graba</small></span>
          <span class="pestanas av-seg"><button class="pestana${j.alTocar === "grabar" ? " activa" : ""}" data-al-tocar="grabar">Empezar a grabar</button><button class="pestana${j.alTocar === "panel" ? " activa" : ""}" data-al-tocar="panel">Solo abrir el panel</button></span></div>
        <div class="av-pie"><button class="boton-txt" data-av="probarAviso" ${web ? "disabled" : ""}>🔔 Enviar aviso de prueba</button></div>
      </div>`;
  }

  // ───────────────────────── Coach: feedback accionable ─────────────────────────
  function irAHora(hora) {
    E.vista = "transcripcion"; E.seccion = "reuniones"; render();
    const seg = (h) => h.split(":").reduce((a, x) => a * 60 + +x, 0), objetivo = seg(hora);
    const turnos = [...document.querySelectorAll(".turno")];
    let mejor = null;
    for (const tn of turnos) { const h = tn.querySelector(".hora")?.textContent || ""; if (/^\d/.test(h) && seg(h) <= objetivo + 2) mejor = tn; }
    (mejor || turnos[0])?.scrollIntoView({ block: "center" });
    mejor?.classList.add("citado");
    setTimeout(() => mejor?.classList.remove("citado"), 3000);
  }
  /** Lee el feedback de la nota (formato nuevo con veredicto/citas, y el antiguo con ✅/🔧 simples). */
  const _cacheFb = new WeakMap(), _cacheRef = new WeakMap();
  function analizarFeedback(n) {
    if (_cacheFb.has(n)) return _cacheFb.get(n);
    const r0 = _analizarFeedback(n); _cacheFb.set(n, r0); return r0;
  }
  function _analizarFeedback(n) {
    const s = secciones(n);
    const r = { veredicto: "", costo: [], bien: [], habito: "", anterior: null };
    const item = (txt) => {
      let x = txt.trim(), hora = null, cita = null, prueba = null;
      const h = x.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*/);
      if (h) { hora = h[1].length <= 5 ? `00:${h[1]}` : h[1]; x = x.slice(h[0].length); }
      const c = x.match(/^["“]([^"”]+)["”]\s*[—–-]\s*/);
      if (c) { cita = c[1]; x = x.slice(c[0].length); }
      const pr = x.split(/\s*→\s*(?:Prueba:\s*)?/);
      if (pr.length > 1) { x = pr[0]; prueba = pr.slice(1).join(" → ").trim().replace(/^["“]|["”]$/g, ""); }
      return { hora, cita, texto: x.trim(), prueba };
    };
    for (const bruto of s.feedback.split("\n")) {
      const l = bruto.replace(/^\s*[-*]\s*/, "").trim();
      if (!l) continue;
      if (/^\*\*Veredicto:\*\*/.test(l)) r.veredicto = l.replace(/^\*\*Veredicto:\*\*\s*/, "");
      else if (/^\*\*Hábito para la próxima:\*\*/.test(l)) r.habito = l.replace(/^\*\*Hábito para la próxima:\*\*\s*/, "");
      else if (/^\*\*Hábito anterior:\*\*/.test(l)) {
        const t = l.replace(/^\*\*Hábito anterior:\*\*\s*/, "");
        const q = t.match(/["“]([^"”]+)["”]/);
        const estado = /✓/.test(t) ? "si" : /✗/.test(t) ? "no" : "na";
        const ev = t.split(/\s:\s|:\s(?=[^:]*$)/).slice(1).join(": ").trim();
        r.anterior = { texto: q ? q[1] : t, estado, evidencia: ev };
      } else if (/^🔧/u.test(l)) r.costo.push(item(l.replace(/^🔧\s*/u, "")));
      else if (/^✅/u.test(l)) r.bien.push(item(l.replace(/^✅\s*/u, "")));
    }
    const p = puntajes(n);
    if (!r.veredicto && p) {
      const prom = promP(p), orden = [...APARTADOS].sort((a, b) => p[b.clave] - p[a.clave]);
      const f = orden[0], d = orden[orden.length - 1];
      r.veredicto = p[f.clave] < 6
        ? `Reunión difícil: ningún apartado llegó a 6. Empieza por ${d.titulo.toLowerCase()} (${p[d.clave]}), es donde más puedes ganar.`
        : p[f.clave] === p[d.clave]
          ? `${prom >= 8 ? "Muy buena reunión" : "Reunión pareja"}: todos tus apartados en ${p[f.clave]}.`
          : `${prom >= 8 ? "Muy buena reunión" : prom >= 6.5 ? "Reunión correcta" : "Reunión difícil"}: tu fuerte fue ${f.titulo.toLowerCase()} (${p[f.clave]}) y lo que más te costó, ${d.titulo.toLowerCase()} (${p[d.clave]}).`;
    }
    return r;
  }
  const promP = (p) => APARTADOS.reduce((a, x) => a + p[x.clave], 0) / APARTADOS.length;
  const semP = (v) => (v >= 8 ? "bien" : v >= 6 ? "ojo" : "mal");
  const CONSEJO = {
    claridad: "Parte por la conclusión y después los detalles: «Mi propuesta es X, por dos razones».",
    escucha: "Antes de responder, resume lo que te dijeron: «Si entendí bien, lo que te complica es…».",
    preguntas: "Lleva 3 preguntas abiertas preparadas y hazlas antes de proponer nada.",
    cierre: "Antes de cortar: decisión, responsable y fecha. «Entonces: Matías envía la propuesta el jueves»."
  };

  /** Métricas con rango de referencia: cada número dice si está bien y qué hacer. */
  function referencias(n) {
    if (_cacheRef.has(n)) return _cacheRef.get(n);
    const r0 = _referencias(n); _cacheRef.set(n, r0); return r0;
  }
  function _referencias(n) {
    const st = stats(n), np = (n.participantes?.length || 1) + 1, dur = st.dur || 0;
    const justo = 100 / np, lo = Math.round(Math.max(12, justo * 0.7)), hi = Math.round(Math.min(75, justo * 1.35 + 5));
    const top = Object.entries(st.muletillas || {}).sort((a, b) => b[1] - a[1])[0];
    const r = [];
    if (st.pct) r.push({ id: "habla", nombre: "Tu tiempo de habla", valor: st.pct, txt: `${Math.round(st.pct)}%`, rango: [lo, hi], escala: [0, 100], ref: `ideal ${lo}–${hi}% con ${np} personas`,
      estado: st.pct >= lo && st.pct <= hi ? "bien" : st.pct > hi + 12 || st.pct < lo - 10 ? "mal" : "ojo",
      consejo: st.pct > hi ? `Con ${np} personas, lo justo era ~${Math.round(justo)}%. Pregunta más y deja que los demás desarrollen.` : st.pct < lo ? "Participaste poco: si tenías algo que aportar, dilo antes del cierre." : "" });
    if (st.mono) r.push({ id: "mono", nombre: "Tu intervención más larga", valor: st.mono, txt: `${Math.round(st.mono)} s`, rango: [0, 60], escala: [0, 180], ref: "ideal bajo 60 s",
      estado: st.mono <= 60 ? "bien" : st.mono <= 120 ? "ojo" : "mal", consejo: st.mono > 60 ? "Habla en bloques de menos de un minuto y chequea: «¿hace sentido hasta acá?»." : "" });
    if (st.ppm) r.push({ id: "ppm", nombre: "Velocidad", valor: st.ppm, txt: `${Math.round(st.ppm)} pal/min`, rango: [120, 160], escala: [80, 220], ref: "ideal 120–160",
      estado: st.ppm >= 120 && st.ppm <= 160 ? "bien" : st.ppm <= 180 && st.ppm >= 105 ? "ojo" : "mal",
      consejo: st.ppm > 160 ? "Vas rápido: haz una pausa después de cada idea importante." : st.ppm < 120 ? "Ritmo pausado: bien para explicar, pero cuida mantener la atención." : "" });
    if (st.hablaMin) r.push({ id: "mul", nombre: "Muletillas", valor: st.mulPor10, txt: `${st.mulPor10.toFixed(1)} cada 10 min`, rango: [0, 3], escala: [0, 15], ref: "ideal bajo 3",
      estado: st.mulPor10 <= 3 ? "bien" : st.mulPor10 <= 6 ? "ojo" : "mal",
      consejo: st.mulPor10 > 3 && top ? `La que más repetiste: “${top[0]}” (×${top[1]}). Cuando la sientas venir, haz una pausa en silencio.` : "" });
    if (dur) { const v = (st.preg || 0) / dur * 10; r.push({ id: "preg", nombre: "Preguntas", valor: v, txt: `${st.preg || 0} (${v.toFixed(1)} cada 10 min)`, rango: [1, 4], escala: [0, 4], ref: "ideal 1 o más cada 10 min",
      estado: v >= 1 ? "bien" : v >= 0.5 ? "ojo" : "mal", consejo: v < 1 ? "Por cada idea que expones, una pregunta abierta: «¿cómo lo resuelven hoy?»." : "" }); }
    r.push({ id: "interr", nombre: "Interrupciones", valor: st.interr || 0, txt: `${st.interr || 0}`, rango: [0, 1], escala: [0, 8], ref: "ideal 0–1",
      estado: (st.interr || 0) <= 1 ? "bien" : st.interr <= 3 ? "ojo" : "mal", consejo: st.interr > 1 ? "Deja terminar: cuenta dos segundos antes de responder." : "" });
    const peso = { mal: 0, ojo: 1, bien: 2 };
    return r.sort((a, b) => peso[a.estado] - peso[b.estado]);
  }
  function barraRango(m) {
    const [a, b] = m.escala, pct = (v) => Math.max(0, Math.min(100, (v - a) / (b - a) * 100));
    return `<div class="co-barra"><i class="zona" style="left:${pct(m.rango[0])}%;width:${pct(m.rango[1]) - pct(m.rango[0])}%"></i><b class="${m.estado}" style="left:${pct(m.valor)}%"></b></div>`;
  }
  function filaReferencia(m) {
    return `<div class="co-ref ${m.estado}"><span class="co-pto"></span><div class="co-ref-txt"><div class="co-ref-cab"><b>${esc(m.nombre)}</b><span class="co-val">${esc(m.txt)}</span></div>
      ${barraRango(m)}<small>${m.consejo ? esc(m.consejo) : `En rango · ${esc(m.ref)}`}</small>${m.consejo ? `<small class="co-ref-ideal">${esc(m.ref)}</small>` : ""}</div></div>`;
  }
  function citaHTML(it, tipo) {
    return `<li class="co-item ${tipo}">
      ${it.cita ? `<button class="co-cita" ${it.hora ? `data-ir-hora="${it.hora}" title="Ir a este momento de la transcripción"` : "disabled"}>${it.hora ? `<span class="co-hora">▶ ${it.hora.replace(/^00:/, "")}</span>` : ""}“${esc(it.cita)}”</button>` : ""}
      <p>${inline(it.texto)}</p>
      ${it.prueba ? `<div class="co-prueba"><span>Prueba decir</span>“${esc(it.prueba.replace(/^["“]|["”]$/g, ""))}”</div>` : ""}</li>`;
  }

  function panelDesempeno(n) {
    const t = tema(), p = puntajes(n), f = analizarFeedback(n), refs = referencias(n), s = secciones(n);
    if (!p && !f.costo.length && !f.bien.length) return `<p class="vacio">Esta reunión no tiene feedback.</p>`;
    const prom = p ? promP(p) : null;
    // juego en una línea
    const total = xpTotal(E.notas, n.fecha), nuevos = calcularLogros(E.notas, n.fecha).filter((e) => e.nota === n.ruta);
    const xpR = (p ? xpDe(p) : 0) + nuevos.length * XP_LOGRO;
    const { i, r } = rango(t, total), antes = rango(t, total - xpR).i;
    let quien = personaje(n) ? inline(personaje(n)) : "";
    if (!quien && p) { const mejor = APARTADOS.reduce((a, b) => (p[b.clave] > p[a.clave] ? b : a)); const a = arquetipo(t, mejor.clave, p[mejor.clave]); if (a) quien = `Fuiste como <strong>${esc(a.nombre)}</strong> (<em>${esc(a.referencia)}</em>): ${esc(a.frase)}`; }
    const hab = f.anterior;
    return `<div class="coach">
      <section class="co-hero ${prom != null ? semP(prom) : ""}">
        ${prom != null ? `<div class="co-anillo" style="--p:${prom / 10}"><b>${prom.toFixed(1)}</b><small>de 10</small></div>` : ""}
        <div class="co-hero-txt"><div class="co-eti">Veredicto</div><p class="co-veredicto">${inline(f.veredicto)}</p>
          ${p ? `<div class="co-chips">${APARTADOS.map((a) => `<span class="co-chip ${semP(p[a.clave])}">${icoApartado(t, a)} ${a.titulo} <b>${p[a.clave]}</b></span>`).join("")}</div>` : ""}</div>
      </section>
      ${f.habito ? `<section class="co-habito"><div class="co-eti">🎯 Tu hábito para la próxima reunión</div><p>${inline(f.habito)}</p>
        ${hab ? `<div class="co-anterior ${hab.estado}"><b>${hab.estado === "si" ? "✓ Cumpliste" : hab.estado === "no" ? "✗ No cumpliste" : "– No aplicó"}</b> el hábito anterior: «${esc(hab.texto)}»${hab.evidencia ? `<small>${inline(hab.evidencia)}</small>` : ""}</div>` : ""}</section>` : ""}
      <div class="co-dos">
        ${f.costo.length ? `<section class="co-lista"><h3><span class="co-pto ojo"></span>Lo que te costó</h3><ul>${f.costo.map((x) => citaHTML(x, "costo")).join("")}</ul></section>` : ""}
        ${f.bien.length ? `<section class="co-lista"><h3><span class="co-pto bien"></span>Lo que hiciste bien</h3><ul>${f.bien.map((x) => citaHTML(x, "bien")).join("")}</ul></section>` : ""}
      </div>
      ${refs.length ? `<section class="co-como"><h3>Cómo hablaste <small>${(() => { const k = refs.filter((m) => m.estado !== "bien").length; return k ? `${k} ${k === 1 ? "cosa" : "cosas"} para mirar` : "todo en rango 👌"; })()}</small></h3>${refs.map(filaReferencia).join("")}
        <p class="co-nota-medicion">Medido automáticamente desde el audio; las interrupciones y velocidad pueden tener error.</p></section>` : ""}
      <section class="co-juego">
        <div class="co-juego-cab"><span>${t.emoji} <b>+${xpR} ${esc(t.xp)}</b></span>${i > antes ? `<span class="co-sube">⬆ Subiste a ${esc(r.nombre)}</span>` : ""}${nuevos.map((e) => `<span class="co-logro">${icoLogro(t, e.def)} ${esc(logroTexto(t, e.def.id).nombre)}</span>`).join("")}</div>
        ${quien ? `<p>${quien}</p>${opinion(n, t, quien)}` : ""}
      </section>
      <details class="co-todo"><summary>Ver todos los datos de esta reunión</summary>
        ${p ? panelJuego(n).replace(/<div class="personaje">[\s\S]*?<div class="apartados">/, '<div class="apartados">') : ""}
        ${s.metricas ? `<div class="subtitulo">Datos de la conversación</div>${tarjetasMetricas(s.metricas)}${tablaMuletillas(n)}` : ""}
      </details>
    </div>`;
  }

  // ───────────────────────── Tu foco (antes "Progreso") ─────────────────────────
  function foco() {
    const conP = [...E.notas].filter((n) => puntajes(n)).sort((a, b) => a.fecha - b.fecha);
    if (!conP.length) return null;
    const ult = conP.slice(-5), prim = conP.slice(0, Math.min(5, Math.max(1, Math.floor(conP.length / 2))));
    const avg = (arr, k) => arr.reduce((a, n) => a + puntajes(n)[k], 0) / arr.length;
    const debil = [...APARTADOS].sort((a, b) => avg(ult, a.clave) - avg(ult, b.clave))[0];
    const crec = [...APARTADOS].filter((a) => a.clave !== debil.clave).map((a) => ({ a, d: avg(ult, a.clave) - avg(prim, a.clave) })).sort((x, y) => y.d - x.d)[0];
    const ultima = [...E.notas].sort((a, b) => b.fecha - a.fecha)[0];
    const habito = ultima ? analizarFeedback(ultima).habito : "";
    const evaluados = [...E.notas].sort((a, b) => b.fecha - a.fecha).map((n) => ({ n, a: analizarFeedback(n).anterior })).filter((x) => x.a && x.a.estado !== "na").slice(0, 8);
    return { conP, ult, prim, debil, debilProm: avg(ult, debil.clave), crec, habito, evaluados, avg };
  }

  function panelFoco() {
    const t = tema(), F = foco();
    if (!F) return `<h1>🎯 Tu foco</h1><div class="vacio grande"><div>${t?.emoji || "🌱"}</div><h2>Aún no hay reuniones con feedback</h2><p>Graba una reunión y aquí verás en qué enfocarte.</p></div>`;
    const { conP, ult, prim, debil, debilProm, crec, habito, evaluados } = F;
    const serie = (k) => conP.slice(-12).map((n) => puntajes(n)[k]);
    const cumplidos = evaluados.filter((x) => x.a.estado === "si").length;
    const lista = [...E.notas].sort((a, b) => a.fecha - b.fecha).map(stats);
    const k5 = (arr, f) => { const v = arr.map(f).filter((x) => x != null && !Number.isNaN(x) && x !== 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const L = lista.slice(-5), P = lista.slice(0, Math.min(5, Math.max(1, Math.floor(lista.length / 2))));
    // % de reuniones recientes con habla en rango
    const enRango = E.notas.slice().sort((a, b) => b.fecha - a.fecha).slice(0, 5).map((n) => referencias(n).find((m) => m.id === "habla")).filter(Boolean);
    const okHabla = enRango.filter((m) => m.estado === "bien").length;
    const mulA = k5(P, (s) => s.mulPor10), mulB = k5(L, (s) => s.mulPor10);
    const pA = k5(P, (s) => (s.p ? promP(s.p) : null)), pB = k5(L, (s) => (s.p ? promP(s.p) : null));
    const ind = [
      { nombre: "Muletillas cada 10 min", ahora: mulB, antes: mulA, fmt: (v) => v.toFixed(1), estado: mulB <= 3 ? "bien" : mulB <= 6 ? "ojo" : "mal", serie: lista.map((s) => s.mulPor10 || null),
        frase: mulB == null ? "" : mulB <= 3 ? "Estás en zona buena (bajo 3). Mantenlo." : `Meta: bajo 3. ${mulA && mulB < mulA ? `Vas bien: bajaste ${Math.round((1 - mulB / mulA) * 100)}% desde el inicio.` : "Haz pausas en silencio en vez de rellenar."}` },
      { nombre: "Reuniones con tu habla en rango", ahora: enRango.length ? okHabla : null, antes: null, fmt: (v) => `${v} de ${enRango.length}`, estado: okHabla >= 4 ? "bien" : okHabla >= 2 ? "ojo" : "mal", serie: lista.map((s) => s.pct || null),
        frase: okHabla >= 4 ? "Equilibras bien cuánto hablas según cuántos son." : "En varias reuniones hablaste más de lo justo para el número de personas. Pregunta más, explica menos." },
      { nombre: "Puntaje promedio", ahora: pB, antes: pA, fmt: (v) => v.toFixed(1), estado: pB >= 8 ? "bien" : pB >= 6.5 ? "ojo" : "mal", serie: lista.map((s) => (s.p ? promP(s.p) : null)),
        frase: pB == null ? "" : `Últimas 5 reuniones${pA != null ? ` (antes ${pA.toFixed(1)})` : ""}. ${pB >= 8 ? "Nivel alto: ahora ve por la constancia." : `Sube ${debil.titulo.toLowerCase()} y esto mejora solo.`}` },
    ].filter((x) => x.ahora != null);
    // por tipo: una frase
    const tipos = {};
    E.notas.filter((n) => puntajes(n)).forEach((n) => (tipos[n.tipo || "Otra"] ||= []).push(n));
    const frasesTipo = Object.entries(tipos).sort((a, b) => b[1].length - a[1].length).map(([tp, arr]) => {
      const rec = arr.sort((a, b) => b.fecha - a.fecha).slice(0, 5), pr = rec.reduce((a, n) => a + promP(puntajes(n)), 0) / rec.length;
      const peor = [...APARTADOS].sort((x, y) => rec.reduce((a, n) => a + puntajes(n)[x.clave], 0) - rec.reduce((a, n) => a + puntajes(n)[y.clave], 0))[0];
      const vp = rec.reduce((a, n) => a + puntajes(n)[peor.clave], 0) / rec.length;
      return `<li><span class="tipo-barra t-${esc(tp)}"></span><div><b>${esc(categoria(tp).emoji)} ${esc(nombreTipo(tp))}</b> <small>${arr.length} reuniones</small>
        <p>Promedio <b class="${semP(pr)}">${pr.toFixed(1)}</b>. Lo más débil: <b>${peor.titulo.toLowerCase()}</b> (${vp.toFixed(1)}).</p></div></li>`;
    }).join("");
    return `<div class="foco">
      <h1>🎯 Tu foco</h1><p class="foco-sub">${conP.length} reuniones con feedback · ${esc(txt("titulo_progreso", "tu progreso"))}</p>
      <div class="foco-hero">
        <section class="co-hero ${semP(debilProm)} foco-principal">
          <div class="co-hero-txt"><div class="co-eti">Tu mayor oportunidad ahora</div>
            <p class="co-veredicto">${icoApartado(t, debil)} ${debil.titulo}: <b>${debilProm.toFixed(1)}</b> <small>promedio de tus últimas ${ult.length}</small></p>
            <p class="foco-consejo">${CONSEJO[debil.clave]}</p>
            <div class="foco-spark">${sparkline(serie(debil.clave), { w: 260, h: 40, color: "var(--acento)" })}</div>
            <button class="boton-txt aplicar foco-practicar" data-abrir-gym="">🥊 Practicar ${debil.titulo.toLowerCase()} en el Gimnasio</button></div>
        </section>
        <section class="foco-avance"><div class="co-eti">🚀 Tu mayor avance</div><p><b>${icoApartado(t, crec.a)} ${crec.a.titulo}</b></p>
          <p class="foco-delta ${crec.d >= 0 ? "bien" : "mal"}">${crec.d >= 0 ? "+" : ""}${crec.d.toFixed(1)} <small>vs tus primeras reuniones</small></p></section>
      </div>
      <section class="co-habito">
        <div class="co-eti">🎯 Tu hábito actual</div><p>${habito ? inline(habito) : "Graba tu próxima reunión y tu IA te dejará uno."}</p>
        ${evaluados.length ? `<div class="foco-hab"><div class="foco-hab-cab"><b>${cumplidos} de ${evaluados.length}</b> hábitos cumplidos en tus últimas reuniones</div>
          <ol>${evaluados.slice().reverse().map((x) => `<li class="${x.a.estado}" title="${esc(x.n.titulo)} · ${esc(x.a.texto)}"><span>${x.a.estado === "si" ? "✓" : "✗"}</span><small>${x.n.fecha.getDate()}/${x.n.fecha.getMonth() + 1}</small></li>`).join("")}</ol></div>`
          : `<p class="foco-nota">Desde tu próxima reunión, Minuta revisará si cumpliste el hábito anterior y lo irá marcando aquí.</p>`}
      </section>
      <div class="subtitulo">3 indicadores que importan</div>
      <div class="foco-ind">${ind.map((x) => `<section class="foco-i ${x.estado}"><div class="foco-i-cab"><span class="co-pto ${x.estado}"></span>${esc(x.nombre)}</div>
        <div class="foco-i-val"><b>${x.fmt(x.ahora)}</b>${x.antes != null ? `<small>antes ${x.fmt(x.antes)}</small>` : ""}</div>
        ${sparkline(x.serie.filter((v) => v != null), { w: 220, h: 34, color: x.estado === "bien" ? "#22c55e" : x.estado === "ojo" ? "#f59e0b" : "#ef4444" })}
        <p>${esc(x.frase)}</p></section>`).join("")}</div>
      ${frasesTipo ? `<div class="subtitulo">Por tipo de reunión</div><ul class="foco-tipos">${frasesTipo}</ul>` : ""}
      <details class="co-todo"><summary>Ver todos los datos y gráficos</summary>${panelProgreso()}</details>
    </div>`;
  }

  /** Mini tarjeta de foco en la barra lateral. */
  function focoMini() {
    const F = foco();
    if (!F) return "";
    const t = tema();
    return `<button class="foco-mini ${semP(F.debilProm)}" data-seccion="progreso" title="Ver tu foco (⌘5)"><span class="co-eti">🎯 Tu foco</span>
      <b>${icoApartado(t, F.debil)} ${F.debil.titulo} · ${F.debilProm.toFixed(1)}</b>${F.habito ? `<small>${esc(F.habito.replace(/\*\*/g, ""))}</small>` : ""}</button>`;
  }

  // ───────────────────────── Personas, compromisos y agenda ─────────────────────────
  let _verNotas = 0;
  const marcarCambioNotas = () => { _verNotas++; };
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
  /** ¿Es el propio usuario? ("Yo", su nombre o su nombre completo, según su perfil). */
  const esYo = (nombre) => {
    const n = norm(nombre); if (!n) return false;
    const propios = ["yo", norm(E.perfil?.nombre || ""), norm(E.perfil?.nombre_completo || "")].filter(Boolean);
    return propios.some((p) => n === p || (p !== "yo" && n.startsWith(p + " ")));
  };
  const yoNombre = () => (E.perfil?.nombre || "").trim() || "tú";
  const nombreValido = (s) => { const t = String(s || "").trim(); return t.length > 1 && t.length <= 40 && t.split(/\s+/).length <= 4 && !/[()"“”:;\d]/.test(t) && !/^\?|^persona \d|^ellos$|^yo$|^equipo$/i.test(t); };
  const DIAS_N = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
  const MESES_N = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const inicioDia = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const sumarDias = (d, k) => { const x = new Date(d); x.setDate(x.getDate() + k); return x; };

  /** Convierte "viernes", "mañana", "próxima semana", "23/10", "fin de mes"… en una fecha, relativa al día de la reunión. */
  function fechaRelativa(txt, base) {
    const t = norm(txt), b = inicioDia(base || new Date());
    if (!t) return null;
    let m;
    if ((m = t.match(/(\d{4}) (\d{2}) (\d{2})/))) return new Date(+m[1], +m[2] - 1, +m[3], 12);
    if ((m = t.match(/\b(\d{1,2}) (\d{1,2})(?: (\d{2,4}))?\b/)) && +m[2] <= 12) {
      const y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : b.getFullYear();
      let d = new Date(y, +m[2] - 1, +m[1], 12); if (!m[3] && d < b) d = new Date(y + 1, +m[2] - 1, +m[1], 12); return d;
    }
    if ((m = t.match(/\b(\d{1,2}) de (\w+)/)) && MESES_N.includes(m[2])) {
      let d = new Date(b.getFullYear(), MESES_N.indexOf(m[2]), +m[1], 12); if (d < b) d.setFullYear(d.getFullYear() + 1); return d;
    }
    if (/pasado manana/.test(t)) return sumarDias(b, 2);
    if (/\bmanana\b/.test(t)) return sumarDias(b, 1);
    if (/\bhoy\b|\bahora\b|al tiro|en el dia/.test(t)) return b;
    if ((m = t.match(/en (\d+) dias?/))) return sumarDias(b, +m[1]);
    if ((m = t.match(/en (\d+) semanas?/))) return sumarDias(b, 7 * +m[1]);
    if (/fin de mes/.test(t)) return new Date(b.getFullYear(), b.getMonth() + 1, 0, 12);
    if (/proxima semana|semana que viene|la otra semana|siguiente semana/.test(t)) return sumarDias(b, ((8 - b.getDay()) % 7) || 7);
    if (/esta semana|fin de semana/.test(t)) return sumarDias(b, Math.max(0, 5 - b.getDay()));
    for (let i = 0; i < 7; i++) if (new RegExp(`\\b${DIAS_N[i]}\\b`).test(t)) {
      let k = (i - b.getDay() + 7) % 7; if (k === 0 || /proximo|siguiente/.test(t)) k = k || 7; return sumarDias(b, k);
    }
    return null;
  }
  const fmtFechaCorta = (d) => {
    const hoy = inicioDia(new Date()), x = inicioDia(d), k = Math.round((x - hoy) / 864e5);
    if (k === 0) return "hoy"; if (k === 1) return "mañana"; if (k === -1) return "ayer";
    if (k > 1 && k < 7) return DIAS[x.getDay()];
    return `${x.getDate()} ${MESES[x.getMonth()].slice(0, 3)}`;
  };
  function estadoFecha(c) {
    if (c.hecho) return "hecho";
    if (!c.fecha) return "sinfecha";
    const k = Math.round((inicioDia(c.fecha) - inicioDia(new Date())) / 864e5);
    return k < 0 ? "vencido" : k === 0 ? "hoy" : k <= 7 ? "semana" : "despues";
  }

  let _cacheComp = { v: -1, l: [] };
  /** Todos los compromisos ("- [ ] responsable — qué — cuándo") de todas las notas. */
  function compromisos() {
    if (_cacheComp.v === _verNotas) return _cacheComp.l;
    const l = [];
    for (const n of E.notas) {
      for (const linea of n.cuerpo.split("\n")) {
        const m = linea.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
        if (!m) continue;
        const resto = m[2].trim(), iso = resto.match(/\((\d{4}-\d{2}-\d{2})\)/);
        const limpio = resto.replace(/\s*\(\d{4}-\d{2}-\d{2}\)/, "").replace(/\*\*/g, "");
        const p = limpio.split(/\s+[—–]\s+|\s+-\s+/);
        const resp = p.length > 1 ? p[0].trim() : "", que = (p.length > 1 ? p[1] : p[0]).trim(), cuando = p.slice(2).join(" — ").trim();
        const fecha = iso ? new Date(`${iso[1]}T12:00:00`) : fechaRelativa(cuando, n.fecha);
        l.push({ nota: n, linea, hecho: m[1] !== " ", resp, que, cuando, fecha, mio: !resp || esYo(resp) });
      }
    }
    // El mismo compromiso suele repetirse en reuniones seguidas: se queda la versión más reciente,
    // y cuenta como hecho si lo marcaste en cualquiera de ellas.
    const unicos = new Map();
    for (const c of l.sort((a, b) => b.nota.fecha - a.nota.fecha)) {
      const k = claveComp(c);
      if (!unicos.has(k)) { c.veces = 1; c.primera = c.nota; c.copias = [c]; unicos.set(k, c); }
      else { const u = unicos.get(k); u.veces++; u.primera = c.nota; u.copias.push(c); if (!u.fecha && c.fecha) u.fecha = c.fecha; if (c.hecho) u.hecho = true; }
    }
    const final = [...unicos.values()];
    _cacheComp = { v: _verNotas, l: final };
    return final;
  }
  /** Cambia el tipo (tag) de una nota ya generada: solo su etiqueta en el frontmatter. */
  function ponerTipo(ruta, id) {
    const i = E.notas.findIndex((x) => x.ruta === ruta);
    if (i < 0) return;
    const n = E.notas[i];
    if (n.tipo === id) return;
    const [fm, cuerpo] = partes(n.texto);
    let nfm = /^tipo:.*$/m.test(fm) ? fm.replace(/^tipo:.*$/m, `tipo: ${id}`) : fm.replace(/^(hora:.*)$/m, `$1\ntipo: ${id}`);
    if (nfm === fm) nfm = fm.replace(/^---\n/, `---\ntipo: ${id}\n`);
    const texto = nfm + cuerpo;
    host.enviar("reescribir", { ruta, texto });
    E.notas[i] = parsearNota(ruta, texto);
    marcarCambioNotas(); _cachePuntajes.clear();
    toast(`Ahora es ${categoria(id).emoji} ${nombreTipo(id)}`);
  }
  /** Clave para reconocer el mismo compromiso repetido en varias notas (responsable + primeras palabras). */
  function claveComp(c) { return `${norm(c.resp)}|${norm(c.que).split(" ").filter((w) => w.length > 2).slice(0, 6).join(" ")}`; }
  function partesComp(linea) {
    const m = linea.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/); if (!m) return null;
    const limpio = m[2].trim().replace(/\s*\(\d{4}-\d{2}-\d{2}\)/, "").replace(/\*\*/g, "");
    const p = limpio.split(/\s+[—–]\s+|\s+-\s+/);
    return { hecho: m[1] !== " ", resp: p.length > 1 ? p[0].trim() : "", que: (p.length > 1 ? p[1] : p[0]).trim() };
  }
  /** Marca o desmarca un compromiso en TODAS las notas donde aparece (Agenda, Personas y la nota quedan iguales). */
  function alternarCompromiso(ruta, linea, desdeLista = false) {
    const base = partesComp(linea); if (!base) return;
    // En Agenda/Personas se ve el estado combinado; en la nota, el de esa línea.
    const dedup = desdeLista ? compromisos().find((c) => claveComp(c) === claveComp(base)) : null;
    const hecho = !(dedup ? dedup.hecho : base.hecho);
    const k = claveComp(base);
    let cambio = false;
    E.notas.forEach((n, i) => {
      let texto = n.texto, toca = n.ruta === ruta && n.texto.includes(linea);
      const lineas = texto.split("\n").map((l) => {
        const c = partesComp(l);
        if (!c || (claveComp(c) !== k && !(toca && l === linea))) return l;
        return l.replace(/\[( |x|X)\]/, hecho ? "[x]" : "[ ]");
      });
      const nuevo = lineas.join("\n");
      if (nuevo === texto) return;
      host.enviar("reescribir", { ruta: n.ruta, texto: nuevo });
      E.notas[i] = parsearNota(n.ruta, nuevo); cambio = true;
    });
    if (!cambio) return;
    marcarCambioNotas(); _cachePuntajes.clear();
    render({ mantenerScroll: true });
    if (hecho) toast("✓ Compromiso cumplido");
  }

  let _cachePer = { v: -1, m: null };
  /** Fichas de personas a partir de los participantes y la sección "Personas" de cada nota. */
  function personas() {
    if (_cachePer.v === _verNotas) return _cachePer.m;
    const m = new Map();
    const tocar = (nombre) => {
      const clave = norm(nombre);
      if (!m.has(clave)) m.set(clave, { clave, nombre: nombre.trim(), notas: [], perfil: [], rol: "" });
      const p = m.get(clave); if (nombre.trim().length > p.nombre.length) p.nombre = nombre.trim();
      return p;
    };
    for (const n of [...E.notas].sort((a, b) => b.fecha - a.fecha)) {
      for (const nom of n.participantes) if (nombreValido(nom) && !esYo(nom)) { const p = tocar(nom); if (!p.notas.includes(n)) p.notas.push(n); }
      for (const linea of (secciones(n).personas || "").split("\n")) {
        const x = linea.match(/^\s*[-*]\s+\*\*([^*]+)\*\*\s*(?:\(([^)]*)\))?\s*[:—-]?\s*(.*)$/);
        const nom = x && limpiarNombre(x[1]);
        if (!nom || !nombreValido(nom) || esYo(nom)) continue;
        const p = tocar(nom);
        if (x[2] && !p.rol) p.rol = x[2].trim();
        if (x[3]) p.perfil.push({ texto: x[3].trim(), nota: n });
        if (!p.notas.includes(n)) p.notas.push(n);
      }
    }
    // "Matías" se une a "Matías Soto" si es el único que calza
    for (const [k, p] of [...m]) {
      if (k.includes(" ")) continue;
      const largos = [...m.values()].filter((q) => q.clave !== k && q.clave.startsWith(k + " "));
      if (largos.length === 1) { const q = largos[0]; p.notas.forEach((n) => !q.notas.includes(n) && q.notas.push(n)); q.perfil.push(...p.perfil); q.rol ||= p.rol; m.delete(k); }
    }
    for (const p of m.values()) {
      p.notas.sort((a, b) => b.fecha - a.fecha);
      const vistos = new Set();
      p.perfil = p.perfil.sort((a, b) => b.nota.fecha - a.nota.fecha).filter((x) => { const k = norm(x.texto); if (vistos.has(k)) return false; vistos.add(k); return true; });
    }
    _cachePer = { v: _verNotas, m };
    return m;
  }
  const iniciales = (nombre) => nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join("");
  const colorPersona = (clave) => { let h = 0; for (const c of clave) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 55% 45%)`; };
  function buscarPersona(a) {
    const toks = new Set([...norm(a.nombre).split(" "), ...norm((a.email || "").split("@")[0].replace(/[._-]/g, " ")).split(" ")].filter((x) => x.length > 1));
    let mejor = null, pts = 0;
    for (const p of personas().values()) {
      const pt = p.clave.split(" ");
      const comunes = pt.filter((x) => toks.has(x)).length;
      const ok = comunes === pt.length || (comunes >= 2) || (pt.length === 1 && comunes === 1 && toks.size <= 2);
      if (ok && comunes > pts) { mejor = p; pts = comunes; }
    }
    return mejor;
  }
  const parecido = (a, b) => { const x = new Set(norm(a).split(" ").filter((w) => w.length > 2)), y = new Set(norm(b).split(" ").filter((w) => w.length > 2)); if (!x.size || !y.size) return 0; let c = 0; x.forEach((w) => y.has(w) && c++); return c / Math.min(x.size, y.size); };
  const PREG_FOCO = {
    cierre: "Antes de cortar: «¿Quién hace qué y para cuándo?»", preguntas: "Abre preguntando: «¿Qué es lo que más les complica hoy con esto?»",
    escucha: "Resume antes de responder: «Si entendí bien, lo que necesitan es…»", claridad: "Parte con tu conclusión en una frase y después los detalles.",
  };

  /** Todo lo que conviene saber antes de una reunión del calendario. */
  function brief(ev) {
    const gente = (ev.asistentes || []).filter((a) => !esYo(a.nombre)).map((a) => ({ a, p: buscarPersona(a) }));
    const conocidas = [...new Set(gente.map((g) => g.p).filter(Boolean))];
    const relacionadas = E.notas.filter((n) => conocidas.some((p) => p.notas.includes(n)) || parecido(n.titulo, ev.titulo) >= 0.6).sort((a, b) => b.fecha - a.fecha);
    const ultima = relacionadas[0] || null;
    const nombresClave = conocidas.flatMap((p) => p.clave.split(" ").filter((w) => w.length > 2));
    const abiertos = compromisos().filter((c) => !c.hecho && (relacionadas.includes(c.nota) || nombresClave.some((w) => norm(c.resp).split(" ").includes(w))))
      .sort((a, b) => (a.fecha ? +a.fecha : 9e15) - (b.fecha ? +b.fecha : 9e15));
    const pendientes = ultima ? secciones(ultima).puntos.split("\n").filter((l) => /\*\*Pendiente:\*\*/.test(l)).map((l) => l.replace(/^\s*[-*]\s*/, "").replace(/\*\*Pendiente:\*\*\s*/, "").trim()) : [];
    const F = foco();
    const preguntas = [
      ...pendientes.slice(0, 2).map((p) => `¿Cómo quedó: ${p.replace(/\.$/, "")}?`),
      ...abiertos.filter((c) => !c.mio).slice(0, 2).map((c) => `${c.resp ? c.resp.split(" ")[0] + ", ¿" : "¿"}alcanzaste a ${c.que.charAt(0).toLowerCase() + c.que.slice(1).replace(/\.$/, "")}?`),
    ];
    if (F) preguntas.push(PREG_FOCO[F.debil.clave]);
    return { ev, gente, conocidas, relacionadas, ultima, abiertos, mios: abiertos.filter((c) => c.mio), suyos: abiertos.filter((c) => !c.mio), pendientes, habito: F?.habito || "", foco: F, preguntas: preguntas.slice(0, 4) };
  }
  /** Texto corto para la notificación de "prepárate". */
  function briefTexto(id) {
    const ev = (E.agenda || []).find((x) => x.id === id);
    if (!ev) return "";
    const b = brief(ev), partes = [];
    if (b.ultima) partes.push(`La última vez (${fmtFechaCorta(b.ultima.fecha)}): ${b.ultima.titulo}`);
    else partes.push(b.conocidas.length ? `Con ${b.conocidas.map((p) => p.nombre.split(" ")[0]).join(", ")}` : "Primera reunión con estas personas");
    const venc = b.abiertos.filter((c) => estadoFecha(c) === "vencido").length;
    if (b.abiertos.length) partes.push(`${b.abiertos.length} compromiso${b.abiertos.length > 1 ? "s" : ""} abierto${b.abiertos.length > 1 ? "s" : ""}${venc ? ` (${venc} vencido${venc > 1 ? "s" : ""})` : ""}`);
    if (b.habito) partes.push(`Tu hábito: ${b.habito.replace(/\*\*/g, "")}`);
    return partes.join(" · ");
  }
  function resumenCompromisos() {
    const mios = compromisos().filter((c) => c.mio && !c.hecho);
    const venc = mios.filter((c) => estadoFecha(c) === "vencido"), hoy = mios.filter((c) => estadoFecha(c) === "hoy");
    if (!venc.length && !hoy.length) return "";
    const p = [];
    if (hoy.length) p.push(`Hoy: ${hoy.slice(0, 2).map((c) => c.que).join("; ")}${hoy.length > 2 ? "…" : ""}`);
    if (venc.length) p.push(`${venc.length} vencido${venc.length > 1 ? "s" : ""}: ${venc[0].que}${venc.length > 1 ? "…" : ""}`);
    return p.join(" · ");
  }
  const enCuanto = (ms) => {
    const k = Math.round((ms - Date.now()) / 60000);
    if (k <= 0) return "en curso"; if (k < 60) return `en ${k} min`;
    const d = new Date(ms), hoy = inicioDia(new Date());
    return inicioDia(d) - hoy === 0 ? `hoy ${hhmm(d)}` : inicioDia(d) - hoy === 864e5 ? `mañana ${hhmm(d)}` : `${DIAS[d.getDay()]} ${hhmm(d)}`;
  };
  const proximos = (horas = 36) => (E.agenda || []).filter((e) => e.fin > Date.now() && e.inicio < Date.now() + horas * 36e5).sort((a, b) => a.inicio - b.inicio);

  function chipFecha(c) {
    const e = estadoFecha(c);
    if (e === "sinfecha") return c.cuando ? `<span class="ag-fecha sin">${esc(c.cuando)}</span>` : `<span class="ag-fecha sin">sin fecha</span>`;
    if (e === "hecho") return `<span class="ag-fecha hecho">hecho</span>`;
    return `<span class="ag-fecha ${e}">${e === "vencido" ? "vencido · " : ""}${fmtFechaCorta(c.fecha)}</span>`;
  }
  function filaCompromiso(c, { conNota = true } = {}) {
    return `<li class="ag-comp ${estadoFecha(c)}${c.mio ? " mio" : ""}">
      <button class="ag-check" data-comp-ruta="${esc(c.nota.ruta)}" data-comp-linea="${esc(c.linea)}" aria-label="${c.hecho ? "Marcar como pendiente" : "Marcar como hecho"}">${c.hecho ? "✓" : ""}</button>
      ${c.hecho ? "" : `<button class="ag-rec" data-recordar="${esc(c.linea)}" title="${ESCRITORIO ? `Agregar a tu calendario${c.fecha ? " con su fecha" : ""}` : `Agregar a Recordatorios del Mac${c.fecha ? " con su fecha" : ""}`}">⏰</button>`}
      <div class="ag-comp-txt"><span class="ag-que">${inline(c.que)}</span>
        <span class="ag-meta">${c.mio ? `<span class="ag-resp mio">Tú</span>` : c.resp ? `<span class="ag-resp" style="--c:${colorPersona(norm(c.resp))}">${esc(c.resp)}</span>` : ""}${chipFecha(c)}
        ${c.veces > 1 ? `<span class="ag-veces" title="Se mencionó en ${c.veces} reuniones desde el ${fmtFechaCorta(c.primera.fecha)}">↻ ${c.veces} reuniones</span>` : ""}
        ${conNota ? `<button class="ag-nota" data-nota="${esc(c.nota.ruta)}">${esc(c.nota.titulo)} · ${fmtFechaCorta(c.nota.fecha)}</button>` : ""}</span></div></li>`;
  }
  function avatar(p, nombre) {
    const n = p ? p.nombre : nombre;
    return `<span class="ag-av${p ? "" : " desconocido"}" style="--c:${p ? colorPersona(p.clave) : "#888"}" title="${esc(n)}">${esc(iniciales(n) || "?")}</span>`;
  }
  function tarjetaBrief(ev, abierta) {
    const b = brief(ev), ahora = Date.now() >= ev.inicio && Date.now() < ev.fin;
    const cab = `<div class="ag-ev-cab"><div class="ag-hora"><b>${hhmm(new Date(ev.inicio))}</b><small>${hhmm(new Date(ev.fin))}</small></div>
      <div class="ag-ev-tit"><h3>${esc(ev.titulo || "Reunión")}</h3><div class="ag-gente">${b.gente.slice(0, 8).map((g) => `<span class="ag-persona${g.p ? " conocida" : ""}"${g.p ? ` data-persona="${esc(g.p.clave)}"` : ""}>${avatar(g.p, g.a.nombre || g.a.email)}${esc((g.p?.nombre || g.a.nombre || g.a.email || "").split(" ").slice(0, 2).join(" "))}</span>`).join("")}${b.gente.length > 8 ? `<span class="ag-mas">+${b.gente.length - 8}</span>` : ""}</div></div>
      <span class="ag-cuando ${ahora ? "ahora" : ""}">${enCuanto(ev.inicio)}</span></div>`;
    if (!abierta) {
      const resumen = [b.ultima ? `Última vez ${fmtFechaCorta(b.ultima.fecha)}` : "Primera vez", b.abiertos.length ? `${b.abiertos.length} compromisos abiertos` : ""].filter(Boolean).join(" · ");
      return `<button class="ag-ev cerrada" data-brief="${esc(ev.id)}">${cab}<p class="ag-resumen">${esc(resumen)} <span>Ver preparación →</span></p></button>`;
    }
    const fu = b.ultima ? analizarFeedback(b.ultima) : null;
    const decis = b.ultima ? secciones(b.ultima).puntos.split("\n").filter((l) => /\*\*Decisión:\*\*/.test(l)).map((l) => l.replace(/^\s*[-*]\s*/, "")).slice(0, 3) : [];
    const perfiles = b.conocidas.map((p) => ({ p, t: p.perfil[0]?.texto })).filter((x) => x.t);
    return `<section class="ag-ev abierta" data-ev="${esc(ev.id)}">${cab}
      <div class="ag-cuerpo">
        <div class="ag-col">
          <div class="ag-bloque"><div class="co-eti">La última vez</div>
            ${b.ultima ? `<button class="ag-ultima" data-nota="${esc(b.ultima.ruta)}"><b>${esc(b.ultima.titulo)}</b><small>${cap(fmtFechaCorta(b.ultima.fecha))} · ${Math.round(b.ultima.duracion || 0)} min · abrir nota →</small></button>
              ${decis.length ? `<ul class="ag-lista">${decis.map((d) => `<li>${inline(d)}</li>`).join("")}</ul>` : fu?.veredicto ? `<p class="ag-txt">${inline(fu.veredicto)}</p>` : ""}`
              : `<p class="ag-txt suave">Primera reunión registrada con ${b.gente.length ? "estas personas" : "este tema"}. Llega con una pregunta de diagnóstico.</p>`}</div>
          ${b.pendientes.length ? `<div class="ag-bloque"><div class="co-eti">Quedó pendiente</div><ul class="ag-lista">${b.pendientes.map((p) => `<li>${inline(p)}</li>`).join("")}</ul></div>` : ""}
          ${perfiles.length ? `<div class="ag-bloque"><div class="co-eti">Lo que les importa</div><ul class="ag-lista perfiles">${perfiles.map((x) => `<li>${avatar(x.p)}<span><b>${esc(x.p.nombre.split(" ")[0])}:</b> ${inline(x.t)}</span></li>`).join("")}</ul></div>` : ""}
        </div>
        <div class="ag-col">
          <div class="ag-bloque"><div class="co-eti">Compromisos abiertos</div>
            ${b.abiertos.length ? `${b.suyos.length ? `<div class="ag-sub">De ellos</div><ul class="ag-comps">${b.suyos.slice(0, 4).map((c) => filaCompromiso(c, { conNota: false })).join("")}</ul>` : ""}
              ${b.mios.length ? `<div class="ag-sub">Tuyos</div><ul class="ag-comps">${b.mios.slice(0, 4).map((c) => filaCompromiso(c, { conNota: false })).join("")}</ul>` : ""}
              ${b.suyos.length > 4 || b.mios.length > 4 ? `<button class="ag-nota" data-seccion="agenda" data-comp-filtro="todos">Ver los ${b.abiertos.length} compromisos ↓</button>` : ""}`
              : `<p class="ag-txt suave">No hay compromisos abiertos con ellos. 👌</p>`}</div>
        </div>
      </div>
      <div class="ag-llega"><div class="co-eti">🎯 Llega con esto</div>
        ${b.habito ? `<p class="ag-habito">Tu hábito: <b>${inline(b.habito)}</b></p>` : ""}
        ${b.preguntas.length ? `<ol class="ag-preg">${b.preguntas.map((q) => `<li>${inline(q)}</li>`).join("")}</ol>` : ""}
        <div class="ag-acc"><button class="boton-txt" data-copiar-brief="${esc(ev.id)}">⧉ Copiar preparación</button><button class="boton-txt aplicar" data-abrir-gym="${esc(ev.id)}">🥊 Ensayar esta reunión</button></div>
      </div>
    </section>`;
  }
  function panelAgenda() {
    const lista = proximos(36);
    if (!E.briefAbierto || !lista.some((e) => e.id === E.briefAbierto)) E.briefAbierto = lista[0]?.id || null;
    const todos = compromisos(), ver = E.compFiltro || "mios";
    const fil = todos.filter((c) => (ver === "mios" ? c.mio : ver === "otros" ? !c.mio : true));
    const grupos = [["vencido", "Vencidos"], ["hoy", "Hoy"], ["semana", "Próximos 7 días"], ["despues", "Más adelante"], ["sinfecha", "Sin fecha"]];
    const hechos = fil.filter((c) => c.hecho).sort((a, b) => b.nota.fecha - a.nota.fecha).slice(0, 8);
    const abiertos = fil.filter((c) => !c.hecho);
    const conteo = (e) => todos.filter((c) => c.mio && !c.hecho && estadoFecha(c) === e).length;
    return `<div class="agenda">
      <h1>📅 Agenda</h1><p class="foco-sub">Prepárate para lo que viene y no se te pase ningún compromiso.</p>
      <div class="ag-kpis">
        <span class="ag-kpi ${conteo("vencido") ? "mal" : ""}"><b>${conteo("vencido")}</b> vencidos</span>
        <span class="ag-kpi ${conteo("hoy") ? "ojo" : ""}"><b>${conteo("hoy")}</b> para hoy</span>
        <span class="ag-kpi"><b>${lista.length}</b> reuniones próximas</span>
      </div>
      <div class="subtitulo">Próximas reuniones</div>
      ${lista.length ? `<div class="ag-eventos">${lista.map((ev) => tarjetaBrief(ev, ev.id === E.briefAbierto)).join("")}</div>`
        : `<div class="ag-vacio">${E.plataforma === "web" ? "En la app de Mac aquí aparecen tus reuniones del calendario." : ESCRITORIO && E.avisos?.calendario !== "si" ? "Conecta tu calendario en Preferencias (dirección iCal de Google u Outlook) y aquí aparecen tus reuniones." : "No hay reuniones en tu calendario en las próximas 36 horas."}</div>`}
      <div class="subtitulo ag-tit-comp">Compromisos <button class="ag-nota" data-recordar="mios" title="Crea un recordatorio por cada compromiso tuyo abierto (sin duplicar)">${ESCRITORIO ? "⏰ Mis compromisos a tu calendario" : "⏰ Mis compromisos a Recordatorios"}</button>
        <span class="pestanas ag-filtro">${[["mios", "Míos"], ["otros", "De otros"], ["todos", "Todos"]].map(([k, n]) => `<button class="pestana${ver === k ? " activa" : ""}" data-comp-filtro="${k}">${n}</button>`).join("")}</span></div>
      ${abiertos.length ? grupos.map(([k, n]) => { const g = abiertos.filter((c) => estadoFecha(c) === k).sort((a, b) => (a.fecha ? +a.fecha : 0) - (b.fecha ? +b.fecha : 0)); return g.length ? `<div class="ag-grupo ${k}"><div class="ag-grupo-tit">${n} <small>${g.length}</small></div><ul class="ag-comps">${g.map((c) => filaCompromiso(c)).join("")}</ul></div>` : ""; }).join("")
        : `<div class="ag-vacio">No tienes compromisos abiertos${ver === "mios" ? "" : " en este filtro"}. 🎉</div>`}
      ${hechos.length ? `<details class="co-todo"><summary>Cumplidos recientemente (${hechos.length})</summary><ul class="ag-comps">${hechos.map((c) => filaCompromiso(c)).join("")}</ul></details>` : ""}
      <p class="cat-ayuda pie">Los compromisos salen de "Próximos pasos" de cada nota. Al marcarlos, la nota se actualiza en tu vault.</p>
    </div>`;
  }
  function panelPersonas() {
    const todas = [...personas().values()].sort((a, b) => b.notas[0].fecha - a.notas[0].fecha);
    if (!todas.length) return `<h1>👥 Personas</h1><div class="vacio grande"><div>👥</div><h2>Aún no hay personas</h2><p>Aparecen solas a medida que grabas reuniones.</p></div>`;
    const q = norm(E.buscaPersona || "");
    const lista = todas.filter((p) => !q || p.clave.includes(q) || norm(p.rol).includes(q));
    const sel = personas().get(E.persona) || lista[0] || todas[0];
    const comp = compromisos().filter((c) => !c.hecho && (sel.notas.includes(c.nota) && (!c.mio || true)) && (norm(c.resp).split(" ").some((w) => w.length > 2 && sel.clave.split(" ").includes(w)) || (c.mio && sel.notas.includes(c.nota))));
    const tipos = {}; sel.notas.forEach((n) => (tipos[n.tipo || "Otra"] = (tipos[n.tipo || "Otra"] || 0) + 1));
    return `<div class="personas">
      <h1>👥 Personas</h1>
      <div class="pe-grid">
        <div class="pe-lista"><label class="buscador"><span class="lupa">⌕</span><input id="busca-persona" value="${esc(E.buscaPersona || "")}" placeholder="Buscar persona" autocomplete="off"></label>
          <nav>${lista.map((p) => `<button class="pe-fila${p === sel ? " elegida" : ""}" data-persona="${esc(p.clave)}">${avatar(p)}<span><b>${esc(p.nombre)}</b><small>${p.notas.length} reunion${p.notas.length > 1 ? "es" : ""} · ${fmtFechaCorta(p.notas[0].fecha)}</small></span></button>`).join("")}</nav></div>
        <div class="pe-ficha">
          <div class="pe-cab">${avatar(sel)}<div><h2>${esc(sel.nombre)}</h2><p>${sel.rol ? `${esc(sel.rol)} · ` : ""}${sel.notas.length} reuniones · la última ${fmtFechaCorta(sel.notas[0].fecha)} · ${Object.entries(tipos).map(([t, k]) => `${esc(categoria(t).emoji)} ${esc(nombreTipo(t))} ${k}`).join(" · ")}</p></div></div>
          <div class="ag-bloque"><div class="co-eti">Qué le importa y cómo es</div>
            ${sel.perfil.length ? `<ul class="ag-lista">${sel.perfil.slice(0, 6).map((x) => `<li>${inline(x.texto)} <button class="ag-nota" data-nota="${esc(x.nota.ruta)}">${fmtFechaCorta(x.nota.fecha)}</button></li>`).join("")}</ul>`
              : `<p class="ag-txt suave">Desde tu próxima reunión con ${esc(sel.nombre.split(" ")[0])}, tu IA anotará qué le importa, sus objeciones y su forma de decidir.</p>`}</div>
          <div class="ag-bloque"><div class="co-eti">Compromisos abiertos</div>${comp.length ? `<ul class="ag-comps">${comp.map((c) => filaCompromiso(c)).join("")}</ul>` : `<p class="ag-txt suave">Nada pendiente con ${esc(sel.nombre.split(" ")[0])}.</p>`}</div>
          <div class="ag-bloque"><div class="co-eti">Reuniones juntos</div><div class="pe-reus">${sel.notas.slice(0, 12).map((n) => `<button class="fila" data-nota="${esc(n.ruta)}"><span class="tipo-barra t-${esc(n.tipo || "Otra")}"></span><span class="fila-txt"><span class="fila-titulo">${esc(n.titulo)}</span><span class="fila-det">${fmtFechaCorta(n.fecha)} · ${Math.round(n.duracion || 0)} min${puntajes(n) ? ` · ${promP(puntajes(n)).toFixed(1)}` : ""}</span></span></button>`).join("")}</div></div>
        </div>
      </div>
    </div>`;
  }
  function textoBrief(id) {
    const ev = (E.agenda || []).find((x) => x.id === id); if (!ev) return "";
    const b = brief(ev), L = [`Preparación: ${ev.titulo} (${hhmm(new Date(ev.inicio))})`];
    if (b.ultima) L.push(`\nLa última vez (${fmtFechaCorta(b.ultima.fecha)}): ${b.ultima.titulo}`);
    if (b.pendientes.length) L.push("\nQuedó pendiente:", ...b.pendientes.map((p) => `- ${p.replace(/\*\*/g, "")}`));
    if (b.abiertos.length) L.push("\nCompromisos abiertos:", ...b.abiertos.map((c) => `- ${c.mio ? "Yo" : c.resp}: ${c.que.replace(/\*\*/g, "")}${c.fecha ? ` (${fmtFechaCorta(c.fecha)})` : ""}`));
    if (b.preguntas.length) L.push("\nPreguntas:", ...b.preguntas.map((q) => `- ${q.replace(/\*\*/g, "")}`));
    return L.join("\n");
  }
  /** Tarjeta "Próxima reunión" del panel de la barra de menú. */
  function proximaPanel() {
    const ev = proximos(2).find((e) => e.inicio - Date.now() < 90 * 60000);
    if (!ev) return "";
    const b = brief(ev), venc = b.abiertos.filter((c) => estadoFecha(c) === "vencido").length;
    const linea = b.suyos.length ? `${b.suyos[0].resp.split(" ")[0]} debía: ${b.suyos[0].que}` : b.pendientes[0] ? `Pendiente: ${b.pendientes[0]}` : b.ultima ? `La última vez: ${b.ultima.titulo}` : "Primera reunión con estas personas";
    return `<button class="pn-proxima" data-pn-brief="${esc(ev.id)}"><span class="co-eti">📅 ${Date.now() >= ev.inicio ? "Ahora" : `Próxima · ${enCuanto(ev.inicio)}`}</span>
      <b>${esc(ev.titulo || "Reunión")}</b><small>${inline(linea.replace(/\*\*/g, ""))}${b.abiertos.length ? ` · ${b.abiertos.length} compromiso${b.abiertos.length > 1 ? "s" : ""}${venc ? ` (${venc} vencido${venc > 1 ? "s" : ""})` : ""}` : ""}</small><span class="pn-link">Ver preparación →</span></button>`;
  }

  // ───────────────────────── Recompensas: revelación de logros y rangos ─────────────────────────
  /** Logros y rango nuevos que trajo una nota (lo mismo que muestra "Tu desempeño"). */
  function premiosDe(n) {
    const t = tema(); if (!t || !n) return null;
    const nuevos = calcularLogros(E.notas, n.fecha).filter((e) => e.nota === n.ruta);
    const p = puntajes(n), xpR = (p ? xpDe(p) : 0) + nuevos.length * XP_LOGRO;
    const total = xpTotal(E.notas, n.fecha), { i, r } = rango(t, total), antes = rango(t, total - xpR).i;
    return {
      ruta: n.ruta, titulo: n.titulo, xp: xpR, moneda: t.xp,
      rango: i > antes ? { emoji: icoRango(t, i), nombre: r.nombre, frase: r.frase, nivel: i + 1 } : null,
      logros: nuevos.map((e) => ({ id: e.def.id, emoji: icoLogro(t, e.def), ...logroTexto(t, e.def.id) })),
    };
  }
  // Cada universo celebra a su manera.
  const EFECTOS = {
    starwars: { modo: "hiperespacio", grito: "¡Que la Fuerza te acompañe!" },
    cyberpunkedgerunners: { modo: "hiperespacio", grito: "PREEM, CHOOM" },
    harrypotter: { modo: "chispas", emojis: ["✨", "⭐"], grito: "¡Diez puntos para tu casa!" },
    senoranillos: { modo: "chispas", emojis: ["✨", "💍"], grito: "Una hazaña digna de cantares" },
    gameofthrones: { modo: "chispas", emojis: ["🔥", "✨"], grito: "Los cuervos llevan la noticia" },
    marvel: { modo: "comic", palabra: "¡BOOM!", grito: "¡Vengadores, unidos!" },
    simpsons: { modo: "lluvia", emojis: ["🍩", "🍩", "⭐"], grito: "¡Woohoo!" },
    dragonball: { modo: "ki", grito: "¡Tu ki se elevó!" },
    rapidoyfurioso: { modo: "lluvia", emojis: ["🏁", "🔥", "⚡"], grito: "Ganaste por un cuarto de milla" },
    shrek: { modo: "lluvia", emojis: ["🧅", "🌿", "⭐"], grito: "¡Ogro-celente!" },
    piratas: { modo: "lluvia", emojis: ["🪙", "🪙", "💎"], grito: "¡Botín asegurado!" },
    toystory: { modo: "lluvia", emojis: ["⭐", "🚀", "🤠"], grito: "¡Al infinito y más allá!" },
    cine: { modo: "comic", palabra: "¡CORTE!", grito: "¡Y el premio es para ti!" },
    pokemon: { modo: "lluvia", emojis: ["⚡", "⭐", "🔴"], grito: "¡Subiste de nivel!" },
  };
  let _rev = null;
  /** Abre la revelación con efectos sobre la ventana. items: [{tipo: "rango"|"logro", emoji, nombre, descripcion}] */
  function revelar(items, extra = {}) {
    if (!items.length) return false;
    cerrarRevelacion(true);
    const t = tema(), ef = EFECTOS[t?.id] || { modo: "confeti", emojis: [t?.emoji || "🏆"], grito: "¡Lo lograste!" };
    const caja = document.createElement("div");
    caja.className = `revelacion rv-${ef.modo}`;
    caja.innerHTML = `<canvas class="rv-lienzo"></canvas><div class="rv-centro"></div>`;
    document.body.appendChild(caja);
    _rev = { caja, items, k: 0, ef, extra, t0: performance.now(), parts: [], raf: 0 };
    pintarItem();
    animarRevelacion();
    requestAnimationFrame(() => caja.classList.add("visible"));
    return true;
  }
  function pintarItem() {
    const r = _rev; if (!r) return;
    const it = r.items[r.k], ult = r.k === r.items.length - 1;
    r.caja.querySelector(".rv-centro").innerHTML = `
      ${r.ef.palabra ? `<div class="rv-palabra">${esc(r.ef.palabra)}</div>` : ""}
      <div class="rv-carta" style="--k:${r.k}">
        <div class="rv-eti">${it.tipo === "rango" ? "⬆ ¡Subiste de rango!" : "🏆 Logro desbloqueado"}</div>
        <div class="rv-medalla"><span>${esc(it.emoji)}</span></div>
        <h2>${esc(it.nombre)}</h2>
        <p>${esc(it.descripcion || "")}</p>
        ${it.tipo === "rango" ? `<div class="rv-xp">Nivel ${it.nivel}</div>` : `<div class="rv-xp">+${XP_LOGRO} ${esc(r.extra.moneda || "XP")}</div>`}
        <div class="rv-grito">${esc(r.ef.grito || "")}</div>
        <div class="rv-acc">${r.items.length > 1 ? `<span class="rv-cuenta">${r.k + 1} de ${r.items.length}</span>` : ""}
          <button class="boton-txt aplicar" data-rv="${ult ? "cerrar" : "sig"}">${ult ? "¡Genial!" : "Siguiente →"}</button></div>
      </div>`;
    traducirDOM(r.caja);
    r.t0 = performance.now(); r.parts = [];
    r.caja.classList.remove("rv-golpe"); void r.caja.offsetWidth; r.caja.classList.add("rv-golpe");
  }
  function cerrarRevelacion(inmediato) {
    const r = _rev; if (!r) return;
    _rev = null; cancelAnimationFrame(r.raf);
    if (inmediato) { r.caja.remove(); return; }
    r.caja.classList.remove("visible"); setTimeout(() => r.caja.remove(), 320);
  }
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-rv]");
    if (b && _rev) { if (b.dataset.rv === "sig") { _rev.k++; pintarItem(); } else cerrarRevelacion(); ev.stopPropagation(); return; }
    if (_rev && ev.target.classList.contains("rv-centro")) cerrarRevelacion();
  }, true);
  document.addEventListener("keydown", (ev) => {
    if (!_rev) return;
    if (ev.key === "Escape") { cerrarRevelacion(); ev.preventDefault(); ev.stopPropagation(); }
    else if (ev.key === "Enter" || ev.key === " " || ev.key === "ArrowRight") { if (_rev.k < _rev.items.length - 1) { _rev.k++; pintarItem(); } else cerrarRevelacion(); ev.preventDefault(); ev.stopPropagation(); }
  }, true);

  function animarRevelacion() {
    const r = _rev; if (!r) return;
    const cv = r.caja.querySelector("canvas"), dpr = window.devicePixelRatio || 1;
    const W = cv.width = innerWidth * dpr, H = cv.height = innerHeight * dpr;
    const ctx = cv.getContext("2d"), css = getComputedStyle(document.documentElement);
    const acento = css.getPropertyValue("--acento").trim() || "#facc15", acento2 = css.getPropertyValue("--acento2").trim() || "#60a5fa";
    const reducir = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cx = W / 2, cy = H * 0.46, rnd = (a, b) => a + Math.random() * (b - a);
    const nuevo = () => {
      const m = r.ef.modo;
      if (m === "hiperespacio") { const a = rnd(0, Math.PI * 2); return { a, d: rnd(10, 80) * dpr, v: rnd(4, 14) * dpr, l: 0 }; }
      if (m === "chispas") return { x: rnd(0, W), y: H + 20, vy: -rnd(1.2, 3.4) * dpr, vx: rnd(-0.6, 0.6) * dpr, s: rnd(2, 5) * dpr, f: rnd(0, 6), e: Math.random() < 0.18 ? r.ef.emojis[Math.floor(Math.random() * r.ef.emojis.length)] : null };
      if (m === "lluvia") return { x: rnd(0, W), y: -40 * dpr, vy: rnd(2.5, 6) * dpr, vx: rnd(-1, 1) * dpr, rot: rnd(0, 6), vr: rnd(-0.08, 0.08), s: rnd(22, 40) * dpr, e: r.ef.emojis[Math.floor(Math.random() * r.ef.emojis.length)] };
      if (m === "ki") { const a = rnd(0, Math.PI * 2); return { a, d: rnd(110, 150) * dpr, v: rnd(2, 6) * dpr, w: rnd(2, 6) * dpr, vida: 1 }; }
      const a = rnd(0, Math.PI * 2), v = rnd(6, 16) * dpr;  // confeti / comic: estallido desde el centro
      return { x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 4 * dpr, rot: rnd(0, 6), vr: rnd(-0.3, 0.3), s: rnd(5, 10) * dpr, c: Math.random() < 0.5 ? acento : acento2, e: r.ef.emojis && Math.random() < 0.15 ? r.ef.emojis[0] : null };
    };
    const paso = (ahora) => {
      if (_rev !== r) return;
      const t = (ahora - r.t0) / 1000, m = r.ef.modo;
      ctx.clearRect(0, 0, W, H);
      if (!reducir) {
        const tasa = m === "hiperespacio" ? 9 : m === "chispas" ? 4 : m === "lluvia" ? (t < 2.5 ? 2 : 0.4) : m === "ki" ? 6 : (t < 0.25 ? 26 : t < 2 ? 1.2 : 0);
        for (let k = 0; k < tasa; k++) if (Math.random() < Math.min(1, tasa - k)) r.parts.push(nuevo());
      }
      // fondo del modo
      if (m === "comic" || m === "ki") {
        const rayos = 18, giro = t * (m === "ki" ? 0.9 : 0.25);
        ctx.save(); ctx.translate(cx, cy);
        for (let k = 0; k < rayos; k++) {
          ctx.rotate((Math.PI * 2) / rayos); ctx.beginPath(); ctx.moveTo(0, 0);
          ctx.arc(0, 0, Math.max(W, H), giro, giro + Math.PI / rayos);
          ctx.fillStyle = m === "ki" ? `rgba(250, 204, 21, ${0.07 + 0.05 * Math.sin(t * 6 + k)})` : (k % 2 ? acento : acento2) + "22"; ctx.fill();
        }
        ctx.restore();
      }
      if (m === "ki") {
        const g = ctx.createRadialGradient(cx, cy, 40 * dpr, cx, cy, (190 + 25 * Math.sin(t * 7)) * dpr);
        g.addColorStop(0, "rgba(253, 224, 71, .55)"); g.addColorStop(1, "rgba(253, 224, 71, 0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      for (const p of r.parts) {
        if (m === "hiperespacio") {
          p.d += p.v; p.v *= 1.045; p.l = Math.min(p.l + p.v * 0.9, 220 * dpr);
          const x1 = cx + Math.cos(p.a) * p.d, y1 = cy + Math.sin(p.a) * p.d, x0 = cx + Math.cos(p.a) * (p.d - p.l), y0 = cy + Math.sin(p.a) * (p.d - p.l);
          ctx.strokeStyle = `rgba(220, 235, 255, ${Math.min(1, p.d / (300 * dpr))})`; ctx.lineWidth = 1.6 * dpr; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          p.muerto = p.d - p.l > Math.hypot(W, H) / 2;
        } else if (m === "chispas") {
          p.x += p.vx + Math.sin(t * 2 + p.f) * 0.4 * dpr; p.y += p.vy; const brillo = 0.5 + 0.5 * Math.sin(t * 8 + p.f);
          if (p.e) { ctx.globalAlpha = 0.85; ctx.font = `${p.s * 4}px system-ui`; ctx.fillText(p.e, p.x, p.y); ctx.globalAlpha = 1; }
          else { ctx.fillStyle = acento; ctx.globalAlpha = 0.35 + 0.65 * brillo; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (0.6 + brillo * 0.6), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
          p.muerto = p.y < -30;
        } else if (m === "lluvia") {
          p.x += p.vx; p.y += p.vy; p.rot += p.vr;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.font = `${p.s}px system-ui`; ctx.textAlign = "center"; ctx.fillText(p.e, 0, 0); ctx.restore();
          p.muerto = p.y > H + 60;
        } else if (m === "ki") {
          p.d += p.v; p.vida -= 0.02;
          const x = cx + Math.cos(p.a) * p.d, y = cy + Math.sin(p.a) * p.d;
          ctx.strokeStyle = `rgba(254, 240, 138, ${Math.max(0, p.vida)})`; ctx.lineWidth = p.w; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(p.a) * 18 * dpr, y + Math.sin(p.a) * 18 * dpr - 10 * dpr); ctx.stroke();
          p.muerto = p.vida <= 0;
        } else {
          p.vy += 0.32 * dpr; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          if (p.e) { ctx.font = `${p.s * 3}px system-ui`; ctx.fillText(p.e, 0, 0); } else { ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); }
          ctx.restore();
          p.muerto = p.y > H + 40;
        }
      }
      r.parts = r.parts.filter((p) => !p.muerto);
      r.raf = requestAnimationFrame(paso);
    };
    r.raf = requestAnimationFrame(paso);
  }

  // ───────────────────────── Pregúntale a tus reuniones (⌘K) ─────────────────────────
  E.preg = { abierta: false, lista: [] };
  const SUGERENCIAS = ["¿Qué compromisos tengo pendientes con Matías?", "¿Qué objeciones han puesto los clubes en las demos?",
    "¿Cuándo hablamos del ambiente QA y qué se decidió?", "¿En qué he mejorado este mes según el feedback?"];
  function abrirPreguntar(q = "") { E.preg.abierta = true; E.preg.borrador = q; render({ mantenerScroll: true }); setTimeout(() => { const i = $("#preg-txt"); i?.focus(); if (q && i) i.setSelectionRange(q.length, q.length); }, 30); }
  function preguntar(q) {
    q = q.trim(); if (!q) return;
    const id = `p${Date.now()}`;
    E.preg.lista.unshift({ id, q, estado: "pensando" });
    E.preg.borrador = "";
    render({ mantenerScroll: true });
    host.enviar("preguntar", { id, pregunta: q });
  }
  function respuestaHTML(r) {
    if (r.estado === "pensando") return `<div class="pr-pensando"><span></span><span></span><span></span> Buscando en tus reuniones…</div>`;
    if (r.estado === "error") return `<p class="forja-error">No pude responder: ${esc(r.error || "error")}</p>`;
    const porN = Object.fromEntries((r.fuentes || []).map((f) => [String(f.n), f]));
    let html = md(r.respuesta || "");
    html = html.replace(/\[(\d+)(?:@(\d{1,2}:\d{2}(?::\d{2})?))?\]/g, (m0, n, h) => {
      const f = porN[n]; if (!f) return m0;
      return `<button class="pr-cita" data-cita-ruta="${esc(f.ruta)}"${h ? ` data-cita-hora="${h.length <= 5 ? "00:" + h : h}"` : ""} title="${esc(f.titulo)}">${n}${h ? ` · ${h.replace(/^00:/, "")}` : ""}</button>`;
    });
    const usadas = (r.fuentes || []).filter((f) => new RegExp(`\\[${f.n}(?:@|\\])`).test(r.respuesta || ""));
    return `<div class="pr-resp">${html}</div>${usadas.length ? `<div class="pr-fuentes">${usadas.map((f) => `<button class="pr-fuente" data-cita-ruta="${esc(f.ruta)}"><b>${f.n}</b> ${esc(f.titulo)}${f.fecha ? ` · ${esc(f.fecha)}` : ""}</button>`).join("")}</div>` : ""}`;
  }
  function overlayPreguntar() {
    if (!E.preg.abierta) return "";
    return `<div class="galeria pr-fondo" data-accion="cerrar-preg"><div class="galeria-caja pr-caja" role="dialog" aria-modal="true" aria-label="Pregúntale a tus reuniones">
      <div class="pr-cab"><span class="pr-ico">✦</span><input id="preg-txt" value="${esc(E.preg.borrador || "")}" placeholder="Pregúntale a tus reuniones…" autocomplete="off"><kbd>↵</kbd><button class="boton" data-accion="cerrar-preg" title="Cerrar (Esc)">✕</button></div>
      ${E.preg.lista.length ? `<div class="pr-lista">${E.preg.lista.map((r) => `<section class="pr-item"><div class="pr-q">${esc(r.q)}</div>${respuestaHTML(r)}</section>`).join("")}</div>`
        : `<div class="pr-sug"><div class="co-eti">Prueba con</div>${SUGERENCIAS.map((s) => `<button class="pr-chip" data-sugerencia="${esc(s)}">${esc(s)}</button>`).join("")}
          <p class="cat-ayuda">Tu IA busca en tus notas y transcripciones y te dice de qué reunión (y de qué minuto) sale cada dato.</p></div>`}
    </div></div>`;
  }

  // ───────────────────────── Gimnasio: ensaya reuniones con Claude ─────────────────────────
  E.gym = null;
  const ESCENARIOS = [
    { id: "cliente", ico: "🤝", titulo: "Presentar tu producto a un cliente", texto: "Eres el dueño de una empresa mediana. {yo} te presenta su producto o servicio. Hoy resuelves eso con planillas y WhatsApp; te preocupa el precio y el trabajo de cambiar de sistema." },
    { id: "atraso", ico: "⏳", titulo: "Explicar un atraso", texto: "Eres jefe de proyecto. La entrega del equipo de {yo} se atrasó una semana por fallas en las pruebas. {yo} debe explicarte qué pasó y proponer un plan creíble." },
    { id: "cierre", ico: "🎯", titulo: "Cerrar con acuerdos claros", texto: "Reunión de seguimiento de un equipo. Tienes varias ideas sueltas y te cuesta comprometer fechas. {yo} debe lograr que la reunión termine con responsables y fechas." },
    { id: "precio", ico: "💸", titulo: "Negociar el precio", texto: "Eres el gerente de finanzas de un cliente grande. Te gusta la propuesta de {yo} pero quieres un 30% de descuento y pagar a 60 días. {yo} debe negociar sin regalar el margen." },
  ];
  function abrirGimnasio(pre = {}) {
    E.gym = { paso: "elegir", dificultad: "realista", voz: true, mic: true, silenciado: false, escuchando: false, nivel: 0, historial: [], escenario: "", titulo: "", contexto: "", ...pre };
    if (pre.escenario) iniciarEnsayo();
    else render({ mantenerScroll: true });
  }
  function escenarioDeEvento(id) {
    const ev = (E.agenda || []).find((x) => x.id === id); if (!ev) return null;
    const b = brief(ev);
    const quien = b.gente.map((g) => g.p?.nombre || g.a.nombre || g.a.email).filter(Boolean).join(", ") || "la contraparte";
    const perfil = b.conocidas.map((p) => p.perfil[0] ? `${p.nombre}: ${p.perfil[0].texto}` : "").filter(Boolean).join(" | ");
    return { titulo: `Ensayo: ${ev.titulo}`, escenario: `Reunión real próxima de ${yoNombre()}: «${ev.titulo}» con ${quien}. Interpreta a ${b.gente[0]?.p?.nombre || b.gente[0]?.a.nombre || "la persona principal"}.`,
      contexto: [textoBrief(id), perfil].filter(Boolean).join("\n").slice(0, 2500) };
  }
  function iniciarEnsayo() {
    const g = E.gym; g.paso = "ensayo"; g.historial = []; g.esperando = true; g.nombre = "";
    render({ mantenerScroll: true });
    pedirGym("turno");
  }
  function pedirGym(modo) {
    const g = E.gym, F = foco();
    const entrada = { escenario: g.escenario, dificultad: g.dificultad, contexto: g.contexto, foco: F ? `${F.debil.titulo}. Hábito: ${F.habito}` : "", historial: g.historial };
    host.enviar("gimnasio", { modo, entrada });
  }
  /** Abre el micrófono para la próxima intervención (si conversas por voz y no estás silenciado). */
  function escucharGym() {
    const g = E.gym; if (!g || g.paso !== "ensayo" || g.esperando || !g.mic || g.silenciado || g.escuchando) return;
    g.escuchando = true; g.micError = "";
    host.enviar("escuchar", { silencio: 1.6 });
    render({ mantenerScroll: true });
  }
  function silenciarGym(enviar = false) {
    const g = E.gym; if (!g) return;
    if (g.escuchando) host.enviar("dejarDeEscuchar", { enviar });
    g.escuchando = false;
  }
  function enviarGym() {
    const i = $("#gym-txt"), t = (i?.value || "").trim(), g = E.gym;
    if (!t || g.esperando) return;
    g.historial.push({ quien: "yo", texto: t }); g.borrador = ""; g.esperando = true; g.escuchando = false;
    host.enviar("callar");
    render({ mantenerScroll: true });
    pedirGym("turno");
  }
  function overlayGimnasio() {
    const g = E.gym; if (!g) return "";
    let cuerpo = "";
    if (g.paso === "elegir") {
      const evs = proximos(36).filter((e) => (e.asistentes || []).length).slice(0, 3);
      cuerpo = `<div class="gy-elegir">
        <div class="gy-opciones"><span class="co-eti" style="margin:0">Cómo será la otra persona</span><span class="pestanas">${[["amable", "Amable"], ["realista", "Realista"], ["dificil", "Difícil"]].map(([k, n]) => `<button class="pestana${g.dificultad === k ? " activa" : ""}" data-gym-dif="${k}">${n}</button>`).join("")}</span>
          <button class="av-op gy-voz" data-gym-voz role="switch" aria-checked="${g.voz}"><span class="av-txt"><b>🔊 Que me hable</b></span><span class="pn-interruptor${g.voz ? " on" : ""}"><i></i></span></button>
          <button class="av-op gy-voz" data-gym-micsw role="switch" aria-checked="${g.mic}"><span class="av-txt"><b>🎙 Responder hablando</b></span><span class="pn-interruptor${g.mic ? " on" : ""}"><i></i></span></button></div>
        ${evs.length ? `<div class="co-eti">Ensaya una reunión real</div><div class="gy-escenarios">${evs.map((e) => `<button class="gy-esc real" data-gym-evento="${esc(e.id)}"><span>📅</span><b>${esc(e.titulo)}</b><small>${enCuanto(e.inicio)} · con lo que sabes de esas personas</small></button>`).join("")}</div>` : ""}
        <div class="co-eti">O elige una situación</div>
        <div class="gy-escenarios">${ESCENARIOS.map((x) => `<button class="gy-esc" data-gym-esc="${x.id}"><span>${x.ico}</span><b>${esc(x.titulo)}</b><small>${esc(x.texto.slice(0, 90))}…</small></button>`).join("")}</div>
        <label class="cat-campo"><span>O describe la tuya</span><textarea id="gym-propio" rows="2" placeholder="ej: el gerente de un club me dice que ya tiene otro software y no quiere cambiar">${esc(g.propio || "")}</textarea></label>
        <div class="gy-opciones"><button class="boton-txt aplicar" data-gym-propio>Empezar con la mía</button></div>
      </div>`;
    } else if (g.paso === "ensayo") {
      cuerpo = `<div class="gy-chat" id="gym-chat">${g.historial.map((m) => `<div class="gy-msg ${m.quien}"><span class="gy-quien">${m.quien === "yo" ? "Tú" : esc(g.nombre || "Contraparte")}</span><p>${esc(m.texto)}</p></div>`).join("")}
          ${g.esperando ? `<div class="gy-msg otro"><span class="gy-quien">${esc(g.nombre || "Contraparte")}</span><div class="pr-pensando"><span></span><span></span><span></span></div></div>` : ""}</div>
        <div class="gy-entrada">
          ${g.mic ? `<div class="gy-mic${g.escuchando ? " oyendo" : ""}">
            ${g.escuchando ? `<span class="gy-onda"><i id="gym-nivel" style="--n:${g.nivel || 0}"></i></span><b>Te escucho…</b><small>habla normal; se envía solo cuando haces una pausa</small>
                <button class="boton-txt" data-gym-ya>Enviar ya</button><button class="boton-txt" data-gym-silencio title="Silenciar micrófono">🔇 Silenciar</button>`
              : g.esperando ? `<span class="gy-onda quieta">🔊</span><b>${esc(g.nombre || "La contraparte")} está ${g.historial.length ? "respondiendo" : "empezando"}…</b><small>después te toca a ti</small>`
              : g.silenciado ? `<span class="gy-onda quieta">🔇</span><b>Micrófono silenciado</b><small>escribe tu respuesta o vuelve a activarlo</small><button class="boton-txt aplicar" data-gym-silencio>🎙 Activar micrófono</button>`
              : `<span class="gy-onda quieta">🎙</span><b>${g.micError ? esc(g.micError) : "Tu turno"}</b><small>${g.micError ? "" : "toca para hablar"}</small><button class="boton-txt aplicar" data-gym-hablar>🎙 Hablar</button>`}
          </div>` : ""}
          <textarea id="gym-txt" rows="2" placeholder="${g.mic ? "O escribe tu respuesta… (↵ envía)" : "Responde como lo harías en la reunión… (↵ envía)"}" ${g.esperando ? "disabled" : ""}>${esc(g.borrador || "")}</textarea>
          <div class="gy-acc"><small>${g.historial.filter((m) => m.quien === "yo").length} intervenciones tuyas</small>
          <button class="boton-txt" data-gym-terminar ${g.historial.filter((m) => m.quien === "yo").length < 2 ? "disabled title=\"Responde al menos 2 veces\"" : ""}>Terminar y evaluar</button></div></div>`;
    } else if (g.paso === "evaluando") {
      cuerpo = `<div class="forja trabajando"><div class="forja-yunque">🥊</div><h2>Evaluando tu ensayo…</h2><div class="forja-barra"><i></i></div></div>`;
    } else if (g.paso === "resultado" && g.resultado) {
      const r = g.resultado, p = r.puntajes || {}, prom = APARTADOS.reduce((a, x) => a + (+p[x.clave] || 0), 0) / 4, t = tema();
      cuerpo = `<div class="coach gy-res">
        <section class="co-hero ${semP(prom)}"><div class="co-anillo" style="--p:${prom / 10}"><b>${prom.toFixed(1)}</b><small>de 10</small></div>
          <div class="co-hero-txt"><div class="co-eti">Veredicto del ensayo</div><p class="co-veredicto">${esc(r.veredicto || "")}</p>
          <div class="co-chips">${APARTADOS.map((a) => `<span class="co-chip ${semP(+p[a.clave] || 0)}">${icoApartado(t, a)} ${a.titulo} <b>${p[a.clave] ?? "–"}</b></span>`).join("")}</div></div></section>
        ${r.habito ? `<section class="co-habito"><div class="co-eti">🎯 Para la reunión de verdad</div><p>${esc(r.habito)}</p></section>` : ""}
        <div class="co-dos">${(r.costo || []).length ? `<section class="co-lista"><h3><span class="co-pto ojo"></span>Lo que te costó</h3><ul>${r.costo.map((x) => citaHTML({ cita: x.cita, texto: x.texto || "", prueba: x.prueba }, "costo")).join("")}</ul></section>` : ""}
          ${(r.bien || []).length ? `<section class="co-lista"><h3><span class="co-pto bien"></span>Lo que hiciste bien</h3><ul>${r.bien.map((x) => citaHTML({ cita: x.cita, texto: x.texto || "" }, "bien")).join("")}</ul></section>` : ""}</div>
        <div class="borrar-botones gy-fin"><button class="boton-txt" data-gym-otra>Otra situación</button><button class="boton-txt aplicar" data-gym-repetir>Repetir este ensayo</button></div>
      </div>`;
    }
    if (g.error) cuerpo = `<p class="forja-error">No resultó: ${esc(g.error)}</p>` + cuerpo;
    return `<div class="galeria gy-fondo" data-accion="cerrar-gym"><div class="galeria-caja gy-caja" role="dialog" aria-modal="true" aria-label="Gimnasio">
      <div class="gy-cab"><div><h2>🥊 Gimnasio</h2><p>${g.paso === "elegir" ? "Ensaya antes de la reunión de verdad. Tu IA hace de la otra persona y al final te evalúa." : esc(g.titulo || "")}</p></div>
        <button class="boton" data-accion="cerrar-gym" title="Cerrar (Esc)">✕</button></div>
      ${cuerpo}</div></div>`;
  }

  // ───────────────────────── Enviar resumen (sin conectar cuentas) ─────────────────────────
  E.env = null;
  const correosDe = (n) => (n.fm.correos || "").replace(/^\[|\]$/g, "").split(",").map((x) => x.trim().replace(/^"|"$/g, "")).filter((x) => /@/.test(x));
  function fechaLarga(d) { return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`; }
  function textoResumen(n) {
    const s = secciones(n), lineas = s.puntos.split("\n");
    const limpia = (l) => l.replace(/^\s*[-*]\s*/, "").replace(/\*\*/g, "").replace(/\s*\(\d{4}-\d{2}-\d{2}\)/, "").trim();
    const decis = lineas.filter((l) => /\*\*Decisión:\*\*/.test(l)).map((l) => limpia(l).replace(/^Decisión:\s*/, ""));
    const pend = lineas.filter((l) => /\*\*Pendiente:\*\*/.test(l)).map((l) => limpia(l).replace(/^Pendiente:\s*/, ""));
    const pasos = lineas.map((l) => l.match(/^\s*[-*]\s+\[ \]\s+(.*)$/)).filter(Boolean).map((m) => {
      const iso = m[1].match(/\((\d{4})-(\d{2})-(\d{2})\)/), p = limpia(m[1]).split(/\s+[—–]\s+/);
      const quien = p.length > 1 ? p[0] : "", que = p.length > 1 ? p[1] : p[0], cuando = p.slice(2).join(" ");
      return `${quien ? quien + ": " : ""}${que}${iso ? ` (${+iso[3]}/${+iso[2]})` : cuando ? ` (${cuando})` : ""}`;
    });
    const temas = lineas.filter((l) => /^###\s/.test(l) && !/Próximos pasos/i.test(l)).map((l) => l.replace(/^###\s*/, "")).slice(0, 4);
    const P = [`Hola${n.participantes.length === 1 ? " " + n.participantes[0].split(" ")[0] : " a todos"},`, "",
      `Les dejo el resumen de la reunión «${n.titulo}» (${fechaLarga(n.fecha)}).`];
    if (temas.length && !decis.length) P.push("", "Temas:", ...temas.map((t) => `• ${t}`));
    if (decis.length) P.push("", "Acuerdos:", ...decis.map((d) => `• ${d}`));
    if (pend.length) P.push("", "Quedó pendiente:", ...pend.map((d) => `• ${d}`));
    if (pasos.length) P.push("", "Próximos pasos:", ...pasos.map((d) => `• ${d}`));
    P.push("", "Cualquier cosa que falte o esté mal, me avisan.", "", "Saludos,", (E.perfil?.nombre || "").trim());
    return P.join("\n");
  }
  function abrirEnviar(ruta) {
    const n = E.notas.find((x) => x.ruta === ruta) || notaActual(); if (!n) return;
    E.env = { ruta: n.ruta, para: correosDe(n).join(", "), asunto: `Resumen: ${n.titulo} (${n.fecha.getDate()}/${n.fecha.getMonth() + 1})`, cuerpo: "", indic: "", redactando: "abriendo" };
    redactarEnv(false);
  }
  const DESTINOS = [
    ["outlook", "Outlook web", "📧"], ["gmail", "Gmail", "✉️"], ["mail", "App Mail", "📨"],
    ["teams", "Teams", "💬"], ["whatsapp", "WhatsApp", "🟢"], ["copiar", "Copiar con formato", "⧉"],
  ];
  function urlDestino(d, e) {
    const q = encodeURIComponent, para = e.para.split(/[,;\s]+/).filter((x) => /@/.test(x));
    switch (d) {
      case "outlook": return `https://outlook.office.com/mail/deeplink/compose?to=${q(para.join(";"))}&subject=${q(e.asunto)}&body=${q(e.cuerpo)}`;
      case "gmail": return `https://mail.google.com/mail/?view=cm&fs=1&to=${q(para.join(","))}&su=${q(e.asunto)}&body=${q(e.cuerpo)}`;
      case "mail": return `mailto:${para.map(q).join(",")}?subject=${q(e.asunto)}&body=${q(e.cuerpo)}`;
      case "teams": return `https://teams.microsoft.com/l/chat/0/0?users=${q(para.join(","))}&message=${q(e.cuerpo)}`;
      case "whatsapp": return `https://wa.me/?text=${q(`*${e.asunto}*\n\n${e.cuerpo}`)}`;
    }
    return "";
  }
  function overlayEnviar() {
    const e = E.env; if (!e) return "";
    const sinCorreos = !e.para.trim();
    return `<div class="galeria borrar-fondo" data-accion="cerrar-env"><div class="galeria-caja env-caja" role="dialog" aria-modal="true" aria-label="Enviar resumen">
      <div class="gy-cab"><div><h2>✉︎ Enviar resumen</h2><p>Se abre listo en la app que elijas; tú revisas y presionas Enviar.</p></div><button class="boton" data-accion="cerrar-env" title="Cerrar (Esc)">✕</button></div>
      <label class="cat-campo"><span>Para <small>${sinCorreos ? "no venían correos en el evento del calendario; escríbelos si quieres" : "invitados del evento"}</small></span><input id="env-para" value="${esc(e.para)}" placeholder="correo@empresa.cl, otro@empresa.cl"></label>
      <label class="cat-campo"><span>Asunto</span><input id="env-asunto" value="${esc(e.asunto)}"></label>
      <label class="cat-campo"><span>Mensaje <small>redactado por tu IA solo con los hechos: sin tu feedback, opiniones ni comentarios internos</small></span>
        ${e.redactando === "abriendo" ? `<div class="env-redactando"></div>`
          : e.redactando ? `<div class="env-redactando"><div class="pr-pensando"><span></span><span></span><span></span> Tu IA está redactando un mensaje apto para enviar…</div></div>`
          : e.error ? `<p class="forja-error">No pude redactar: ${esc(e.error)}</p>` : `<textarea id="env-cuerpo" rows="12">${esc(e.cuerpo)}</textarea>`}</label>
      ${!e.redactando && e.cuerpo ? `<p class="env-estado">${e.editado ? "✓ Guardado con tus cambios" : e.guardado ? "✓ Mensaje guardado: se redactó una sola vez" : "✓ Redactado y guardado"}</p>` : ""}
      <div class="env-indic"><input id="env-indic" value="${esc(e.indic || "")}" placeholder="Indicaciones opcionales: más corto, solo para Matías, más formal…" ${e.redactando ? "disabled" : ""}>
        <button class="boton-txt" data-env-claude ${e.redactando ? "disabled" : ""}>↻ Volver a redactar</button></div>
      <div class="env-destinos">${DESTINOS.map(([k, n, i]) => `<button class="env-dest" data-env-dest="${k}" ${e.redactando || !e.cuerpo ? "disabled" : ""}><span>${i}</span>${n}</button>`).join("")}</div>
      <p class="cat-ayuda">Teams y Outlook web usan tu sesión del navegador. Si el mensaje es muy largo y no se abre completo, usa "Copiar con formato".</p>
    </div></div>`;
  }
  /** Siempre lo redacta Claude: las notas son privadas (traen feedback y comentarios para ti) y no se pueden copiar tal cual. */
  function redactarEnv(forzar = true) {
    const e = E.env; if (!e) return;
    e.redactando = forzar ? true : "abriendo"; e.error = "";
    render({ mantenerScroll: true });
    host.enviar("redactar", { ruta: e.ruta, indicaciones: e.indic || "", forzar });
  }
  let _guardarEnv = 0;
  function guardarEnv() {
    clearTimeout(_guardarEnv);
    _guardarEnv = setTimeout(() => { const e = E.env; if (e && e.cuerpo) { e.editado = true; host.enviar("guardarMensaje", { ruta: e.ruta, asunto: e.asunto, texto: e.cuerpo }); const p = document.querySelector(".env-estado"); if (p) p.textContent = "✓ Guardado con tus cambios"; } }, 700);
  }
  function htmlCorreo(t) { return t.split("\n").map((l) => (/^• /.test(l) ? `<li>${esc(l.slice(2))}</li>` : `<p>${esc(l) || "&nbsp;"}</p>`)).join("").replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`); }

  let _ultimoContexto = "";
  function render(opts = {}) {
    aplicarTema();
    estiloCategorias();
    const scroll = $(".principal")?.scrollTop || 0;
    const scrollLista = $(".lista")?.scrollTop || 0;
    const foco = document.activeElement?.id;
    const app = $("#app");
    const contexto = PANEL ? `${E.temaId}|${E.panVista}|${E.pan.fase}` : `${E.temaId}|${E.seccion}|${E.vista}|${E.sel}`;
    const animar = contexto !== _ultimoContexto;
    _ultimoContexto = contexto;
    if (PANEL) {
      app.className = `modo-panel${animar ? " animar" : " quieto"}`;
      app.innerHTML = panel() + confirmarBorrado();
      traducirDOM(app);
      ui.despuesDePintar();
      if (foco === "pn-titulo") { const b = $("#pn-titulo"); b?.focus(); b?.setSelectionRange(b.value.length, b.value.length); }
      tic(); reportarAlto();
      return;
    }
    app.className = `plataforma-${E.plataforma}${E.lateral ? "" : " sin-lateral"}${animar ? " animar" : " quieto"}`;
    app.innerHTML = `${E.lateral ? lateral() : ""}<main class="principal-cont">${superior()}<div class="principal"><div class="hoja" data-pagina="${E.seccion === "reuniones" ? E.vista : E.seccion}">${contenido()}</div></div></main>${galeria()}${confirmarBorrado()}${dialogoCorregir()}${dialogoCorregirIA()}${overlayPreguntar()}${overlayGimnasio()}${overlayEnviar()}${overlayComentarios()}${overlayBienvenida()}${bannerActualizacion()}`;
    traducirDOM(app);
    const pr = $(".principal");
    if (pr && (opts.mantenerScroll || !animar)) pr.scrollTo({ top: scroll, behavior: "instant" });
    if ($(".lista")) $(".lista").scrollTo({ top: scrollLista, behavior: "instant" });
    contar(app);
    const chat = document.getElementById("gym-chat"); if (chat) chat.scrollTop = chat.scrollHeight;
    ui.despuesDePintar();  // foco al abrir una ventana, adentro mientras está abierta y de vuelta al cerrarla
    if (enPantallaIdioma() && !document.activeElement?.closest?.(".bv-lenguas")) $(".bv-lengua.sugerido")?.focus();
    if (foco && /^(buscar|corr-de|corr-a|voto-txt|forja-nombre|forja-notas|busca-persona|u-busca|preg-txt|gym-txt|gym-propio|env-para|env-asunto|env-cuerpo|env-indic|ics-url)$/.test(foco)) { const b = document.getElementById(foco); if (b) { b.focus(); try { b.setSelectionRange(b.value.length, b.value.length); } catch {} } }
  }

  // ───────────────────────── Eventos ─────────────────────────
  function textoCopiable() {
    const n = notaActual(); if (!n) return "";
    const s = secciones(n);
    if (E.vista === "transcripcion") return s.transcripcion.split("\n").map((l) => l.replace(/^[>\s]+/, "")).filter((l) => l.startsWith("[")).join("\n");
    if (E.vista === "feedback") return s.feedback.trim();
    if (E.vista === "metricas") return s.metricas.trim();
    return s.puntos.trim();
  }

  function elegirTema(id) {
    if (id === E.temaId) return;
    document.documentElement.classList.add("cambiando");
    setTimeout(() => {
      E.temaId = id;
      host.enviar("tema", { id });
      render({ mantenerScroll: true });
      requestAnimationFrame(() => document.documentElement.classList.remove("cambiando"));
    }, 160);
  }

  document.addEventListener("click", (ev) => {
    if (ui.manejarClic(ev)) return;  // la pieza recuerda qué botón abrió una ventana (para devolverle el foco)
    const rv = ev.target.closest("[data-revivir]");
    if (rv) { const t = tema(), def = LOGROS.find((d) => d.id === rv.dataset.revivir); if (def) revelar([{ tipo: "logro", emoji: icoLogro(t, def), ...logroTexto(t, def.id) }], { moneda: t.xp }); return; }
    const ac = ev.target.closest("[data-act]");
    if (ac) {
      if (ac.dataset.act === "luego") { E.act.oculto = true; render({ mantenerScroll: true }); return; }
      if (ac.dataset.act === "cerrar-progreso") { E.act.progreso = null; render({ mantenerScroll: true }); return; }
      if (ac.dataset.act === "instalar" && PANEL) { host.enviar("actualizar"); return; }
      if (ac.dataset.act === "instalar") {
        E.act.progreso = { paso: "1", texto: "Descargando la versión nueva…", total: 3 }; E.act.oculto = false; render({ mantenerScroll: true });
        host.enviar("actualizar");
        return;
      }
      if (ac.dataset.act === "buscar") {
        if (E.act.buscando) return;
        E.act.buscando = true; E.act.alDia = false; render({ mantenerScroll: true });
        host.enviar("buscarActualizacion");
        return;
      }
      host.enviar("actualizar"); return;
    }
    if (E.bv) {
      const t = ev.target, b = E.bv;
      const lg = t.closest("[data-bv-lengua]"); if (lg) { elegirIdiomaBV(lg.dataset.bvLengua); return; }
      const ps = t.closest("[data-bv-paso]"); if (ps) { bvPaso(+ps.dataset.bvPaso); return; }
      if (t.closest("[data-bv-fin]")) { terminarBienvenida(); return; }
      const pr = t.closest("[data-bv-probar]");
      if (pr) { b.probando = b.probado = pr.dataset.bvProbar; b.iaTexto = ""; render({ mantenerScroll: true });
        host.enviar("probarIA", { ia: b.probando }); return; }
      if (t.closest("[data-bv-saltar-ia]")) { b.iaOk = "despues"; bvPaso(1); return; }
      if (t.closest("[data-bv-recargar]")) { b.cargando = true; render({ mantenerScroll: true }); host.enviar("bienvenidaEstado"); return; }
      const u = t.closest("[data-bv-url]"); if (u) { guardarCamposBV(); host.enviar("abrirURL", { url: u.dataset.bvUrl }); return; }
      const mo = t.closest("[data-bv-modelo]"); if (mo) { b.modeloElegido = mo.dataset.bvModelo; render({ mantenerScroll: true }); return; }
      if (t.closest("[data-bv-descargar]")) { const id = b.modeloElegido || b.modelos?.elegido || b.modelos?.recomendado; b.descargando = id; b.pct = 0; render({ mantenerScroll: true });
        host.enviar("descargarModelo", { id }); return; }
      const nm = t.closest("[data-bv-notas]"); if (nm) { guardarCamposBV(); b.notasModo = nm.dataset.bvNotas; b.repoTexto = ""; render({ mantenerScroll: true }); return; }
      if (t.closest("[data-bv-carpeta]")) { host.enviar("elegirCarpetaNotas"); return; }
      if (t.closest("[data-bv-clonar]")) { guardarCamposBV(); if (!/^https:\/\//.test(b.repoUrl || "")) { b.repoTexto = "Pega la dirección https del repositorio."; b.repoOk = false; render({ mantenerScroll: true }); return; }
        b.trabajando = true; render({ mantenerScroll: true }); host.enviar("clonarNotas", { url: b.repoUrl, token: b.token || "" }); return; }
      const rs = t.closest("[data-bv-respaldo]"); if (rs) { guardarCamposBV(); b.respaldoModo = rs.dataset.bvRespaldo; b.repoTexto = ""; render({ mantenerScroll: true }); return; }
      if (t.closest("[data-bv-crear-repo]")) { guardarCamposBV(); if (!b.token) { b.repoTexto = "Pega tu token de acceso (botón \"Crear token\")."; b.repoOk = false; render({ mantenerScroll: true }); return; }
        b.trabajando = true; render({ mantenerScroll: true }); host.enviar("crearRepoNotas", { proveedor: b.respaldoModo, token: b.token, nombre: b.repoNombre || "minuta-notas" }); return; }
      const pm = t.closest("[data-bv-permiso]"); if (pm) { host.enviar("pedirMicrofono"); return; }
      const te = t.closest("[data-universo]"); if (te) { elegirTema(te.dataset.universo); return; }
      if (t.closest("[data-av]")) { /* lo maneja el bloque de avisos */ } else if (t.closest(".bienvenida")) return;
    }
    const bi = ev.target.closest("[data-bajar-idioma]");
    if (bi) {
      const c = bi.dataset.bajarIdioma; E.catI.bajando = c; render({ mantenerScroll: true });
      host.enviar("descargarIdioma", { codigo: c });
      return;
    }
    if (E.coment) {
      const ct = ev.target.closest("[data-coment-tipo]"); if (ct) { E.coment.titulo = $("#coment-titulo")?.value; E.coment.texto = $("#coment-texto")?.value; E.coment.tipo = ct.dataset.comentTipo; render({ mantenerScroll: true }); return; }
      if (ev.target.closest("[data-coment-sistema]")) { E.coment.titulo = $("#coment-titulo")?.value; E.coment.texto = $("#coment-texto")?.value; E.coment.sistema = !E.coment.sistema; render({ mantenerScroll: true }); return; }
      const ce = ev.target.closest("[data-coment-enviar]"); if (ce) { enviarComentario(ce.dataset.comentEnviar); return; }
      if (ev.target.closest("[data-coment-ver]")) { host.enviar("abrirURL", { url: E.coment.enviado }); E.coment = null; render({ mantenerScroll: true }); return; }
      const cc = ev.target.closest("[data-accion=cerrar-coment]");
      if (cc && (cc.classList.contains("boton") || cc.classList.contains("boton-txt") || ev.target.classList.contains("borrar-fondo"))) { E.coment = null; render({ mantenerScroll: true }); return; }
      if (ev.target.closest(".env-caja")) return;
    }
    const pt = ev.target.closest("[data-poner-tipo]");
    if (pt && E.menuTipo) { const r = E.menuTipo; E.menuTipo = null; ponerTipo(r, pt.dataset.ponerTipo); render({ mantenerScroll: true }); return; }
    if (ev.target.closest("[data-cambiar-tipo]")) { const n = notaActual(); E.menuTipo = E.menuTipo ? null : n?.ruta; render({ mantenerScroll: true }); return; }
    if (E.menuTipo) { E.menuTipo = null; render({ mantenerScroll: true }); return; }
    if (E.menu && !ev.target.closest("[data-accion=menu]")) { E.menu = false; if (!ev.target.closest(".menu-mas [data-accion],.menu-mas [data-seccion]")) { render({ mantenerScroll: true }); return; } }
    const av = ev.target.closest("[data-av],[data-ajuste],[data-al-tocar]");
    if (av) {
      if (av.dataset.av) { host.enviar(av.dataset.av); if (av.dataset.av === "probarAviso") toast("Aviso enviado 🔔"); return; }
      if (av.dataset.ajuste) E.ajustes[av.dataset.ajuste] = !E.ajustes[av.dataset.ajuste];
      if (av.dataset.alTocar) E.ajustes.alTocar = av.dataset.alTocar;
      host.enviar("ajustesAvisos", { ajustes: E.ajustes }); render({ mantenerScroll: true }); return;
    }
    const qc = ev.target.closest("[data-quitar-corr]");
    if (qc) { E.correcciones = E.correcciones.filter((c) => c.de !== qc.dataset.quitarCorr); host.enviar("quitarCorreccion", { de: qc.dataset.quitarCorr }); render({ mantenerScroll: true }); return; }
    const fl = ev.target.closest("#corr-flot");
    if (fl) { abrirCorregir(fl.dataset.corrDe); return; }
    if (E.env) {
      const t = ev.target;
      if (t.closest("[data-accion=cerrar-env]") && (t.closest(".boton") || t.classList.contains("borrar-fondo"))) { E.env = null; render({ mantenerScroll: true }); return; }
      const d = t.closest("[data-env-dest]");
      if (d && !d.disabled) {
        const k = d.dataset.envDest, e = E.env;
        if (k === "copiar") { host.enviar("copiarFormato", { texto: `${e.asunto}\n\n${e.cuerpo}`, html: `<p><b>${esc(e.asunto)}</b></p>${htmlCorreo(e.cuerpo)}` }); toast("Copiado con formato ✓"); }
        else { host.enviar("abrir", { url: urlDestino(k, e) }); toast("Abriendo… revisa y presiona Enviar"); }
        return;
      }
      if (t.closest("[data-env-claude]")) { redactarEnv(true); return; }
      if (t.closest(".env-caja")) return;
    }
    const rc = ev.target.closest("[data-recordar]");
    if (rc) {
      const lista = rc.dataset.recordar === "mios" ? compromisos().filter((c) => c.mio && !c.hecho) : compromisos().filter((c) => c.linea === rc.dataset.recordar && !c.hecho);
      host.enviar("recordatorios", { lista: lista.map((c) => ({ titulo: c.mio ? c.que.replace(/\*\*/g, "") : `${c.resp}: ${c.que.replace(/\*\*/g, "")}`, notas: `De la reunión «${c.nota.titulo}» (${fmtFechaCorta(c.nota.fecha)}) · Minuta`, fecha: c.fecha ? +c.fecha : null })) });
      return;
    }
    if (E.gym) {
      const gy = ev.target;
      if (gy.closest("[data-accion=cerrar-gym]") && (gy.closest(".boton") || gy.classList.contains("gy-fondo"))) { host.enviar("callar"); E.gym = null; render({ mantenerScroll: true }); return; }
      const ge = gy.closest("[data-gym-esc]");
      if (ge) { const x = ESCENARIOS.find((z) => z.id === ge.dataset.gymEsc); Object.assign(E.gym, { escenario: x.texto.replaceAll("{yo}", (E.perfil?.nombre || "").trim() || "la otra persona"), titulo: `${x.ico} ${x.titulo}`, contexto: "" }); iniciarEnsayo(); return; }
      const gv = gy.closest("[data-gym-evento]");
      if (gv) { Object.assign(E.gym, escenarioDeEvento(gv.dataset.gymEvento) || {}); iniciarEnsayo(); return; }
      if (gy.closest("[data-gym-propio]")) { const t = ($("#gym-propio")?.value || "").trim(); if (!t) { $("#gym-propio")?.focus(); return; } Object.assign(E.gym, { escenario: t, titulo: "✍️ Tu situación", contexto: "" }); iniciarEnsayo(); return; }
      if (gy.closest("[data-gym-micsw]")) { E.gym.mic = !E.gym.mic; render({ mantenerScroll: true }); return; }
      if (gy.closest("[data-gym-hablar]")) { host.enviar("callar", { mic: false }); escucharGym(); return; }
      if (gy.closest("[data-gym-ya]")) { silenciarGym(true); return; }
      if (gy.closest("[data-gym-silencio]")) {
        const g = E.gym; g.silenciado = !g.silenciado;
        if (g.silenciado) { silenciarGym(false); render({ mantenerScroll: true }); setTimeout(() => $("#gym-txt")?.focus(), 30); } else { escucharGym(); }
        return;
      }
      const gd = gy.closest("[data-gym-dif]"); if (gd) { E.gym.dificultad = gd.dataset.gymDif; render({ mantenerScroll: true }); return; }
      if (gy.closest("[data-gym-voz]")) { E.gym.voz = !E.gym.voz; render({ mantenerScroll: true }); return; }
      if (gy.closest("[data-gym-terminar]")) { host.enviar("callar"); E.gym.paso = "evaluando"; render({ mantenerScroll: true }); pedirGym("evaluar"); return; }
      if (gy.closest("[data-gym-repetir]")) { iniciarEnsayo(); return; }
      if (gy.closest("[data-gym-otra]")) { abrirGimnasio({ voz: E.gym.voz, dificultad: E.gym.dificultad }); return; }
      if (gy.closest(".gy-caja")) return;
    }
    const ga = ev.target.closest("[data-abrir-gym]");
    if (ga) { if (ga.dataset.abrirGym) { const x = escenarioDeEvento(ga.dataset.abrirGym); abrirGimnasio(x ? { ...x } : {}); } else abrirGimnasio(); return; }
    const sg = ev.target.closest("[data-sugerencia]");
    if (sg) { preguntar(sg.dataset.sugerencia); return; }
    const ct = ev.target.closest("[data-cita-ruta]");
    if (ct) {
      E.preg.abierta = false; E.sel = ct.dataset.citaRuta; E.seccion = "reuniones";
      host.enviar("seleccion", { ruta: E.sel });
      if (ct.dataset.citaHora) irAHora(ct.dataset.citaHora); else { E.vista = "puntos"; render(); }
      return;
    }
    if (ev.target.closest("[data-accion=cerrar-preg]") && (ev.target.closest(".boton") || ev.target.classList.contains("pr-fondo"))) { E.preg.abierta = false; render({ mantenerScroll: true }); return; }
    if (ev.target.closest("[data-accion=preguntar]")) { abrirPreguntar(); return; }
    const cp = ev.target.closest("[data-comp-ruta]");
    if (cp) { alternarCompromiso(cp.dataset.compRuta, cp.dataset.compLinea, true); return; }
    const tr = ev.target.closest("li.tarea[data-tarea] .check");
    if (tr && notaActual()) {
      const n = notaActual(), raw = tr.closest("li").dataset.tarea;
      const linea = n.cuerpo.split("\n").find((l) => /^\s*[-*]\s+\[( |x|X)\]\s+/.test(l) && l.replace(/^\s*[-*]\s+\[( |x|X)\]\s+/, "").trim() === raw.trim());
      if (linea) alternarCompromiso(n.ruta, linea);
      return;
    }
    const cf = ev.target.closest("[data-comp-filtro]");
    if (cf) { E.compFiltro = cf.dataset.compFiltro; render({ mantenerScroll: true }); return; }
    const br = ev.target.closest("[data-brief]");
    if (br) { E.briefAbierto = br.dataset.brief; render({ mantenerScroll: true }); return; }
    const cb = ev.target.closest("[data-copiar-brief]");
    if (cb) { host.enviar("copiar", { texto: textoBrief(cb.dataset.copiarBrief) }); toast("Preparación copiada ✓"); return; }
    const pv = ev.target.closest("[data-pn-enviar]");
    if (pv) { host.enviar("visorEnviar", { ruta: pv.dataset.pnEnviar }); return; }
    const pb = ev.target.closest("[data-pn-brief]");
    if (pb) { host.enviar("prep", { id: pb.dataset.pnBrief }); return; }
    const pe = ev.target.closest("[data-persona]");
    if (pe && !PANEL) { E.seccion = "personas"; E.persona = pe.dataset.persona; render(); return; }
    const ih = ev.target.closest("[data-ir-hora]");
    if (ih) { irAHora(ih.dataset.irHora); return; }
    const op = ev.target.closest("[data-op],[data-op-motivo]");
    if (op) { op.dataset.opMotivo ? opinar(op, -1, op.dataset.opMotivo) : opinar(op, +op.dataset.op); return; }
    if (ev.target.closest("[data-voto-ok]")) { cerrarComentario(); return; }
    const fj = ev.target.closest("[data-forja]");
    if (fj) {
      const a = fj.dataset.forja;
      if (a === "abrir") E.forja = { nombre: "", notas: "", estado: "" };
      if (a === "cerrar") E.forja = null;
      if (a === "crear") {
        const nombre = ($("#forja-nombre")?.value || "").trim();
        if (!nombre) { $("#forja-nombre")?.focus(); return; }
        E.forja = { nombre, notas: ($("#forja-notas")?.value || "").trim(), estado: "trabajando" };
        host.enviar("crearUniverso", { nombre, notas: E.forja.notas });
      }
      if (a === "borrar-u") {
        if (!fj.classList.contains("armado")) { fj.classList.add("armado"); fj.textContent = "¿Borrar?"; setTimeout(() => { if (fj.isConnected) { fj.classList.remove("armado"); fj.textContent = "🗑"; } }, 3000); return; }
        host.enviar("borrarUniverso", { id: fj.dataset.id }); E.temas = E.temas.filter((t) => t.id !== fj.dataset.id);
        if (E.temaId === fj.dataset.id) elegirTema("cine");
      }
      render({ mantenerScroll: true });
      if (a === "abrir") setTimeout(() => $("#forja-nombre")?.focus(), 30);
      return;
    }
    const au = !E.bv && ev.target.closest(".acerca [data-bv-url]");
    if (au) { host.enviar("abrirURL", { url: au.dataset.bvUrl }); return; }
    const vu = ev.target.closest("[data-votar-u]");
    if (vu) { abrirVoto(vu.dataset.votarU, vu.dataset.voto); return; }
    const uc = ev.target.closest("[data-u-cat]");
    if (uc) { E.uCat = uc.dataset.uCat; render({ mantenerScroll: true }); return; }
    const cd = ev.target.closest("[data-crear-desde]");
    if (cd) { const nb = cd.dataset.crearDesde; E.forja = { nombre: nb.charAt(0).toUpperCase() + nb.slice(1), notas: "", estado: "" }; E.uBusca = ""; E.uCat = ""; render({ mantenerScroll: false }); setTimeout(() => { const f = $("#forja-nombre"); f?.scrollIntoView({ block: "center" }); (cd.dataset.crearDesde ? $("#forja-notas") : f)?.focus(); }, 40); return; }
    const cu = ev.target.closest("[data-comentar-u],[data-proponer-u]");
    if (cu) {
      const id = cu.dataset.comentarU || cu.dataset.proponerU;
      const u = E.temas.find((t) => t.id === id) || E.catU.lista.find((t) => t.id === id);
      if (u) abrirComentario(cu.dataset.proponerU ? { tipo: "propuesta", universo: u } : { tipo: "universo", universo: u });
      return;
    }
    const uPrev = ev.target.closest("[data-previa],[data-previa-cerrar],[data-bajar-u]");
    if (uPrev) {
      if (uPrev.dataset.bajarU) { descargarUniverso(uPrev.dataset.bajarU, !!uPrev.dataset.usar); E.previa = null; return; }
      E.previa = uPrev.dataset.previa || null; render({ mantenerScroll: true }); return;
    }
    const cc = ev.target.closest("[data-cat-color],[data-cat-nueva],[data-cat-borrar]");
    if (cc) {
      if (cc.dataset.catColor) { const [i, col] = cc.dataset.catColor.split("|"); E.categorias[+i].color = col; guardarCategorias(true); render({ mantenerScroll: true }); }
      else if ("catNueva" in cc.dataset) {
        const usados = E.categorias.map((c) => c.color);
        E.categorias.push({ id: `c-${Date.now().toString(36)}`, nombre: "Nueva categoría", emoji: "✨", color: COLORES_CAT.find((c) => !usados.includes(c)) || "#3b82f6",
          descripcion: "", enfoque: "", dominios: [], palabras: [], apps: [] });
        guardarCategorias(true); render({ mantenerScroll: true });
        const ult = document.querySelector(".cat:last-child .cat-nombre"); ult?.scrollIntoView({ block: "center", behavior: "smooth" }); ult?.focus(); ult?.select();
      } else if (cc.dataset.catBorrar) {
        if (!cc.classList.contains("armado")) { cc.classList.add("armado"); cc.textContent = "¿Seguro?"; setTimeout(() => { if (cc.isConnected) { cc.classList.remove("armado"); cc.textContent = "🗑"; } }, 3000); return; }
        E.categorias.splice(+cc.dataset.catBorrar, 1); guardarCategorias(true); render({ mantenerScroll: true });
      }
      return;
    }
    const bb = ev.target.closest("[data-borrar]");
    if (bb) { E.borrar = bb.dataset.borrar; render({ mantenerScroll: true }); setTimeout(() => $(".borrar-caja .peligro")?.focus(), 30); return; }
    const ab = ev.target.closest("[data-accion=si-borrar],[data-accion=cancelar-borrar]");
    if (ab) {
      if (ab.dataset.accion === "si-borrar") borrarNota(E.borrar, ab.dataset.delRespaldo !== "0");
      else if (ev.target === ab || ab.classList.contains("boton-txt")) { E.borrar = null; render({ mantenerScroll: true }); }
      return;
    }
    if (ev.target.closest("[data-pn-tipomenu]")) { E.pnTipoMenu = !E.pnTipoMenu; render(); return; }
    if (E.pnTipoMenu && !ev.target.closest(".pn-tipo-menu")) { E.pnTipoMenu = false; render(); }
    const pn = ev.target.closest("[data-pn],[data-pn-tipo],[data-pn-vista],[data-pn-nota]");
    if (pn) {
      const d = pn.dataset;
      if (d.pnVista) { E.panVista = d.pnVista; render(); return; }
      if (d.pnTipo) { elegirTipoPanel(d.pnTipo); return; }
      if (d.pnNota) { host.enviar("visor", { ruta: d.pnNota }); return; }
      if (d.pn === "inicio") { E.pan.inicio = !E.pan.inicio; host.enviar("inicio", { activo: E.pan.inicio }); render(); return; }
      if (d.pn === "grabar") { host.enviar("grabar", { titulo: E.pan.titulo, tipo: E.pan.tipo }); return; }
      host.enviar(d.pn); return;
    }
    if (PANEL && ev.target.closest("[data-accion=galeria]")) { E.panVista = "universos"; render(); return; }
    if (ev.target.closest("[data-ics-conectar]")) { const u = ($("#ics-url")?.value || "").trim(); if (u) { host.enviar("calendarioICS", { url: u }); toast("Conectando tu calendario…"); } else $("#ics-url")?.focus(); return; }
    if (ev.target.closest("[data-ics-quitar]")) { host.enviar("calendarioICS", { url: "" }); return; }
    const v = ev.target.closest("[data-ventana]");
    if (v) { host.enviar("ventana", { op: v.dataset.ventana }); return; }
    const b = ev.target.closest("[data-accion],[data-vista],[data-nota],[data-universo],[data-seccion]");
    if (!b) return;
    if (b.dataset.nota) { E.sel = b.dataset.nota; E.seccion = "reuniones"; host.enviar("seleccion", { ruta: E.sel }); render(); return; }
    if (b.dataset.seccion) { E.seccion = b.dataset.seccion; render(); return; }
    if (b.dataset.vista) { E.vista = b.dataset.vista; E.seccion = "reuniones"; render(); return; }
    if (b.dataset.universo) { if (PANEL) E.panVista = "inicio"; elegirTema(b.dataset.universo); return; }
    const n = notaActual();
    switch (b.dataset.accion) {
      case "galeria": E.galeria = true; render({ mantenerScroll: true }); break;
      case "bienvenida": E.menu = false; abrirBienvenida(); break;
      case "comentarios": E.menu = false; abrirComentario({ tipo: "error" }); break;
      case "comentar-nota": E.menu = false; abrirComentario({ tipo: "nota" }); break;
      case "cerrar-galeria": if (ev.target === b || b.classList.contains("boton")) { E.galeria = false; render({ mantenerScroll: true }); } break;
      case "lateral": E.lateral = !E.lateral; render({ mantenerScroll: true }); break;
      case "menu": E.menu = !E.menu; render({ mantenerScroll: true }); break;
      case "enviar": if (n) abrirEnviar(n.ruta); break;
      case "corregir": if (n) abrirCorregir(getSelection()?.toString().trim().slice(0, 60) || ""); break;
      case "corregir-ia": if (n) { E.menu = false; E.corrIA = { texto: "", ruta: n.ruta }; render({ mantenerScroll: true }); setTimeout(() => $("#corria-txt")?.focus(), 30); } break;
      case "cerrar-corria": if (ev.target === b || b.classList.contains("boton-txt") || b.classList.contains("boton")) { if (!E.corrIA?.trabajando) { E.corrIA = null; render({ mantenerScroll: true }); } } break;
      case "aplicar-corria": aplicarCorregirIA(); break;
      case "a-palabra": E.corrIA = null; if (n) abrirCorregir(""); break;
      case "cancelar-corr": if (ev.target === b || b.classList.contains("boton-txt")) { E.corr = null; render({ mantenerScroll: true }); } break;
      case "aplicar-corr": aplicarCorregir(); break;
      case "borrar": if (n) { E.borrar = n.ruta; render({ mantenerScroll: true }); setTimeout(() => $(".borrar-caja .peligro")?.focus(), 30); } break;
      case "copiar": host.enviar("copiar", { texto: textoCopiable() }); toast("Copiado ✓"); break;
      case "obsidian": n && host.enviar("obsidian", { ruta: n.ruta }); render({ mantenerScroll: true }); break;
      case "finder": n && host.enviar("finder", { ruta: n.ruta }); render({ mantenerScroll: true }); break;
    }
  });

  document.addEventListener("change", (ev) => {
    const el = ev.target;
    if (el.dataset?.idiomaUi) {
      const c = el.value; E.perfil = { ...(E.perfil || {}), idioma_ui: c };
      host.enviar("perfil", { cambios: { idioma_ui: c } });
      return;
    }
    if (el.dataset?.perfilSel) { const k = el.dataset.perfilSel; E.perfil = { ...(E.perfil || {}), [k]: el.value }; host.enviar("perfil", { cambios: { [k]: el.value } }); toast("Guardado ✓"); }
  });
  /** En la vista previa del navegador no hay app de Mac: carga el paquete directo (incluido o del catálogo). */
  function cambiarIdiomaWeb(c) {
    const listo = () => (E.bv?.lengua === c ? bvTrasIdioma() : render());
    if (c === "es") { E.idioma = { ...E.idioma, codigo: "es", textos: {}, palabras: null }; listo(); return; }
    fetch(`idiomas/${c}.json`).then((r) => (r.ok ? r.json() : fetch(`${CATALOGO_RAW}idiomas/${c}.json`).then((x) => x.json())))
      .then((d) => { E.idioma = { ...E.idioma, codigo: c, textos: d.textos || {}, palabras: d.palabras || null }; listo(); }).catch(() => toast("No pude cargar ese idioma"));
  }

  // ───────────────────────── Bienvenida (primera vez) ─────────────────────────
  // Pregunta lo necesario para usar Minuta sin tocar archivos: quién eres, tu IA, el modelo de transcripción,
  // dónde están tus notas (o tu repo) y los permisos. Todo queda en ~/minuta/perfil.json y en el Llavero.
  // Lo primero, antes de cualquier texto, es el idioma: así todo lo que sigue ya se entiende.
  E.bv = null;
  const BV_PASOS = ["idioma", "hola", "tu", "ia", "modelo", "notas", "permisos", "listo"];
  const enPantallaIdioma = () => !!E.bv && BV_PASOS[E.bv.paso] === "idioma";
  function abrirBienvenida(pintar = true) {
    E.bv = { paso: 0, perfil: { ...(E.perfil || {}) }, ia: [], modelos: null, carpeta: "", notas: 0, tokens: {}, cargando: true, notasModo: "", respaldoModo: "" };
    if (!E.bv.perfil.idioma_ui) E.bv.perfil.idioma_ui = E.idioma.codigo;
    host.enviar("bienvenidaEstado");
    if (pintar) render({ mantenerScroll: true });
  }
  /** La bienvenida de la vista previa: IAs, modelos y carpeta ficticios. */
  function bienvenidaSimulada() {
    return ({ ia: [{ id: "claude", nombre: "Claude", ruta: "/opt/homebrew/bin/claude", soportada: true }, { id: "codex", nombre: "ChatGPT (Codex)", ruta: null, soportada: true, guia: "https://minuta-app.github.io/minuta/ia.html#codex" }, { id: "gemini", nombre: "Gemini", ruta: null, soportada: true, guia: "https://minuta-app.github.io/minuta/ia.html#gemini" }],
      modelos: { recomendado: "turbo", ram: 16, lista: [{ id: "turbo", nombre: "Preciso", mb: 574, detalle: "El mejor para reuniones; recomendado con 8 GB de RAM o más.", listo: false }, { id: "small", nombre: "Liviano", mb: 190, detalle: "Más rápido y pequeño; para Macs con poca memoria.", listo: false }], vadListo: false },
      perfil: E.perfil || {}, carpeta: "~/Documents/Minuta/Reuniones", notas: 0, tokens: {} });
  }
  /** Idioma sugerido en la pantalla de idioma: la primera vez, el del sistema; si no, el que ya se usa. */
  function idiomaSugerido() {
    if (!E._primeraVez) return E.idioma.codigo;
    const s = String(E.idioma.sistema || navigator.language || "es").toLowerCase();
    return s.startsWith("es") ? "es" : "en";
  }
  /** La persona eligió idioma: se guarda como en Preferencias y se avanza cuando la traducción ya está cargada. */
  function elegirIdiomaBV(c) {
    const b = E.bv; if (!b || b.lengua) return;
    b.perfil.idioma_ui = c; E.perfil = { ...(E.perfil || {}), idioma_ui: c };
    if (E.idioma.codigo === c) { host.enviar("perfil", { cambios: { idioma_ui: c } }); bvTrasIdioma(); return; }
    b.lengua = c; render({ mantenerScroll: true });
    host.enviar("perfil", { cambios: { idioma_ui: c } });  // la app manda el idioma en cargar (en la vista previa, simular)
    setTimeout(() => { if (E.bv?.lengua === c) bvTrasIdioma(); }, 2500);  // si la traducción no llega, se sigue igual
  }
  function bvTrasIdioma() {
    const b = E.bv; if (!b) return;
    b.lengua = null;
    if (BV_PASOS[b.paso] === "idioma") b.paso = 1;
    render({ mantenerScroll: true });
    setTimeout(() => $('.bv-acc [data-bv-paso="1"]')?.focus(), 30);
  }
  /** Paso 0: solo el idioma. Título fijo en los dos idiomas y cada opción escrita en su propio idioma (no pasa por el traductor). */
  function pantallaIdioma() {
    const b = E.bv, sug = idiomaSugerido();
    const lista = [["es", "Español", "Sugerido"], ["en", "English", "Suggested"]];
    const otro = (E.idioma.instalados || []).find((x) => x.codigo === E.idioma.codigo && !["es", "en"].includes(x.codigo));
    if (otro) lista.push([otro.codigo, otro.nombre, ""]);
    return `<div class="bienvenida bv-idioma" role="dialog" aria-modal="true" aria-labelledby="bv-idioma-titulo" data-sin-traducir>
      <div class="bv-idioma-caja">
        <div class="bv-logo" aria-hidden="true">🎙️</div>
        <h1 id="bv-idioma-titulo"><span lang="es">Elige tu idioma</span><span class="bv-sep" aria-hidden="true"> · </span><span lang="en">Choose your language</span></h1>
        <div class="bv-lenguas" role="group" aria-labelledby="bv-idioma-titulo">${lista.map(([c, n, s]) => `
          <button type="button" class="bv-lengua${c === sug ? " sugerido" : ""}" data-bv-lengua="${esc(c)}" lang="${esc(c)}"${b.lengua ? " disabled" : ""}${b.lengua === c ? ` aria-busy="true"` : ""}>
            <b>${esc(n)}</b>${c === sug && s ? `<small>✓ ${s}</small>` : ""}</button>`).join("")}
        </div>
      </div></div>`;
  }
  function bvPaso(d) {
    const b = E.bv; guardarCamposBV();
    if (d > 0 && !bvPuedeSeguir()) return;
    b.paso = Math.max(0, Math.min(BV_PASOS.length - 1, b.paso + d)); b.error = "";
    render({ mantenerScroll: true });
  }
  function guardarCamposBV() {
    const b = E.bv; if (!b) return;
    for (const el of document.querySelectorAll("[data-bv-campo]")) b.perfil[el.dataset.bvCampo] = el.value;
    const u = $("#bv-repo-url"); if (u) b.repoUrl = u.value.trim();
    const t = $("#bv-token"); if (t) b.token = t.value.trim();
    const n = $("#bv-repo-nombre"); if (n) b.repoNombre = n.value.trim();
  }
  function bvPuedeSeguir() {
    const b = E.bv, paso = BV_PASOS[b.paso];
    if (paso === "tu" && !(b.perfil.nombre || "").trim()) { b.error = "Escribe tu nombre para seguir."; render({ mantenerScroll: true }); return false; }
    if (paso === "ia" && !b.iaOk) { b.error = "Prueba tu IA antes de seguir (o elige \"La configuro después\")."; render({ mantenerScroll: true }); return false; }
    if (paso === "modelo" && !(b.modelos?.lista || []).some((m) => m.listo) && !b.descargando) { b.error = "Descarga un modelo para poder transcribir."; render({ mantenerScroll: true }); return false; }
    return true;
  }
  function terminarBienvenida() {
    const b = E.bv; guardarCamposBV();
    const perfil = { ...b.perfil }; delete perfil.carpeta_notas;  // la carpeta ya quedó guardada al elegirla
    E.perfil = { ...(E.perfil || {}), ...b.perfil };
    host.enviar("terminarBienvenida", { perfil, tema: E.temaId });
    E.bv = null; E._primeraVez = false; render({ mantenerScroll: true }); toast("¡Listo! Ya puedes grabar tu primera reunión 🎉");
  }
  function overlayBienvenida() {
    const b = E.bv; if (!b) return "";
    const paso = BV_PASOS[b.paso], p = b.perfil;
    const puntos = BV_PASOS.map((_, i) => `<i class="${i === b.paso ? "on" : i < b.paso ? "ok" : ""}"></i>`).slice(1).join("");
    const opc = (lista, actual) => lista.map(([v, n]) => `<option value="${esc(v)}"${v === actual ? " selected" : ""}>${esc(n)}</option>`).join("");
    if (paso === "idioma") return pantallaIdioma();
    let cuerpo = "";
    if (paso === "hola") {
      cuerpo = `<div class="bv-hero"><div class="bv-logo">🎙️</div><h2>Bienvenido a Minuta</h2>
        <p>Tus reuniones, tu computador, tus notas. El audio nunca sale de tu computador: se transcribe aquí mismo. Solo el texto va a la IA que tú elijas.</p></div>
        <p class="cat-ayuda">Son 5 pasos cortos. Todo se puede cambiar después en Preferencias.</p>`;
    } else if (paso === "tu") {
      cuerpo = `<h2>¿Quién eres?</h2><p class="bv-sub">Con esto tu IA sabe a quién le da el feedback. Se guarda solo en tu computador.</p>
        <div class="pp-fila"><label class="cat-campo"><span>Tu nombre</span><input data-bv-campo="nombre" value="${esc(p.nombre || "")}" placeholder="ej: Ana"></label>
          <label class="cat-campo"><span>Nombre completo <small>para reconocerte en las invitaciones</small></span><input data-bv-campo="nombre_completo" value="${esc(p.nombre_completo || "")}" placeholder="ej: Ana Pérez"></label></div>
        <label class="cat-campo"><span>Qué haces <small>le da contexto al feedback</small></span><input data-bv-campo="descripcion" value="${esc(p.descripcion || "")}" placeholder="ej: Product Manager en una startup"></label>
        <div class="pp-fila"><label class="cat-campo"><span>Idioma de tus notas <small>lo que escribe tu IA</small></span><select data-bv-campo="idioma">${opc(IDIOMAS_NOTAS, p.idioma || "español")}</select></label>
          <label class="cat-campo"><span>Idioma de tus reuniones <small>para transcribir</small></span><select data-bv-campo="idioma_audio">${opc(IDIOMAS_AUDIO, p.idioma_audio || "auto")}</select></label></div>`;
    } else if (paso === "ia") {
      const lista = b.ia || [];
      const CUENTA = { claude: "Claude Pro o Max", codex: "Cuenta de ChatGPT", gemini: "Cuenta de Google" };
      cuerpo = `<h2>Tu IA</h2><p class="bv-sub">Minuta usa <b>tu propia cuenta</b> para escribir las notas y el feedback: sin otra suscripción y sin pasar por servidores de Minuta. Elige la que ya tienes. <a href="#" data-bv-url="https://minuta-app.github.io/minuta/ia.html">¿Qué es esto?</a></p>
        ${b.cargando ? `<div class="pr-pensando"><span></span><span></span><span></span> Buscando qué tienes instalado…</div>` : `<div class="bv-ias">${lista.map((x) => `
          <div class="bv-ia${x.ruta ? " hay" : ""}${!x.soportada ? " pronto" : ""}"><b>${esc(x.nombre)}</b>
            <small><span>${!x.soportada ? "Pronto" : x.ruta ? "Instalada" : "No está instalada"}</span> · <span>${CUENTA[x.id] || ""}</span></small>
            ${x.soportada ? (x.ruta ? `<button class="boton-txt${b.iaOk === x.id ? "" : " aplicar"}" data-bv-probar="${esc(x.id)}" ${b.probando ? "disabled" : ""}>${b.probando === x.id ? "Probando…" : b.iaOk === x.id ? "✓ Funciona" : "Probar"}</button>`
              : `<button class="boton-txt" data-bv-url="${esc(x.guia || "")}">Cómo instalarla</button><button class="boton-txt" data-bv-recargar>Ya la instalé</button>`) : ""}
          </div>`).join("")}</div>`}
        ${b.iaTexto && !b.iaOk ? `<p class="forja-error">${esc(b.iaTexto)}</p><p class="cat-ayuda">Si dice que no has iniciado sesión: abre la Terminal, escribe <code>${esc(b.probado || "claude")}</code> y sigue los pasos. Después vuelve a probar. <a href="#" data-bv-url="https://minuta-app.github.io/minuta/ia.html">Guía paso a paso</a></p>` : ""}
        <button class="boton-txt bv-saltar" data-bv-saltar-ia>La configuro después</button>`;
    } else if (paso === "modelo") {
      const m = b.modelos || { lista: [] };
      cuerpo = `<h2>Transcripción en tu computador</h2><p class="bv-sub"><span>Se descarga una sola vez el modelo que convierte la voz en texto. Tu audio nunca sale de tu computador.</span>${m.ram ? ` <span>Tu computador tiene ${m.ram} GB de memoria.</span>` : ""}</p>
        <div class="bv-modelos">${m.lista.map((x) => `<button class="bv-modelo${(b.modeloElegido || m.elegido || m.recomendado) === x.id ? " elegido" : ""}" data-bv-modelo="${esc(x.id)}" ${b.descargando ? "disabled" : ""}>
          <b>${esc(x.nombre)} ${x.id === m.recomendado ? `<em>recomendado</em>` : ""}</b><small>${esc(x.detalle)}</small><span>${x.listo ? "✓ Descargado" : `${x.mb} MB`}</span></button>`).join("")}</div>
        ${b.descargando ? `<div class="bv-barra"><i style="width:${b.pct || 0}%"></i></div><p class="cat-ayuda">Descargando… ${b.pct || 0}% · puedes seguir con los demás pasos.</p>`
          : (m.lista.find((x) => x.id === (b.modeloElegido || m.elegido || m.recomendado))?.listo ? `<p class="cat-ayuda">✓ Listo para transcribir.</p>` : `<button class="boton-txt aplicar" data-bv-descargar>⬇ Descargar</button>`)}`;
    } else if (paso === "notas") {
      const modo = b.notasModo;
      cuerpo = `<h2>Tus notas</h2><p class="bv-sub">Cada reunión queda como un archivo Markdown que es tuyo. Ahora: <b>${esc(b.carpeta || "")}</b>${b.notas ? ` (${b.notas} notas)` : ""}</p>
        <div class="pestanas bv-modos">${[["nuevas", "Empiezo de cero"], ["carpeta", "Ya tengo notas en una carpeta"], ["repo", "Mis notas están en GitHub o GitLab"]].map(([k, n]) => `<button class="pestana${modo === k ? " activa" : ""}" data-bv-notas="${k}">${n}</button>`).join("")}</div>
        ${modo === "carpeta" || modo === "nuevas" ? `<button class="boton-txt" data-bv-carpeta>📁 ${modo === "nuevas" ? "Elegir otra carpeta (opcional)" : "Elegir la carpeta de mis notas"}</button>` : ""}
        ${modo === "repo" ? `<label class="cat-campo"><span>Dirección del repositorio <small>la de "Clone" con https</small></span><input id="bv-repo-url" value="${esc(b.repoUrl || "")}" placeholder="https://github.com/tu-usuario/mis-notas.git"></label>
          <label class="cat-campo"><span>Token de acceso <small>solo si el repo es privado · se guarda en el Llavero</small></span><input id="bv-token" type="password" value="${esc(b.token || "")}" placeholder="ghp_… o glpat-…"></label>
          <div class="bv-fila"><button class="boton-txt" data-bv-url="https://github.com/settings/tokens/new?scopes=repo&description=Minuta">Crear token en GitHub</button><button class="boton-txt" data-bv-url="https://gitlab.com/-/user_settings/personal_access_tokens?name=Minuta&scopes=api,write_repository">Crear token en GitLab</button>
          <button class="boton-txt aplicar" data-bv-clonar ${b.trabajando ? "disabled" : ""}>${b.trabajando ? "Trayendo…" : "Traer mis notas"}</button></div>` : ""}
        ${b.repoTexto ? `<p class="${b.repoOk ? "cat-ayuda" : "forja-error"}">${esc(b.repoTexto)}</p>` : ""}
        ${modo && modo !== "repo" ? `<div class="bv-respaldo"><b>☁️ Respaldo en tu cuenta (opcional)</b><p>Minuta crea un repositorio <b>privado en tu propia cuenta</b> y sube cada nota nueva. Nadie más tiene acceso.</p>
          <div class="pestanas">${[["", "Sin respaldo"], ["github", "GitHub"], ["gitlab", "GitLab"]].map(([k, n]) => `<button class="pestana${(b.respaldoModo || "") === k ? " activa" : ""}" data-bv-respaldo="${k}">${n}</button>`).join("")}</div>
          ${b.respaldoModo ? `<div class="pp-fila"><label class="cat-campo"><span>Nombre del repositorio</span><input id="bv-repo-nombre" value="${esc(b.repoNombre || "minuta-notas")}"></label>
            <label class="cat-campo"><span>Token de acceso <small>se guarda en el Llavero</small></span><input id="bv-token" type="password" value="${esc(b.token || "")}" placeholder="${b.respaldoModo === "gitlab" ? "glpat-…" : "ghp_…"}"></label></div>
            <div class="bv-fila"><button class="boton-txt" data-bv-url="${b.respaldoModo === "gitlab" ? "https://gitlab.com/-/user_settings/personal_access_tokens?name=Minuta&scopes=api,write_repository" : "https://github.com/settings/tokens/new?scopes=repo&description=Minuta"}">Crear token</button>
            <button class="boton-txt aplicar" data-bv-crear-repo ${b.trabajando ? "disabled" : ""}>${b.trabajando ? "Creando…" : "Crear repositorio privado"}</button></div>` : ""}</div>` : ""}`;
    } else if (paso === "permisos") {
      const a = E.avisos || {};
      const fila = (ico, t, d, estado, boton) => `<div class="bv-permiso"><span>${ico}</span><div><b>${t}</b><small>${d}</small></div>${estado === "si" ? `<em class="ok">✓</em>` : boton}</div>`;
      cuerpo = ESCRITORIO ? `<h2>Permisos</h2><p class="bv-sub">Minuta solo usa esto para lo que dice aquí.</p>
        ${fila("🎙️", "Micrófono", "Para grabar tu voz en las reuniones.", b.micOk ? "si" : "", `<button class="boton-txt aplicar" data-bv-permiso="microfono">Revisar</button>`)}
        ${fila("🔊", "Audio de la llamada", "Para grabar a los demás. No necesita permiso.", "si", "")}
        ${fila("📅", "Calendario", "Opcional: conéctalo después en Preferencias con la dirección iCal de Google u Outlook.", a.calendario, `<small class="bv-luego">después</small>`)}`
        : `<h2>Permisos</h2><p class="bv-sub">macOS te pedirá confirmar cada uno. Minuta solo los usa para lo que dice aquí.</p>
        ${fila("🎙️", "Micrófono", "Para grabar tu voz en las reuniones.", b.micOk ? "si" : "", `<button class="boton-txt aplicar" data-bv-permiso="microfono">Permitir</button>`)}
        ${fila("🔊", "Audio de la llamada", "Para grabar a los demás. macOS lo pide la primera vez que grabes.", "", `<small class="bv-luego">al grabar</small>`)}
        ${fila("📅", "Calendario", "Para saber el título y los invitados de cada reunión.", a.calendario, `<button class="boton-txt aplicar" data-av="pedirCalendario">Permitir</button>`)}`;
      cuerpo += `
        ${fila("🔔", "Avisos", "Para avisarte cuando hay notas listas o un logro.", a.permiso, `<button class="boton-txt aplicar" data-av="pedirAvisos">Permitir</button>`)}`;
    } else {
      cuerpo = `<div class="bv-hero"><div class="bv-logo">🎉</div><h2>¡Todo listo${p.nombre ? `, ${esc(p.nombre)}` : ""}!</h2>
        <p>Cuando empiece una reunión en Teams, Zoom o Meet te aviso arriba a la derecha: un clic y grabo. Al terminar, tus notas y tu feedback quedan listos solos.</p></div>
        <div class="u-sub">Elige tu universo</div>
        <div class="galeria-grid bv-universos">${E.temas.slice(0, 8).map((t) => `<button class="universo${t.id === E.temaId ? " elegido" : ""}" data-universo="${t.id}" style="${varsUniverso(t.estilo)}"><span class="u-emoji">${t.emoji}</span><span class="u-nombre">${esc(t.nombre)}</span></button>`).join("")}</div>`;
    }
    const ultimo = b.paso === BV_PASOS.length - 1;
    return `<div class="bienvenida" role="dialog" aria-modal="true" aria-label="Bienvenida"><div class="bv-caja">
      <div class="bv-puntos">${puntos}</div>
      <div class="bv-cuerpo">${cuerpo}</div>
      ${b.error ? `<p class="forja-error">${esc(b.error)}</p>` : ""}
      <div class="bv-acc">${b.paso ? `<button class="boton-txt" data-bv-paso="-1">← Atrás</button>` : `<span></span>`}
        ${ultimo ? `<button class="boton-txt aplicar" data-bv-fin>Empezar a usar Minuta</button>` : `<button class="boton-txt aplicar" data-bv-paso="1">Siguiente →</button>`}</div>
    </div></div>`;
  }

  // ───────────────────────── Actualizaciones ─────────────────────────
  E.act = { hay: false };
  /** Vista previa en el navegador: recorre los pasos para ver cómo se ve. */
  function simularActualizacion() {
    const pasos = [["1", "Descargando la versión nueva…"], ["2", "Preparando la versión nueva…", 10], ["2", "Preparando la versión nueva…", 55], ["2", "Preparando la versión nueva…", 92], ["3", "Instalando: Minuta se cerrará y volverá a abrirse sola"]];
    pasos.forEach(([paso, texto, pct], i) => setTimeout(() => window.Minuta.actualizacionProgreso({ paso, texto, total: 3, ...(pct != null ? { pct } : {}) }), 900 * (i + 1)));
  }
  function bannerActualizacion() {
    if (enPantallaIdioma()) return "";  // nada antes de elegir idioma
    const pr = E.act.progreso;
    if (pr) {
      // El mismo aviso muestra el avance: paso N de 3, barra y qué está pasando. Sin alertas del sistema.
      if (pr.paso === "error") return `<div class="act-banner act-error" role="alert"><span>⚠️</span><div><b>No se pudo actualizar</b><small>${esc(pr.texto || "")}</small></div>
        <button class="boton-txt aplicar" data-act="instalar">Reintentar</button><button class="boton-mini" data-act="cerrar-progreso" title="Cerrar">✕</button></div>`;
      const n = Math.max(1, Math.min(3, +pr.paso || 1)), total = pr.total || 3;
      const dentro = pr.pct != null ? pr.pct / 100 : null;
      const pct = Math.round(((n - 1) + (dentro ?? 0.15)) / total * 100);
      return `<div class="act-banner act-progreso" role="status" aria-live="polite"><span class="act-giro">⟳</span><div class="act-cuerpo">
        <b>Actualizando Minuta</b><small>${esc(pr.texto || "")}</small>
        <div class="act-barra${dentro == null ? " indeterminada" : ""}"><i style="width:${pct}%"></i></div>
        <small class="act-paso">Paso ${n} de ${total}${dentro != null ? ` · ${pr.pct}%` : ""}${n === 2 && !ESCRITORIO ? " · unos 2 o 3 minutos" : ""}</small></div></div>`;
    }
    if (!E.act.hay || E.act.oculto) return "";
    return `<div class="act-banner" role="status"><span>✨</span><div><b>Hay una versión nueva de Minuta</b><small>${esc((E.act.detalle || "").split("\n").slice(0, 3).join(" · ").replace(/•\s*/g, "")).slice(0, 160)}</small></div>
      <button class="boton-txt aplicar" data-act="instalar">Actualizar</button><button class="boton-mini" data-act="luego" title="Más tarde">✕</button></div>`;
  }

  // ───────────────────────── Comentarios (sin servidor: issues en GitHub) ─────────────────────────
  // Con la cuenta de GitHub del respaldo se publican desde la app; si no, se abre GitHub con todo listo.
  // Nada es obligatorio ni aparece solo: el formulario se abre únicamente cuando la persona lo pide.
  E.coment = null;
  E.comentCuenta = undefined; // undefined: aún no se pregunta · null: sin cuenta · "usuario": se publica con su cuenta
  function pedirCuenta() {
    if (E.comentCuenta !== undefined || E.plataforma === "web") return;
    E.comentCuenta = null;
    host.enviar("comentariosCuenta", {});
  }
  function abrirComentario(c) {
    E.coment = { sistema: true, ...c };
    pedirCuenta();
    render({ mantenerScroll: true });
    setTimeout(() => $(c.tipo === "error" || c.tipo === "idea" || c.tipo === "otro" ? "#coment-titulo" : "#coment-texto")?.focus(), 30);
  }
  const TIPOS_COMENT = [["error", "🐞 Algo falla"], ["idea", "💡 Una idea"], ["universo", "🌌 Un universo"], ["otro", "💬 Otro"]];
  /** Universo listo para el catálogo: solo los campos de datos (nada de la máquina de la persona). */
  function universoParaCatalogo(u) {
    const CAMPOS = ["id", "nombre", "emoji", "xp", "categorias", "personaje_por_defecto", "elogios", "apartados", "rangos", "logros", "iconos_logros", "iconos_apartados", "iconos_rangos", "estilo", "idioma", "descripcion"];
    return JSON.stringify(Object.fromEntries(CAMPOS.filter((k) => u[k] !== undefined).map((k) => [k, u[k]])), null, 2);
  }
  function overlayComentarios() {
    const c = E.coment; if (!c) return "";
    const cuenta = E.comentCuenta;
    if (c.enviado) return `<div class="galeria borrar-fondo" data-accion="cerrar-coment"><div class="galeria-caja env-caja" role="dialog" aria-modal="true" aria-label="Comentario publicado">
      <div class="gy-cab"><div><h2>✓ Publicado</h2><p>${c.tipo === "propuesta" ? "Tu universo quedó propuesto en el catálogo. Cuando lo revisemos, aparecerá para que todos lo descarguen." : "Gracias. Quedó publicado en GitHub y te llegarán las respuestas ahí."}</p></div><button class="boton" data-accion="cerrar-coment" title="Cerrar (Esc)">✕</button></div>
      <div class="borrar-botones"><button class="boton-txt" data-accion="cerrar-coment">Cerrar</button><button class="boton-txt aplicar" data-coment-ver>Verlo en GitHub</button></div></div></div>`;
    const sobre = c.tipo === "nota" ? "el feedback de una nota" : c.universo ? `${c.universo.emoji || "🌌"} ${c.universo.nombre}` : "";
    const titulo = c.tipo === "propuesta" ? "📤 Proponer tu universo" : c.tipo === "nota" ? "🗨 Comentar el feedback" : c.universo ? "💬 Comentar un universo" : "💬 Enviar comentarios";
    const ayuda = c.tipo === "propuesta" ? "Se envía el universo (nombre, rangos, logros, frases y colores) para que lo revisemos y lo sumemos al catálogo. Revisa que no tenga tu nombre, el de tu empresa ni datos de tus reuniones."
      : c.tipo === "nota" ? "Cuéntanos qué te pareció el feedback. No se envía nada de la nota: solo lo que escribas aquí."
      : "No incluyas datos de tus reuniones.";
    const donde = cuenta ? `Se publica en GitHub con tu cuenta <b>@${esc(cuenta)}</b> y es público.` : "Se abre GitHub con tu mensaje listo; lo revisas y lo publicas tú. Es público.";
    const general = !c.universo && c.tipo !== "nota";
    return `<div class="galeria borrar-fondo" data-accion="cerrar-coment"><div class="galeria-caja env-caja" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <div class="gy-cab"><div><h2>${titulo}</h2><p><span>${donde}</span> <span>${ayuda}</span></p></div><button class="boton" data-accion="cerrar-coment" title="Cerrar (Esc)">✕</button></div>
      ${sobre ? `<p class="coment-sobre">Sobre: <b data-sin-traducir>${esc(sobre)}</b></p>` : ""}
      ${general ? `<div class="pestanas">${TIPOS_COMENT.map(([k, n]) => `<button class="pestana${c.tipo === k ? " activa" : ""}" data-coment-tipo="${k}">${n}</button>`).join("")}</div>
      <label class="cat-campo"><span>Título</span><input id="coment-titulo" value="${esc(c.titulo || "")}"></label>` : ""}
      <label class="cat-campo"><span>${c.tipo === "propuesta" ? "Cuéntanos algo de tu universo (opcional)" : "Cuéntanos"}</span><textarea id="coment-texto" rows="${c.tipo === "propuesta" ? 3 : 6}">${esc(c.texto || "")}</textarea></label>
      ${c.tipo === "propuesta" ? "" : `<label class="av-op" data-coment-sistema><span class="av-txt"><b>${c.tipo === "nota" ? "Incluir versión de la app, idioma, tu IA y el universo" : "Incluir versión de la app e idioma"}</b><small>ayuda a entender el contexto; nunca se incluyen notas ni nombres</small></span><span class="pn-interruptor${c.sistema ? " on" : ""}"><i></i></span></label>`}
      ${c.error ? `<p class="forja-error">No se pudo publicar: ${esc(c.error)}. Puedes abrirlo en GitHub.</p>` : ""}
      <div class="borrar-botones${cuenta ? " tres" : ""}"><button class="boton-txt" data-accion="cerrar-coment">Cancelar</button>
        ${cuenta ? `<button class="boton-txt" data-coment-enviar="navegador">Abrir en GitHub</button><button class="boton-txt aplicar" data-coment-enviar="directo" ${c.enviando ? "disabled" : ""}>${c.enviando ? "Publicando…" : "Publicar"}</button>`
          : `<button class="boton-txt aplicar" data-coment-enviar="navegador">Abrir en GitHub</button>`}</div>
    </div></div>`;
  }
  function enviarComentario(modo) {
    const c = E.coment; c.titulo = ($("#coment-titulo")?.value || "").trim(); c.texto = ($("#coment-texto")?.value || "").trim();
    const general = !c.universo && c.tipo !== "nota";
    if (general && !c.titulo) { $("#coment-titulo")?.focus(); return; }
    if (!general && c.tipo !== "propuesta" && !c.texto) { $("#coment-texto")?.focus(); return; }
    const so = ESCRITORIO ? (host.plataforma === "windows" ? "Windows" : "Linux") : navigator.userAgent.match(/Mac OS X [\d_]+/)?.[0]?.replace(/_/g, ".") || "macOS";
    const ia = { claude: "Claude", codex: "ChatGPT (Codex)", gemini: "Gemini" }[E.perfil?.ia || "claude"] || "";
    const sistema = c.sistema && c.tipo !== "propuesta" ? `\n\n---\nMinuta ${E.version || ""} · idioma ${E.idioma.codigo} · ${so}${c.tipo === "nota" ? ` · IA: ${ia} · universo: ${E.temaId}` : ""}` : "";
    const resumen = (t) => t.replace(/\s+/g, " ").slice(0, 70) + (t.length > 70 ? "…" : "");
    const u = c.universo;
    let datos;
    if (c.tipo === "propuesta") {
      const json = universoParaCatalogo(u);
      datos = { repo: "catalogo", etiqueta: "propuesta", titulo: `📤 Propuesta de universo: ${u.nombre} [${u.id}]`,
        cuerpo: `${c.texto ? c.texto + "\n\n" : ""}Universo creado con Minuta.\n\n\`\`\`json\n${json}\n\`\`\`` };
      // Por el navegador no cabe un universo entero en la dirección: se copia y la persona lo pega.
      if (modo !== "directo" && datos.cuerpo.length > 6000) {
        host.enviar("copiar", { texto: "```json\n" + json + "\n```" });
        datos.cuerpo = `${c.texto ? c.texto + "\n\n" : ""}Universo creado con Minuta.\n\n<!-- Tu universo quedó copiado: pégalo aquí abajo (Cmd+V / Ctrl+V). -->\n`;
      }
    } else if (u) {
      datos = { repo: "catalogo", etiqueta: "universo", titulo: `🌌 ${u.nombre} [${u.id}]: ${resumen(c.texto)}`, cuerpo: c.texto + sistema };
    } else if (c.tipo === "nota") {
      datos = { repo: "app", etiqueta: "feedback", titulo: `🗨 Sobre el feedback: ${resumen(c.texto)}`, cuerpo: c.texto + sistema };
    } else {
      const pre = { error: "🐞", idea: "💡", universo: "🌌", otro: "💬" }[c.tipo] || "";
      datos = { repo: c.tipo === "universo" ? "catalogo" : "app", etiqueta: { error: "error", idea: "idea", universo: "universo", otro: "comentario" }[c.tipo],
        titulo: `${pre} ${c.titulo}`, cuerpo: (c.texto || "") + sistema };
    }
    if (modo === "directo") { c.enviando = true; c.error = ""; render({ mantenerScroll: true }); host.enviar("comentarios", { ...datos, directo: true }); return; }
    host.enviar("comentarios", datos);
    E.coment = null; render({ mantenerScroll: true });
    toast(c.tipo === "propuesta" && datos.cuerpo.includes("quedó copiado") ? "Se abrió GitHub: pega tu universo y publica ✓" : "Se abrió GitHub: revisa y publica ✓");
  }

  document.addEventListener("input", (ev) => {
    if (E.corr && (ev.target.id === "corr-de" || ev.target.id === "corr-a" || ev.target.dataset?.corr)) {
      if (ev.target.id === "corr-de") E.corr.de = ev.target.value;
      else if (ev.target.id === "corr-a") E.corr.a = ev.target.value;
      else E.corr[ev.target.dataset.corr] = ev.target.checked;
      const k = $("#corr-conteo"); if (k) k.innerHTML = htmlConteo();
      return;
    }
    if (ev.target.dataset?.perfil) {
      const k = ev.target.dataset.perfil; E.perfil = { ...(E.perfil || {}), [k]: ev.target.value };
      clearTimeout(window._tPerfil); window._tPerfil = setTimeout(() => host.enviar("perfil", { cambios: { [k]: E.perfil[k] } }), 600);
      return;
    }
    if (E.env && ["env-para", "env-asunto", "env-cuerpo", "env-indic"].includes(ev.target.id)) {
      E.env[ev.target.id.slice(4)] = ev.target.value;
      if (ev.target.id === "env-cuerpo" || ev.target.id === "env-asunto") guardarEnv();
      return;
    }
    if (ev.target.id === "gym-txt" && E.gym) {
      E.gym.borrador = ev.target.value;
      if (E.gym.escuchando) { silenciarGym(false); render({ mantenerScroll: true }); }  // si escribes, dejo de escuchar
      return;
    }
    if (ev.target.id === "gym-propio" && E.gym) { E.gym.propio = ev.target.value; return; }
    if (ev.target.id === "preg-txt") { E.preg.borrador = ev.target.value; return; }
    if (ev.target.id === "busca-persona") { E.buscaPersona = ev.target.value; render({ mantenerScroll: true }); return; }
    if (ev.target.id === "u-busca") { E.uBusca = ev.target.value; render({ mantenerScroll: true }); return; }
    if (ev.target.id === "forja-nombre" && E.forja) { E.forja.nombre = ev.target.value; return; }
    if (ev.target.id === "forja-notas" && E.forja) { E.forja.notas = ev.target.value; return; }
    const campo = ev.target.closest?.("[data-campo]");
    if (campo && campo.closest(".cat")) {
      const c = E.categorias[+campo.closest(".cat").dataset.cat];
      c[campo.dataset.campo] = "lista" in campo.dataset ? campo.value.split(",").map((x) => x.trim()).filter(Boolean) : campo.value;
      guardarCategorias(); return;
    }
    if (ev.target.id === "pn-titulo") { E.pan.titulo = ev.target.value; host.enviar("titulo", { texto: ev.target.value }); return; }
    if (ev.target.id === "buscar") { E.busqueda = ev.target.value; render({ mantenerScroll: true }); }
  });

  /** Esc (o el ✕ de la pieza) sobre una ventana: cierra la de más arriba. Devuelve true si cerró algo. */
  function cerrarArriba() {
    const cerrar = (f) => { f(); render({ mantenerScroll: true }); return true; };
    if (E.coment) return cerrar(() => { E.coment = null; });
    if (E.previa) return cerrar(() => { E.previa = null; });
    if (E.env) return cerrar(() => { E.env = null; });
    if (E.gym) return cerrar(() => { host.enviar("callar"); E.gym = null; });
    if (E.preg.abierta) return cerrar(() => { E.preg.abierta = false; });
    if (E.corr) return cerrar(() => { E.corr = null; });
    if (E.corrIA && !E.corrIA.trabajando) return cerrar(() => { E.corrIA = null; });
    if (E.votoAbierto) return cerrar(() => { E.votoAbierto = null; });
    if (E.forja) { if (E.forja.estado === "trabajando") return false; return cerrar(() => { E.forja = null; }); }
    if (E.borrar) return cerrar(() => { E.borrar = null; });
    if (E.galeria) return cerrar(() => { E.galeria = false; });
    return false;
  }
  document.addEventListener("keydown", (ev) => {
    const mod = ev.metaKey || ev.ctrlKey;
    if (enPantallaIdioma()) {
      // Pantalla de idioma: flechas y Tab pasan de una opción a otra (sin salir de ella); Enter o espacio elige. Sin atajos hasta elegir.
      const bs = [...document.querySelectorAll(".bv-lengua")], i = bs.indexOf(document.activeElement);
      const paso = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key] ?? (ev.key === "Tab" ? (ev.shiftKey ? -1 : 1) : 0);
      if (paso && bs.length) { bs[i < 0 ? 0 : (i + paso + bs.length) % bs.length].focus(); ev.preventDefault(); }
      else if (mod) ev.preventDefault();
      return;
    }
    if (E.menuTipo && ev.key === "Escape") { E.menuTipo = null; render({ mantenerScroll: true }); ev.preventDefault(); return; }
    // Una ventana abierta (aria-modal): Tab no se sale de ella y Esc la cierra (cerrarArriba).
    if (ui.manejarTecla(ev)) return;
    if (E.env && ev.key === "Enter" && ev.target.id === "env-indic") { redactarEnv(true); ev.preventDefault(); return; }
    if (E.env) return;
    if (E.gym) {
      if (ev.key === "Enter" && !ev.shiftKey && ev.target.id === "gym-txt") { enviarGym(); ev.preventDefault(); }
      return;
    }
    if (!PANEL && mod && ev.key.toLowerCase() === "g") { abrirGimnasio(); ev.preventDefault(); return; }
    if (!PANEL && mod && ev.key.toLowerCase() === "k") { E.preg.abierta ? (E.preg.abierta = false, render({ mantenerScroll: true })) : abrirPreguntar(); ev.preventDefault(); return; }
    if (E.preg.abierta) {
      if (ev.key === "Enter" && ev.target.id === "preg-txt") { preguntar(ev.target.value); ev.preventDefault(); }
      return;
    }
    if (ev.key === "Enter" && ev.target.id === "buscar" && /\?\s*$|^(que|qué|cuando|cuándo|como|cómo|quien|quién|cuanto|cuánto|donde|dónde|por que|por qué)\s/i.test(ev.target.value.trim())) { abrirPreguntar(ev.target.value.trim()); preguntar(ev.target.value); ev.preventDefault(); return; }
    if (E.menu && ev.key === "Escape") { E.menu = false; render({ mantenerScroll: true }); return; }
    if (E.corr) {
      if (ev.key === "Enter" && /^corr-/.test(ev.target.id || "")) { aplicarCorregir(); ev.preventDefault(); }
      return;
    }
    if (E.votoAbierto && ev.target.id === "voto-txt" && ev.key === "Enter") { cerrarComentario(); ev.preventDefault(); return; }
    if (!PANEL && (ev.metaKey || (ESCRITORIO && ev.ctrlKey)) && ev.key.toLowerCase() === "e" && notaActual() && E.seccion === "reuniones") { abrirCorregir(getSelection()?.toString().trim().slice(0, 60) || ""); ev.preventDefault(); return; }
    if (E.borrar) return;
    if (!PANEL && (ev.metaKey || (ESCRITORIO && ev.ctrlKey)) && (ev.key === "Backspace" || (ESCRITORIO && ev.key === "Delete")) && document.activeElement?.id !== "buscar" && notaActual()) {
      E.borrar = notaActual().ruta; render({ mantenerScroll: true }); setTimeout(() => $(".borrar-caja .peligro")?.focus(), 30); ev.preventDefault(); return;
    }
    if (PANEL) {
      if (ev.key === "Enter" && ev.target.id === "pn-titulo" && E.pan.fase === "inactiva") { host.enviar("grabar", { titulo: E.pan.titulo, tipo: E.pan.tipo }); ev.preventDefault(); }
      if (ev.key === "Escape") { if (E.panVista !== "inicio") { E.panVista = "inicio"; render(); } else host.enviar("cerrarPanel"); }
      // Teclas 1–9: eligen el tipo de reunión en el orden del menu (no al escribir ni con ⌘/Ctrl/Alt).
      const enCampo = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName || "") || ev.target.isContentEditable;
      if (/^[1-9]$/.test(ev.key) && !ev.metaKey && !ev.ctrlKey && !ev.altKey && !enCampo && E.panVista === "inicio" && (E.pan.fase === "inactiva" || E.pan.fase === "grabando")) {
        const c = E.categorias[+ev.key - 1];
        if (c) { elegirTipoPanel(c.id); ev.preventDefault(); }
      }
      return;
    }
    if (VENTANA && (ESCRITORIO ? ev.ctrlKey && !ev.altKey : ev.metaKey && !ev.ctrlKey) && (ev.key === "w" || ev.key === "m")) { host.enviar("ventana", { op: ev.key === "w" ? "cerrar" : "minimizar" }); ev.preventDefault(); return; }
    if (VENTANA && (ESCRITORIO ? ev.key === "F11" : ev.metaKey && ev.ctrlKey && ev.key.toLowerCase() === "f")) { host.enviar("ventana", { op: "pantalla" }); ev.preventDefault(); return; }
    if (mod && /^[1-3]$/.test(ev.key)) { if (+ev.key <= VISTAS.length) { E.seccion = "reuniones"; E.vista = VISTAS[+ev.key - 1][0]; render(); } ev.preventDefault(); return; }
    if (mod && ev.key === ",") { E.seccion = "preferencias"; render(); ev.preventDefault(); return; }
    if (mod && /^[4-7]$/.test(ev.key)) { E.seccion = Object.keys(ATAJO).find((k) => ATAJO[k] === +ev.key); render(); ev.preventDefault(); return; }
    if (mod && ev.key.toLowerCase() === "u") { E.galeria = !E.galeria; render({ mantenerScroll: true }); ev.preventDefault(); return; }
    if (mod && ev.key === "\\") { E.lateral = !E.lateral; render({ mantenerScroll: true }); ev.preventDefault(); return; }
    if (mod && ev.key.toLowerCase() === "f") { if (!E.lateral) { E.lateral = true; render(); } $("#buscar")?.focus(); ev.preventDefault(); return; }
    const escribiendo = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "") && document.activeElement.id !== "buscar";
    if (!escribiendo && E.seccion !== "preferencias" && (ev.key === "ArrowDown" || ev.key === "ArrowUp") && (ev.altKey || document.activeElement?.id !== "buscar")) {
      const lista = filtradas(), i = lista.findIndex((x) => x.ruta === E.sel);
      const j = Math.max(0, Math.min(lista.length - 1, i + (ev.key === "ArrowDown" ? 1 : -1)));
      if (lista[j] && j !== i) { E.sel = lista[j].ruta; E.seccion = "reuniones"; render(); $(".fila.elegida")?.scrollIntoView({ block: "nearest" }); ev.preventDefault(); }
    }
  });

  // ───────────────────────── API pública ─────────────────────────
  // Lo que la app llama (window.Minuta.<funcion>): host-ui lo deja en window.Minuta sin reemplazar el objeto.
  host.responder({
    /** datos: { notas: [{ruta, texto}], temas: [...], estilos: {id: estilo}, temaId, seleccion, plataforma } */
    cargar(datos) {
      if (datos.perfil) E.perfil = datos.perfil;
      if (datos.idioma) E.idioma = { ...E.idioma, ...datos.idioma };
      if (datos.actualizacion) E.act = { ...E.act, ...datos.actualizacion };
      if (datos.version) E.version = datos.version;
      if ("primeraVez" in datos) E._primeraVez = !!datos.primeraVez;
      // Primera vez: la bienvenida (que parte por el idioma) se abre en este mismo pintado, sin mostrar antes la app.
      if (datos.primeraVez && !E.bv && !E._bvMostrada && !PANEL) { E._bvMostrada = true; abrirBienvenida(false); if (E.cargado) render({ mantenerScroll: true }); }
      if (E.bv?.lengua && E.idioma.codigo === E.bv.lengua) bvTrasIdioma();
      if (datos.avisos || datos.ajustes || datos.agenda) {
        const antes = JSON.stringify([E.avisos, E.ajustes, E.agenda]);
        if (datos.avisos) E.avisos = datos.avisos;
        if (datos.ajustes) E.ajustes = { ...E.ajustes, ...datos.ajustes };
        if (datos.agenda) E.agenda = datos.agenda;
        const soloAvisos = Object.keys(datos).every((k) => k === "avisos" || k === "ajustes" || k === "agenda");
        if (soloAvisos) { if (E.cargado && (PANEL || ["preferencias", "agenda"].includes(E.seccion)) && antes !== JSON.stringify([E.avisos, E.ajustes, E.agenda])) render({ mantenerScroll: true }); return; }
      }
      const firma = JSON.stringify([E.idioma.codigo, datos.temaId, datos.seleccion, datos.vista, datos.seccion,
        (datos.notas || []).map((n) => n.ruta + ":" + n.texto.length), (datos.temas || []).length]);
      let catCambio = false;
      const estable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
      if (Array.isArray(datos.categorias) && datos.categorias.length && estable(datos.categorias) !== estable(E.categorias)) {
        E.categorias = datos.categorias; catCambio = true;
      }
      if (Array.isArray(datos.correcciones)) E.correcciones = datos.correcciones;
      if (datos.votos && typeof datos.votos === "object") E.votos = datos.votos;
      if (E.cargado && firma === this._firma && !catCambio) return;
      this._firma = firma;
      E.cargado = true;
      if (datos.plataforma) E.plataforma = datos.plataforma;
      if (datos.temas) {
        const estilos = datos.estilos || {};
        E.temas = limpiarUniversos(datos.temas.map((t) => ({ ...t, estilo: t?.estilo || estilos[t?.id] })))
          .sort((a, b) => (a.id === "cine" ? "zzz" : a.nombre).localeCompare(b.id === "cine" ? "zzz" : b.nombre));
      }
      if (datos.temaId) E.temaId = datos.temaId;
      if (datos.notas) {
        _cachePuntajes.clear();
        E.notas = datos.notas.map((n) => parsearNota(n.ruta, n.texto)).sort((a, b) => b.fecha - a.fecha);
        marcarCambioNotas();
      }
      if (datos.seleccion) E.sel = datos.seleccion;
      if (!E.notas.some((n) => n.ruta === E.sel)) E.sel = E.notas[0]?.ruta || null;
      if (datos.vista) E.vista = datos.vista;
      if (datos.seccion) E.seccion = datos.seccion;
      render({ mantenerScroll: true });
    },
    estado: () => ({ ...E, notas: E.notas.length }),
    /** Para la barra de menú: qué ganaste con esta nota (para decidir el aviso). */
    premios(ruta) { return premiosDe(E.notas.find((n) => n.ruta === ruta)); },
    /** Abre la revelación de la nota (devuelve false si la nota aún no está cargada). */
    revelar(ruta) {
      const n = E.notas.find((x) => x.ruta === ruta); if (!n) return false;
      const p = premiosDe(n); if (!p) return false;
      E.sel = ruta; E.seccion = "reuniones"; E.vista = "feedback"; render();
      const items = [...(p.rango ? [{ tipo: "rango", emoji: p.rango.emoji, nombre: p.rango.nombre, descripcion: p.rango.frase, nivel: p.rango.nivel }] : []),
        ...p.logros.map((l) => ({ tipo: "logro", emoji: l.emoji, nombre: l.nombre, descripcion: l.descripcion }))];
      if (!items.length) return true;
      return revelar(items, { moneda: p.moneda });
    },
    /** Estado inicial de la bienvenida: IAs instaladas, modelos, perfil y carpeta de notas. */
    bienvenida(d) {
      const b = E.bv; if (!b) return;
      Object.assign(b, { ia: d.ia || [], modelos: d.modelos, carpeta: d.carpeta, notas: d.notas || 0, tokens: d.tokens || {}, cargando: false });
      b.perfil = { ...(d.perfil || {}), ...b.perfil };
      render({ mantenerScroll: true });
    },
    iaProbada(r) { const b = E.bv; if (!b) return; b.probando = null; if (r.ok) { b.iaOk = r.ia; b.iaTexto = ""; b.perfil.ia = r.ia; } else b.iaTexto = r.codigo === "no_instalada" ? "No está instalada" : r.texto || "No respondió."; render({ mantenerScroll: true }); },
    modeloProgreso(r) { const b = E.bv; if (!b) return; b.pct = r.pct; const bar = document.querySelector(".bv-barra i"); if (bar) { bar.style.width = r.pct + "%"; const t = bar.parentElement.nextElementSibling; if (t) t.textContent = tr(`Descargando… ${r.pct}% · puedes seguir con los demás pasos.`); } },
    modeloListo(r) { const b = E.bv; if (!b) { toast(r.ok ? "Modelo descargado ✓" : `No se pudo descargar: ${r.error}`); return; } b.descargando = null; if (r.modelos) b.modelos = r.modelos; if (r.ok) { b.perfil.modelo_whisper = r.id; b.modeloElegido = r.id; } else b.error = r.error || "No se pudo descargar."; render({ mantenerScroll: true }); },
    carpetaNotas(r) { const b = E.bv; if (!b) return; b.carpeta = r.ruta; b.notas = r.notas; b.perfil.carpeta_notas = r.ruta; render({ mantenerScroll: true }); },
    repoNotas(r) {
      const b = E.bv; if (!b) { toast(r.ok ? "Respaldo listo ✓" : r.texto); return; }
      b.trabajando = false; b.repoOk = r.ok;
      b.repoTexto = r.ok ? (r.creado ? "✓ Repositorio privado creado. Cada reunión nueva se respaldará sola." : `✓ Notas traídas a ${r.texto} (${r.notas} notas).`) : `No resultó: ${r.texto}`;
      if (r.ok && !r.creado) { b.carpeta = r.texto; b.notas = r.notas; }
      render({ mantenerScroll: true });
    },
    permisoMicrofono(r) { if (E.bv) { E.bv.micOk = r.ok; render({ mantenerScroll: true }); } },
    /** Hay (o no) versión nueva. */
    /** Desde el panel de la barra de menú: empieza la actualización mostrando el avance en esta ventana. */
    iniciarActualizacion() {
      if (E.act.progreso && E.act.progreso.paso !== "error") return;
      E.act.progreso = { paso: "1", texto: "Descargando la versión nueva…", total: 3 }; E.act.oculto = false; render({ mantenerScroll: true });
      host.enviar("actualizar");
    },
    /** Avance de la actualización: { paso: "1"|"2"|"3"|"error", texto, total, pct } */
    actualizacionProgreso(d) { E.act.progreso = d; render({ mantenerScroll: true }); },
    actualizacion(r) {
      const antes = E.act.hay, manual = E.act.buscando;
      E.act = { ...E.act, ...r, buscando: false, alDia: !r.hay && !r.error };
      if (manual) toast(r.error ? "No pude revisar si hay versiones nuevas. Revisa tu conexión." : r.hay ? "Hay una versión nueva de Minuta ✨" : `Estás en la última versión${E.version ? ` (${E.version})` : ""} ✓`);
      if (manual || r.hay !== antes || r.hay) render({ mantenerScroll: true });
    },
    /** Índice del catálogo público (universos o idiomas). */
    catalogo(r) {
      const c = r.tipo === "idiomas" ? (E.catI ||= {}) : E.catU;
      Object.assign(c, { estado: "listo", lista: r.tipo === "idiomas" ? (Array.isArray(r.lista) ? limpiarDato(r.lista) : []) : limpiarUniversos(r.lista), error: r.error || "" });
      render({ mantenerScroll: true });
    },
    /** Terminó una descarga del catálogo. */
    /** Resultado de corregir una nota con la IA: { ok, cambios, recordados, error } */
    corregido(r) {
      const c = E.corrIA; if (!c) return;
      c.trabajando = false;
      if (r?.ok) { c.listo = r; _cachePuntajes.clear(); marcarCambioNotas(); } else c.error = r?.error || "No se pudo corregir.";
      render({ mantenerScroll: true });
    },
    /** Cuenta de GitHub con la que se puede publicar: { usuario } (null si no hay). */
    comentariosCuenta(d) { E.comentCuenta = d?.usuario || null; if (E.coment || E.galeria) render({ mantenerScroll: true }); },
    /** Resultado de publicar un comentario con la cuenta: { ok, url, error } */
    comentarioEnviado(d) {
      if (!E.coment) return;
      E.coment.enviando = false;
      if (d.ok && /^https:\/\/github\.com\//.test(d.url || "")) E.coment.enviado = d.url; else E.coment.error = d.error || "GitHub no respondió";
      render({ mantenerScroll: true });
    },
    /** Resultado de votar un universo: { id, ok, nuevo, positivo } */
    votado(d) {
      const v = E.votosU?.[d.id]; if (!v) return;
      if (!d.ok) { toast("No se pudo votar"); return; }
      if (d.nuevo) v[d.positivo ? "si" : "no"]++;
      v.mio = d.positivo ? "si" : "no";
      toast(d.nuevo ? "¡Voto registrado! ✓" : "Ya habías votado así");
      render({ mantenerScroll: true });
    },
    descargado(r) {
      if (r.tipo === "universo") {
        E.catU.bajando = null;
        if (!r.ok) toast(`No se pudo descargar: ${r.error || "error"}`);
        else { const u = E.catU.lista.find((x) => x.id === r.id); toast(`${u?.emoji || "✨"} ${u?.nombre || r.id} listo`); if (r.usar) elegirTema(r.id); }
      } else {
        E.catI && (E.catI.bajando = null);
        if (r.instalados) E.idioma = { ...(E.idioma || {}), instalados: r.instalados };
        toast(r.ok ? "Idioma descargado ✓" : `No se pudo descargar: ${r.error || "error"}`);
      }
      render({ mantenerScroll: true });
    },
    gym(r) {
      const g = E.gym; if (!g) return;
      g.error = r.ok ? "" : (r.error || "error");
      if (r.modo === "turno") {
        g.esperando = false;
        if (r.ok) { g.nombre ||= r.datos.nombre || "Contraparte"; g.historial.push({ quien: "otro", texto: r.datos.texto || "" }); if (g.voz) host.enviar("hablar", { texto: r.datos.texto || "" }); }
        render({ mantenerScroll: true }); if (!g.mic || g.silenciado) setTimeout(() => $("#gym-txt")?.focus(), 30);
        if (r.ok && (!g.voz || E.plataforma === "web")) escucharGym();  // si me habla, escucho cuando termine (vozTermino)
      } else { if (r.ok) { g.resultado = r.datos; g.paso = "resultado"; } else g.paso = "ensayo"; render({ mantenerScroll: true }); }
    },
    respuesta(r) {
      const it = E.preg.lista.find((x) => x.id === r.id); if (!it) return;
      Object.assign(it, r.ok ? { estado: "ok", respuesta: r.respuesta, fuentes: r.fuentes } : { estado: "error", error: r.error });
      render({ mantenerScroll: true });
    },
    /** Terminó de hablar la contraparte: ahora te escucha a ti. */
    vozTermino() { escucharGym(); },
    /** Texto que vas diciendo (parcial) y la intervención final tras una pausa. */
    dictado(r) {
      const g = E.gym; if (!g) return;
      if (r.error) { g.escuchando = false; g.micError = r.error; render({ mantenerScroll: true }); return; }
      if (r.texto != null && (r.escuchando || r.final)) { g.borrador = r.texto; const i = $("#gym-txt"); if (i) i.value = r.texto; }
      const nv = $("#gym-nivel"); if (nv) nv.style.setProperty("--n", r.nivel || 0);
      if (r.final) { g.escuchando = false; if ((g.borrador || "").trim()) { const i = $("#gym-txt"); if (i) i.value = g.borrador; enviarGym(); } else render({ mantenerScroll: true }); return; }
      if (!r.escuchando && g.escuchando) { g.escuchando = false; render({ mantenerScroll: true }); }
    },
    redactando() { if (E.env) { E.env.redactando = true; render({ mantenerScroll: true }); } },
    redactado(r) {
      if (!E.env) return;
      E.env.redactando = false;
      if (r.ok && r.texto) { E.env.cuerpo = r.texto; if (r.asunto) E.env.asunto = r.asunto; E.env.guardado = !!r.guardado; E.env.editado = !!r.editado; }
      else E.env.error = r.error || "Tu IA no respondió";
      render({ mantenerScroll: true });
    },
    abrirEnviar(ruta) { E.seccion = "reuniones"; E.sel = ruta; abrirEnviar(ruta); },
    aviso(x) { toast(typeof x === "string" ? x : x?.t || ""); },
    vivo(d) { E.vivo = d; const el = document.getElementById("pn-vivo"); if (el) el.innerHTML = vivoHTML(); },
    habitoActual: () => (foco()?.habito || "").replace(/\*\*/g, ""),
    briefTexto: (id) => briefTexto(id),
    resumenCompromisos: () => resumenCompromisos(),
    irBrief(id) { E.seccion = "agenda"; E.briefAbierto = id; render(); },
    ir(seccion) { E.seccion = seccion; render(); if (seccion === "preferencias") host.enviar("estadoAvisos"); },
    /** Solo para pruebas automáticas (recorrer todas las vistas). */
    /** Para las pruebas automáticas (pruebas/interfaz.mjs): funciones puras de la interfaz. */
    _probar(cambios) { if (typeof cambios === "function") cambios(E); else Object.assign(E, cambios); render(); return E.notas.map((n) => n.ruta); },
    /** Resultado del creador de universos: { ok, id, nombre, error } */
    forjado(r) {
      E.galeria = true;
      E.forja = r.ok ? { estado: "listo", id: r.id, nombre: r.nombre, nombreFinal: r.nombre } : { ...(E.forja || { nombre: "", notas: "" }), estado: "error", error: r.error };
      render({ mantenerScroll: true });
    },
    /** Estado de grabación para el panel: { fase, desde (ms), detectada, titulo, tipo, estado, inicio } */
    panel(d = {}) {
      const antes = JSON.stringify(E.pan);
      const tituloLocal = document.activeElement?.id === "pn-titulo" ? E.pan.titulo : null;
      Object.assign(E.pan, d);
      if (tituloLocal != null) E.pan.titulo = tituloLocal;
      if (d.abierto) E.panVista = "inicio";
      if (JSON.stringify(E.pan) !== antes || d.abierto) render({ mantenerScroll: true });
      if (d.abierto) setTimeout(() => E.pan.fase === "inactiva" && $("#pn-titulo")?.focus(), 60);
    },
    /** Estado de la ventana nativa: { pantalla: bool, activa: bool } */
    ventana(d = {}) {
      if ("pantalla" in d) { RAIZ.classList.toggle("pantalla", !!d.pantalla); RAIZ.classList.toggle("forma", !d.pantalla && !ESCRITORIO); regiones(); }
      if ("activa" in d) RAIZ.classList.toggle("inactiva", !d.activa);
    },
  });

  // Funciones puras para las pruebas automáticas (pruebas/interfaz.mjs) y lo que recibió la vista previa.
  window.Minuta._pruebas = {
    limpiarNombre: (t) => limpiarNombre(t), leerParticipantes: (t) => leerParticipantes(t), nombreValido: (t) => nombreValido(t),
    limpiarUniverso: (u) => limpiarUniverso(u), simulados: () => _simulados.map((m) => JSON.parse(JSON.stringify(m))),
  };

  // ───────────────────────── Vista previa del navegador ─────────────────────────
  // Sin app alrededor, host-ui le pasa cada acción a simular(): responde como la app, con datos ficticios.
  const _simulados = [];
  const COMUNES = PiezaHost.simulacionesComunes({ espera: 800 });
  const abrirWeb = (url) => { if (/^(https|mailto):/.test(String(url || ""))) window.open(url, "_blank", "noopener"); };
  const SIMULAR = {
    copiar: COMUNES.copiar,
    probarIA: COMUNES.probarIA,
    copiarFormato: (d, c) => COMUNES.copiar({ texto: d.texto }, c),
    tema: (d) => { try { localStorage.setItem("minuta.tema", d.id); } catch {} },
    abrirURL: (d) => abrirWeb(d.url),
    abrir: (d) => abrirWeb(d.url),
    perfil: (d) => { if (d.cambios?.idioma_ui) cambiarIdiomaWeb(d.cambios.idioma_ui); },
    bienvenidaEstado: (d, c) => c.luego(300, () => c.responder("bienvenida", bienvenidaSimulada())),
    catalogo: (d, c) => fetch(`${CATALOGO_RAW}${d.tipo}/index.json`).then((r) => r.json()).then((lista) => c.responder("catalogo", { tipo: d.tipo, lista }))
      .catch((e) => c.responder("catalogo", { tipo: d.tipo, lista: [], error: String(e) })),
    descargarUniverso: (d, c) => fetch(`${CATALOGO_RAW}universos/${d.id}.json`).then((r) => r.json())
      .then((t) => { const u = limpiarUniverso(t); if (!u) throw new Error("formato"); E.temas.push({ ...u, descargado: true }); c.responder("descargado", { tipo: "universo", id: d.id, ok: true, usar: d.usar }); })
      .catch((e) => c.responder("descargado", { tipo: "universo", id: d.id, ok: false, error: String(e) })),
    descargarIdioma: (d, c) => {
      E.idioma.instalados = [...E.idioma.instalados, E.catI.lista.find((x) => x.codigo === d.codigo)];
      c.responder("descargado", { tipo: "idioma", id: d.codigo, ok: true, instalados: E.idioma.instalados });
    },
    descargarModelo: (d, c) => {
      const b = E.bv; let k = 0;
      const paso = () => c.luego(300, () => {
        k += 20; c.responder("modeloProgreso", { id: d.id, pct: k });
        if (k < 100) return paso();
        c.responder("modeloListo", { id: d.id, ok: true, modelos: { ...b?.modelos, lista: (b?.modelos?.lista || []).map((x) => ({ ...x, listo: x.listo || x.id === d.id })) } });
      });
      paso();
    },
    elegirCarpetaNotas: (d, c) => c.responder("carpetaNotas", { ruta: "~/Documents/Notas", notas: 12 }),
    corregirIA: (d, c) => c.luego(1200, () => c.responder("corregido", { ok: true, cambios: "(vista previa) Aquí verías qué corrigió tu IA.", recordados: [d.instruccion] })),
    preguntar: (d, c) => c.luego(900, () => c.responder("respuesta", { id: d.id, ok: true, respuesta: "En la vista previa no hay IA. En tu Mac, aquí aparece la respuesta con citas como [1] o [1@00:27:05].", fuentes: [{ n: 1, ruta: E.notas[0]?.ruta, titulo: E.notas[0]?.titulo, fecha: "" }] })),
    gimnasio: (d, c) => c.luego(700, () => c.responder("gym", d.modo === "turno"
      ? { modo: d.modo, ok: true, datos: { nombre: "Carlos, dueño del club", texto: d.entrada.historial.length ? "Ya, pero ¿cuánto me va a costar al mes? Hoy con la planilla no pago nada." : "Hola, cuéntame rápido, que tengo una clase en 20 minutos." } }
      : { modo: d.modo, ok: true, datos: { veredicto: "Buen diagnóstico, pero cerraste sin fecha concreta.", puntajes: { claridad: 7, escucha: 8, preguntas: 6, cierre: 5 }, costo: [{ cita: "lo vemos y te aviso", texto: "Sin fecha ni responsable.", prueba: "¿Te parece el jueves a las 10 para mostrarte la configuración?" }], bien: [{ cita: "¿cuántas horas valle tienes vacías?", texto: "Pregunta con números." }], habito: "Cerrar siempre con fecha y hora" } })),
    redactar: (d, c) => c.luego(d.forzar ? 900 : 50, () => c.responder("redactado", { ok: true, texto: textoResumen(E.notas.find((x) => x.ruta === d.ruta)), asunto: E.env?.asunto, guardado: !d.forzar })),
    buscarActualizacion: (d, c) => c.luego(900, () => c.responder("actualizacion", { hay: false })),
    actualizar: () => simularActualizacion(),
    recordatorios: (d) => toast(`${(d.lista || []).length} a Recordatorios (solo en la app de Mac)`),
    comentarios: (d) => {
      const r = d.repo === "catalogo" ? "minuta-app/minuta-catalogo" : "minuta-app/minuta";
      abrirWeb(`https://github.com/${r}/issues/new?title=${encodeURIComponent(d.titulo)}&body=${encodeURIComponent(d.cuerpo)}&labels=${encodeURIComponent(d.etiqueta || "")}`);
    },
  };
  function simular(accion, datos, ctx) {
    _simulados.push({ accion, datos });
    if (_simulados.length > 100) _simulados.shift();
    if (Object.hasOwn(SIMULAR, accion)) return SIMULAR[accion](datos, ctx);
  }

  // Reloj: refresca "en 12 min" y vencimientos sin molestar
  setInterval(() => { if (E.cargado && (PANEL || E.seccion === "agenda") && !document.activeElement?.matches?.("input,textarea")) render({ mantenerScroll: true }); }, 60000);

  // Navegador sin contenedor: datos de ejemplo
  setTimeout(() => {
    if (E.cargado || !host.esWeb) return;
    fetch("demo.json").then((r) => r.json()).then((d) => {
      E.idioma.instalados = [...E.idioma.instalados, { codigo: "en", nombre: "English", bandera: "🇬🇧", incluido: true }];
      const lang = new URLSearchParams(location.search).get("idioma"); if (lang) setTimeout(() => cambiarIdiomaWeb(lang), 50);
      if (new URLSearchParams(location.search).has("bienvenida")) { E._primeraVez = true; setTimeout(abrirBienvenida, 200); }
      if (new URLSearchParams(location.search).has("actualizacion")) E.act = { hay: true, detalle: "• Bienvenida nueva\n• Transcripción dentro de la app" };
      try { d.temaId = new URLSearchParams(location.search).get("tema") || localStorage.getItem("minuta.tema") || d.temaId; } catch {}
      const v = new URLSearchParams(location.search).get("vista");
      if (v === "progreso" || v === "logros") d.seccion = v; else if (v) d.vista = v;
      const t0 = Date.now(), M = 60000;
      d.agenda = [
        { id: "demo1", titulo: "Reunión con proveedor de pagos", inicio: t0 + 12 * M, fin: t0 + 57 * M, asistentes: [{ nombre: "Matías Soto", email: "matias@ejemplo.com" }, { nombre: "Javiera Rojas", email: "javiera@ejemplo.com" }] },
        { id: "demo2", titulo: "Planificación sprint 52", inicio: t0 + 190 * M, fin: t0 + 220 * M, asistentes: [{ nombre: "Carlos Muñoz", email: "cmunoz@empresa.com" }] },
        { id: "demo3", titulo: "Demo club Los Aromos", inicio: t0 + 26 * 60 * M, fin: t0 + 27 * 60 * M, asistentes: [{ nombre: "Paula Díaz", email: "paula@ejemplo.com" }] },
      ];
      window.Minuta.cargar({ ...d, plataforma: "web" });
    }).catch(() => render());
  }, 400);
})();
