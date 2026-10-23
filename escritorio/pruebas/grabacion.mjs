// Prueba completa en Linux: bienvenida → grabar (micrófono + audio del sistema) → procesar → nota.
// Requiere PulseAudio con: sink "voz" (su monitor es el micrófono por defecto) y sink por defecto "parlantes".
// Uso: xvfb-run -a node pruebas/grabacion.mjs <pista-yo.wav> <pista-ellos.wav> <modelos> <capturas>
import { createRequire } from "module";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
const requerir = createRequire(import.meta.url);
const { _electron: electron } = requerir(requerir.resolve("playwright", { paths: [process.cwd(), ...(process.env.NODE_PATH || "").split(":")] }));

const [pistaYo, pistaEllos, modelos, salida] = process.argv.slice(2);
fs.mkdirSync(salida, { recursive: true });
const base = path.join(process.env.HOME, "minuta");
fs.mkdirSync(path.join(base, "models"), { recursive: true });
for (const f of fs.readdirSync(modelos)) fs.copyFileSync(path.join(modelos, f), path.join(base, "models", f));

const app = await electron.launch({ executablePath: path.resolve("node_modules/electron/dist/electron"), args: ["--no-sandbox", "."], env: { ...process.env, MINUTA_PRUEBAS: "1" } });
const errores = [];
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
await app.firstWindow();
let ventana;
for (let i = 0; i < 40 && !ventana; i++) { ventana = app.windows().find((x) => x.url() === "minuta://ui/index.html"); await esperar(250); }
ventana.on("pageerror", (e) => errores.push(e.message));

// Bienvenida resuelta como la dejaría el usuario.
await app.evaluate(() => global.minutaPruebas.ACCIONES.terminarBienvenida({ perfil: { nombre: "Ana", nombre_completo: "Ana Pérez", idioma_audio: "es", modelo_whisper: "small", carpeta_notas: "~/Documents/Minuta/Reuniones" }, tema: "starwars" }));
await esperar(800);

console.log("grabando…");
await app.evaluate(() => { global.minutaPruebas.M.titulo = ""; global.minutaPruebas.grabar(); });
await esperar(2500);
const reproducir = (archivo, sink) => new Promise((ok) => spawn("paplay", ["--device", sink, archivo]).on("close", ok));
await Promise.all([reproducir(pistaYo, "voz"), reproducir(pistaEllos, "parlantes")]);
await esperar(1500);
const durante = await app.evaluate(() => ({ fase: global.minutaPruebas.M.fase, estado: global.minutaPruebas.M.estado, carpeta: global.minutaPruebas.M.carpeta }));
console.log("durante:", durante);
await app.evaluate(() => global.minutaPruebas.detener());
console.log("procesando…");
const t0 = Date.now();
for (;;) {
  await esperar(3000);
  const m = await app.evaluate(() => ({ cola: global.minutaPruebas.M.enCola.length, estado: global.minutaPruebas.M.estado, nota: global.minutaPruebas.M.ultimaNota }));
  if (!m.cola) { console.log("listo en", Math.round((Date.now() - t0) / 1000), "s:", m); break; }
  if (Date.now() - t0 > 30 * 60e3) { console.log("demasiado"); break; }
}
const dir = durante.carpeta;
for (const f of fs.readdirSync(dir)) console.log("  ", f, fs.statSync(path.join(dir, f)).size);
console.log(fs.readFileSync(path.join(dir, "procesar.log"), "utf8").split("\n").slice(-12).join("\n"));
await esperar(2500);
await ventana.screenshot({ path: `${salida}/4-nota.png` });
const alerta = app.windows().find((x) => x.url().endsWith("alerta.html"));
if (alerta) await alerta.screenshot({ path: `${salida}/5-alerta-nota.png` });
console.log("errores de la interfaz:", errores);
await app.close();
