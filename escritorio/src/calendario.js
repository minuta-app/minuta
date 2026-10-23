// Calendario en Windows y Linux: la dirección iCal secreta de Google Calendar u Outlook (solo lectura).
// Hace lo mismo que EventKit en Mac: Agenda de las próximas 36 h, título e invitados de la reunión en curso
// y el aviso 1 minuto antes. La dirección se guarda cifrada (es secreta: quien la tenga ve tu calendario).
const fs = require("fs");
const path = require("path");
const { net, safeStorage } = require("electron");
const ical = require("node-ical");
const { BASE } = require("./rutas");

const ARCHIVO = path.join(BASE, ".calendario");
let eventos = [], url = null, ultimoError = "", yo = null, opciones = {};
const avisados = new Set();

const texto = (v) => (v == null ? "" : typeof v === "string" ? v : typeof v.val === "string" ? v.val : String(v));
const lista = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
function persona(p) {
  const val = texto(p), cn = (p && p.params && p.params.CN) || "";
  const email = /^mailto:/i.test(val) ? val.slice(7) : val.includes("@") ? val : "";
  return { nombre: String(cn).replace(/^"|"$/g, ""), email: email.toLowerCase() };
}

function leerURL() {
  try {
    const d = fs.readFileSync(ARCHIVO);
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(d) : d.toString("utf8");
  } catch { return null; }
}
function guardarURL(u) {
  if (!u) return fs.rmSync(ARCHIVO, { force: true });
  fs.writeFileSync(ARCHIVO, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(u) : Buffer.from(u));
  try { fs.chmodSync(ARCHIVO, 0o600); } catch {}
}

/** Descarga y expande los eventos de las próximas 36 h (y las últimas 3 h). */
async function actualizar() {
  if (!url) { eventos = []; return 0; }
  const r = await net.fetch(url.replace(/^webcal:/i, "https:"), { headers: { "User-Agent": "Minuta" } });
  if (!r.ok) throw new Error(`Respuesta ${r.status}`);
  const datos = ical.sync.parseICS(await r.text());
  const desde = new Date(Date.now() - 3 * 3600e3), hasta = new Date(Date.now() + 36 * 3600e3);
  const nuevos = [];
  for (const ev of Object.values(datos)) {
    if (!ev || ev.type !== "VEVENT" || ev.recurrenceid) continue;
    let instancias = [];
    try { instancias = ical.expandRecurringEvent(ev, { from: desde, to: hasta, expandOngoing: true }); } catch { continue; }
    for (const i of instancias) {
      if (i.isFullDay) continue;
      const e = i.event || ev;
      if (texto(e.status).toUpperCase() === "CANCELLED") continue;
      const gente = [...lista(e.attendee), ...lista(e.organizer)].map(persona).filter((p) => p.nombre || p.email);
      const inicio = new Date(i.start).getTime(), fin = new Date(i.end || i.start).getTime();
      nuevos.push({ uid: texto(e.uid), titulo: texto(i.summary || e.summary) || "Reunión", inicio, fin, gente,
        lugar: texto(e.location), notas: texto(e.description), url: texto(e.url) });
    }
  }
  // Tú apareces en casi todas tus reuniones: ese correo se saca de los invitados (EventKit lo sabe; un .ics no).
  const conGente = nuevos.filter((e) => e.gente.length > 1);
  const cuenta = {};
  for (const e of conGente) for (const c of new Set(e.gente.map((p) => p.email).filter(Boolean))) cuenta[c] = (cuenta[c] || 0) + 1;
  const [masComun, n] = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0] || [];
  yo = masComun && conGente.length >= 2 && n >= conGente.length * 0.8 ? masComun : null;
  eventos = nuevos.sort((a, b) => a.inicio - b.inicio);
  return eventos.length;
}

const sinMi = (gente) => {
  const vistos = new Set();
  return gente.filter((p) => p.email !== yo && !(p.email && vistos.has(p.email)) && (vistos.add(p.email), true));
};

function agendaJS() {
  const ahora = Date.now();
  return eventos.filter((e) => e.fin > ahora).slice(0, 40).map((e) => ({
    id: `${e.uid}@${Math.floor(e.inicio / 1000)}`, titulo: e.titulo, inicio: e.inicio, fin: e.fin,
    asistentes: sinMi(e.gente).map((p) => ({ nombre: p.nombre, email: p.email })), lugar: e.lugar,
  }));
}

/** Evento en curso (o que empieza/terminó hace poco): título, nombres e correos de los invitados. */
function eventoActual() {
  const ahora = Date.now();
  const c = eventos.filter((e) => e.inicio <= ahora + 15 * 60e3 && e.fin >= ahora - 5 * 60e3);
  if (!c.length) return null;
  const ev = c.reduce((a, b) => (Math.abs(a.inicio - ahora) <= Math.abs(b.inicio - ahora) ? a : b));
  const gente = sinMi(ev.gente);
  return { titulo: ev.titulo, asistentes: [...new Set(gente.map((p) => p.nombre).filter(Boolean))], correos: gente.map((p) => p.email).filter(Boolean) };
}

/** Avisa 1 minuto antes de las reuniones con invitados o enlace de videollamada. */
function revisar() {
  const ahora = Date.now();
  for (const e of eventos) {
    const id = `${e.uid}@${e.inicio}`;
    if (avisados.has(id) || e.inicio < ahora - 60e3 || e.inicio > ahora + 75e3) continue;
    const t = [e.lugar, e.notas, e.url].join(" ").toLowerCase();
    const video = ["teams.microsoft", "meet.google", "zoom.us", "webex", "whereby", "jitsi"].some((x) => t.includes(x));
    if (!video && sinMi(e.gente).length < 1) continue;
    avisados.add(id);
    const falta = (e.inicio - ahora) / 1000;
    const titulo = opciones.f(falta > 20 ? "«{x}» empieza en 1 minuto" : "«{x}» está empezando", e.titulo);
    opciones.alAviso?.(titulo, "Cuando entres, un clic y empiezo a grabar.", e.titulo);
  }
}

function estado() { return !url ? "sin_preguntar" : ultimoError ? "no" : "si"; }

/** Conecta (o desconecta, con url vacía) la dirección iCal. Devuelve { ok, eventos | error }. */
async function conectar(nueva) {
  if (!nueva) { url = null; guardarURL(null); eventos = []; ultimoError = ""; return { ok: true, eventos: 0 }; }
  if (!/^(https|webcal):\/\//i.test(nueva)) return { ok: false, error: opciones.t?.("La dirección debe empezar con https:// (la dirección secreta en formato iCal).") || "URL inválida" };
  const antes = url;
  url = nueva;
  try {
    const n = await actualizar();
    guardarURL(nueva); ultimoError = "";
    return { ok: true, eventos: n };
  } catch (e) {
    url = antes;
    return { ok: false, error: `${opciones.t?.("No pude leer el calendario") || "Error"}: ${e.message || e}` };
  }
}

function iniciar(o) {
  opciones = o;
  url = leerURL();
  const refrescar = () => actualizar().then(() => { ultimoError = ""; opciones.alCambio?.(); }).catch((e) => { ultimoError = String(e.message || e); });
  refrescar();
  setInterval(refrescar, 10 * 60e3);
  setInterval(revisar, 30e3);
}

module.exports = { iniciar, conectar, agendaJS, eventoActual, estado, conectado: () => !!url };
