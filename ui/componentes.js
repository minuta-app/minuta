// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Pieza «componentes»: lo que todas las apps repetían en su interfaz. Diálogo accesible (foco al título, Tab que no se escapa, Esc,
// el foco vuelve a donde estaba), `envolver` para un diálogo armado por la app, confirmar con una promesa, avisos (toast) en cola
// (también con un botón), las filas de «Tu IA», la fila de
// actualizaciones «Paso n de 3», «Acerca de» y el formulario de comentarios que abre un issue en GitHub.
// Sin dependencias (usa la pieza «i18n» que le pasas). Script clásico (window.PiezaComponentes) o Node (require). Devuelve HTML
// como texto: todo lo que viene de afuera va escapado. Sin estilos ni código en línea (CSP script-src 'self').
//
//   const ui = PiezaComponentes.crear({ i18n, host, app: "Ana", pintar, cerrar: cerrarDialogo, retener: (...a) => bv.retener(...a) });
//   const html = app() + (E.ajustes ? ui.dialogo({ id: "t-aj", titulo: "Ajustes", cuerpo: ui.filasIA({ ias: E.ias, elegida: E.config.ia }) }) : "") + ui.capas();
//   (la app pinta `html`), i18n.traducirDOM(raiz); ui.despuesDePintar();
//   document.addEventListener("click", (ev) => { if (ui.manejarClic(ev)) return; /* … */ });
//   document.addEventListener("keydown", (ev) => { if (ui.manejarTecla(ev)) return; /* … */ });
//   window.Ana.iaProbada = (r) => ui.iaProbada(r);   ui.aviso("Guardado");
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === "object" && module.exports) module.exports = m;
  else raiz.PiezaComponentes = m;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ID = /^[a-z][a-z0-9-]{0,40}$/i;
  const IA_ID = /^[a-z][a-z0-9-]{0,30}$/;
  const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
  const HTTPS = /^https:\/\/[^\s"'<>]+$/;
  const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  const MODAL = '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';
  const TIPOS_COMENTARIO = { error: { etiqueta: "error", prefijo: "🐞" }, idea: { etiqueta: "idea", prefijo: "💡" }, otro: { etiqueta: "comentario", prefijo: "💬" } };
  const esHttps = (u) => HTTPS.test(String(u || ""));

  /** Dónde corre la app, para el comentario (nunca nada de la persona). */
  function sistemaDe(plataforma, navegador) {
    if (plataforma === "windows") return "Windows";
    if (plataforma === "linux") return "Linux";
    const ua = String(navegador?.userAgent || "");
    if (plataforma === "movil") return /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : "Celular";
    const mac = ua.match(/Mac OS X (\d+)[_.](\d+)/);
    if (plataforma === "mac") return mac ? `macOS ${mac[1]}.${mac[2]}` : "macOS";
    return "Navegador";
  }

  /** La dirección de un issue nuevo en GitHub, prellenado. Solo para un repo con forma dueño/nombre. */
  function urlIssue(repo, { titulo, cuerpo, etiqueta } = {}) {
    if (!REPO.test(String(repo || ""))) return null;
    const q = [`title=${encodeURIComponent(String(titulo || "").slice(0, 200))}`, `body=${encodeURIComponent(String(cuerpo || "").slice(0, 6000))}`];
    if (etiqueta && /^[a-z][a-z0-9-]{0,30}$/.test(etiqueta)) q.push(`labels=${encodeURIComponent(etiqueta)}`);
    return `https://github.com/${repo}/issues/new?${q.join("&")}`;
  }

  /** Avisos breves en cola: uno a la vez, sin repetir el que ya está o espera, con texto plano (textContent, nunca HTML). */
  function crearAvisos(opciones = {}) {
    const documento = opciones.documento || (typeof document !== "undefined" ? document : null);
    const base = Number.isFinite(opciones.duracion) ? opciones.duracion : 2400;
    const pausa = Number.isFinite(opciones.pausa) ? opciones.pausa : 220;
    const max = opciones.max || 4;
    const cola = [];
    let actual = null, t = null;
    let accionActual = null;
    function elemento() {
      if (!documento) return null;
      let el = documento.getElementById?.("toast") || documento.getElementById?.("pz-toast");
      if (!el && documento.createElement && documento.body) {
        el = documento.createElement("div");
        el.id = "pz-toast";
        el.setAttribute("role", "status");
        el.setAttribute("aria-live", "polite");
        documento.body.appendChild(el);
      }
      el?.classList?.add("pz-toast");
      el?.setAttribute?.("data-sin-traducir", "");   // ya llega traducido: traducirDOM no lo vuelve a tocar
      return el;
    }
    // Con un botón (Deshacer, Revisar…) dura más: hay que alcanzar a leerlo y a tocarlo.
    const duracionDe = (a) => a.duracion ?? Math.round(Math.min(a.accion ? 10000 : 7000, Math.max(a.accion ? 6000 : base, 900 + 45 * a.texto.length)) * (a.error ? 1.5 : 1));
    function cerrarActual() {
      clearTimeout(t);
      accionActual = null;
      const el = elemento();
      el?.classList?.remove("visible");
      t = setTimeout(siguiente, pausa);
    }
    function siguiente() {
      const el = elemento();
      actual = cola.shift() || null;
      accionActual = null;
      if (!actual) { el?.classList?.remove("visible", "pz-con-accion"); return; }
      if (el) {
        el.textContent = actual.texto;
        el.classList.toggle("pz-error", !!actual.error);
        el.classList.toggle("pz-con-accion", !!actual.accion);
        if (actual.accion && documento.createElement) {
          // Texto y botón con textContent (nunca HTML); el clic lo atiende este botón, sin código en línea.
          const b = documento.createElement("button");
          b.type = "button";
          b.className = "pz-toast-accion";
          b.textContent = actual.accion.texto;
          const f = actual.accion.f;
          accionActual = f;
          b.addEventListener?.("click", (ev) => { ev.preventDefault?.(); cerrarActual(); try { f(); } catch (e) { (globalThis.console || {}).error?.(e); } });
          el.appendChild(b);
        }
        el.classList.add("visible");
      }
      t = setTimeout(() => { el?.classList?.remove("visible"); t = setTimeout(siguiente, pausa); }, duracionDe(actual));
    }
    return {
      /** texto: ya traducido (texto plano). `accion: {texto (ya traducido), f}` suma un botón que corre `f` y cierra el aviso. */
      mostrar(texto, o = {}) {
        const limpio = String(texto ?? "").trim().slice(0, 400);
        if (!limpio) return false;
        if (actual?.texto === limpio || cola.some((x) => x.texto === limpio)) return false;
        const accion = o.accion && typeof o.accion.f === "function" && String(o.accion.texto ?? "").trim()
          ? { texto: String(o.accion.texto).trim().slice(0, 60), f: o.accion.f } : null;
        cola.push({ texto: limpio, error: !!o.error, accion, duracion: Number.isFinite(o.duracion) ? o.duracion : undefined });
        while (cola.length > max) cola.shift();   // si se juntan muchos, quedan los últimos
        if (!actual) siguiente();
        return true;
      },
      get actual() { return actual?.texto ?? null; },
      get enCola() { return cola.map((x) => x.texto); },
      /** Corre el botón del aviso que se ve (para un atajo de teclado de la app) y lo cierra. */
      accionar() { const f = accionActual; if (!f) return false; cerrarActual(); f(); return true; },
      /** Deja #toast listo (clase pz-toast y data-sin-traducir) antes del primer aviso. */
      preparar() { elemento(); },
      limpiar() { clearTimeout(t); cola.length = 0; actual = null; accionActual = null; elemento()?.classList?.remove("visible", "pz-con-accion"); },
    };
  }

  function crear(opciones = {}) {
    const { i18n } = opciones;
    if (!i18n || typeof i18n.T !== "function" || typeof i18n.Tp !== "function") throw new Error("componentes: falta «i18n» (la pieza i18n).");
    const T = (t, v) => i18n.T(t, v);
    // Frases fijas: van en español y las traduce traducirDOM con el resto de la app (así cuentan en sus pruebas de textos).
    const L = (x) => esc(x);
    // Frases con valores: ya traducidas (T escapa la frase y los valores), dentro de data-sin-traducir.
    const F = (t, v, etiqueta = "span") => `<${etiqueta} data-sin-traducir>${T(t, v)}</${etiqueta}>`;
    const Tp = (t, v) => i18n.Tp(t, v);
    const tr = (t) => (typeof i18n.tr === "function" ? i18n.tr(t) : t);
    const app = String(opciones.app || "").slice(0, 60);
    /** `version` puede ser una función: en muchas apps llega después, con el estado. */
    const versionApp = () => String((typeof opciones.version === "function" ? opciones.version() : opciones.version) ?? "").slice(0, 40);
    const host = opciones.host || null;
    const ventana = opciones.ventana || (typeof window !== "undefined" ? window : globalThis);
    const documento = () => opciones.documento || ventana.document || null;
    const pintar = () => opciones.pintar?.();
    const enviar = (accion, datos) => host?.enviar?.(accion, datos);
    const avisos = crearAvisos({ documento: opciones.documento, duracion: opciones.duracion, pausa: opciones.pausa });
    try { avisos.preparar(); } catch { /* sin documento todavía */ }

    // ───────────── Avisos ─────────────
    /** Un aviso. `texto`: la frase en español con `valores` (va por Tp), o una frase ya armada en español sin `valores` («Quedan
     *  3 días»: va por tr, que reconoce las plantillas), o `traducido: true` si ya viene en el idioma de la persona.
     *  `accion: {texto, f}` suma un botón (Deshacer, Revisar…): `texto` en español (se traduce salvo con `traducido`). */
    function aviso(texto, o = {}) {
      if (opciones.retener?.(texto, o)) return false;   // la bienvenida los guarda mientras se elige el idioma
      const t = String(texto ?? "");
      const listo = o.traducido ? t : o.valores ? Tp(t, o.valores) : tr(t);
      const accion = o.accion && typeof o.accion.f === "function"
        ? { texto: o.traducido ? String(o.accion.texto ?? "") : tr(String(o.accion.texto ?? "")), f: o.accion.f } : undefined;
      return avisos.mostrar(listo, { ...o, accion });
    }

    // ───────────── Diálogos ─────────────
    const CLAVE = /^[A-Za-z0-9_-]{1,60}$/;
    const clasesDe = (clase) => String(clase || "").split(/\s+/).filter((c) => /^[a-z][a-z0-9-]{0,30}$/.test(c)).join(" ");
    /** La caja del diálogo. `id` es el del título (aria-labelledby); `clave` distingue pasos que usan el mismo título (el foco
     *  vuelve al título al cambiar de paso). */
    function caja({ id, clase, sinEsc, clave, rol = "dialog" }, contenido) {
      const clases = clasesDe(clase);
      const k = CLAVE.test(String(clave ?? "")) ? ` data-pz-clave="${esc(clave)}"` : "";
      return `<div class="pz-capa" data-pz-capa><div class="pz-dialogo${clases ? " " + clases : ""}" role="${rol}" aria-modal="true" aria-labelledby="${id}" tabindex="-1"${sinEsc ? " data-pz-sin-esc" : ""}${k}>
        ${contenido}</div></div>`;
    }
    const botonCerrar = () => `<button type="button" class="pz-boton pz-plano pz-cerrar" data-pz-cerrar aria-label="${L("Cerrar")}"><span aria-hidden="true">✕</span></button>`;
    /** HTML de un diálogo modal.
     *  `titulo`: frase en español (va por T, con `valores`). `tituloHTML`: un título que armaste tú (con esc()), p. ej. bilingüe
     *  y sin traducir. Sin ninguno de los dos, no hay cabecera: el título lo pone la app en `cuerpo` con ese `id` (como `envolver`).
     *  `antes`: HTML antes del título (los puntos de avance de una bienvenida). `cuerpo` y `pie` los arma la app (con esc()).
     *  `clase: "pz-ancho"`, `cerrable: false` sin ✕, `sinEsc: true` para uno que no se cierra solo, `clave` (ver `caja`). */
    function dialogo({ id, titulo, tituloHTML, valores = {}, antes = "", cuerpo = "", pie = "", clase = "", cerrable = true, sinEsc = false, clave } = {}) {
      if (!ID.test(String(id || ""))) throw new Error("componentes: el diálogo necesita un id (letras, números y guiones).");
      const conTitulo = typeof tituloHTML === "string" || (typeof titulo === "string" && titulo !== "");
      const h2 = typeof tituloHTML === "string" ? tituloHTML : T(titulo || "", valores);
      const cabeza = conTitulo
        ? `<div class="pz-cabeza"><h2 id="${id}" tabindex="-1" data-sin-traducir>${h2}</h2>${cerrable ? botonCerrar() : ""}</div>`
        : cerrable ? `<div class="pz-cabeza pz-sin-titulo">${botonCerrar()}</div>` : "";
      return caja({ id, clase, sinEsc, clave }, `${antes}${cabeza}${cuerpo}${pie ? `<div class="pz-pie">${pie}</div>` : ""}`);
    }
    /** Un diálogo con todo lo de adentro armado por la app (su propio <h2 id="…">): la pieza pone la capa, la caja accesible, el
     *  foco y Esc. `id` es el del título que viene en `html`. Sin ✕ (si la quieres: `cerrable: true`). */
    function envolver(html, { id, clase = "", sinEsc = false, clave, cerrable = false } = {}) {
      if (!ID.test(String(id || ""))) throw new Error("componentes: envolver necesita el id del título que viene en el html.");
      return caja({ id, clase, sinEsc, clave }, `${cerrable ? `<div class="pz-cabeza pz-sin-titulo">${botonCerrar()}</div>` : ""}${html}`);
    }

    let confirmacion = null;
    /** Pregunta antes de algo que no se deshace. Devuelve una promesa: true (sí) o false (no). Esc y el velo cuentan como «no»;
     *  con `sinElegir` devuelven ese valor (p. ej. `null` para «Guardar / No guardar / Cancelar»). Con `peligro` el foco empieza
     *  en «Cancelar» (un Enter apurado nunca borra). */
    function confirmar({ titulo, texto = "", valores = {}, si = "Aceptar", no = "Cancelar", peligro = false, sinElegir = false } = {}) {
      if (confirmacion) { const c = confirmacion; confirmacion = null; c.resolver(c.sinElegir); }
      return new Promise((resolver) => {
        confirmacion = { titulo, texto, valores, si, no, peligro, sinElegir, resolver };
        pintar();
      });
    }
    function responderConfirmacion(valor) {
      const c = confirmacion; if (!c) return false;
      confirmacion = null;
      c.resolver(valor);
      pintar();
      return true;
    }
    function confirmacionHTML() {
      const c = confirmacion; if (!c) return "";
      return `<div class="pz-capa" data-pz-capa><div class="pz-dialogo pz-confirmar" role="alertdialog" aria-modal="true" aria-labelledby="pz-t-conf" aria-describedby="pz-d-conf" tabindex="-1">
        <h2 id="pz-t-conf" tabindex="-1" data-sin-traducir>${T(c.titulo || "", c.valores)}</h2>${c.texto ? `<p id="pz-d-conf" data-sin-traducir>${T(c.texto, c.valores)}</p>` : ""}
        <div class="pz-pie"><button type="button" class="pz-boton" data-pz-confirmar="no"${c.peligro ? " data-autofoco" : ""} data-sin-traducir>${T(c.no)}</button><button type="button" class="pz-boton pz-principal${c.peligro ? " pz-peligro" : ""}" data-pz-confirmar="si"${c.peligro ? "" : " data-autofoco"} data-sin-traducir>${T(c.si)}</button></div></div></div>`;
    }

    // Foco: el de antes de abrir se recuerda por id o por su primer data-* (la app vuelve a pintar todo con innerHTML).
    let abierto = null, volverA = null, ultimo = null, focoDentro = null;
    function descriptor(el) {
      if (!el || el === documento()?.body) return null;
      if (el.id) return `#${cssEsc(el.id)}`;
      for (const a of el.attributes || []) if (/^data-[a-z0-9-]+$/.test(a.name) && !a.name.startsWith("data-sin")) return `[${a.name}="${cssEsc(a.value)}"]`;
      return null;
    }
    const cssEsc = (v) => (ventana.CSS?.escape ? ventana.CSS.escape(String(v)) : String(v).replace(/[^\w-]/g, (c) => `\\${c}`));
    const modales = () => [...(documento()?.querySelectorAll?.(MODAL) || [])];
    const modal = () => modales().pop() || null;
    const enfocables = (d) => [...d.querySelectorAll(ENFOCABLES)].filter((e) => !e.closest("[inert]") && e.getClientRects?.().length !== 0);
    // Un diálogo (o un paso) se reconoce por su título y su `data-pz-clave` (dentro o en la caja): pasos con el mismo título
    // pero otra clave mueven el foco al título nuevo.
    const claveDe = (d) => [d.getAttribute("aria-labelledby") || d.id || "modal",
      d.getAttribute("data-pz-clave") || d.querySelector("[data-pz-clave]")?.getAttribute("data-pz-clave") || ""].join("|");
    /** El título del diálogo (el de aria-labelledby), enfocable sin entrar al orden de Tab. */
    function tituloDe(d) {
      const id = d.getAttribute("aria-labelledby");
      const t = id ? [...d.querySelectorAll("[id]")].find((e) => e.id === id) : d.querySelector("h1, h2, h3");
      if (!t) return null;
      if (!t.hasAttribute("tabindex")) t.setAttribute("tabindex", "-1");
      return t;
    }
    // Lo último enfocado dentro del diálogo, para volver ahí si la app vuelve a pintar todo (innerHTML) con el diálogo abierto.
    const doc0 = documento();
    doc0?.addEventListener?.("focusin", (ev) => {
      const t = ev.target, d = t?.closest?.(MODAL);
      if (d && t !== d && d === modal()) focoDentro = { clave: claveDe(d), sel: descriptor(t) };
    });

    /** Llamar después de cada pintada: al abrir, el foco va al título (o a `[data-autofoco]`, si lo pusiste en un campo); mientras
     *  está abierto, se queda donde estaba aunque la app vuelva a pintar; al cerrar, vuelve al botón que lo abrió. */
    function despuesDePintar() {
      const doc = documento(); if (!doc) return;
      const d = modal();
      if (d) {
        const clave = claveDe(d);
        if (abierto !== clave) {
          if (abierto === null) volverA = ultimo || descriptor(doc.activeElement);
          abierto = clave;
          focoDentro = null;
          const destino = d.querySelector("[data-autofoco]:not([disabled])") || tituloDe(d) || d;
          destino.focus?.({ preventScroll: true });
        } else if (doc.activeElement === d || !d.contains(doc.activeElement)) {
          const antes = focoDentro && focoDentro.clave === clave && focoDentro.sel ? d.querySelector(focoDentro.sel) : null;
          const destino = (antes && !antes.disabled && antes) || d.querySelector("[data-autofoco]:not([disabled])") || tituloDe(d) || d;
          destino.focus?.({ preventScroll: true });
        }
      } else if (abierto !== null) {
        abierto = null;
        focoDentro = null;
        const el = volverA ? doc.querySelector(volverA) : null;
        volverA = null;
        el?.focus?.();
      }
    }

    // ───────────── Tu IA ─────────────
    const ia = { probando: {}, resultados: {}, instaladas: {} };
    /** Prueba una IA: `probarIA {ia}` (la forma única de todas las apps). */
    function probarIA(id) {
      if (!IA_ID.test(String(id || ""))) return false;
      ia.probando[id] = true;
      delete ia.resultados[id];
      enviar("probarIA", { ia: id });
      pintar();
      return true;
    }
    /** La respuesta `iaProbada {ia, ok, plantilla?, valores?, ayuda?, error?}`. Si quedó bien, la elige. */
    function iaProbada(r = {}) {
      const id = r.ia ?? r.id;   // `id` era la forma vieja de casi todas las apps
      if (!IA_ID.test(String(id || ""))) return;
      delete ia.probando[id];
      ia.resultados[id] = r;
      if (r.ok) ia.instaladas[id] = true;   // una que no estaba y se instaló después: ya cuenta como instalada
      if (r.ok) {
        if (opciones.elegirIA) opciones.elegirIA(id); else enviar("config", { ia: id });
        aviso("Lista para usar");
      }
      pintar();
    }
    function errorIA(r) {
      if (r.plantilla) return Tp(r.plantilla, r.valores || {}) + (r.ayuda ? " " + tr(r.ayuda) : "");
      return tr(r.error || r.texto || "No respondió.");
    }
    /** Las filas de Ajustes → Tu IA (y del paso de la bienvenida). `ias`: [{id, nombre, instalada, detalle?}] (de ia.py lista).
     *  `detalle`: frase en español que dice por qué no está lista (se traduce con tr). Una no instalada se puede volver a probar
     *  («Revisar de nuevo»). `principal`: "una" (por defecto: si no hay ninguna en uso, solo la primera instalada lleva el color de
     *  acción; así hay uno solo por pantalla), "todas" (cada una sin usar, como en 0.1.0) o false (ninguna). */
    function filasIA({ ias = [], elegida = null, guia = null, principal = "una" } = {}) {
      const lista = (Array.isArray(ias) ? ias : []).filter((x) => x && IA_ID.test(String(x.id)));
      if (!lista.length) return `<p class="pz-ayuda">${L("No encontré ninguna IA instalada. Puedes instalar Claude Code, Codex o Gemini y probarla aquí.")}</p>`;
      const instalada = (x) => !!x.instalada || !!ia.instaladas[x.id];
      const hayEnUso = lista.some((x) => x.id === elegida && instalada(x));
      const recomendada = principal === "una" && !hayEnUso ? lista.find(instalada)?.id : null;
      return `<div class="pz-filas">${lista.map((x) => {
        const id = x.id, r = ia.resultados[id], probando = !!ia.probando[id], enUso = elegida === id, esta = instalada(x);
        const detalle = typeof x.detalle === "string" && x.detalle.trim() ? x.detalle.trim().slice(0, 300) : "";
        const comoInstalar = esHttps(guia) ? ` · <button type="button" class="pz-enlace" data-pz-enlace="${esc(guia + "#" + id)}">${L("Cómo instalarla")}</button>` : "";
        const estado = r && !r.ok ? `<small class="pz-error-texto" data-sin-traducir>${esc(errorIA(r))}</small>`
          : !esta ? `<small>${detalle ? `<span data-sin-traducir>${esc(tr(detalle))}</span>` : `<span>${L("No está instalada")}</span>`}${comoInstalar}</small>`
            : `<small>${enUso ? L("En uso") : L("Instalada")}</small>`;
        const marca = probando ? `<span class="pz-giro" role="img" aria-label="${L("Probando…")}"></span>` : r?.ok ? `<span class="pz-ok">${L("Lista")}</span>` : "";
        const esPrincipal = esta && !enUso && (principal === "todas" || id === recomendada);
        const texto = probando ? L("Probando…") : !esta ? L("Revisar de nuevo") : enUso ? L("Probar otra vez") : L("Usar y probar");
        const boton = `<button type="button" class="pz-boton${esPrincipal ? " pz-principal" : esta ? "" : " pz-plano"}" data-pz-probar-ia="${esc(id)}" ${probando ? "disabled" : ""}>${texto}</button>`;
        return `<div class="pz-fila"><span class="pz-txt"><b data-sin-traducir>${esc(x.nombre || id)}</b>${estado}</span>${marca}${boton}</div>`;
      }).join("")}</div>`;
    }

    // ───────────── Actualizaciones (la forma de la pieza «actualizaciones») ─────────────
    const act = { estado: null, disponible: null };   // estado: null | "buscando" | "al-dia" | "sin-conexion" | {paso, texto, valores, total, pct}
    function buscarActualizacion() { act.estado = "buscando"; enviar("buscarActualizacion", {}); pintar(); }
    function actualizar() { act.estado = { paso: "1", texto: "", valores: {}, total: 3 }; enviar("actualizar", {}); pintar(); }
    /** Las notas pueden venir como `notas` (pieza «actualizaciones») o `detalle` (apps de antes). `desarrollo: true` (o `hay` sin
     *  versión) es una instalación de desarrollo: las notas son los commits nuevos. */
    const conNotas = (r) => ({ ...r, notas: r.notas ?? r.detalle ?? "" });
    /** `actualizacionRevisada {hay, version, notas|detalle, sinConexion, texto, valores, desarrollo?}`. `{pintar: false}` no
     *  vuelve a pintar (p. ej. detrás de la pantalla del idioma). */
    function actualizacionRevisada(r = {}, { pintar: repintar = true } = {}) {
      r = r && typeof r === "object" ? r : {};
      if (r.hay) { act.disponible = conNotas(r); act.estado = null; } else { act.disponible = null; act.estado = r.sinConexion ? "sin-conexion" : "al-dia"; }
      if (repintar) pintar();
    }
    /** Lo que la app manda en su estado (`estado.actualizacion`). `{pintar: false}` solo lo anota. */
    function actualizacionDisponible(r, { pintar: repintar = true } = {}) {
      act.disponible = r && typeof r === "object" && r.hay ? conNotas(r) : null;
      if (repintar) pintar();
    }
    /** `actualizacionProgreso {paso: "1"|"2"|"3"|"error", codigo, texto, valores, total, pct?}`. */
    function actualizacionProgreso(a = {}) {
      act.estado = { paso: String(a.paso || ""), texto: String(a.texto || ""), valores: a.valores || {}, total: Number(a.total) || 3, pct: a.pct };
      if (act.estado.paso === "error") aviso(act.estado.texto || "No se pudo actualizar", { valores: act.estado.valores, error: true });
      pintar();
    }
    function filaActualizacion() {
      const v = act.estado, a = act.disponible;
      if (v && typeof v === "object") {
        const error = v.paso === "error";
        const n = Math.max(1, Math.min(v.total, parseInt(v.paso, 10) || 1));
        const pct = typeof v.pct === "number" && Number.isFinite(v.pct) ? Math.max(0, Math.min(100, Math.round(v.pct))) : null;
        const texto = v.texto ? T(v.texto, v.valores) : "";
        return `<div class="pz-fila pz-act" aria-live="polite"><span class="pz-txt"><b class="${error ? "pz-error-texto" : ""}" data-sin-traducir>${texto}${pct !== null ? ` · ${pct}%` : ""}</b>${error ? "" : `${F("Paso {n} de {total}", { n, total: v.total }, "small")}`}${!error ? `<progress class="pz-progreso" max="${v.total * 100}" value="${(n - 1) * 100 + (pct ?? 0)}"></progress>` : ""}</span>${error ? `<button type="button" class="pz-boton" data-pz-act="buscar">${L("Buscar de nuevo")}</button>` : ""}</div>`;
      }
      if (a) {
        const titulo = a.texto ? T(a.texto, a.valores || {}) : "";
        const desarrollo = a.desarrollo === true || (!a.version && !a.texto);
        return `<div class="pz-fila pz-act"><span class="pz-txt">${desarrollo ? F("Hay cambios nuevos en el código de {app}", { app }, "b") : F("Hay una versión nueva de {app}", { app }, "b")}${titulo ? `<small data-sin-traducir>${titulo}</small>` : ""}${a.notas ? `<small class="pz-notas" data-sin-traducir>${esc(String(a.notas).slice(0, 2000))}</small>` : ""}<small>${L("Tus datos no se tocan al actualizar.")}</small></span><button type="button" class="pz-boton pz-principal" data-pz-act="instalar">${L("Actualizar ahora")}</button></div>`;
      }
      const estado = v === "buscando" ? L("Buscando…") : v === "al-dia" ? L("Estás en la última versión") : v === "sin-conexion" ? L("No pude revisar: sin conexión") : F("{app} revisa sola si hay versiones nuevas.", { app });
      return `<div class="pz-fila pz-act" aria-live="polite"><span class="pz-txt">${estado}</span><button type="button" class="pz-boton" data-pz-act="buscar" ${v === "buscando" ? "disabled" : ""}>${L("Buscar actualizaciones")}</button></div>`;
    }

    // ───────────── Acerca de ─────────────
    const ENLACES = () => [["sitio", L("Sitio")], ["codigo", L("Código")], ["comunidad", L("Comunidad")], ["aportar", L("Cómo aportar")]];
    /** Versión, licencia y enlaces (solo https). `extra: [{texto, url}]` suma los de la app (texto en español, se traduce con el
     *  resto). `comentarios: true` suma el botón para abrir el formulario. */
    function acercaDe({ version = versionApp(), licencia = "AGPL-3.0", enlaces = {}, extra = [], comentarios = !!opciones.repo } = {}) {
      const botones = ENLACES().filter(([k]) => esHttps(enlaces[k])).map(([k, n]) => `<button type="button" class="pz-chip" data-pz-enlace="${esc(enlaces[k])}">${n}</button>`);
      for (const x of (Array.isArray(extra) ? extra : []).slice(0, 8)) {
        if (x && esHttps(x.url) && String(x.texto ?? "").trim()) botones.push(`<button type="button" class="pz-chip" data-pz-enlace="${esc(x.url)}">${L(String(x.texto).trim().slice(0, 60))}</button>`);
      }
      if (comentarios && REPO.test(String(opciones.repo || ""))) botones.push(`<button type="button" class="pz-chip" data-pz-comentarios="error">${L("Enviar comentarios")}</button>`);
      return `<div class="pz-acerca">${F("{app} {v} · Gratis y abierto ({licencia}). Sin cuentas ni telemetría.", { app, v: version, licencia }, "p")}</div>${botones.length ? `<div class="pz-chips">${botones.join("")}</div>` : ""}`;
    }

    // ───────────── Comentarios → issue en GitHub (nunca obligatorio, solo cuando la persona lo pide) ─────────────
    let comentario = null;
    function abrirComentarios({ tipo = "error", version = versionApp() } = {}) {
      if (!REPO.test(String(opciones.repo || ""))) return false;
      comentario = { tipo: TIPOS_COMENTARIO[tipo] ? tipo : "error", titulo: "", texto: "", sistema: true, version: String(version).slice(0, 40), falta: "" };
      pintar();
      return true;
    }
    function leerCampos() {
      const doc = documento(); if (!doc || !comentario) return;
      const t = doc.getElementById?.("pz-coment-titulo"), x = doc.getElementById?.("pz-coment-texto");
      if (t) comentario.titulo = String(t.value || "").slice(0, 200);
      if (x) comentario.texto = String(x.value || "").slice(0, 5000);
    }
    /** Lo que va al issue: título con su ícono, el texto y (si se deja marcado) versión, idioma y sistema. */
    function datosComentario(c = comentario) {
      const tipo = TIPOS_COMENTARIO[c.tipo] || TIPOS_COMENTARIO.otro;
      const sistema = c.sistema ? `\n\n---\n${app} ${c.version || ""} · ${i18n.idioma || "es"} · ${sistemaDe(host?.plataforma, ventana.navigator)}` : "";
      return { titulo: `${tipo.prefijo} ${String(c.titulo).trim()}`, cuerpo: String(c.texto).trim() + sistema, etiqueta: tipo.etiqueta };
    }
    function enviarComentario() {
      leerCampos();
      if (!comentario.titulo.trim()) { comentario.falta = "titulo"; pintar(); documento()?.getElementById?.("pz-coment-titulo")?.focus?.(); return; }
      const url = urlIssue(opciones.repo, datosComentario());
      if (!url) return;
      enviar("abrirEnlace", { url });
      comentario = null;
      pintar();
      aviso("Se abrió GitHub: revisa y publica");
    }
    const nombresComentario = () => ({ error: L("Algo falla"), idea: L("Una idea"), otro: L("Otro") });
    function comentariosHTML() {
      const c = comentario; if (!c) return "";
      const pestanas = Object.keys(TIPOS_COMENTARIO).map((k) => `<button type="button" class="pz-chip" data-pz-coment-tipo="${k}" aria-pressed="${c.tipo === k}">${nombresComentario()[k]}</button>`).join("");
      const cuerpo = `<p class="pz-ayuda">${L("Se abre GitHub con tu mensaje listo; lo revisas y lo publicas tú. Es público, así que no incluyas datos personales.")}</p>
        <div class="pz-chips" role="group" aria-label="${L("Tipo")}">${pestanas}</div>
        <label class="pz-campo"><span>${L("Título")}</span><input id="pz-coment-titulo" type="text" maxlength="200" value="${esc(c.titulo)}"${c.falta === "titulo" ? ` aria-invalid="true" aria-describedby="pz-coment-falta"` : ""}></label>
        ${c.falta === "titulo" ? `<small id="pz-coment-falta" class="pz-error-texto">${L("Escribe un título.")}</small>` : ""}
        <label class="pz-campo"><span>${L("Cuéntanos")}</span><textarea id="pz-coment-texto" rows="5" maxlength="5000">${esc(c.texto)}</textarea></label>
        <label class="pz-casilla"><input type="checkbox" id="pz-coment-sistema" data-pz-coment-sistema ${c.sistema ? "checked" : ""}><span><b>${L("Incluir la versión de la app, el idioma y el sistema")}</b><small>${L("Ayuda a entender el contexto. Nunca se incluye nada tuyo.")}</small></span></label>`;
      const pie = `<button type="button" class="pz-boton" data-pz-cerrar>${L("Cancelar")}</button><button type="button" class="pz-boton pz-principal" data-pz-coment-enviar>${L("Abrir en GitHub")}</button>`;
      return dialogo({ id: "pz-t-coment", titulo: "Enviar comentarios", cuerpo, pie });
    }

    /** Lo que la pieza pinta por su cuenta (comentarios y confirmación), arriba de todo: ponlo al final de la pintada. */
    const capas = () => comentariosHTML() + confirmacionHTML();

    // ───────────── Clics y teclas ─────────────
    function manejarClic(ev) {
      const t = ev?.target;
      const enfocable = t?.closest?.("button, a, input, select, textarea, [tabindex]");
      if (enfocable && !enfocable.closest(MODAL)) ultimo = descriptor(enfocable);
      if (!t?.closest) return false;
      const b = t.closest("[data-pz-confirmar], [data-pz-cerrar], [data-pz-probar-ia], [data-pz-act], [data-pz-enlace], [data-pz-comentarios], [data-pz-coment-tipo], [data-pz-coment-enviar], [data-pz-coment-sistema]");
      if (!b) {
        // Un clic en el velo (fuera del diálogo) cierra, como Esc.
        if (t.matches?.("[data-pz-capa]") && !t.querySelector?.("[data-pz-sin-esc]")) return cerrarArriba();
        return false;
      }
      if (b.hasAttribute("data-pz-coment-sistema")) { if (comentario) comentario.sistema = !!b.checked; return true; }
      ev.preventDefault?.();
      if (b.hasAttribute("data-pz-confirmar")) return responderConfirmacion(b.getAttribute("data-pz-confirmar") === "si");
      if (b.hasAttribute("data-pz-cerrar")) return cerrarArriba();
      if (b.hasAttribute("data-pz-probar-ia")) return probarIA(b.getAttribute("data-pz-probar-ia"));
      if (b.hasAttribute("data-pz-act")) { if (b.getAttribute("data-pz-act") === "instalar") actualizar(); else buscarActualizacion(); return true; }
      if (b.hasAttribute("data-pz-enlace")) { const u = b.getAttribute("data-pz-enlace"); if (esHttps(u)) enviar("abrirEnlace", { url: u }); return true; }
      if (b.hasAttribute("data-pz-comentarios")) return abrirComentarios({ tipo: b.getAttribute("data-pz-comentarios"), version: versionApp() });
      if (b.hasAttribute("data-pz-coment-tipo")) { leerCampos(); const k = b.getAttribute("data-pz-coment-tipo"); if (comentario && TIPOS_COMENTARIO[k]) comentario.tipo = k; pintar(); return true; }
      if (b.hasAttribute("data-pz-coment-enviar")) { enviarComentario(); return true; }
      return false;
    }
    /** Cierra lo de más arriba: la confirmación, el formulario de comentarios o (con `cerrar`) el diálogo de la app. */
    function cerrarArriba() {
      if (confirmacion) return responderConfirmacion(confirmacion.sinElegir);
      if (comentario) { comentario = null; pintar(); return true; }
      if (opciones.cerrar) { opciones.cerrar(); return true; }
      return false;
    }
    function manejarTecla(ev) {
      const d = modal();
      if (!d || !ev) return false;
      if (ev.key === "Escape") {
        if (d.hasAttribute("data-pz-sin-esc")) return false;
        ev.preventDefault?.();
        return cerrarArriba();
      }
      if (ev.key === "Tab") {
        const lista = enfocables(d);
        const doc = documento();
        if (!lista.length) { ev.preventDefault?.(); d.focus?.(); return true; }
        const primero = lista[0], ultimoEl = lista[lista.length - 1], activo = doc.activeElement;
        const dentro = d.contains(activo);
        if (ev.shiftKey && (!dentro || activo === primero || activo === d)) { ev.preventDefault?.(); ultimoEl.focus(); return true; }
        if (!ev.shiftKey && (!dentro || activo === ultimoEl)) { ev.preventDefault?.(); primero.focus(); return true; }
        return false;   // dentro del diálogo, Tab sigue su orden normal
      }
      return false;
    }

    return {
      esc, aviso, avisos, dialogo, envolver, confirmar, capas, despuesDePintar, manejarClic, manejarTecla,
      filasIA, probarIA, iaProbada, ia,
      filaActualizacion, buscarActualizacion, actualizar, actualizacionRevisada, actualizacionDisponible, actualizacionProgreso, act,
      acercaDe, abrirComentarios, datosComentario,
      get hayCapa() { return !!(confirmacion || comentario); },
    };
  }

  return { crear, crearAvisos, urlIssue, sistemaDe, esc };
});
