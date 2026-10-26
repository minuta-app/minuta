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
  for (let paso = 0; paso < 8; paso++) {  // 0 = idioma, 1 = hola … 7 = listo
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

// Bienvenida: lo primero es el idioma (antes de cualquier otro texto), y elegir English deja el resto en inglés.
{
  const p = await pagina("?bienvenida");
  // Anota lo que la interfaz le manda a la app (como el puente de Electron), para ver que se guardó idioma_ui.
  await p.evaluate(() => { window._enviados = []; window.minutaHost = { enviar: (m) => window._enviados.push(m) }; });
  const inicio = await p.evaluate(() => ({
    pantalla: !!document.querySelector(".bienvenida.bv-idioma"),
    titulo: document.querySelector("#bv-idioma-titulo")?.textContent.replace(/\s+/g, " ").trim(),
    botones: [...document.querySelectorAll(".bv-lengua b")].map((b) => b.textContent),
    foco: document.activeElement?.dataset?.bvLengua || "",
    otroTexto: !!document.querySelector(".bv-cuerpo, .bv-acc, .act-banner"),
    estado: window.Minuta.estado().bv?.paso,
  }));
  if (!inicio.pantalla || inicio.estado !== 0) falla(`con ?bienvenida la primera pantalla no es la de idioma (paso ${inicio.estado})`);
  if (inicio.titulo !== "Elige tu idioma · Choose your language") falla(`título de la pantalla de idioma: ${JSON.stringify(inicio.titulo)}`);
  if (JSON.stringify(inicio.botones) !== JSON.stringify(["Español", "English"])) falla(`botones de idioma: ${JSON.stringify(inicio.botones)}`);
  if (!inicio.foco) falla("la pantalla de idioma no deja el foco en el idioma sugerido");
  if (inicio.otroTexto) falla("antes de elegir idioma se ve otro paso o un aviso");
  // Con teclado: flecha para pasar a English y Enter para elegir.
  await p.focus('[data-bv-lengua="es"]');
  await p.keyboard.press("ArrowRight");
  if ((await p.evaluate(() => document.activeElement?.dataset?.bvLengua)) !== "en") falla("la flecha no pasa de Español a English");
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => window.Minuta.estado().bv?.paso === 1, null, { timeout: 4000 }).catch(() => falla("elegir English no avanzó al paso siguiente"));
  await p.waitForTimeout(250);
  const despues = await p.evaluate(() => ({
    titulo: document.querySelector(".bv-cuerpo h2")?.textContent, boton: document.querySelector('.bv-acc [data-bv-paso="1"]')?.textContent,
    guardado: window._enviados.some((m) => m.accion === "perfil" && m.cambios?.idioma_ui === "en"),
    idiomaUi: window.Minuta.estado().perfil?.idioma_ui, bvIdioma: window.Minuta.estado().bv?.perfil?.idioma_ui, codigo: window.Minuta.estado().idioma.codigo, lang: document.documentElement.lang,
  }));
  if (despues.titulo !== "Welcome to Minuta" || !/^Next/.test(despues.boton || "")) falla(`después de elegir English el paso siguiente no está en inglés: ${JSON.stringify(despues)}`);
  if (!despues.guardado || despues.idiomaUi !== "en" || despues.bvIdioma !== "en" || despues.codigo !== "en") falla(`no quedó guardado idioma_ui = en: ${JSON.stringify(despues)}`);
  await p.close();
  console.log("  ✓ Bienvenida: primero el idioma; English cambia lo que sigue y queda en idioma_ui");
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
