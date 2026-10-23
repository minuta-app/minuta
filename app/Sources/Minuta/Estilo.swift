import AppKit
import SwiftUI

// MARK: - Colores y fuentes del universo

extension Color {
    /// Color de un universo: "#rgb", "#rrggbb", "#rrggbbaa", "rgb(r,g,b)" o "rgba(r,g,b,a)" (como en CSS).
    /// Antes solo entendía "#…": los "rgba(…)" de los universos salían negros (botón «Ahora no» ilegible).
    init(hex: String) {
        let texto = hex.trimmingCharacters(in: .whitespaces).lowercased()
        if texto.hasPrefix("rgb") {
            let n = texto.drop(while: { $0 != "(" }).dropFirst().prefix(while: { $0 != ")" })
                .split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
            if n.count >= 3 {
                self.init(.sRGB, red: n[0] / 255, green: n[1] / 255, blue: n[2] / 255, opacity: n.count > 3 ? n[3] : 1)
                return
            }
        }
        var limpio = texto.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        if limpio.count == 3 { limpio = limpio.map { "\($0)\($0)" }.joined() }
        var v: UInt64 = 0
        Scanner(string: limpio).scanHexInt64(&v)
        let alfa = limpio.count == 8 ? Double(v & 0xFF) / 255 : 1
        if limpio.count == 8 { v >>= 8 }
        self.init(.sRGB, red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255, opacity: alfa)
    }
}

extension TemaJuego.Estilo {
    var cAcento: Color { Color(hex: acento) }
    var cAcentoTexto: Color { Color(hex: acento_texto) }
    var cAcento2: Color { Color(hex: acento2) }
    var cFondo: Color { Color(hex: fondo) }
    var cFondo2: Color { Color(hex: fondo2) }
    var cTexto: Color { Color(hex: texto) }
    var cSuave: Color { Color(hex: suave) }

    /// Curvatura de controles (pestañas, buscador, botones) según el universo.
    var radioControl: CGFloat { radio >= 18 ? 15 : radio >= 12 ? 10 : radio >= 8 ? 6 : 3 }

    /// Fuente para controles pequeños (pestañas, etiquetas) con la personalidad del universo.
    func fuenteControl(_ tamano: CGFloat, activo: Bool) -> Font {
        let base: Font = fuente == "ui-rounded"
            ? .system(size: tamano, weight: activo ? .heavy : .semibold, design: .rounded)
            : .custom(fuente, size: tamano + (fuente == "Luminari" || fuente == "Trattatello" || fuente == "Herculanum" ? 0.5 : 0))
                .weight(activo ? .bold : .medium)
        return cursiva ? base.italic() : base
    }

    /// Negro o blanco, lo que se lea mejor sobre el color de acento.
    var textoSobreAcento: Color {
        var v: UInt64 = 0
        Scanner(string: acento.trimmingCharacters(in: CharacterSet(charactersIn: "#"))).scanHexInt64(&v)
        let r = Double((v >> 16) & 0xFF), g = Double((v >> 8) & 0xFF), b = Double(v & 0xFF)
        return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? .black : .white
    }

    func fuenteTitulo(_ tamano: CGFloat) -> Font {
        let base: Font = fuente == "ui-rounded"
            ? .system(size: tamano, weight: .heavy, design: .rounded)
            : .custom(fuente, size: tamano).weight(peso >= 700 ? .heavy : .regular)
        return cursiva ? base.italic() : base
    }
}

// MARK: - CSS por universo

extension Render {
    static func css(_ e: TemaJuego.Estilo?) -> String {
        let fuente = e.map { $0.fuente == "ui-rounded" ? "ui-rounded, -apple-system" : "\"\($0.fuente)\", -apple-system" } ?? "-apple-system"
        let vars: String
        if let e {
            vars = """
            :root { color-scheme: \(e.oscuro ? "dark" : "light"); --fondo:\(e.fondo); --fondo2:\(e.fondo2); --panel:\(e.panel); --texto:\(e.texto);
              --suave:\(e.suave); --linea:\(e.linea); --acento:\(e.acento); --acento-t:\(e.acento_texto); --acento2:\(e.acento2);
              --radio:\(e.radio)px; --fuente-t:\(fuente); --peso-t:\(e.peso); --mayus:\(e.mayusculas ? "uppercase" : "none");
              --cursiva:\(e.cursiva ? "italic" : "normal"); --sombra: \(e.oscuro ? "0 10px 30px -18px rgba(0,0,0,.8)" : "0 10px 30px -20px rgba(30,40,60,.35)"); }
            """
        } else {
            vars = """
            :root { color-scheme: light dark; --fondo:#fbfbfd; --fondo2:#f2f2f7; --panel:rgba(255,255,255,.8); --texto:#1d1d1f; --suave:#6e6e73;
              --linea:rgba(0,0,0,.08); --acento:#c2410c; --acento-t:#c2410c; --acento2:#7c3aed; --radio:12px; --fuente-t:-apple-system;
              --peso-t:700; --mayus:none; --cursiva:normal; --sombra:0 10px 30px -20px rgba(0,0,0,.3); }
            @media (prefers-color-scheme: dark) { :root { --fondo:#1c1c1e; --fondo2:#151517; --panel:rgba(255,255,255,.05); --texto:#f5f5f7;
              --suave:#a1a1a6; --linea:rgba(255,255,255,.1); --acento:#fb923c; --acento-t:#fb923c; } }
            """
        }
        let (patron, tamano) = patronCSS(e?.patron ?? "")
        return vars + """
        * { box-sizing: border-box; }
        html { background: var(--fondo); }
        body { margin: 0; min-height: 100vh; color: var(--texto); font: 14.5px/1.58 -apple-system, BlinkMacSystemFont, sans-serif;
               -webkit-font-smoothing: antialiased; background-color: var(--fondo);
               background-image: \(patron.isEmpty ? "" : patron + ","), linear-gradient(180deg, var(--fondo) 0%, var(--fondo2) 100%);
               background-size: \(tamano.isEmpty ? "" : tamano + ","), 100% 100%; background-attachment: fixed; }
        .contenedor { max-width: 820px; margin: 0 auto; padding: 30px 38px 80px; }
        ::selection { background: color-mix(in srgb, var(--acento) 35%, transparent); }
        h1 { font-family: var(--fuente-t); font-weight: var(--peso-t); text-transform: var(--mayus); font-style: var(--cursiva);
             font-size: 27px; line-height: 1.15; letter-spacing: .005em; margin: 0 0 10px; animation: subir .35s ease both; }
        .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 24px; animation: subir .35s .05s ease both; }
        .chips span { background: var(--panel); border: 1px solid var(--linea); color: var(--suave); font-size: 12px; padding: 3px 10px;
                      border-radius: 999px; backdrop-filter: blur(8px); }
        .chips .tipo { color: var(--acento-t); border-color: color-mix(in srgb, var(--acento) 45%, transparent); font-weight: 650; }
        .card, .tarjeta, .apartado, .logro, .personaje, .nuevos, .turnos, .feedback li.top {
               background: var(--panel); border: 1px solid var(--linea); border-radius: var(--radio); box-shadow: var(--sombra);
               backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
        .card { padding: 14px 20px 12px; margin-bottom: 12px; animation: subir .4s ease both; }
        .card > :first-child { margin-top: 0 !important; }
        .card:nth-child(2) { animation-delay: .05s } .card:nth-child(3) { animation-delay: .1s } .card:nth-child(4) { animation-delay: .15s }
        .card:nth-child(5) { animation-delay: .2s } .card:nth-child(6) { animation-delay: .25s } .card:nth-child(n+7) { animation-delay: .3s }
        h3 { font-family: var(--fuente-t); font-weight: var(--peso-t); font-style: var(--cursiva); font-size: 16.5px; margin: 0 0 6px;
             display: flex; align-items: center; gap: 9px; }
        h3::before { content: ""; width: 4px; height: 1.05em; border-radius: 4px; background: linear-gradient(var(--acento), var(--acento2)); flex: none; }
        h2 { font-family: var(--fuente-t); font-size: 17px; margin: 22px 0 8px; }
        ul { margin: 2px 0 4px; padding-left: 18px; }
        ul ul { margin: 2px 0 3px; padding-left: 18px; color: var(--suave); font-size: 13.5px; }
        li { margin: 3px 0; }
        li::marker { color: var(--acento); }
        ul ul li::marker { color: var(--suave); }
        li.tarea { list-style: none; margin-left: -18px; padding: 5px 0; border-top: 1px dashed var(--linea); }
        li.tarea:first-child { border-top: none; }
        .check { display: inline-grid; place-items: center; width: 16px; height: 16px; border: 2px solid var(--acento); border-radius: 5px;
                 margin-right: 9px; vertical-align: -3px; font-size: 11px; }
        li.hecha { color: var(--suave); text-decoration: line-through; }
        p { margin: 6px 0; }
        strong { font-weight: 650; }
        em { color: var(--suave); }
        code { font: 12.5px ui-monospace, Menlo, monospace; background: color-mix(in srgb, var(--acento) 12%, transparent); padding: 1px 5px; border-radius: 5px; }
        blockquote { margin: 6px 0; padding-left: 10px; border-left: 3px solid var(--acento); color: var(--suave); }
        a { color: var(--acento-t); }
        .vacio { color: var(--suave); padding: 30px 0; text-align: center; }
        .feedback ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
        .feedback li.top { padding: 12px 16px; animation: subir .4s ease both; }
        .feedback li.top ul { list-style: disc; padding-left: 18px; margin-top: 6px; gap: 2px; }
        .tarjetas { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
        .tarjeta { padding: 14px 16px; animation: subir .4s ease both; }
        .tarjeta.ancha { grid-column: span 2; }
        .valor { font: 800 24px/1.1 ui-rounded, -apple-system; color: var(--acento-t); letter-spacing: -.01em; }
        .tarjeta.ancha .valor { font-size: 15px; line-height: 1.35; }
        .nombre { font-size: 12px; color: var(--suave); margin-top: 4px; }
        .detalle { font-size: 11.5px; color: var(--suave); margin-top: 2px; }
        .turnos { padding: 6px 18px; }
        .turno { display: grid; grid-template-columns: 58px 132px 1fr; gap: 12px; padding: 9px 0; border-top: 1px solid var(--linea); font-size: 13.5px; }
        .turno:first-child { border-top: none; }
        .hora { color: var(--suave); font-variant-numeric: tabular-nums; font-size: 12px; padding-top: 2px; }
        .quien { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--acento2); }
        .quien.yo { color: var(--acento-t); }
        @keyframes subir { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes crecer { from { transform: scaleX(0); } }
        @keyframes latido { 0%, 100% { transform: scale(1) rotate(0); } 50% { transform: scale(1.12) rotate(-6deg); } }
        @keyframes brillo { from { background-position: -200% 0; } to { background-position: 200% 0; } }
        """
    }

    /// Textura de fondo de cada universo (capa CSS + tamaño).
    static func patronCSS(_ nombre: String) -> (String, String) {
        switch nombre {
        case "estrellas":
            let estrellas = [(20, 30, 1.0), (130, 80, 1.2), (210, 170, 1.6), (300, 40, 1.0), (380, 220, 1.3), (60, 200, 0.9), (250, 110, 0.8), (340, 140, 1.1)]
            return (estrellas.map { "radial-gradient(\($0.2)px \($0.2)px at \($0.0)px \($0.1)px, rgba(255,255,255,.85), transparent)" }.joined(separator: ","),
                    Array(repeating: "400px 260px", count: estrellas.count).joined(separator: ","))
        case "pergamino":
            return ("radial-gradient(ellipse at 50% -10%, rgba(212,175,55,.16), transparent 55%), radial-gradient(ellipse at 50% 120%, rgba(0,0,0,.5), transparent 60%)", "100% 100%, 100% 100%")
        case "runas":
            return ("radial-gradient(ellipse at 50% -10%, rgba(201,162,39,.14), transparent 55%), repeating-linear-gradient(45deg, rgba(201,162,39,.035) 0 1px, transparent 1px 24px)", "100% 100%, auto")
        case "comic":
            return ("radial-gradient(rgba(230,36,41,.16) 1px, transparent 1.7px), radial-gradient(ellipse at 100% 0%, rgba(230,36,41,.22), transparent 45%)", "9px 9px, 100% 100%")
        case "velocidad":
            return ("repeating-linear-gradient(100deg, transparent 0 46px, rgba(255,106,0,.07) 46px 48px, transparent 48px 130px), radial-gradient(ellipse at 100% 0%, rgba(0,229,255,.12), transparent 45%)", "auto, 100% 100%")
        case "ki":
            return ("radial-gradient(circle at 88% -8%, rgba(248,91,26,.32), transparent 42%), radial-gradient(circle at -8% 108%, rgba(30,91,184,.18), transparent 45%), repeating-conic-gradient(from 0deg at 88% -8%, rgba(248,91,26,.05) 0 6deg, transparent 6deg 14deg)", "100% 100%, 100% 100%, 100% 100%")
        case "nubes":
            return ("radial-gradient(70px 32px at 9% 7%, rgba(255,255,255,.95), transparent 70%), radial-gradient(100px 44px at 16% 10%, rgba(255,255,255,.9), transparent 70%), radial-gradient(90px 38px at 82% 5%, rgba(255,255,255,.95), transparent 70%), radial-gradient(120px 50px at 90% 9%, rgba(255,255,255,.85), transparent 70%)", "100% 700px, 100% 700px, 100% 700px, 100% 700px")
        case "hielo":
            return ("linear-gradient(180deg, rgba(159,201,230,.16), transparent 260px), repeating-linear-gradient(60deg, rgba(159,201,230,.035) 0 1px, transparent 1px 32px)", "100% 100%, auto")
        case "pantano":
            return ("radial-gradient(ellipse at 15% 110%, rgba(123,179,46,.3), transparent 50%), radial-gradient(ellipse at 95% 105%, rgba(139,90,43,.18), transparent 45%)", "100% 100%, 100% 100%")
        case "olas":
            return ("repeating-radial-gradient(circle at 50% 150%, transparent 0 30px, rgba(46,139,139,.07) 30px 32px), radial-gradient(ellipse at 50% -10%, rgba(200,161,90,.14), transparent 55%)", "auto, 100% 100%")
        case "film":
            return ("radial-gradient(ellipse at 50% -25%, rgba(245,183,0,.18), transparent 55%)", "100% 100%")
        default:
            return ("", "")
        }
    }

    static let cssTema = """
    .juego { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
    .etiqueta { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--suave); font-weight: 700; }
    .personaje { padding: 16px 18px; position: relative; overflow: hidden; animation: subir .4s ease both;
                 background: linear-gradient(135deg, color-mix(in srgb, var(--acento) 22%, var(--panel)), color-mix(in srgb, var(--acento2) 18%, var(--panel))); }
    .personaje .texto { font-size: 16px; margin-top: 8px; line-height: 1.5; }
    .personaje .texto strong { font-family: var(--fuente-t); font-style: var(--cursiva); color: var(--acento-t); }
    .xp-chip { float: right; text-transform: none; letter-spacing: 0; color: var(--acento-t); font-size: 12.5px; font-weight: 800; }
    .nuevos { padding: 12px 16px; animation: subir .4s .08s ease both;
              background: linear-gradient(110deg, color-mix(in srgb, var(--acento) 14%, var(--panel)) 30%, color-mix(in srgb, var(--acento) 30%, var(--panel)) 50%, color-mix(in srgb, var(--acento) 14%, var(--panel)) 70%);
              background-size: 200% 100%; animation: subir .4s ease both, brillo 3.5s linear infinite; border-color: color-mix(in srgb, var(--acento) 50%, transparent); }
    .nuevo { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
    .nuevo .emo { font-size: 28px; animation: latido 2.2s ease-in-out infinite; }
    .nuevo > div { flex: 1; }
    .nombre-rango { font-family: var(--fuente-t); font-weight: var(--peso-t); text-transform: var(--mayus); font-style: var(--cursiva); font-size: 22px; margin-top: 4px; }
    .frase { font-size: 12.5px; color: var(--suave); margin-top: 3px; line-height: 1.45; }
    .xp { font: 800 15px ui-rounded, -apple-system; color: var(--acento-t); white-space: nowrap; }
    .barra { height: 8px; border-radius: 99px; background: color-mix(in srgb, var(--texto) 10%, transparent); margin-top: 12px; overflow: hidden; }
    .barra div { height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--acento), var(--acento2)); transform-origin: left;
                 animation: crecer 1s cubic-bezier(.2,.8,.2,1) .25s both; }
    .barra.fina { height: 5px; margin-top: 9px; }
    .apartados { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .apartado { padding: 14px 16px; animation: subir .4s ease both; }
    .apartado:nth-child(2) { animation-delay: .06s } .apartado:nth-child(3) { animation-delay: .12s } .apartado:nth-child(4) { animation-delay: .18s }
    .apartado .cabeza { display: flex; justify-content: space-between; align-items: baseline; font-weight: 700; }
    .apartado .cabeza .ico { font-size: 18px; margin-right: 4px; }
    .apartado .puntos { font: 800 26px ui-rounded, -apple-system; color: var(--acento-t); }
    .apartado .puntos small { font-size: 12px; color: var(--suave); font-weight: 600; }
    .segmentos { display: grid; grid-template-columns: repeat(10, 1fr); gap: 3px; margin: 9px 0 11px; }
    .segmentos i { height: 7px; border-radius: 4px; background: color-mix(in srgb, var(--texto) 10%, transparent); }
    .segmentos i.on { background: linear-gradient(90deg, var(--acento), var(--acento2)); animation: subir .3s ease both; }
    .arq { font-size: 14.5px; }
    .arq strong { font-family: var(--fuente-t); font-style: var(--cursiva); }
    .pie { font-size: 11.5px; color: var(--suave); margin-top: 10px; border-top: 1px solid var(--linea); padding-top: 7px; }
    .titulo-datos { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--suave); font-weight: 700; margin: 14px 0 10px; }
    .resumen-logros { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 18px; }
    .resumen-logros .tarjeta .valor { font-size: 26px; }
    .logros { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .logro { display: flex; gap: 14px; padding: 14px 16px; animation: subir .4s ease both; }
    .logro .emo { font-size: 30px; width: 46px; height: 46px; display: grid; place-items: center; border-radius: 12px; flex: none;
                  background: color-mix(in srgb, var(--texto) 7%, transparent); filter: grayscale(1); opacity: .55; }
    .logro .info { flex: 1; }
    .logro strong { font-family: var(--fuente-t); font-style: var(--cursiva); font-size: 14.5px; }
    .logro .pie { border-top: none; padding-top: 0; margin-top: 6px; }
    .logro.bloqueado strong, .logro.bloqueado .frase { opacity: .75; }
    .logro.listo { border-color: color-mix(in srgb, var(--acento) 55%, transparent);
                   background: linear-gradient(135deg, color-mix(in srgb, var(--acento) 16%, var(--panel)), var(--panel)); }
    .logro.listo .emo { filter: none; opacity: 1; background: linear-gradient(135deg, color-mix(in srgb, var(--acento) 35%, transparent), color-mix(in srgb, var(--acento2) 25%, transparent));
                        animation: latido 3s ease-in-out infinite; }
    .logro.listo .pie { color: var(--acento-t); font-weight: 600; }
    """

    static func documento(_ cuerpo: String, tema: TemaJuego?) -> String {
        "<!doctype html><html><head><meta charset=\"utf-8\"><style>\(css(tema?.estilo))\(cssTema)</style></head><body><div class=\"contenedor\">\(cuerpo)</div></body></html>"
    }

    // MARK: Paneles

    static func panelTema(_ nota: Nota, todas: [Nota], tema: TemaJuego?) -> String {
        guard let tema else { return "<p class=\"vacio\">No encontré los universos en ~/minuta/temas.</p>" }
        guard let p = Juego.puntajes(de: nota) else {
            return "<p class=\"vacio\">Esta reunión no tiene puntajes de feedback.</p>"
        }
        let xpTotal = Juego.xpTotal(todas, hasta: nota.fecha)
        let logrosAhora = Juego.calcularLogros(todas, hasta: nota.fecha).filter { $0.nota == nota.url.path }
        let xpReunion = Juego.xp(p) + logrosAhora.count * Juego.xpPorLogro
        let (indice, rango, _) = Juego.rango(tema, xp: xpTotal)
        let indiceAntes = Juego.rango(tema, xp: xpTotal - xpReunion).indice
        let promedio = Double(p.values.reduce(0, +)) / 4

        var html = "<div class=\"juego\">"
        let elogio = tema.elogios.count == 4 ? tema.elogios[promedio >= 8 ? 0 : promedio >= 6 ? 1 : promedio >= 4 ? 2 : 3] : ""
        var texto = Juego.personaje(de: nota).map { inline($0) } ?? ""
        if texto.isEmpty {
            let mejor = Juego.apartados.max { (p[$0.clave] ?? 0) < (p[$1.clave] ?? 0) }!
            if let a = Juego.arquetipo(tema, mejor.clave, Double(p[mejor.clave] ?? 1)) {
                texto = "Fuiste como <strong>\(esc(a.nombre))</strong> (<em>\(esc(a.referencia))</em>): \(esc(a.frase))"
            }
        }
        html += "<div class=\"personaje\"><div class=\"etiqueta\">\(tema.emoji) Personaje de la reunión · \(esc(elogio)) <span class=\"xp-chip\">+\(xpReunion) \(esc(tema.xp))</span></div><div class=\"texto\">\(texto)</div></div>"

        if !logrosAhora.isEmpty || indice > indiceAntes {
            html += "<div class=\"nuevos\">"
            if indice > indiceAntes {
                html += "<div class=\"etiqueta\">⬆︎ ¡Subiste de rango!</div><div class=\"nuevo\"><span class=\"emo\">\(tema.iconoRango(indice))</span><div><div class=\"nombre-rango\">\(esc(rango.nombre))</div><div class=\"frase\">\(esc(rango.frase))</div></div></div>"
            }
            if !logrosAhora.isEmpty {
                html += "<div class=\"etiqueta\" style=\"margin-top:\(indice > indiceAntes ? 12 : 0)px\">🏆 Logros desbloqueados</div>"
                for l in logrosAhora {
                    let info = tema.logros[l.def.id]
                    html += "<div class=\"nuevo\"><span class=\"emo\">\(tema.iconoLogro(l.def))</span><div><strong>\(esc(info?.nombre ?? l.def.id))</strong><div class=\"frase\">\(esc(info?.descripcion ?? ""))</div></div><span class=\"xp\">+\(Juego.xpPorLogro)</span></div>"
                }
            }
            html += "</div>"
        }

        let ultimas = todas.filter { $0.fecha <= nota.fecha }.sorted { $0.fecha < $1.fecha }.compactMap(Juego.puntajes).suffix(5)
        html += "<div class=\"apartados\">"
        for a in Juego.apartados {
            let valor = p[a.clave] ?? 0
            guard let arq = Juego.arquetipo(tema, a.clave, Double(valor)) else { continue }
            let prom = Double(ultimas.map { $0[a.clave] ?? 0 }.reduce(0, +)) / Double(max(1, ultimas.count))
            let proximo = valor < 10 ? tema.apartados[a.clave]?[valor].nombre : nil
            let pie = (ultimas.count <= 1 ? "Primera reunión" : "Promedio últimas \(ultimas.count): \(String(format: "%.1f", prom))")
                + (proximo.map { " · Próximo: \(esc($0))" } ?? " · ¡Nivel máximo!")
            html += """
            <div class="apartado"><div class="cabeza"><span><span class="ico">\(tema.iconoApartado(a))</span> \(a.titulo)</span><span class="puntos">\(valor)<small>/10</small></span></div>
            <div class="segmentos">\((1...10).map { "<i class=\"\($0 <= valor ? "on" : "")\" style=\"animation-delay:\(Double($0) * 0.04)s\"></i>" }.joined())</div>
            <div class="arq"><strong>\(esc(arq.nombre))</strong> · <em>\(esc(arq.referencia))</em></div>
            <div class="frase">\(esc(arq.frase))</div><div class="pie">\(pie)</div></div>
            """
        }
        return html + "</div></div>"
    }

    static func panelLogros(todas: [Nota], tema: TemaJuego?) -> String {
        guard let tema else { return "<p class=\"vacio\">No encontré los universos en ~/minuta/temas.</p>" }
        let estados = Juego.calcularLogros(todas)
        let listos = estados.filter(\.listo).count
        let xp = Juego.xpTotal(todas, hasta: .distantFuture)
        let (indice, rango, _) = Juego.rango(tema, xp: xp)
        let f = DateFormatter()
        f.locale = Locale(identifier: "es_CL")
        f.dateFormat = "d MMM yyyy"
        var html = """
        <h1>\(tema.emoji) Logros</h1>
        <div class="chips"><span class="tipo">\(esc(tema.nombre))</span><span>Los logros suman \(Juego.xpPorLogro) \(esc(tema.xp)) cada uno</span></div>
        <div class="resumen-logros">
          <div class="tarjeta"><div class="valor">\(listos)<small style="font-size:14px;color:var(--suave)">/\(estados.count)</small></div><div class="nombre">Logros desbloqueados</div></div>
          <div class="tarjeta"><div class="valor">\(tema.iconoRango(indice)) \(indice + 1)</div><div class="nombre">\(esc(rango.nombre))</div></div>
          <div class="tarjeta"><div class="valor">\(xp)</div><div class="nombre">\(esc(tema.xp)) acumulados</div></div>
        </div>
        <div class="logros">
        """
        for (n, e) in estados.sorted(by: { ($0.listo ? 0 : 1, $0.fecha ?? .distantFuture, $0.progreso / $0.def.objetivo > 0 ? 0 : 1) < ($1.listo ? 0 : 1, $1.fecha ?? .distantFuture, $1.progreso / $1.def.objetivo > 0 ? 0 : 1) }).enumerated() {
            let info = tema.logros[e.def.id]
            let pct = Int(min(1, e.progreso / e.def.objetivo) * 100)
            let estado = e.fecha.map { "✓ Desbloqueado el \(f.string(from: $0))" }
                ?? (e.def.objetivo > 1 ? "\(e.def.formato(min(e.progreso, e.def.objetivo))) de \(e.def.formato(e.def.objetivo))" : "🔒 Bloqueado")
            html += """
            <div class="logro \(e.listo ? "listo" : "bloqueado")" style="animation-delay:\(min(Double(n) * 0.03, 0.5))s"><div class="emo">\(tema.iconoLogro(e.def))</div>
            <div class="info"><strong>\(esc(info?.nombre ?? e.def.id))</strong><div class="frase">\(esc(info?.descripcion ?? ""))</div>
            \(e.listo || e.def.objetivo <= 1 ? "" : "<div class=\"barra fina\"><div style=\"width:\(pct)%\"></div></div>")
            <div class="pie">\(estado)</div></div></div>
            """
        }
        return html + "</div>"
    }
}

// MARK: - Nivel (siempre visible)

struct NivelView: View {
    let notas: [Nota]
    let tema: TemaJuego?
    var compacto = false

    var body: some View {
        if let tema, let e = tema.estilo {
            let xp = Juego.xpTotal(notas, hasta: .distantFuture)
            let (i, rango, siguiente) = Juego.rango(tema, xp: xp)
            let base = Juego.umbralesRango[i]
            let progreso = min(1, max(0, siguiente.map { Double(xp - base) / Double($0 - base) } ?? 1))
            let logros = Juego.calcularLogros(notas).filter(\.listo).count
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Text(tema.iconoRango(i))
                        .font(.system(size: compacto ? 22 : 26))
                        .frame(width: compacto ? 38 : 44, height: compacto ? 38 : 44)
                        .background(LinearGradient(colors: [e.cAcento.opacity(0.35), e.cAcento2.opacity(0.3)], startPoint: .topLeading, endPoint: .bottomTrailing),
                                    in: RoundedRectangle(cornerRadius: 11))
                    VStack(alignment: .leading, spacing: 1) {
                        Text("RANGO \(i + 1) DE 10").font(.system(size: 9.5, weight: .bold)).tracking(0.6).foregroundStyle(e.cSuave)
                        Text(rango.nombre).font(e.fuenteTitulo(compacto ? 15 : 16)).foregroundStyle(e.cTexto).lineLimit(2).minimumScaleFactor(0.8)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    VStack(alignment: .trailing, spacing: 1) {
                        Text("🏆 \(logros)").font(.system(size: 12, weight: .bold, design: .rounded)).foregroundStyle(e.cTexto)
                        Text("logros").font(.system(size: 9.5)).foregroundStyle(e.cSuave)
                    }
                }
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(e.cTexto.opacity(0.12))
                        Capsule().fill(LinearGradient(colors: [e.cAcento, e.cAcento2], startPoint: .leading, endPoint: .trailing))
                            .frame(width: max(6, g.size.width * progreso))
                    }
                }
                .frame(height: 7)
                .animation(.spring(duration: 0.8), value: progreso)
                Text(siguiente.map { "\(xp) \(tema.xp) · faltan \($0 - xp) para \(tema.rangos[i + 1].nombre)" } ?? "\(xp) \(tema.xp) · rango máximo")
                    .font(.system(size: 10.5)).foregroundStyle(e.cSuave).lineLimit(2)
            }
            .padding(compacto ? 12 : 12)
            .background {
                RoundedRectangle(cornerRadius: 14)
                    .fill(LinearGradient(colors: [e.cFondo, e.cFondo2], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .overlay(RoundedRectangle(cornerRadius: 14)
                        .fill(LinearGradient(colors: [e.cAcento.opacity(0.18), .clear], startPoint: .topTrailing, endPoint: .bottomLeading)))
            }
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(e.cAcento.opacity(0.35), lineWidth: 1))
        }
    }
}

// MARK: - Galería de universos

struct GaleriaUniversos: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var cerrar

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Elige tu universo").font(.system(size: 22, weight: .bold))
                    Text("Cambia los colores, los personajes, los rangos y los logros.").foregroundStyle(.secondary)
                }
                Spacer()
                Button("Listo") { cerrar() }.keyboardShortcut(.defaultAction)
            }
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 14)], spacing: 14) {
                    ForEach(model.temas) { t in
                        TarjetaUniverso(tema: t, elegido: t.id == model.temaID)
                            .onTapGesture { withAnimation(.spring(duration: 0.35)) { model.temaID = t.id } }
                    }
                }
                .padding(2)
            }
        }
        .padding(22)
        .frame(width: 720, height: 560)
        .background {
            if let e = model.temaActual?.estilo {
                LinearGradient(colors: [e.cFondo, e.cFondo2], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            }
        }
        .foregroundStyle(model.temaActual?.estilo?.cTexto ?? .primary)
        .tint(model.temaActual?.estilo?.cAcento ?? .accentColor)
        .preferredColorScheme(model.temaActual?.estilo.map { $0.oscuro ? .dark : .light })
    }
}

struct TarjetaUniverso: View {
    let tema: TemaJuego
    let elegido: Bool

    var body: some View {
        let e = tema.estilo
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(tema.emoji).font(.system(size: 30))
                Spacer()
                if elegido { Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(e?.cAcento ?? .accentColor) }
            }
            Text(tema.nombre).font(e?.fuenteTitulo(18) ?? .headline).foregroundStyle(e?.cTexto ?? .primary).lineLimit(1).minimumScaleFactor(0.7)
            Text("XP: \(tema.xp)").font(.caption).foregroundStyle(e?.cSuave ?? .secondary).lineLimit(1)
            HStack(spacing: 4) {
                ForEach(Array((tema.iconos_rangos ?? []).prefix(6).enumerated()), id: \.offset) { Text($0.element).font(.system(size: 14)) }
            }
            HStack(spacing: 5) {
                ForEach([e?.acento, e?.acento2, e?.acento_texto].compactMap { $0 }, id: \.self) {
                    Circle().fill(Color(hex: $0)).frame(width: 12, height: 12)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
        .background {
            RoundedRectangle(cornerRadius: 16)
                .fill(LinearGradient(colors: [e?.cFondo ?? .gray, e?.cFondo2 ?? .gray], startPoint: .topLeading, endPoint: .bottomTrailing))
                .overlay(RoundedRectangle(cornerRadius: 16)
                    .fill(LinearGradient(colors: [(e?.cAcento ?? .clear).opacity(0.25), .clear], startPoint: .topTrailing, endPoint: .center)))
        }
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(elegido ? (e?.cAcento ?? .accentColor) : Color.primary.opacity(0.1), lineWidth: elegido ? 2.5 : 1))
        .scaleEffect(elegido ? 1.02 : 1)
        .shadow(color: .black.opacity(elegido ? 0.25 : 0.1), radius: elegido ? 12 : 4, y: 4)
        .contentShape(Rectangle())
    }
}
