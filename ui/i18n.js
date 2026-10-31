// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Pieza «i18n»: los idiomas de la interfaz. La clave de cada traducción es la frase en español, con marcadores {nombre}.
// Sin dependencias. Funciona como script clásico (queda en window.PiezaI18n) o en Node (require), con una CSP
// «script-src 'self'»: no usa eval, ni estilos en línea, ni innerHTML.
//
//   const i18n = PiezaI18n.crear();
//   await i18n.cargar(i18n.elegir({ config: E.config.idioma_ui }));   // carga ui/idiomas/<codigo>.json validado
//   i18n.T("Hola, **{nombre}**", { nombre })   → HTML escapado (valores incluidos), para dentro de data-sin-traducir
//   i18n.Tp("Copiado {n} veces", { n })         → texto plano (textContent, aria-label, avisos)
//   i18n.traducirDOM(raiz)                      → traduce lo ya pintado, salvo [data-sin-traducir]
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === "object" && module.exports) module.exports = m;
  else raiz.PiezaI18n = m;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CODIGO = /^[a-z]{2,3}(-[A-Z]{2})?$/;
  const MARCADOR = /\{(\w+)\}/g;
  const LIMITE = { frases: 20000, clave: 2000, valor: 4000, nombre: 40, bandera: 16, palabras: 2000 };
  // Caracteres de control y de dirección (bidi): en una traducción de afuera solo sirven para engañar a quien lee.
  const RAROS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/;
  // Solo etiquetas de verdad (<b>, </a>, <img …>, <!--): un texto como «<nombre>.md» no es HTML.
  const ETIQUETA_HTML = /<\/?(?:a|abbr|b|br|button|code|div|em|form|i|iframe|img|input|link|meta|object|p|script|span|strong|style|svg|table|td|tr|u|ul|li|ol|video|audio|embed|base|math)\b[^>]*>|<!--|<!\[|<\?/i;
  const PROHIBIDAS = new Set(["__proto__", "constructor", "prototype"]);
  /** Lo que nunca se traduce: contenido de la persona y lo que no es texto de la app. */
  const SALTAR = "[data-sin-traducir], script, style, svg, textarea, code, pre";
  /** El texto de un textarea es de la persona, pero su placeholder, title y aria-label son de la app: esos sí se traducen. */
  const SOLO_ATRIBUTOS = "textarea";
  /** Nunca se traducen atributos aquí adentro. */
  const SIN_ATRIBUTOS = "script, style, svg";
  const ATRIBUTOS = ["title", "aria-label", "placeholder", "alt"];

  /** Escapa para HTML (texto y atributos entre comillas). */
  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const marcadores = (t) => [...String(t).matchAll(MARCADOR)].map((m) => m[1]).sort().join(",");
  const negritas = (t) => (String(t).match(/\*\*/g) || []).length;
  const tieneLetras = (t) => /\p{L}/u.test(t);

  /** Valida un paquete de idioma que viene de afuera ({codigo, nombre, bandera?, textos, palabras?}). Las frases que no
   *  cumplen se descartan una por una (y se dicen en `errores`); el paquete entero solo se rechaza si su forma no sirve.
   *  Reglas de cada frase: texto, sin HTML ni caracteres de control, los MISMOS marcadores {x} que la clave y los mismos **. */
  function validarPaquete(dato, esperado) {
    const errores = [];
    if (!dato || typeof dato !== "object" || Array.isArray(dato)) return { ok: false, errores: ["El paquete no es un objeto."] };
    if (typeof dato.codigo !== "string" || !CODIGO.test(dato.codigo)) return { ok: false, errores: ["«codigo» no es un código de idioma."] };
    if (esperado && dato.codigo !== esperado) return { ok: false, errores: [`El paquete es de «${dato.codigo}», no de «${esperado}».`] };
    const nombre = typeof dato.nombre === "string" && dato.nombre.trim() && dato.nombre.length <= LIMITE.nombre && !RAROS.test(dato.nombre)
      ? dato.nombre.trim() : dato.codigo;
    const bandera = typeof dato.bandera === "string" && dato.bandera.length <= LIMITE.bandera && !RAROS.test(dato.bandera) && !ETIQUETA_HTML.test(dato.bandera)
      ? dato.bandera : "";
    const textos = new Map();
    const fuente = dato.textos && typeof dato.textos === "object" && !Array.isArray(dato.textos) ? dato.textos : null;
    if (!fuente) return { ok: false, errores: ["Faltan «textos»."] };
    const entradas = Object.keys(fuente);
    if (entradas.length > LIMITE.frases) return { ok: false, errores: ["El paquete trae demasiadas frases."] };
    for (const clave of entradas) {
      const valor = fuente[clave];
      const mal = PROHIBIDAS.has(clave) ? "clave reservada"
        : typeof valor !== "string" || !valor.trim() ? "no es texto"
          : clave.length > LIMITE.clave || valor.length > LIMITE.valor ? "demasiado larga"
            : RAROS.test(clave) || RAROS.test(valor) ? "trae caracteres de control"
              : ETIQUETA_HTML.test(valor) ? "trae HTML"
                : marcadores(clave) !== marcadores(valor) ? "no trae los mismos marcadores {…}"
                  : negritas(clave) !== negritas(valor) ? "no trae los mismos **" : "";
      if (mal) errores.push(`«${clave.slice(0, 60)}»: ${mal}`);
      else textos.set(clave, valor);
    }
    const palabras = new Map();
    if (dato.palabras && typeof dato.palabras === "object" && !Array.isArray(dato.palabras)) {
      for (const [k, v] of Object.entries(dato.palabras).slice(0, LIMITE.palabras)) {
        if (/^\p{Ll}{1,40}$/u.test(k) && !PROHIBIDAS.has(k) && typeof v === "string" && /^[\p{L} .'-]{1,40}$/u.test(v)) palabras.set(k, v);
        else errores.push(`palabra «${String(k).slice(0, 40)}» no válida`);
      }
    }
    return { ok: true, errores, paquete: { codigo: dato.codigo, nombre, bandera, textos, palabras } };
  }

  /** Expresión que reconoce una frase con marcadores ya armada: «Quedan 3 días» ← «Quedan {n} días». {n} solo calza números. */
  function patron(clave) {
    const nombres = [];
    let fuente = "^", ultimo = 0;
    for (const m of clave.matchAll(MARCADOR)) {
      fuente += clave.slice(ultimo, m.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      fuente += m[1] === "n" ? "(\\d+(?:[.,:]\\d+)*)" : "(.+?)";
      nombres.push(m[1]);
      ultimo = m.index + m[0].length;
    }
    if (!nombres.length) return null;
    return { re: new RegExp(fuente + clave.slice(ultimo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "u"), nombres };
  }
  /** Pone los valores en una plantilla en una sola pasada: un valor que trae «{otro}» nunca se vuelve a reemplazar.
   *  `valores` puede ser un objeto ({n: 2}) o una lista ([2, 8]): con lista se llenan en orden, así «Paso {n} de {n}» da
   *  «Paso 2 de 8» (un nombre repetido no repite el primer valor). */
  function poner(plantilla, valores, transformar) {
    if (Array.isArray(valores)) {
      let i = 0;
      return plantilla.replace(MARCADOR, (todo) => (i < valores.length ? transformar(valores[i++]) : todo));
    }
    return plantilla.replace(MARCADOR, (todo, k) => (Object.prototype.hasOwnProperty.call(valores, k) ? transformar(valores[k]) : todo));
  }
  /** Igual, con una lista de valores por nombre (lo que se leyó de una frase ya armada): cada {nombre} toma el siguiente. */
  function ponerEnOrden(plantilla, listas) {
    const usados = {};
    return plantilla.replace(MARCADOR, (todo, k) => {
      const l = listas[k];
      if (!l || !l.length) return todo;
      const i = usados[k] = (usados[k] ?? -1) + 1;
      return l[Math.min(i, l.length - 1)];
    });
  }

  function crear(opciones = {}) {
    const noTraducir = opciones.noTraducir ? `${SALTAR}, ${opciones.noTraducir}` : SALTAR;
    // Atributos: sin `noTraducirAtributos`, se saltan donde se salta el texto (como hasta 0.2.0). Con él, se traducen en todas
    // partes (también en las zonas de `noTraducir`: un botón «Abrir nota» dentro de una lista de notas) menos donde diga.
    const sinAtributos = typeof opciones.noTraducirAtributos === "string" && opciones.noTraducirAtributos.trim()
      ? `${SIN_ATRIBUTOS}, ${opciones.noTraducirAtributos}` : null;
    const documento = () => opciones.documento || (typeof document !== "undefined" ? document : null);
    const faltantes = () => opciones.faltantes || globalThis._faltantes || null;
    const ESPANOL = { codigo: "es", nombre: "Español", bandera: "", textos: new Map(), palabras: new Map() };
    let actual = ESPANOL, patrones = [];

    function anotarFaltante(t) {
      const f = faltantes();
      if (f && /\p{L}{2}/u.test(t)) f.add(t);
    }
    function nucleo(k) {
      let v = actual.textos.get(k);
      if (v != null) return v;
      for (const { re, nombres, otro } of patrones) {
        const m = k.match(re);
        if (m) { const listas = {}; nombres.forEach((n, i) => { (listas[n] = listas[n] || []).push(m[i + 1]); }); return ponerEnOrden(otro, listas); }
      }
      // Fechas y textos cortos («18 de octubre · 10:45»): palabra por palabra si todas son conocidas.
      const P = actual.palabras, palabras = k.match(/\p{L}+/gu) || [];
      if (P.size && palabras.length && palabras.every((w) => P.has(w.toLowerCase()) || w.toLowerCase() === "de")) {
        return k.replace(/(\d+) de (\p{L}+)/gu, "$1 $2").replace(/\p{L}+/gu, (w) => {
          const x = P.get(w.toLowerCase()) || w;
          return w[0] === w[0].toUpperCase() ? x[0].toUpperCase() + x.slice(1) : x;
        });
      }
      return null;
    }

    const i18n = {
      esc,
      validarPaquete,
      get idioma() { return actual.codigo; },
      get nombre() { return actual.nombre; },

      /** Usa un paquete ya leído (se valida aquí). Con «es» o null vuelve al español. Devuelve {ok, errores}. */
      usar(dato) {
        if (!dato || dato.codigo === "es") { actual = ESPANOL; patrones = []; }
        else {
          const r = validarPaquete(dato);
          if (!r.ok) return { ok: false, errores: r.errores };
          actual = r.paquete;
          patrones = [];
          for (const [clave, otro] of actual.textos) { const p = patron(clave); if (p) patrones.push({ ...p, otro }); }
          const d = documento();
          if (d?.documentElement) d.documentElement.lang = actual.codigo;
          return { ok: true, errores: r.errores };
        }
        const d = documento();
        if (d?.documentElement) d.documentElement.lang = "es";
        return { ok: true, errores: [] };
      },

      /** Carga <ruta><codigo>.json (por defecto «idiomas/», junto a la interfaz). Si falla, queda en español. */
      async cargar(codigo, { ruta = "idiomas/", traer = globalThis.fetch } = {}) {
        if (codigo === actual.codigo) return { ok: true, errores: [] };
        if (!codigo || codigo === "es" || !CODIGO.test(codigo)) return i18n.usar(null);
        try {
          const r = await traer(`${ruta}${codigo}.json`);
          const dato = await r.json();
          const v = validarPaquete(dato, codigo);
          if (!v.ok) { i18n.usar(null); return v; }
          return i18n.usar(dato);
        } catch {
          i18n.usar(null);
          return { ok: false, errores: ["No pude leer el idioma."] };
        }
      },

      /** El idioma a usar: lo recién elegido > ?idioma= (vista previa y pruebas: si la URL lo fuerza, gana) > lo guardado en la
       *  config > el del sistema. */
      elegir({ elegido, config, url, sistema, disponibles = ["es", "en"] } = {}) {
        if (url === undefined && typeof location !== "undefined") url = new URLSearchParams(location.search).get("idioma");
        if (sistema === undefined) sistema = i18n.idiomaDelSistema(undefined, disponibles);
        for (const c of [elegido, url, config, sistema]) if (typeof c === "string" && disponibles.includes(c)) return c;
        return disponibles.includes("es") ? "es" : disponibles[0];
      },

      /** El primer idioma del sistema que la app tiene; si el sistema está en otro, inglés (o el primero que haya). */
      idiomaDelSistema(lenguajes, disponibles = ["es", "en"]) {
        if (lenguajes === undefined && typeof navigator !== "undefined") lenguajes = navigator.languages?.length ? navigator.languages : [navigator.language];
        const lista = (lenguajes || []).filter(Boolean).map((l) => String(l).toLowerCase());
        if (!lista.length) return disponibles.includes("es") ? "es" : disponibles[0];
        for (const l of lista) {
          const exacto = disponibles.find((d) => d.toLowerCase() === l), base = disponibles.find((d) => d === l.split("-")[0]);
          if (exacto || base) return exacto || base;
        }
        return disponibles.includes("en") ? "en" : disponibles[0];
      },

      /** Traduce un texto ya armado (nodo de texto o atributo). Sin traducción, queda igual. */
      tr(t) {
        if (actual.codigo === "es" || !t) return t;
        t = String(t);
        const k = t.trim();
        if (!k) return t;
        const r = nucleo(k);
        if (r != null) return t.replace(k, r);
        const kn = k.replace(/\s+/g, " ");
        if (kn !== k) { const c = nucleo(kn); if (c != null) return t.replace(k, c); }
        // Íconos o símbolos alrededor («💬 Comentarios ▾»): se traduce el centro.
        const m = kn.match(/^([^\p{L}¿¡«“"]*)(.*?)([\s▾→←✓…:]*)$/u);
        if (m && (m[1] || m[3]) && m[2]) { const c = nucleo(m[2]); if (c != null) return t.replace(k, m[1] + c + m[3]); }
        // Partes con « · » («18 oct · 70 min · abrir»): cada una que se pueda.
        if (kn.includes(" · ")) {
          const partes = kn.split(" · "), nuevas = partes.map((x) => i18n.tr(x));
          if (nuevas.some((x, i) => x !== partes[i])) return t.replace(k, nuevas.join(" · "));
        }
        anotarFaltante(kn);
        return t;
      },

      /** La frase traducida, todavía con sus marcadores (para quien la necesite así). */
      frasePlantilla(plantilla) {
        if (actual.codigo === "es") return plantilla;
        const v = actual.textos.get(plantilla);
        if (v == null) anotarFaltante(plantilla);
        return v ?? plantilla;
      },

      /** Frase completa con marcadores, en HTML: se traduce entera, se escapa y después se ponen los valores, también
       *  escapados. «**así**» queda en negrita. Va dentro de un elemento con data-sin-traducir (ya está traducida). */
      T(plantilla, valores = {}) {
        const t = esc(i18n.frasePlantilla(plantilla)).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
        return poner(t, valores, esc);
      },
      /** Como T, pero los valores son HTML que TÚ armaste con esc() (un enlace, una cifra con su etiqueta). Nunca texto de afuera. */
      Thtml(plantilla, valoresHtml = {}) {
        const t = esc(i18n.frasePlantilla(plantilla)).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
        return poner(t, valoresHtml, String);
      },
      /** Texto plano (textContent, aria-label, avisos): sin escapar y sin las marcas **. */
      Tp(plantilla, valores = {}) {
        return poner(i18n.frasePlantilla(plantilla).replace(/\*\*(.+?)\*\*/g, "$1"), valores, String);
      },
      /** T dentro de su etiqueta con data-sin-traducir: `frase("Quedan {n}", {n}, "small")`. */
      frase(plantilla, valores = {}, etiqueta = "span") {
        const e = /^[a-z][a-z0-9]{0,10}$/.test(etiqueta) ? etiqueta : "span";
        return `<${e} data-sin-traducir>${i18n.T(plantilla, valores)}</${e}>`;
      },

      /** Traduce lo ya pintado: textos y los atributos title, aria-label, placeholder y alt. Nunca traduce el texto de
       *  [data-sin-traducir], script, style, svg, textarea, code ni pre (ni de lo que diga `noTraducir`); el placeholder, title y
       *  aria-label de un textarea sí. Con `crear({noTraducirAtributos})`, los atributos se traducen en todas partes menos ahí.
       *  { soloDentro: true } no toca los atributos de la raíz (al volver a pintar dentro de un contenedor ya traducido). */
      traducirDOM(raiz, { soloDentro = false } = {}) {
        if (!raiz || actual.codigo === "es") return;
        const atributos = (el) => {
          for (const a of ATRIBUTOS) {
            const v = el.getAttribute?.(a);
            if (v) { const x = i18n.tr(v); if (x !== v) el.setAttribute(a, x); }
          }
        };
        // Con `noTraducirAtributos`: los atributos de una zona sin traducir (y de lo que tiene adentro) igual se traducen.
        const soloAtributos = (n) => {
          if (n.matches?.(sinAtributos)) return;
          atributos(n);
          for (const h of Array.from(n.childNodes || [])) if (h.nodeType === 1) soloAtributos(h);
        };
        const recorrer = (n) => {
          for (const h of Array.from(n.childNodes || [])) {
            if (h.nodeType === 3) {
              if (tieneLetras(h.nodeValue)) { const v = i18n.tr(h.nodeValue); if (v !== h.nodeValue) h.nodeValue = v; }
            } else if (h.nodeType === 1 && !h.matches(noTraducir)) {
              if (!sinAtributos || !h.matches(sinAtributos)) atributos(h);
              recorrer(h);
            } else if (h.nodeType === 1) {
              if (sinAtributos) soloAtributos(h);
              else if (h.matches(SOLO_ATRIBUTOS) && !h.matches("[data-sin-traducir]")) atributos(h);
            }
          }
        };
        if (raiz.nodeType === 1) {
          if (raiz.closest?.(noTraducir)) {
            if (sinAtributos && !raiz.closest(sinAtributos)) {
              if (soloDentro) for (const h of Array.from(raiz.childNodes || [])) { if (h.nodeType === 1) soloAtributos(h); }
              else soloAtributos(raiz);
            }
            return;
          }
          if (!soloDentro) atributos(raiz);
        }
        recorrer(raiz);
      },
    };
    return i18n;
  }

  return { crear, esc, validarPaquete, CODIGO };
});
