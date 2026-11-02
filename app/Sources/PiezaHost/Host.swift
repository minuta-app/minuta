// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
import AppKit
import Foundation

/// Pieza «host-mac»: la app de Mac genérica. Lee `app.json` (dentro de la app, en `Contents/Resources/<id>/`) y de ahí saca el
/// id, el nombre, la carpeta de datos y las claves de config permitidas: nada de una app adentro. Equivale a la pieza
/// «host-escritorio» (Electron) y usa las mismas reglas que `bin/nucleo.py`.
///
///     @main enum AnaApp {
///         @MainActor static func main() {
///             Host.arrancar(.init(sitio: "https://ana-app.github.io/ana/")) { puente in
///                 puente.registrar("grabar") { datos in … puente.llamar("grabando", ["ok": true]) }
///             }
///         }
///     }
@MainActor
public enum Host {
    public struct Configuracion {
        /// Tamaño de la ventana la primera vez (después se recuerda) y el mínimo.
        public var ancho: CGFloat
        public var alto: CGFloat
        public var minAncho: CGFloat
        public var minAlto: CGFloat
        /// Enlaces del menú Ayuda (solo https).
        public var sitio: String?
        public var codigo: String?
        /// false: sin menú Ayuda aunque haya `sitio` o `codigo` (la app pone el suyo o no quiere ninguno).
        public var menuAyuda: Bool
        /// La app muestra avisos del sistema (Notificaciones): el host se encarga de que tocar uno abra la ventana desde el arranque.
        public var avisos: Bool
        /// El objeto `window.<App>` de la interfaz (pieza «host-ui»). Sin él: el id con mayúscula («ana» → «Ana»).
        public var global: String?
        /// El script que arma el estado al abrir (si existe en bin/). nil: ninguno.
        public var estadoScript: String?
        /// Cerrar la ventana cierra la app (sin esto, como en las apps de Mac: la app sigue y se vuelve a abrir desde el Dock).
        public var cerrarSale: Bool
        /// Solo para desarrollo y pruebas: dónde están app.json, bin/ y ui/, y qué Python usar.
        public var recursos: URL?
        public var python: URL?
        /// Segundos que puede tardar el script del estado (apps con mucho historial: más).
        public var limiteEstado: Int
        /// El estado se arma dentro de la fila (`Fila`): nunca se lee a medio guardar una acción con "cola": "escritura".
        public var estadoEnFila: Bool
        /// El título de «Ajustes…» en el menú de la app (se traduce como todo; una app para niños: «Para adultos…»). nil: sin ese ítem.
        public var tituloAjustes: String?
        /// App de barra de menú: sin Dock ni menús mientras la ventana está cerrada (.accessory) y con Dock y menús mientras está
        /// abierta (también al reabrirla desde el Dock o con `p.mostrar()`).
        public var barraDeMenu: Bool
        /// ¿Abrir la ventana al arrancar? nil: siempre. P. ej. `{ faltaAlgo }` (si no falta nada, queda en la barra de menú).
        public var abrirAlArrancar: (@MainActor () -> Bool)?
        /// La interfaz llega hasta arriba: barra de título transparente, sin título, y una franja invisible de `altoFranja` puntos
        /// que mueve la ventana (doble clic: zoom). WKWebView no entiende `-webkit-app-region`. La interfaz lo sabe por
        /// `window.<ID>_BARRA === "transparente"` (y deja ese espacio libre: los botones de la ventana quedan encima).
        public var barraTransparente: Bool
        public var altoFranja: CGFloat
        /// Vidrio: el fondo translúcido de macOS detrás de la interfaz (implica `barraTransparente`); `window.<ID>_VIDRIO = true`.
        public var vidrio: Bool
        /// El nombre con el que macOS recuerda el tamaño de la ventana. nil: el nombre de la app. Una app con tilde que ya existía
        /// pasa el de antes (sin tilde) para que nadie pierda el tamaño de su ventana.
        public var nombreVentana: String?

        public init(ancho: CGFloat = 1280, alto: CGFloat = 800, minAncho: CGFloat = 720, minAlto: CGFloat = 520, sitio: String? = nil,
                    codigo: String? = nil, menuAyuda: Bool = true, avisos: Bool = false, global: String? = nil, estadoScript: String? = "estado.py",
                    cerrarSale: Bool = false, recursos: URL? = nil, python: URL? = nil, limiteEstado: Int = 60, estadoEnFila: Bool = false,
                    tituloAjustes: String? = "Ajustes…", barraDeMenu: Bool = false, abrirAlArrancar: (@MainActor () -> Bool)? = nil,
                    barraTransparente: Bool = false, altoFranja: CGFloat = 30, vidrio: Bool = false, nombreVentana: String? = nil) {
            self.ancho = ancho; self.alto = alto; self.minAncho = minAncho; self.minAlto = minAlto
            self.sitio = sitio; self.codigo = codigo; self.menuAyuda = menuAyuda; self.avisos = avisos
            self.global = global; self.estadoScript = estadoScript
            self.cerrarSale = cerrarSale; self.recursos = recursos; self.python = python
            self.limiteEstado = min(max(limiteEstado, 1), 3600); self.estadoEnFila = estadoEnFila
            self.tituloAjustes = tituloAjustes; self.barraDeMenu = barraDeMenu; self.abrirAlArrancar = abrirAlArrancar
            self.barraTransparente = barraTransparente || vidrio; self.altoFranja = max(altoFranja, 0); self.vidrio = vidrio
            self.nombreVentana = nombreVentana
        }
    }

    public private(set) static var opciones = Configuracion()
    /// app.json tal cual (validado: id, nombre, datos, config).
    public private(set) static var app: [String: Any] = [:]
    public private(set) static var id = ""
    public private(set) static var nombre = ""
    public private(set) static var recursos = URL(fileURLWithPath: "/")
    public private(set) static var datos = URL(fileURLWithPath: "/")
    private static var datosPropios = false
    /// Con "datos": "visible": ~/<Nombre> (la carpeta que ve la persona; los datos internos van en ~/<Nombre>/.<id>).
    private static var carpetaVisible: URL?

    /// Lee app.json y deja todo listo. false si la app no trae un app.json que sirva (sin él no hay app).
    @discardableResult
    public static func configurar(_ c: Configuracion = .init()) -> Bool {
        opciones = c
        guard let r = c.recursos ?? recursosEmpaquetados() else { return false }
        let a = Archivos.leerJSON(r.appendingPathComponent("app.json"))
        guard let i = a["id"] as? String, Texto.calza(i, "[a-z][a-z0-9]{0,30}") else { return false }
        var d = a
        if (d["nombre"] as? String ?? "").isEmpty { d["nombre"] = i.prefix(1).uppercased() + i.dropFirst() }
        if d["datos"] == nil { d["datos"] = "sistema" }
        if !(d["config"] is [String: Any]) { d["config"] = [String: Any]() }
        app = d
        id = i
        nombre = d["nombre"] as? String ?? i
        recursos = r
        guard let carpeta = carpetaDatos() else { return false }
        datos = carpeta
        return true
    }

    /// `Contents/Resources/<id>/app.json`: la carpeta cuyo app.json dice ese mismo id.
    private static func recursosEmpaquetados() -> URL? {
        guard let base = Bundle.main.resourceURL,
              let hijos = try? FileManager.default.contentsOfDirectory(at: base, includingPropertiesForKeys: nil) else { return nil }
        for h in hijos where Texto.calza(h.lastPathComponent, "[a-z][a-z0-9]{0,30}") {
            if Archivos.leerJSON(h.appendingPathComponent("app.json"))["id"] as? String == h.lastPathComponent { return h }
        }
        return nil
    }

    /// La misma carpeta que `nucleo.carpeta_datos()`: Application Support/<Nombre>, ~/<Nombre>/.<id> o la carpeta propia de app.json.
    private static func carpetaDatos() -> URL? {
        let casa = FileManager.default.homeDirectoryForCurrentUser.resolvingSymlinksInPath()
        if let propia = app["datos"] as? [String: Any] {
            let crudo = propia["carpeta"] as? String ?? ""
            let ruta = crudo.hasPrefix("~") ? casa.path + String(crudo.dropFirst()) : crudo
            let u = URL(fileURLWithPath: ruta).standardizedFileURL
            guard u.path.hasPrefix(casa.path + "/") else { return nil }
            datosPropios = true
            return u
        }
        if app["datos"] as? String == "visible" {
            carpetaVisible = casa.appendingPathComponent(nombre)
            return casa.appendingPathComponent(nombre).appendingPathComponent("." + id)
        }
        return casa.appendingPathComponent("Library/Application Support").appendingPathComponent(nombre)
    }

    /// La carpeta de datos queda solo para la persona (0700). Con "datos": "visible", ~/<Nombre> recién creada también (como
    /// `nucleo.carpeta_datos()`; una que ya existía no se toca). Una carpeta propia de app.json se usa tal cual.
    public static func prepararDatos() {
        guard !datosPropios else { return }
        if let v = carpetaVisible, !FileManager.default.fileExists(atPath: v.path) {
            try? FileManager.default.createDirectory(at: v, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: v.path)
        }
        try? FileManager.default.createDirectory(at: datos, withIntermediateDirectories: true)
        try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: datos.path)
    }

    /// Python portátil que viene dentro de la app (Contents/Resources/python).
    public static var python: URL {
        opciones.python ?? Bundle.main.resourceURL!.appendingPathComponent("python/bin/python3")
    }

    /// Prefijo de las variables de entorno («ana» → «ANA_»).
    public static var prefijo: String { id.uppercased() + "_" }

    /// La versión de la app (Info.plist).
    public static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }

    /// Arranque completo: configura, crea la app de Mac, deja que la app registre lo suyo y abre la ventana.
    public static func arrancar(_ c: Configuracion = .init(), preparar: @escaping @MainActor (Puente) -> Void) {
        guard configurar(c) else { fatalError("No encontré un app.json que sirva dentro de la app (Contents/Resources/<id>/app.json).") }
        let app = NSApplication.shared
        Delegado.compartido = Delegado(preparar: preparar)
        app.delegate = Delegado.compartido
        // Una app de barra de menú parte sin Dock: aparece en él solo mientras su ventana está abierta (Puente.mostrar).
        app.setActivationPolicy(c.barraDeMenu ? .accessory : .regular)
        app.run()
    }
}

/// El delegado de la app: abre la ventana, la vuelve a mostrar desde el Dock y, antes de cerrar, espera los guardados.
@MainActor
public final class Delegado: NSObject, NSApplicationDelegate {
    static var compartido: Delegado?
    private let preparar: @MainActor (Puente) -> Void

    init(preparar: @escaping @MainActor (Puente) -> Void) { self.preparar = preparar }

    public func applicationDidFinishLaunching(_ aviso: Notification) {
        Host.prepararDatos()
        let p = Puente.shared
        // Antes de lo de la app: si la app se abrió tocando un aviso, ese toque ya tiene quién lo atienda (la app puede poner otro).
        if Host.opciones.avisos { Notificaciones.preparar() }
        preparar(p)
        p.instalarMenus()
        p.aplicarApariencia()
        if let c = p.carpeta, let v = p.vigilante, let u = c.actual() { v.empezar(u) }
        if Host.opciones.abrirAlArrancar?() ?? true { p.mostrar() }
        // En el primer uso lo primero es elegir el idioma: lo que corre solo espera a que esté elegido.
        if Idioma.elegido { p.iniciarTareas() }
    }

    /// Desde el Dock o abriendo la app otra vez: la ventana (con Dock y menús, también en una app de barra de menú).
    public func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        Puente.shared.mostrar()
        return true
    }

    public func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { Host.opciones.cerrarSale }

    /// La interfaz guarda lo pendiente y se espera a que terminen los guardados (como mucho 3 segundos).
    public func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        Puente.shared.guardarTodo()
        Puente.shared.esperarLibre(segundos: 3) { _ in
            Puente.shared.antesDeSalir?()
            Puente.shared.vigilante?.detener()
            // Lo que siga corriendo se corta (un trabajo queda «interrumpido» y se sigue al volver): nada queda huérfano.
            Procesador.cortarTodo()
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }
}

// MARK: - Archivos y texto

public enum Archivos {
    public static func leerJSON(_ url: URL, maximo: Int = 50 * 1024 * 1024) -> [String: Any] {
        guard let tam = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? Int, tam <= maximo,
              let d = try? Data(contentsOf: url), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return [:] }
        return j
    }

    /// JSON con claves ordenadas, escrito de una vez y solo para la persona (0600).
    @discardableResult
    public static func escribirJSON(_ url: URL, _ valor: Any, privado: Bool = true) -> Bool {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard JSONSerialization.isValidJSONObject(valor),
              let d = try? JSONSerialization.data(withJSONObject: valor, options: [.prettyPrinted, .sortedKeys]),
              (try? d.write(to: url, options: .atomic)) != nil else { return false }
        if privado { try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path) }
        return true
    }
}

public enum Texto {
    /// ¿El texto entero calza con el patrón?
    public static func calza(_ s: String, _ patron: String) -> Bool {
        guard let re = try? NSRegularExpression(pattern: "^(?:\(patron))$") else { return false }
        return re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    /// Un JSON booleano (JSONSerialization da NSNumber: `as? Bool` también acepta 0 y 1).
    public static func esBool(_ v: Any?) -> Bool {
        guard let v else { return false }
        return CFGetTypeID(v as CFTypeRef) == CFBooleanGetTypeID()
    }

    /// Un JSON entero (no booleano, sin decimales).
    public static func entero(_ v: Any?) -> Int? {
        guard let n = v as? NSNumber, !esBool(n) else { return nil }
        let d = n.doubleValue
        guard d.rounded() == d, abs(d) < 9_007_199_254_740_992 else { return nil }
        return n.intValue
    }

    /// «ana» → «Ana».
    public static func global(_ id: String) -> String { id.prefix(1).uppercased() + id.dropFirst() }
}

// MARK: - Configuración (config.json en la carpeta de datos, compartida con nucleo.config())

@MainActor
public enum Config {
    public static var ruta: URL { Host.datos.appendingPathComponent("config.json") }
    public static var reglas: [String: Any] { Host.app["config"] as? [String: Any] ?? [:] }

    /// Solo las claves de app.json con valores válidos (lo demás se descarta).
    public static func leer() -> [String: Any] { limpiar(Archivos.leerJSON(ruta, maximo: 1024 * 1024)) }

    public static func limpiar(_ d: [String: Any]) -> [String: Any] {
        let r = reglas
        return d.filter { k, v in r[k].map { valida($0, v) } ?? false }
    }

    /// Mezcla los cambios válidos con lo que hay en el archivo. Desde la interfaz nunca cambia una clave marcada
    /// "interfaz": false en app.json (esas las escribe la app con desdeInterfaz: false).
    @discardableResult
    public static func guardar(_ cambios: [String: Any], desdeInterfaz: Bool = true) -> [String: Any] {
        let r = reglas
        let soloDeLaApp = { (k: String) -> Bool in
            guard let regla = r[k] as? [String: Any], let i = regla["interfaz"], Texto.esBool(i) else { return false }
            return (i as? Bool) == false
        }
        let limpios = limpiar(cambios).filter { k, _ in !(desdeInterfaz && soloDeLaApp(k)) }
        Host.prepararDatos()
        var d = Archivos.leerJSON(ruta, maximo: 1024 * 1024)
        for (k, v) in limpios { d[k] = v }
        Archivos.escribirJSON(ruta, d)
        return leer()
    }

    public static func texto(_ clave: String) -> String { (leer()[clave] as? String) ?? "" }

    /// Las mismas reglas que nucleo._valida.
    public static func valida(_ regla: Any, _ valor: Any) -> Bool {
        if let r = regla as? [String: Any] {
            let max = Texto.entero(r["max"]).flatMap { $0 > 0 && $0 <= 5 * 1024 * 1024 ? $0 : nil } ?? 2000
            if r["tipo"] as? String == "texto", let patron = r["patron"] as? String {
                guard let s = valor as? String, s.count <= max else { return false }
                return Texto.calza(s, patron)
            }
            if r["tipo"] as? String == "texto", Texto.entero(r["max"]) != nil {
                guard let s = valor as? String else { return false }
                return s.count <= max
            }
            return r["tipo"].map { valida($0, valor) } ?? false
        }
        if let lista = regla as? [Any] {
            if let s = valor as? String { return lista.contains { ($0 as? String) == s } }
            if Texto.esBool(valor) { return false }
            if let n = valor as? NSNumber { return lista.contains { ($0 as? NSNumber).map { !Texto.esBool($0) && $0 == n } ?? false } }
            return false
        }
        switch regla as? String {
        case "bool": return Texto.esBool(valor)
        case "texto": return (valor as? String).map { $0.count <= 2000 } ?? false
        case "numero": return (valor as? NSNumber).map { !Texto.esBool($0) && $0.doubleValue.isFinite } ?? false
        default: return false
        }
    }
}

// MARK: - Idioma (las claves son el texto en español, igual que en ui/idiomas)

@MainActor
public enum Idioma {
    private static var cache: (codigo: String, textos: [String: String])?
    /// De dónde leer el idioma elegido si la app no lo guarda en config.json (devuelve el código o ""). nil: config.idioma_ui.
    public static var fuente: (@MainActor () -> String)?
    private static var elegidoAhora: String { fuente?() ?? Config.texto("idioma_ui") }

    /// Los idiomas de app.json (config.idioma_ui); sin ellos, español e inglés.
    public static var idiomas: [String] {
        let l = (Config.reglas["idioma_ui"] as? [Any] ?? []).compactMap { $0 as? String }.filter { Texto.calza($0, "[a-z]{2,3}") }
        return l.isEmpty ? ["es", "en"] : l
    }

    /// Uno de los idiomas de app.json: el elegido o el del sistema (el archivo de traducciones se busca con este código).
    public static var codigo: String {
        let lista = idiomas
        let e = elegidoAhora
        if lista.contains(e) { return e }
        let s = String((Locale.preferredLanguages.first ?? "").prefix(2)).lowercased()
        if lista.contains(s) { return s }
        return lista.contains("en") ? "en" : lista[0]
    }

    /// Ya hay idioma: lo eligió (bienvenida o Ajustes) o terminó la bienvenida. Antes, nada corre solo ni se pide.
    public static var elegido: Bool {
        let c = Config.leer()
        return !elegidoAhora.isEmpty || (Texto.esBool(c["bienvenida"]) && (c["bienvenida"] as? Bool) == true)
    }

    public static func t(_ texto: String) -> String {
        let c = codigo
        guard c != "es" else { return texto }
        if cache?.codigo != c {
            let j = Archivos.leerJSON(Host.recursos.appendingPathComponent("ui/idiomas/\(c).json"), maximo: 5 * 1024 * 1024)
            cache = (c, j["textos"] as? [String: String] ?? [:])
        }
        return cache?.textos[texto] ?? texto
    }

    /// Una frase con marcadores ({x}, {n}…): se traduce entera y después se ponen los valores.
    public static func f(_ plantilla: String, _ valores: [String: String]) -> String {
        var t = self.t(plantilla)
        for (k, v) in valores { t = t.replacingOccurrences(of: "{\(k)}", with: v) }
        return t
    }

    public static func olvidar() { cache = nil }
}
