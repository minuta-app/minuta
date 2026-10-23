// Dónde vive cada cosa. Igual que en Mac: los datos del usuario en ~/minuta (nunca dentro de la app)
// y el código (bin/, ui/, universos/) dentro de la app, salvo en una instalación de desarrollo.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { app } = require("electron");

const ES_WIN = process.platform === "win32";
const PLATAFORMA = ES_WIN ? "windows" : process.platform === "darwin" ? "mac" : "linux";
/** Carpeta de escritorio/vendor (mismos nombres que usa electron-builder: linux, win). */
const VENDOR = ES_WIN ? "win" : PLATAFORMA;
const HOME = os.homedir();
/** Datos del usuario: perfil, universos descargados, modelos, grabaciones. */
const BASE = path.join(HOME, "minuta");
/** Raíz del repo cuando se corre sin empaquetar (escritorio/src → raíz). */
const REPO = path.resolve(__dirname, "..", "..");

/** Código que usa la app: ~/minuta si es un checkout de git (desarrollo), si no el que viene dentro de la app. */
function recursos() {
  if (fs.existsSync(path.join(BASE, ".git")) && fs.existsSync(path.join(BASE, "ui", "index.html"))) return BASE;
  if (app.isPackaged) return path.join(process.resourcesPath, "minuta");
  return REPO;
}

/** whisper-cli, separador de voces y sus modelos (vienen con la app). */
function herramientas() {
  return app.isPackaged ? path.join(process.resourcesPath, "herramientas") : path.join(REPO, "escritorio", "vendor", VENDOR, "herramientas");
}

/** Python portátil que viene con la app; en desarrollo, el del sistema. */
function python() {
  const dentro = app.isPackaged ? path.join(process.resourcesPath, "python") : path.join(REPO, "escritorio", "vendor", VENDOR, "python");
  const candidatos = ES_WIN ? [path.join(dentro, "python.exe")] : [path.join(dentro, "bin", "python3")];
  const hallado = candidatos.find((p) => fs.existsSync(p));
  return hallado || (ES_WIN ? "python" : "python3");
}

/** "~/Documents/x" → ruta absoluta; y al revés, para guardar en el perfil sin el nombre de usuario del equipo. */
const expandir = (r) => (r.startsWith("~") ? path.join(HOME, r.slice(1)) : r);
const corta = (r) => (r.startsWith(HOME) ? "~" + r.slice(HOME.length).replace(/\\/g, "/") : r);

function asegurarCarpetas() {
  for (const d of ["", "temas", "models", "grabaciones", "idiomas", "mensajes"]) fs.mkdirSync(path.join(BASE, d), { recursive: true });
}

module.exports = { ES_WIN, PLATAFORMA, HOME, BASE, REPO, recursos, herramientas, python, expandir, corta, asegurarCarpetas };
