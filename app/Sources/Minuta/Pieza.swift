import Foundation
import PiezaHost

/// Lo que Minuta usa de la pieza «host-mac» (target `PiezaHost`). Minuta es una app de barra de menú (LSUIElement) con una
/// ventana sin borde que dibuja cada universo (VisorWeb.swift) y un panel (BarraMenu.swift), cada uno con su WKWebView: la
/// ventana y el puente del host (`Host.arrancar`, `Puente`) no calzan todavía (ver «Piezas» en AGENTS.md y los pendientes para
/// Pieza). Lo que sí calza, y vive aquí para que el resto de la app no importe `PiezaHost` (sus `Idioma` y `Puente` se llaman
/// igual que los de Minuta):
/// - `Host.configurar`: app.json, la carpeta de datos (~/minuta) y dónde está el código (el checkout de desarrollo o la app).
/// - `Procesador`: los scripts de bin/ con límite de tiempo (corta también lo que lanzaron), sin variables MINUTA_* de afuera
///   salvo las de la app (`entornoApp`: MINUTA_HERRAMIENTAS), la entrada en un archivo 0600 dentro de una carpeta propia 0700 y
///   nada huérfano al salir.
/// - `Enchufe`: las acciones declaradas en acciones.json (probarIA de la pieza «ia»; gimnasio y preguntar de app.json), con
///   sus datos validados por las mismas reglas que pieza.py y Electron.
/// - `Secretos`: el Llavero (el token del respaldo, con el mismo servicio y la misma cuenta de siempre).
@MainActor
enum PiezaMinuta {
    /// Antes de correr cualquier script: lee app.json de `recursos` (Temas.recursos) y usa el Python de la app.
    static func configurar(recursos: URL, python: URL) {
        if !Host.configurar(.init(estadoScript: nil, recursos: recursos, python: python)) {
            NSLog("Minuta: no encontré un app.json que sirva en %@", recursos.path)
        }
        // El idioma elegido está en perfil.json (no en config.json, que en Minuta es el universo elegido).
        PiezaHost.Idioma.fuente = { Perfil.guardado()["idioma_ui"] ?? "" }
        // Lo que necesitan todos los scripts de Minuta (también los declarados) además de lo que pone el host: dónde están
        // minuta-transcribir y minuta-diarizar.
        Procesador.entornoApp["MINUTA_HERRAMIENTAS"] = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS").path
    }

    /// `script <args…> [entrada.json] <salida.json>` con límite de tiempo. `fin(respuesta)`: el JSON del script o
    /// {ok: false, codigo: "limite" | "fallo", texto, error} del host.
    static func correr(_ script: String, _ args: [String], entrada: [String: Any]? = nil, limite: Int,
                       fin: @escaping @MainActor ([String: Any]) -> Void) {
        Procesador.correr(script, args, entrada: entrada, limite: limite) { r in fin(r.respuesta) }
    }

    /// Al salir: lo que siga corriendo se corta (y lo que lanzó), nada queda huérfano.
    static func cortarTodo() { Procesador.cortarTodo() }

    /// Scripts corriendo ahora (para no actualizar en medio de uno).
    static var enCurso: Int { Procesador.enCurso }

    /// El Llavero de este Mac (`Secretos`: solo en este Mac, con la sesión abierta), con el servicio de siempre: así quien ya
    /// conectó su cuenta no la pierde.
    static func guardarSecreto(_ valor: String, servicio: String, cuenta: String) {
        Secretos(servicio: servicio).guardar(valor, cuenta: cuenta)
    }

    static func leerSecreto(servicio: String, cuenta: String) -> String? {
        Secretos(servicio: servicio).leer(cuenta)
    }
}

/// Las acciones declaradas en acciones.json: las mismas reglas que el host (validar los datos → armar los argumentos → correr el
/// script con su límite → responder con el eco), pero la respuesta va al WKWebView que la pidió (la ventana o el panel), porque
/// `Puente.shared` del host no conoce los de Minuta (pendiente para Pieza).
@MainActor
enum Declaradas {
    private static var cargadas: [String: Enchufe.Accion]?

    static var acciones: [String: Enchufe.Accion] {
        if let c = cargadas { return c }
        let (a, errores) = Enchufe.cargar(Host.recursos)
        for e in errores { NSLog("Minuta: %@", e) }
        cargadas = a
        return a
    }

    /// true si `nombre` está declarada (y ya se pidió); la respuesta llega a `responder(funcion, json)`.
    @discardableResult
    static func correr(_ nombre: String, _ datos: [String: Any], responder: @escaping @MainActor (String, [String: Any]) -> Void) -> Bool {
        guard let a = acciones[nombre] else { return false }
        func responde(_ r: [String: Any], _ entrada: [String: Any]) {
            guard let f = a.responde else { return }
            var x = r
            for k in a.eco { if let v = entrada[k] { x[k] = v } }
            responder(f, x)
        }
        func error(_ codigo: String, _ campo: String, _ texto: String, _ entrada: [String: Any]) {
            responde(["ok": false, "codigo": codigo, "campo": campo, "texto": texto, "valores": [String: String](),
                      "error": PiezaHost.Idioma.t(texto)], entrada)
        }
        let entrada: [String: Any]
        switch Enchufe.validar(a, datos) {
        case .falla(let campo, _):
            // Aunque los datos no pasen, vuelve el eco que sí es válido (la interfaz sabe a qué pedido responde el error).
            error("datos", campo, "No entendí lo que pediste. Intenta de nuevo.", Enchufe.ecoValido(a, datos))
            return true
        case .ok(let e):
            entrada = e
        }
        // Minuta no declara valores que ponga el host («inyectar»): si una acción los pide, no corre.
        if let par = a.inyectar.first {
            error("falta", par.key, "Falta algo para hacer esto.", entrada)
            return true
        }
        let args = Enchufe.armarArgs(a, entrada)
        let limite = a.limite(para: entrada)
        Procesador.correr(a.script, args, entrada: a.porArchivo ? entrada : nil, limite: limite ?? 3600, latido: limite == nil) { r in
            responde(r.respuesta, entrada)
        }
        return true
    }
}
