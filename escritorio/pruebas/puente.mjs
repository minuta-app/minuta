// El puente sobre la pieza «host-escritorio» (Linux, pantalla virtual): las acciones declaradas en acciones.json (preguntar,
// gimnasio, probarIA) con sus datos validados y su eco, el panel de la bandeja agregado al puente del host, la grabadora oculta
// (minuta://app/, con su AudioWorklet) y que lo que guarda Chromium siga en la carpeta de siempre (safeStorage).
// Uso: HOME=$(mktemp -d) xvfb-run -a node pruebas/puente.mjs   (desde escritorio/, con Electron instalado)
import { createRequire } from "module";
import path from "path";
const requerir = createRequire(import.meta.url);
const { _electron: electron } = requerir(requerir.resolve("playwright", { paths: [process.cwd(), ...(process.env.NODE_PATH || "").split(":")] }));

const app = await electron.launch({ executablePath: path.resolve("node_modules/electron/dist/electron"), args: ["--no-sandbox", "."], env: { ...process.env, MINUTA_PRUEBAS: "1" } });
const fallas = [];
const revisar = (nombre, ok, detalle) => { console.log(`${ok ? "✓" : "✗"} ${nombre}${ok ? "" : ` → ${JSON.stringify(detalle)}`}`); if (!ok) fallas.push(nombre); };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const buscar = async (p) => { for (let i = 0; i < 40; i++) { const w = app.windows().find((x) => p(x.url())); if (w) return w; await esperar(250); } throw new Error("no apareció la ventana"); };
const visor = await buscar((u) => u === "minuta://ui/index.html");
const grabadora = await buscar((u) => u.endsWith("grabadora.html"));
await visor.waitForTimeout(2500);

/** Manda una acción desde el visor y espera la respuesta `funcion`. */
async function pedir(accion, datos, funcion, ms = 6000) {
  await visor.evaluate(({ accion, datos, funcion }) => {
    window.__r = null;
    window.Minuta[funcion] = (r) => { window.__r = r; };
    window.minutaEscritorio.enviar({ accion, datos });
  }, { accion, datos, funcion });
  for (let t = 0; t < ms; t += 250) { const r = await visor.evaluate(() => window.__r); if (r) return r; await esperar(250); }
  return null;
}

const p = await pedir("preguntar", { id: "q1", pregunta: "¿Qué acordamos?" }, "respuesta");
revisar("preguntar (declarada): responde con el eco del id", p?.ok === true && p.id === "q1" && typeof p.respuesta === "string", p);
const g = await pedir("gimnasio", { modo: "otro", entrada: {} }, "gym");
revisar("gimnasio con un modo que no existe: no corre (codigo «datos»)", g?.ok === false && g.codigo === "datos", g);
const i = await pedir("probarIA", { ia: "codex" }, "iaProbada", 15000);
revisar("probarIA (pieza «ia»): responde por sí sola", i && i.ia === "codex" && typeof i.ok === "boolean", i);
const w = await grabadora.evaluate(async () => { try { await new AudioContext().audioWorklet.addModule("pcm.js"); return "ok"; } catch (e) { return e.message; } });
revisar("grabadora: minuta://app/pcm.js carga como AudioWorklet", w === "ok", w);

await app.evaluate(() => global.minutaPruebas.mostrarPanel());
const panel = await buscar((u) => u.endsWith("#panel"));
await panel.waitForTimeout(800);
await panel.evaluate(() => window.minutaEscritorio.enviar({ accion: "copiar", datos: { texto: "hola desde el panel" } }));
await esperar(500);
revisar("panel: su puente llega a lo que trae el host (copiar)", (await app.evaluate(({ clipboard }) => clipboard.readText())) === "hola desde el panel");
// Una declarada pedida desde el panel le responde al panel (host.ventanas.agregar), no al visor.
await visor.evaluate(() => { window.__gymVisor = null; window.Minuta.gym = (r) => { window.__gymVisor = r; }; });
await panel.evaluate(() => { window.__gym = null; window.Minuta.gym = (r) => { window.__gym = r; }; window.minutaEscritorio.enviar({ accion: "gimnasio", datos: { modo: "otro", entrada: {} } }); });
let gp = null;
for (let t = 0; t < 6000 && !gp; t += 250) { gp = await panel.evaluate(() => window.__gym); if (!gp) await esperar(250); }
revisar("panel: una declarada le responde al panel, no al visor", gp?.codigo === "datos" && !(await visor.evaluate(() => window.__gymVisor)), gp);
const datos = await app.evaluate(({ app }) => app.getPath("userData"));
revisar("userData de siempre (~/.config/Minuta): safeStorage sigue leyendo lo cifrado antes", datos === path.join(process.env.HOME, ".config", "Minuta"), datos);

await app.close();
if (fallas.length) { console.error(`✗ ${fallas.length} fallas`); process.exit(1); }
console.log("✓ Puente en orden");
