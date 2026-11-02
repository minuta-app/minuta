// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Pieza «tema»: sistema, claro u oscuro. Pone <html data-pz-modo="claro|oscuro"> (o lo quita para seguir al sistema); los colores
// los resuelve tema.css con light-dark(). El atributo lleva prefijo para no chocar con un `data-tema` de la app (un
// closest("[data-tema]") de la app encontraba <html>). Lo elegido se lee con `tema.valor` y `tema.resuelto()`.
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

  const VALORES = ["sistema", "claro", "oscuro"];
  /** El atributo que pone en <html> (tema.css lo lee). Antes de 0.2.0 era data-tema. */
  const ATRIBUTO = "data-pz-modo";
  /** Las opciones del selector, en español (las traduce la app con traducirDOM o T). */
  const OPCIONES = [["sistema", "Como el sistema"], ["claro", "Claro"], ["oscuro", "Oscuro"]];
  const valido = (v) => (VALORES.includes(v) ? v : null);

  function crear(opciones = {}) {
    const ventana = opciones.ventana || (typeof window !== "undefined" ? window : globalThis);
    const documento = opciones.documento || ventana.document || null;
    const consulta = ventana.matchMedia ? ventana.matchMedia("(prefers-color-scheme: dark)") : null;
    let valor = "sistema";

    const resuelto = () => (valor === "sistema" ? (consulta?.matches ? "oscuro" : "claro") : valor);

    /** Pone el tema en el documento. Un valor desconocido es «sistema». Devuelve el que quedó. */
    function aplicar(v) {
      valor = valido(v) || "sistema";
      const html = documento?.documentElement;
      if (html?.dataset) {
        if (valor === "sistema") delete html.dataset.pzModo; else html.dataset.pzModo = valor;
      }
      opciones.alCambiar?.(resuelto(), valor);
      return valor;
    }

    /** ?tema= (vista previa, pruebas, capturas) > lo guardado > sistema. */
    function elegir({ config, url } = {}) {
      let deUrl = url;
      if (deUrl === undefined) { try { deUrl = new URLSearchParams(ventana.location?.search || "").get("tema"); } catch { deUrl = null; } }
      return valido(deUrl) || valido(config) || "sistema";
    }

    /** El selector de Ajustes: un grupo de tres botones con aria-pressed (estilo .pz-seg de «componentes»). Las etiquetas van en
     *  español: las traduce traducirDOM con el resto de la app (sus inglés vienen en `textos` de la pieza). */
    function selectorHTML() {
      return `<div class="pz-seg" role="group" aria-label="Apariencia">${OPCIONES.map(([v, n]) =>
        `<button type="button" data-pz-tema="${v}" aria-pressed="${valor === v}">${n}</button>`).join("")}</div>`;
    }

    /** Un clic en el selector: aplica, guarda y devuelve true. Cualquier otro clic, false. */
    function manejarClic(ev) {
      const b = ev?.target?.closest?.("button[data-pz-tema]");
      if (!b) return false;
      const v = valido(b.getAttribute("data-pz-tema"));
      if (!v) return false;
      ev.preventDefault?.();
      aplicar(v);
      opciones.guardar?.(v);
      return true;
    }

    /** Avisa cuando el sistema cambia de claro a oscuro (solo importa en «sistema»). Devuelve cómo dejar de escuchar. */
    function escuchar(fn) {
      if (!consulta?.addEventListener) return () => {};
      const f = () => { if (valor === "sistema") fn(resuelto()); };
      consulta.addEventListener("change", f);
      return () => consulta.removeEventListener("change", f);
    }

    return {
      aplicar, elegir, selectorHTML, manejarClic, escuchar, resuelto,
      get valor() { return valor; },
    };
  }

  return { crear, VALORES, OPCIONES, ATRIBUTO };
});
