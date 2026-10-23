// Detecta cuándo una app de reuniones empieza o deja de usar el micrófono (como en Mac, sin leer audio).
// Windows: el registro de privacidad del micrófono (LastUsedTimeStop = 0 mientras una app lo usa).
// Linux: los flujos de grabación activos de PulseAudio/PipeWire (pactl list source-outputs).
const { execFile } = require("child_process");
const { app } = require("electron");
const { ES_WIN } = require("./rutas");

/** Palabra clave en la ruta o el nombre de la app → nombre amigable. */
const APPS = [
  [/teams/i, "Microsoft Teams"], [/zoom/i, "Zoom"], [/slack/i, "Slack"], [/webex|cisco/i, "Webex"], [/discord/i, "Discord"],
  [/whatsapp/i, "WhatsApp"], [/skype/i, "Skype"], [/msedge|edge/i, "Edge / Meet"], [/chrome|chromium/i, "Chrome / Meet"],
  [/firefox/i, "Firefox / Meet"], [/brave/i, "Brave / Meet"], [/opera/i, "Opera / Meet"], [/vivaldi/i, "Vivaldi / Meet"], [/signal/i, "Signal"],
  [/telegram/i, "Telegram"], [/jitsi/i, "Jitsi"],
];
const nombre = (id) => APPS.find(([rx]) => rx.test(id))?.[1] || null;

function ejecutar(cmd, args) {
  return new Promise((ok) => execFile(cmd, args, { windowsHide: true, timeout: 5000, maxBuffer: 4 << 20 }, (e, out) => ok(e ? "" : String(out))));
}

/** Identificadores de las apps que están usando el micrófono ahora. */
async function appsUsandoMicrofono() {
  if (ES_WIN) {
    const base = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone";
    const out = await ejecutar("reg", ["query", base, "/s", "/v", "LastUsedTimeStop"]);
    const activas = [];
    let clave = "";
    for (const linea of out.split(/\r?\n/)) {
      if (linea.startsWith("HKEY_")) clave = linea.trim();
      else if (/LastUsedTimeStop\s+REG_QWORD\s+0x0\s*$/i.test(linea) && clave) activas.push(clave.split("\\").pop().replace(/#/g, "\\"));
    }
    return activas.filter((a) => !/minuta|electron/i.test(a));
  }
  const out = await ejecutar("pactl", ["list", "source-outputs"]);
  const propios = new Set(app.getAppMetrics().map((m) => String(m.pid)));
  const activas = [];
  for (const bloque of out.split(/\n(?=Source Output #)/)) {
    const prop = (k) => (bloque.match(new RegExp(`${k.replace(/\./g, "\\.")} = "([^"]*)"`)) || [])[1] || "";
    const pid = prop("application.process.id"), bin = prop("application.process.binary"), nom = prop("application.name");
    if (!bin && !nom) continue;
    if (propios.has(pid) || /^(parec|parecord|pw-record|minuta)$/i.test(bin)) continue;
    // Los navegadores graban también cuando el micrófono está "en espera"; si el flujo está en pausa (corked) no cuenta.
    if (/Corked: yes/.test(bloque)) continue;
    activas.push(`${bin} ${nom}`.trim());
  }
  return activas;
}

class DetectorReuniones {
  constructor() { this.activos = new Set(); this.alDetectar = () => {}; this.alTerminar = () => {}; this.reloj = null; }
  iniciar() { this.reloj = setInterval(() => this.revisar(), 3000); }
  detener() { clearInterval(this.reloj); }
  async revisar() {
    const ahora = new Set(await appsUsandoMicrofono());
    const nuevas = [...ahora].filter((a) => !this.activos.has(a));
    const terminadas = [...this.activos].filter((a) => !ahora.has(a));
    this.activos = ahora;
    const nombresAhora = new Set([...ahora].map(nombre).filter(Boolean));
    for (const n of new Set(terminadas.map(nombre).filter(Boolean))) if (!nombresAhora.has(n)) this.alTerminar(n);
    const primera = nuevas.map(nombre).find(Boolean);
    if (primera) this.alDetectar(primera);
  }
  async sigueActiva(app) { return (await appsUsandoMicrofono()).some((a) => nombre(a) === app); }
}

module.exports = { DetectorReuniones, appsUsandoMicrofono, nombre };
