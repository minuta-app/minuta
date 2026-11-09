// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Pieza «tema»: sistema, claro, oscuro o vidrio. Pone <html data-pz-modo="claro|oscuro"> (o lo quita para seguir al sistema); los colores
// los resuelve tema.css con light-dark(). El atributo lleva prefijo para no chocar con un `data-tema` de la app (un
// closest("[data-tema]") de la app encontraba <html>). Lo elegido se lee con `tema.valor` y `tema.resuelto()`.
// «Vidrio» sigue al sistema (claro u oscuro) y pone <html data-pz-estilo="vidrio">: paneles translúcidos y esmerilados.
// Temas de otros (un universo, la comunidad): `tema.registrar({id, nombre, base, colores})` los suma al selector. Solo colores #hex
// de los tokens conocidos: se validan y se ponen con CSSOM (style.setProperty), nunca como CSS escrito.
// Trae el selector de Ajustes («Apariencia») como HTML y su manejador de clics.
// Sin dependencias. Script clásico (window.PiezaTema) o Node (require). Sin estilos ni código en línea.
//
//   const tema = PiezaTema.crear({ guardar: (v) => host.enviar("config", { tema: v }) });
//   tema.aplicar(tema.elegir({ config: E.config.tema }));   // ?tema=oscuro gana (vistas previas y capturas)
//   const ajustes = `<h3>Apariencia</h3>${tema.selectorHTML()}`;          // la app lo pinta y lo traduce con traducirDOM
//   document.addEventListener("click", (ev) => { if (tema.manejarClic(ev)) return pintar(); /* … */ });
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === "object" && module.exports) module.exports = m;
  else raiz.PiezaTema = m;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VALORES = ["sistema", "claro", "oscuro", "vidrio"];
  /** El atributo que pone en <html> (tema.css lo lee). Antes de 0.2.0 era data-tema. */
  const ATRIBUTO = "data-pz-modo";
  /** Las opciones del selector, en español (las traduce la app con traducirDOM o T). */
  const OPCIONES = [["sistema", "Como el sistema"], ["claro", "Claro"], ["oscuro", "Oscuro"], ["vidrio", "Vidrio"]];
  const valido = (v) => (VALORES.includes(v) ? v : null);
  /** Los tokens que puede cambiar un tema registrado (cada uno con su par -claro/-oscuro en tema.css). */
  const TOKENS = ["fondo", "panel", "panel-2", "linea", "texto", "texto-suave", "tenue", "acento", "sobre-acento", "rojo", "verde"];
  const MODOS = "claro oscuro".split(" ");   // los dos pares de cada token
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const ID = /^[a-z][a-z0-9-]{1,30}$/;

  /** Un tema de afuera, limpio: {id, nombre, base: "claro"|"oscuro"|"vidrio", colores: {token: "#rrggbb"}}, o null. */
  function validarTema(x) {
    if (!x || typeof x !== "object" || !ID.test(x.id || "") || VALORES.includes(x.id)) return null;
    if (typeof x.nombre !== "string" || !x.nombre.trim() || x.nombre.length > 40) return null;
    const base = ["claro", "oscuro", "vidrio"].includes(x.base) ? x.base : "claro";
    const colores = {};
    for (const [k, v] of Object.entries(x.colores || {})) if (TOKENS.includes(k) && HEX.test(v)) colores[k] = v.toLowerCase();
    return Object.keys(colores).length ? { id: x.id, nombre: x.nombre.trim(), base, colores } : null;
  }

  function crear(opciones = {}) {
    const ventana = opciones.ventana || (typeof window !== "undefined" ? window : globalThis);
    const documento = opciones.documento || ventana.document || null;
    const consulta = ventana.matchMedia ? ventana.matchMedia("(prefers-color-scheme: dark)") : null;
    let valor = "sistema";
    const extra = new Map();   // los temas registrados (universos, comunidad), por id

    const base = (v) => (extra.has(v) ? extra.get(v).base : v);
    const sistema = () => (consulta?.matches ? "oscuro" : "claro");
    const resuelto = () => { const b = base(valor); return b === "sistema" || b === "vidrio" ? sistema() : b; };
    const conocido = (v) => valido(v) || (extra.has(v) ? v : null);

    /** Pone el tema en el documento. Un valor desconocido es «sistema». Devuelve el que quedó. */
    function aplicar(v) {
      valor = conocido(v) || "sistema";
      const html = documento?.documentElement;
      const b = base(valor);
      if (html?.dataset) {
        if (b === "sistema" || b === "vidrio") delete html.dataset.pzModo; else html.dataset.pzModo = b;
        if (b === "vidrio") html.dataset.pzEstilo = "vidrio"; else delete html.dataset.pzEstilo;
        // Los colores de un tema registrado van en el par del modo (--x-claro o --x-oscuro): light-dark() los elige igual.
        for (const k of TOKENS) for (const m of MODOS) html.style?.removeProperty?.(`--${k}-${m}`);
        const t = extra.get(valor);
        if (t) for (const [k, c] of Object.entries(t.colores)) for (const m of MODOS) html.style?.setProperty?.(`--${k}-${m}`, c);
      }
      opciones.alCambiar?.(resuelto(), valor);
      return valor;
    }

    /** ?tema= (vista previa, pruebas, capturas) > lo guardado > sistema. */
    function elegir({ config, url } = {}) {
      let deUrl = url;
      if (deUrl === undefined) { try { deUrl = new URLSearchParams(ventana.location?.search || "").get("tema"); } catch { deUrl = null; } }
      return conocido(deUrl) || conocido(config) || "sistema";
    }

    /** Suma un tema de afuera al selector. Devuelve el tema limpio, o null si no pasó la validación. */
    function registrar(x) {
      const t = validarTema(x);
      if (t) extra.set(t.id, t);
      return t;
    }

    /** El selector de Ajustes: un grupo de tres botones con aria-pressed (estilo .pz-seg de «componentes»). Las etiquetas van en
     *  español: las traduce traducirDOM con el resto de la app (sus inglés vienen en `textos` de la pieza). */
    function selectorHTML() {
      const esc = (s) => String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
      const propios = [...extra.values()].map((t) =>
        `<button type="button" data-pz-tema="${esc(t.id)}" aria-pressed="${valor === t.id}" data-sin-traducir>${esc(t.nombre)}</button>`).join("");
      return `<div class="pz-seg" role="group" aria-label="Apariencia">${OPCIONES.map(([v, n]) =>
        `<button type="button" data-pz-tema="${v}" aria-pressed="${valor === v}">${n}</button>`).join("")}${propios}</div>`;
    }

    /** Un clic en el selector: aplica, guarda y devuelve true. Cualquier otro clic, false. */
    function manejarClic(ev) {
      const b = ev?.target?.closest?.("button[data-pz-tema]");
      if (!b) return false;
      const v = conocido(b.getAttribute("data-pz-tema"));
      if (!v) return false;
      ev.preventDefault?.();
      aplicar(v);
      opciones.guardar?.(v);
      return true;
    }

    /** Avisa cuando el sistema cambia de claro a oscuro (solo importa en «sistema»). Devuelve cómo dejar de escuchar. */
    function escuchar(fn) {
      if (!consulta?.addEventListener) return () => {};
      const f = () => { const b = base(valor); if (b === "sistema" || b === "vidrio") fn(resuelto()); };
      consulta.addEventListener("change", f);
      return () => consulta.removeEventListener("change", f);
    }

    return {
      aplicar, elegir, selectorHTML, manejarClic, escuchar, resuelto, registrar,
      get valor() { return valor; },
      get estilo() { return base(valor) === "vidrio" ? "vidrio" : "plano"; },
      get temas() { return [...extra.values()]; },
    };
  }

  return { crear, VALORES, OPCIONES, ATRIBUTO, TOKENS, validarTema };
});
