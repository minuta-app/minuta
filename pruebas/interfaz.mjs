// Pruebas de la interfaz (ui/) en un navegador real, con los datos ficticios de ui/demo.json.
// Uso: node pruebas/interfaz.mjs   (necesita Playwright: npm i --no-save playwright && npx playwright install chromium)
// Revisa que:
//   1. ninguna vista tire errores de JavaScript (español e inglés, ventana y panel);
//   2. limpiar nombres dé lo mismo que en Python (pruebas/casos_nombres.json);
//   3. todo texto de la interfaz tenga traducción en ui/idiomas/en.json (los datos de las notas y universos no cuentan);
//   4. el botón principal de cada universo se lea (contraste del texto sobre su fondo).
// Con CAPTURAS=carpeta guarda una captura de cada vista y universo para revisarlas a ojo.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requerir = createRequire(import.meta.url);
const { chromium } = requerir(process.env.PLAYWRIGHT || "playwright");
const CAPTURAS = process.env.CAPTURAS || "";
const errores = [];
const falla = (m) => { errores.push(m); console.log("  ✗ " + m); };

// Servidor estático de ui/ (y del catálogo local si existe, para la galería).
const tipos = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const servidor = http.createServer((pedido, resp) => {
  const ruta = path.join(RAIZ, "ui", decodeURIComponent(new URL(pedido.url, "http://x").pathname));
  if (!ruta.startsWith(path.join(RAIZ, "ui")) || !fs.existsSync(ruta) || fs.statSync(ruta).isDirectory()) { resp.writeHead(404); return resp.end(); }
  resp.writeHead(200, { "Content-Type": tipos[path.extname(ruta)] || "application/octet-stream" });
  fs.createReadStream(ruta).pipe(resp);
}).listen(0);
const BASE = `http://localhost:${servidor.address().port}/index.html`;

// Universos: los incluidos (+ los del catálogo si está al lado, como en el desarrollo).
const universos = [];
for (const dir of [path.join(RAIZ, "universos"), path.join(RAIZ, "..", "minuta-catalogo", "universos")]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".json") && !f.startsWith("_") && f !== "index.json") {
    const u = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (!universos.some((x) => x.id === u.id)) universos.push(u);
  }
}
// Textos que son datos (notas de ejemplo, universos, categorías ficticias): no se traducen.
const datos = fs.readFileSync(path.join(RAIZ, "ui", "demo.json"), "utf8") + universos.map((u) => JSON.stringify(u)).join("\n");
// Palabras que vienen de los datos (nombres, títulos, universos) o que no se traducen (marcas, unidades).
const vocabulario = new Set([...(datos.toLowerCase().match(/\p{L}+/gu) || []), "min", "h", "claude", "chatgpt", "codex", "gemini", "github", "gitlab", "obsidian", "minuta", "color", "ia", "xp", "ok"]);
// Nombres propios, iniciales, idiomas, rutas y dominios: tampoco se traducen.
const NOMBRE_PROPIO = /^(?:[\p{Lu}][\p{L}.]*(?: [\p{Lu}][\p{L}.]*){0,3}|[\p{Lu}]{1,3}|[\p{Emoji}\s]*[\p{Lu}][\p{L}]+(?: \(.+\))?)$/u;
const RUTA_O_DOMINIO = /[~/]|\b[\w-]+\.(?:cl|com|us|json|cpp|md)\b/;
const esDato = (t) => NOMBRE_PROPIO.test(t) || RUTA_O_DOMINIO.test(t) || datos.includes(t) || datos.includes(JSON.stringify(t).slice(1, -1)) || (t.toLowerCase().match(/\p{L}+/gu) || []).every((w) => vocabulario.has(w));
const casos = JSON.parse(fs.readFileSync(path.join(RAIZ, "pruebas", "casos_nombres.json"), "utf8"));

const navegador = await chromium.launch();
async function pagina(consulta = "", hash = "", ancho = 1180) {
  const p = await navegador.newPage({ viewport: { width: ancho, height: 800 } });
  p.on("pageerror", (e) => falla(`error de JavaScript (${consulta || "es"}${hash}): ${e.message}`));
  await p.route(/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await p.addInitScript(() => { window._faltantes = new Set(); });
  await p.goto(BASE + consulta + hash);
  await p.waitForFunction(() => window.Minuta && window.Minuta._probar);
  await p.waitForTimeout(600);
  return p;
}
const ir = (p, f) => p.evaluate(f).then(() => p.waitForTimeout(250));

// Vistas a recorrer: (nombre, cambios de estado)
const VISTAS = [
  ["resumen", "E => { E.seccion = 'reuniones'; E.vista = 'puntos'; }"],
  ["desempeño", "E => { E.seccion = 'reuniones'; E.vista = 'feedback'; }"],
  ["transcripción", "E => { E.seccion = 'reuniones'; E.vista = 'transcripcion'; }"],
  ["agenda", "E => { E.seccion = 'agenda'; }"],
  ["personas", "E => { E.seccion = 'personas'; }"],
  ["foco", "E => { E.seccion = 'progreso'; }"],
  ["logros", "E => { E.seccion = 'logros'; }"],
  ["preferencias", "E => { E.seccion = 'preferencias'; }"],
  ["galería", "E => { E.seccion = 'reuniones'; E.galeria = true; }"],
  ["comentarios", "E => { E.galeria = false; E.coment = { tipo: 'error', sistema: true }; }"],
  ["corregir con IA", "E => { E.coment = null; E.corrIA = { texto: '', ruta: E.notas[0].ruta }; }"],
  ["borrar", "E => { E.corrIA = null; E.perfil = { ...(E.perfil || {}), respaldo: 'github' }; E.borrar = E.notas[0].ruta; }"],
  ["actualizando", "E => { E.borrar = null; E.act = { hay: true, progreso: { paso: '2', texto: 'Preparando la versión nueva…', total: 3, pct: 40 } }; }"],
];

console.log("Interfaz");
for (const [idioma, consulta] of [["español", ""], ["inglés", "?idioma=en"]]) {
  const p = await pagina(consulta);
  for (const [nombre, cambio] of VISTAS) {
    await ir(p, `window.Minuta._probar(${cambio})`);
    if (CAPTURAS) await p.screenshot({ path: path.join(CAPTURAS, `${idioma}-${nombre}.png`) });
  }
  // Bienvenida, paso por paso (en otra página: se abre con ?bienvenida)
  const pb = await pagina(consulta ? consulta + "&bienvenida" : "?bienvenida");
  await pb.waitForTimeout(400);
  for (let paso = 0; paso < 7; paso++) {
    await ir(pb, `window.Minuta._probar(E => { if (E.bv) E.bv.paso = ${paso}; })`);
    if (CAPTURAS) await pb.screenshot({ path: path.join(CAPTURAS, `${idioma}-bienvenida-${paso}.png`) });
  }
  if (idioma === "inglés") {
    const crudos = [...(await p.evaluate(() => [...window._faltantes])), ...(await pb.evaluate(() => [...window._faltantes]))];
    const faltan = crudos.filter((t) => /\p{L}{2}/u.test(t) && !esDato(t));
    const unicos = [...new Set(faltan)].sort();
    if (unicos.length) falla(`${unicos.length} textos sin traducción en ui/idiomas/en.json:\n      ` + unicos.slice(0, 200).map((t) => JSON.stringify(t)).join("\n      "));
    else console.log("  ✓ Todo traducido al inglés");
  }
  await p.close(); await pb.close();
  console.log(`  ✓ Vistas en ${idioma} sin errores`);
}

// Panel de la barra de menú
{
  const p = await pagina("", "#panel", 372);
  await ir(p, "window.Minuta._probar(E => { E.pan.actualizacion = { hay: true }; })");
  if (CAPTURAS) await p.screenshot({ path: path.join(CAPTURAS, "panel.png"), fullPage: true });
  await p.close();
  console.log("  ✓ Panel sin errores");
}

// Nombres: mismos resultados que Python
{
  const p = await pagina();
  const r = await p.evaluate((c) => ({
    limpiar: c.limpiar.map(([e]) => window.Minuta._pruebas.limpiarNombre(e)),
    participantes: c.participantes.map(([b]) => window.Minuta._pruebas.leerParticipantes(b)),
  }), casos);
  casos.limpiar.forEach(([e, esperado], i) => r.limpiar[i] !== esperado && falla(`limpiarNombre(${JSON.stringify(e)}) = ${JSON.stringify(r.limpiar[i])}, se esperaba ${JSON.stringify(esperado)}`));
  casos.participantes.forEach(([b, esperado], i) => JSON.stringify(r.participantes[i]) !== JSON.stringify(esperado) && falla(`leerParticipantes(${JSON.stringify(b)}) = ${JSON.stringify(r.participantes[i])}, se esperaba ${JSON.stringify(esperado)}`));
  await p.close();
  console.log(`  ✓ Nombres: ${casos.limpiar.length + casos.participantes.length} casos revisados`);
}

// Universos: el botón principal y el de grabar se leen (contraste ≥ 3 entre texto y fondo).
{
  const p = await pagina();
  const contraste = () => {
    const lum = (c) => { const m = c.match(/[\d.]+/g); if (!m) return null; const [r, g, b] = m.slice(0, 3).map((x) => { x = +x / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const el = document.querySelector(".boton-et.principal"); if (!el) return null;
    const cs = getComputedStyle(el), a = lum(cs.color), b = lum(cs.backgroundColor);
    if (a == null || b == null || cs.backgroundColor === "rgba(0, 0, 0, 0)") return null;
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  let revisados = 0;
  for (const u of universos) {
    await ir(p, `window.Minuta._probar(E => { E.seccion = 'reuniones'; E.temas = E.temas.filter((x) => x.id !== ${JSON.stringify(u.id)}).concat([${JSON.stringify(u)}]); E.temaId = ${JSON.stringify(u.id)}; })`);
    const c = await p.evaluate(contraste);
    if (c != null && c < 3) falla(`universo ${u.id}: el botón "Enviar" casi no se lee (contraste ${c.toFixed(2)})`);
    if (CAPTURAS) await p.screenshot({ path: path.join(CAPTURAS, `universo-${u.id}.png`) });
    revisados++;
  }
  await p.close();
  console.log(`  ✓ ${revisados} universos revisados`);
}

await navegador.close();
servidor.close();
if (errores.length) { console.log(`\n✗ ${errores.length} problemas`); process.exit(1); }
console.log("\n✓ Interfaz en orden");
