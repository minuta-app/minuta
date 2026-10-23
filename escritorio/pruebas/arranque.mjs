// Prueba de humo: abre la app (Linux, pantalla virtual), saca capturas de la bienvenida y del panel.
// Uso: xvfb-run -a node pruebas/arranque.mjs <carpeta-de-capturas>
import { createRequire } from "module";
// Playwright puede estar instalado global (no es dependencia de la app).
const requerir = createRequire(import.meta.url);
const { _electron: electron } = requerir(requerir.resolve("playwright", { paths: [process.cwd(), ...(process.env.NODE_PATH || "").split(":")] }));
import fs from "fs";
import path from "path";

const salida = process.argv[2] || "/tmp/minuta-capturas";
fs.mkdirSync(salida, { recursive: true });
const casa = process.env.HOME;
const app = await electron.launch({
  executablePath: path.resolve("node_modules/electron/dist/electron"),
  args: ["--no-sandbox", "."],
  env: { ...process.env, MINUTA_PRUEBAS: "1" },
});
const errores = [];
app.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
await app.firstWindow();
const buscar = async (prueba) => { for (let i = 0; i < 40; i++) { const w = app.windows().find((x) => prueba(x.url())); if (w) return w; await new Promise((r) => setTimeout(r, 250)); } throw new Error("no apareció la ventana"); };
const ventana = await buscar((u) => u === "minuta://ui/index.html");
const panel = await buscar((u) => u.endsWith("#panel"));
ventana.on("pageerror", (e) => errores.push(e.message));
ventana.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
await ventana.waitForTimeout(3500);
await ventana.screenshot({ path: `${salida}/1-bienvenida.png` });
console.log("título:", await ventana.title(), "| clases:", await ventana.evaluate(() => document.documentElement.className));
console.log("bienvenida abierta:", await ventana.evaluate(() => !!document.querySelector(".bv, .bienvenida, [class*='bv-']")));
// Panel de la bandeja
await app.evaluate(() => global.minutaPruebas.mostrarPanel());
await panel.waitForTimeout(1200);
await panel.screenshot({ path: `${salida}/2-panel.png` });
// Alerta de reunión detectada
await app.evaluate(() => global.minutaPruebas.ACCIONES.probarAviso());
await new Promise((r) => setTimeout(r, 1500));
const alerta = app.windows().find((x) => x.url().endsWith("alerta.html"));
if (alerta) await alerta.screenshot({ path: `${salida}/3-alerta.png` });
// Preferencias (avisos y calendario iCal en Windows/Linux)
await app.evaluate(() => global.minutaPruebas.ACCIONES.terminarBienvenida({ perfil: { nombre: "Ana" }, tema: "starwars" }));
await ventana.evaluate(() => window.Minuta._probar((E) => { E.bv = null; E.seccion = "preferencias"; }));
await ventana.waitForTimeout(800);
await ventana.evaluate(() => document.querySelector(".av")?.scrollIntoView());
await ventana.waitForTimeout(400);
await ventana.screenshot({ path: `${salida}/4-preferencias.png` });
fs.writeFileSync(`${salida}/errores.json`, JSON.stringify(errores, null, 1));
await app.close();
console.log("errores:", errores.length, errores.slice(0, 5));
