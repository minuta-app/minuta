// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Pieza «host-ui»: el puente entre la interfaz web y la app que la contiene. La interfaz siempre dice
// host.enviar(accion, datos) y la app responde llamando window.<Global>.<funcion>(json). Lo mismo en Mac (WKWebView),
// Windows y Linux (Electron, preload), el celular (Capacitor) y el navegador (vista previa: responde `simular`).
// Sin dependencias. Script clásico (window.PiezaHost) o Node (require). Sin eval ni código en línea.
//
//   const host = PiezaHost.crearHost({ nombre: "ana", global: "Ana", simular: { listo: (d, c) => c.responder("estado", DEMO) } });
//   host.responder({ estado(e) { … }, iaProbada(r) { … } });   // queda en window.Ana
//   host.enviar("probarIA", { ia: "claude" });
//   host.plataforma   // "mac" | "windows" | "linux" | "movil" | "web"
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === "object" && module.exports) module.exports = m;
  else raiz.PiezaHost = m;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const NOMBRE = /^[a-z][a-z0-9]{0,30}$/;
  const GLOBAL = /^[A-Z][A-Za-z0-9]{0,30}$/;
  const ACCION = /^[A-Za-z][A-Za-z0-9]{0,40}$/;
  const PLATAFORMAS = ["mac", "windows", "linux", "movil", "web"];
  const PROHIBIDAS = new Set(["__proto__", "constructor", "prototype"]);

  /** Lo que viaja por el puente es JSON: igual en la vista previa, así la simulación nunca comparte objetos con la interfaz. */
  function comoJSON(v) {
    if (v === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(v)); } catch { return {}; }
  }
  const esObjeto = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

  /** Las respuestas de vista previa que toda app necesita igual. Se suman con `simular: { ...PiezaHost.simulacionesComunes(), … }`. */
  function simulacionesComunes(opciones = {}) {
    const espera = Number.isFinite(opciones.espera) ? opciones.espera : 400;
    return {
      probarIA: (d, c) => c.luego(espera, () => c.responder("iaProbada", { ia: d.ia, ok: true })),
      buscarActualizacion: (d, c) => c.luego(espera, () => c.responder("actualizacionRevisada", { hay: false, version: "", notas: "", texto: "", valores: { v: "" } })),
      actualizar: (d, c) => c.luego(espera, () => c.responder("actualizacionProgreso",
        { paso: "error", codigo: "vistaPrevia", texto: "En la vista previa no hay nada que actualizar.", valores: {}, total: 3 })),
      abrirEnlace: (d, c) => { if (/^https:\/\/[^\s]+$/.test(String(d.url || ""))) c.ventana?.open?.(d.url, "_blank", "noopener"); },
      copiar: (d, c) => { try { c.ventana?.navigator?.clipboard?.writeText(String(d.texto ?? "")).catch(() => {}); } catch { /* sin portapapeles */ } },
    };
  }

  /**
   * crearHost({nombre, global, simular, ventana?, plano?, canales?})
   *   nombre   id de la app en minúsculas («ana»): el manejador de WKWebView (`webkit.messageHandlers.ana`), el puente de Electron
   *            (`window.anaEscritorio`), el del celular (`window.anaMovil`) y la plataforma (`window.ANA_HOST`).
   *   global   el objeto de respuestas («Ana» → `window.Ana`).
   *   simular  función (accion, datos, ctx) o mapa {accion: (datos, ctx) => …} para la vista previa del navegador.
   *   plano    `true` manda `{accion, ...datos}` en vez de `{accion, datos}` (solo mientras la app nativa no cambie a la forma común).
   *   canales  `{escritorio, movil}` si el preload usa otro nombre (`{escritorio: "anaHost"}`).
   */
  function crearHost(opciones = {}) {
    const { nombre, global } = opciones;
    if (!NOMBRE.test(String(nombre || ""))) throw new Error("host-ui: «nombre» va en minúsculas, sin espacios (por ejemplo «ana»).");
    if (!GLOBAL.test(String(global || ""))) throw new Error("host-ui: «global» empieza con mayúscula (por ejemplo «Ana»).");
    const ventana = opciones.ventana || (typeof window !== "undefined" ? window : globalThis);
    const canales = { escritorio: `${nombre}Escritorio`, movil: `${nombre}Movil`, ...(opciones.canales || {}) };
    for (const c of Object.values(canales)) if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(String(c))) throw new Error("host-ui: canal no válido.");
    const declarada = ventana[`${nombre.toUpperCase()}_HOST`];
    const plataforma = PLATAFORMAS.includes(declarada) ? declarada : "web";
    if (ventana.document?.documentElement?.dataset) ventana.document.documentElement.dataset.host = plataforma;

    const respuestas = ventana[global] && typeof ventana[global] === "object" ? ventana[global] : (ventana[global] = {});
    const simular = opciones.simular;
    const pendientes = new Set();

    /** Llama una respuesta como lo haría la app (con una copia JSON). Una función que no existe se ignora. */
    function llamar(funcion, json) {
      const f = respuestas[funcion];
      if (PROHIBIDAS.has(funcion) || typeof f !== "function") { ventana.console?.warn?.(`host-ui: window.${global}.${funcion} no existe`); return; }
      return f.call(respuestas, comoJSON(json));
    }
    function luego(ms, f) {
      const t = setTimeout(() => { pendientes.delete(t); f(); }, Math.max(0, ms | 0));
      pendientes.add(t);
      return t;
    }
    const contexto = { responder: llamar, luego, ventana, plataforma };

    function enviar(accion, datos = {}) {
      if (!ACCION.test(String(accion || ""))) throw new Error(`host-ui: acción no válida: ${String(accion).slice(0, 40)}`);
      const d = esObjeto(datos) ? comoJSON(datos) : {};
      const msg = opciones.plano ? { ...d, accion } : { accion, datos: d };
      const wk = ventana.webkit?.messageHandlers?.[nombre];
      if (wk) return wk.postMessage(msg);
      const escritorio = ventana[canales.escritorio];
      if (escritorio?.enviar) return escritorio.enviar(msg);
      const movil = ventana[canales.movil];
      if (movil?.enviar) return movil.enviar(msg);
      if (typeof simular === "function") return simular(accion, d, contexto);
      if (esObjeto(simular) && Object.prototype.hasOwnProperty.call(simular, accion) && typeof simular[accion] === "function") return simular[accion](d, contexto);
      return undefined;  // en la vista previa, una acción sin simular no hace nada (igual que el `default: break` de la app)
    }

    /** Suma funciones a window.<Global> (las que llama la app). Nunca reemplaza el objeto: la app puede tener una referencia. */
    function responder(funciones) {
      for (const [k, f] of Object.entries(funciones || {})) {
        if (PROHIBIDAS.has(k) || typeof f !== "function") continue;
        respuestas[k] = f;
      }
      return respuestas;
    }

    return {
      plataforma, nombre, global,
      esWeb: plataforma === "web",
      esEscritorio: plataforma === "windows" || plataforma === "linux",
      esMovil: plataforma === "movil",
      enviar, responder, llamar, luego,
      /** Para las pruebas: cancela lo que la simulación dejó esperando. */
      cancelarPendientes() { for (const t of pendientes) clearTimeout(t); pendientes.clear(); },
    };
  }

  return { crearHost, simulacionesComunes, PLATAFORMAS };
});
