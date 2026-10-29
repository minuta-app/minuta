// Capturas de la página y del README (docs/img) desde la vista previa, con los datos ficticios de ui/demo.json.
// Uso: node herramientas/capturas.mjs   (necesita Playwright y Chromium, igual que pruebas/interfaz.mjs; PLAYWRIGHT=/ruta si no está global)
// Genera: notas, desempeno, agenda y logro (español), en-desempeno (inglés; las notas de ejemplo siguen en español) en 2560×1600, y compartir.png (1200×630).
// Míralas antes de subirlas: son lo primero que ve quien llega a Minuta.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMG = path.join(RAIZ, "docs", "img");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT || "playwright");

// Servidor estático de ui/ (solo esa carpeta).
const tipos = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const servidor = http.createServer((pedido, resp) => {
  const ruta = path.join(RAIZ, "ui", decodeURIComponent(new URL(pedido.url, "http://x").pathname));
  if (!ruta.startsWith(path.join(RAIZ, "ui")) || !fs.existsSync(ruta) || fs.statSync(ruta).isDirectory()) { resp.writeHead(404); return resp.end(); }
  resp.writeHead(200, { "Content-Type": tipos[path.extname(ruta)] || "application/octet-stream" });
  fs.createReadStream(ruta).pipe(resp);
}).listen(0);
const BASE = `http://localhost:${servidor.address().port}/index.html`;

const navegador = await chromium.launch();
async function pagina(consulta = "") {
  const p = await navegador.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, timezoneId: "America/Santiago" });
  // Hora fija (un martes a media mañana, cerca de las reuniones de ejemplo) para que la agenda no dependa de cuándo se corre.
  await p.clock.setFixedTime(new Date("2026-10-20T10:48:00-03:00"));
  p.on("pageerror", (e) => { throw new Error(`error de JavaScript: ${e.message}`); });
  // Sin red: el catálogo y las versiones responden vacío, como en las pruebas.
  await p.route(/^https?:\/\/(?!localhost)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await p.goto(BASE + consulta);
  await p.waitForFunction(() => window.Minuta && window.Minuta._probar);
  await p.waitForTimeout(600);
  return p;
}
const ir = async (p, cambio, espera = 900) => { await p.evaluate(cambio); await p.waitForTimeout(espera); };
const jpg = (p, nombre) => p.screenshot({ path: path.join(IMG, nombre), type: "jpeg", quality: 86 });
// La nota de ejemplo más completa (la primera de demo.json) y un universo por captura, para mostrar varios.
const vista = (tema, cambios) => `window.Minuta._probar(E => { E.temaId = ${JSON.stringify(tema)}; E.sel = E.notas[0].ruta; E.galeria = false; ${cambios} })`;

for (const [prefijo, consulta] of [["", ""], ["en-", "?idioma=en"]]) {
  const p = await pagina(consulta);
  if (!prefijo) {
    await ir(p, vista("starwars", "E.seccion = 'reuniones'; E.vista = 'puntos';"));
    await jpg(p, "notas.jpg");
  }
  await ir(p, vista("harrypotter", "E.seccion = 'reuniones'; E.vista = 'feedback';"));
  await jpg(p, `${prefijo}desempeno.jpg`);
  if (!prefijo) {
    await ir(p, vista("marvel", "E.seccion = 'agenda';"));
    await jpg(p, "agenda.jpg");
    await ir(p, vista("marvel", "E.seccion = 'logros';"));
    const logro = await p.$('[data-revivir="equilibrio"]') || await p.$("[data-revivir]");
    if (!logro) throw new Error("no hay logros desbloqueados en demo.json para la captura del logro");
    await logro.click();
    await p.waitForTimeout(1600);
    await jpg(p, "logro.jpg");
  }
  await p.close();
}

// Imagen para compartir (Open Graph / Twitter / social preview de GitHub): 1200×630, con la captura de las notas recién hecha.
const captura = fs.readFileSync(path.join(IMG, "notas.jpg")).toString("base64");
const tarjeta = await navegador.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await tarjeta.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; font-family: Inter, system-ui, sans-serif; color: #f3f1ec;
    background: radial-gradient(900px 500px at 0% 0%, #2a2116 0%, transparent 60%), radial-gradient(700px 500px at 100% 100%, #2a1416 0%, transparent 60%), #0d0c12; }
  .marca { position: absolute; left: 64px; top: 58px; display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 30px; letter-spacing: -0.01em; }
  .punto { width: 30px; height: 30px; border-radius: 50%; background: #ff6b4a; box-shadow: 0 0 0 5px rgba(255,107,74,.25); }
  h1 { position: absolute; left: 64px; top: 140px; width: 600px; font-size: 54px; line-height: 1.08; font-weight: 800; letter-spacing: -0.025em; }
  .chips { position: absolute; left: 64px; bottom: 60px; width: 560px; display: flex; flex-wrap: wrap; gap: 10px; }
  .chips span { border: 1px solid #2c2b38; background: #1b1a24; border-radius: 999px; padding: 9px 16px; font-size: 19px; font-weight: 500; }
  .chips i { display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #3ddc84; margin-right: 8px; }
  .captura { position: absolute; left: 700px; top: 112px; width: 640px; border-radius: 14px; border: 1px solid #3a3946;
    box-shadow: 0 30px 80px rgba(0,0,0,.6); transform: perspective(1600px) rotateY(-14deg) rotateX(4deg); transform-origin: left center; }
</style></head><body>
  <div class="marca"><span class="punto"></span>Minuta</div>
  <h1>Sal de cada reunión con las notas listas y sabiendo cómo mejorar</h1>
  <div class="chips"><span><i></i>Privada: todo en tu computador</span><span>Gratis y abierta</span><span>Claude, ChatGPT o Gemini</span><span>Mac · Windows · Linux</span></div>
  <img class="captura" src="data:image/jpeg;base64,${captura}" alt="">
</body></html>`);
await tarjeta.waitForTimeout(300);
await tarjeta.screenshot({ path: path.join(IMG, "compartir.png") });

await navegador.close();
servidor.close();
console.log("Listo: docs/img (notas, desempeno, agenda, logro, en-desempeno, compartir.png)");
