// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
import AppKit
import UniformTypeIdentifiers
import WebKit

/// Pieza «host-mac»: la ventana con la interfaz de ui/ (WKWebView) y el puente `host.enviar(accion, datos)` ↔
/// `window.<App>.<funcion>(json)` (pieza «host-ui»). Equivale a host.js de «host-escritorio».
///
/// Orden al recibir una acción: lo que registró la app (`registrar`) → lo que trae el host (listo, config, abrirEnlace, copiar)
/// → lo declarado en acciones.json (validar, inyectar, fila, script con límite, eco, responder, después). Lo demás se ignora.
///
/// Seguridad: solo el marco principal con un archivo de ui/ habla con el puente; la ventana nunca navega fuera de ui/ (un
/// enlace https se abre en el navegador); `<id>://` sirve solo lo que aprueba el resolvedor de medios de la app.
@MainActor
public final class Puente: NSObject, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    public typealias Datos = [String: Any]
    public static let shared = Puente()

    public private(set) var ventana: NSWindow?
    public private(set) var web: WKWebView?
    public private(set) var lista = false

    private var registradas: [String: @MainActor (Datos) -> Void] = [:]
    private var internas: [String: @MainActor (Datos) -> Void] = [:]
    private var declaradas: [String: Enchufe.Accion] = [:]
    public private(set) var errores: [String] = []
    private var ocupadas = 0
    private var tareasIniciadas = false
    private var medios: Medios?

    /// Valores que pone el host, nunca la interfaz (`inyectar` de una acción): `idiomaUI`, `carpetaDatos`, `carpetaActual` (con
    /// `carpeta`) y los de la app (`puente.inyectores["proyecto"] = { _ in … }`). nil = no corre (responde codigo «falta»); una
    /// `Falta("Elige una carpeta primero.")`, lo mismo con ese texto.
    public var inyectores: [String: @MainActor (Datos) -> Any?] = [:]
    /// Lo que devuelve un inyector cuando falta algo, con su texto (en español, con marcadores; la interfaz lo traduce).
    public struct Falta {
        public let texto: String
        public let valores: [String: String]
        public init(_ texto: String, _ valores: [String: String] = [:]) { self.texto = texto; self.valores = valores }
    }
    /// La carpeta que elige la persona (con marcador: la sigue aunque la mueva). Con ella, el inyector `carpetaActual`.
    public var carpeta: CarpetaElegida? {
        didSet {
            guard let c = carpeta else { return }
            // Lo que la app ya puso gana (p. ej. "" sin carpeta, para que su script decida).
            if inyectores["carpetaActual"] == nil {
                inyectores["carpetaActual"] = { _ -> Any? in
                    if let u = c.actual() { return u.path }
                    return Falta(c.textoFalta)
                }
            }
            c.alCambiar = { [unowned self] u in if let u { self.vigilante?.empezar(u) } else { self.vigilante?.detener() } }
        }
    }
    /// El vigilante de la carpeta (avisa `archivoCambiado` cuando un archivo conocido cambia afuera). Las acciones con
    /// «vigilar» le dicen qué texto leyó o escribió la app.
    public var vigilante: Vigilante?
    /// Las actualizaciones (pieza «actualizaciones»): el host atiende buscarActualizacion y actualizar, las revisa cada rato con
    /// el idioma elegido y suma `actualizacion` al estado.
    public var actualizaciones: Actualizador? {
        didSet { if actualizaciones != nil { registrarActualizaciones() } }
    }

    /// Las funciones de la pieza «actualizaciones» (el host no la importa: así una app sin ella compila igual).
    ///     p.actualizaciones = .init(revisar: Actualizaciones.revisar, revisarCadaRato: Actualizaciones.revisarCadaRato,
    ///         seguir: Actualizaciones.seguir, instalar: Actualizaciones.instalar, aviso: Actualizaciones.aviso,
    ///         disponible: { Actualizaciones.disponible })
    public struct Actualizador {
        public var revisar: @MainActor (@escaping @MainActor ([String: Any]) -> Void) -> Void
        public var revisarCadaRato: @MainActor (@escaping @MainActor ([String: Any]) -> Void) -> Void
        public var seguir: @MainActor (@escaping @MainActor ([String: Any]) -> Void) -> Void
        public var instalar: @MainActor (@escaping @MainActor (Bool, String) -> Void) -> Void
        public var aviso: @MainActor (String, String) -> [String: Any]
        public var disponible: @MainActor () -> [String: Any]
        public init(revisar: @escaping @MainActor (@escaping @MainActor ([String: Any]) -> Void) -> Void,
                    revisarCadaRato: @escaping @MainActor (@escaping @MainActor ([String: Any]) -> Void) -> Void,
                    seguir: @escaping @MainActor (@escaping @MainActor ([String: Any]) -> Void) -> Void,
                    instalar: @escaping @MainActor (@escaping @MainActor (Bool, String) -> Void) -> Void,
                    aviso: @escaping @MainActor (String, String) -> [String: Any],
                    disponible: @escaping @MainActor () -> [String: Any]) {
            self.revisar = revisar; self.revisarCadaRato = revisarCadaRato; self.seguir = seguir
            self.instalar = instalar; self.aviso = aviso; self.disponible = disponible
        }
    }

    private func registrarActualizaciones() {
        internas["buscarActualizacion"] = { [unowned self] _ in
            guard let act = self.actualizaciones else { return }
            act.revisar { r in self.llamar("actualizacionRevisada", r) }
        }
        internas["actualizar"] = { [unowned self] _ in
            // La interfaz guarda todo justo antes de pedirlo: se espera. Nunca en medio de un guardado o de un script.
            self.esperarLibre(segundos: 5) { libre in
                guard let act = self.actualizaciones else { return }
                guard libre else {
                    self.llamar("actualizacionProgreso", ["paso": "error", "codigo": "ocupada", "texto": "Espera a que termine lo que está haciendo y vuelve a intentarlo.",
                                                          "valores": [String: String](), "total": 3])
                    return
                }
                act.seguir { self.llamar("actualizacionProgreso", $0) }
                act.instalar { ok, codigo in if !ok { self.llamar("actualizacionProgreso", act.aviso("error", codigo)) } }
            }
        }
    }
    /// Suma lo propio al estado antes de mandarlo (llama `listo` con el estado final).
    public var estado: (@MainActor (Datos, @escaping @MainActor (Datos) -> Void) -> Void)?
    /// Lo que corre solo (revisar actualizaciones…), una vez y recién con el idioma elegido.
    public var tareas: (@MainActor () -> Void)?
    /// Después de guardar config (nueva, anterior).
    public var alCambiarConfig: (@MainActor (Datos, Datos) -> Void)?
    /// Los menús del medio (entre el de la app y Ventana). Sin esto: Archivo, Edición y Ver de siempre.
    public var menus: (@MainActor (Menus) -> [NSMenuItem])?
    /// Justo antes de cerrar la app (después de esperar los guardados).
    public var antesDeSalir: (@MainActor () -> Void)?
    /// Para la app: configurar el WKWebView antes de crearlo (otro manejador de mensajes, otra preferencia).
    public var alConfigurarWeb: (@MainActor (WKWebViewConfiguration) -> Void)?

    private override init() {
        super.init()
        let (a, e) = Enchufe.cargar(Host.recursos)
        declaradas = a
        errores = e
        for x in e { NSLog("%@: %@", Host.nombre, x) }
        inyectores["idiomaUI"] = { _ in Idioma.codigo }
        inyectores["carpetaDatos"] = { _ in Host.datos.path }
        internas["listo"] = { [unowned self] _ in self.lista = true; self.enviarEstado() }
        internas["config"] = { [unowned self] d in self.guardarConfig(d) }
        internas["abrirEnlace"] = { [unowned self] d in self.abrirEnlace(d["url"]) }
        internas["copiar"] = { [unowned self] d in self.llamar("copiado", ["ok": self.copiar(d["texto"])]) }
    }

    // MARK: Lo que usa la app

    /// Una acción propia de la app (grabar la pantalla, un lienzo…). Gana sobre lo que trae el host y lo declarado: así una app
    /// migra de a poco.
    public func registrar(_ accion: String, _ fn: @escaping @MainActor (Datos) -> Void) {
        precondition(Texto.calza(accion, Enchufe.nombre), "acción rara: \(accion)")
        registradas[accion] = fn
    }

    /// `Puente.registrar("grabar") { datos in … }`
    public static func registrar(_ accion: String, _ fn: @escaping @MainActor (Datos) -> Void) { shared.registrar(accion, fn) }

    /// `<id>://<nombre>/<ruta>`: `resolver(ruta)` devuelve el archivo que se puede servir (con rangos) o nil. Antes de mostrar().
    public func registrarMedios(_ nombre: String, _ resolver: @escaping @MainActor (String) -> URL?) {
        precondition(Texto.calza(nombre, "[a-z][a-z0-9-]{0,30}") && nombre != "ui", "medios: nombre raro")
        if medios == nil { medios = Medios() }
        medios?.resolvedores[nombre] = resolver
    }

    public var acciones: [String] { Array(Set(registradas.keys).union(internas.keys).union(declaradas.keys)).sorted() }

    /// Hacia la interfaz: `window.<App>.<funcion>(json)`. Solo nombres de función simples y JSON. No devuelve nada (así
    /// `guard … else { return p.llamar(…) }` compila en una acción); para saber si se pudo mandar, `intentarLlamar`.
    public func llamar(_ funcion: String, _ datos: Any) { intentarLlamar(funcion, datos) }

    /// Lo mismo que `llamar`, y dice si se mandó (false: la interfaz aún no está lista, o el nombre o los datos no sirven).
    @discardableResult
    public func intentarLlamar(_ funcion: String, _ datos: Any) -> Bool {
        let global = Host.opciones.global ?? Texto.global(Host.id)
        guard lista, let web, Texto.calza(funcion, Enchufe.nombre), Texto.calza(global, "[A-Z][A-Za-z0-9]{0,40}"),
              JSONSerialization.isValidJSONObject(["x": datos]),
              let d = try? JSONSerialization.data(withJSONObject: ["x": datos]), let json = String(data: d, encoding: .utf8) else { return false }
        web.evaluateJavaScript("window.\(global) && typeof window.\(global).\(funcion) === 'function' && window.\(global).\(funcion)((\(json)).x)")
        return true
    }

    /// Corre una acción como si la hubiera pedido la interfaz (para `despues` y para la app).
    public func despachar(_ accion: String, _ datos: Datos) {
        guard Texto.calza(accion, Enchufe.nombre) else { return }
        if let f = registradas[accion] { return f(datos) }
        if let f = internas[accion] { return f(datos) }
        if let a = declaradas[accion] { correrDeclarada(a, datos) }
    }

    /// Algo se cortaría si la app se cierra: la fila, un script, o lo que la app marcó con ocupar()/soltar().
    public var ocupada: Bool { Fila.pendientes > 0 || Procesador.enCurso > 0 || ocupadas > 0 }
    public func ocupar() { ocupadas += 1 }
    public func soltar() { ocupadas = max(0, ocupadas - 1) }

    /// Espera (hasta `segundos`) a que no quede nada en la fila, ningún script corriendo ni nada marcado; `listo(true)` si quedó libre.
    public func esperarLibre(segundos: Double, _ listo: @escaping @MainActor (Bool) -> Void) {
        let limite = Date().addingTimeInterval(segundos)
        func revisar() {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                Task { @MainActor in
                    let libre = !Puente.shared.ocupada
                    if libre || Date() >= limite { listo(libre) } else { revisar() }
                }
            }
        }
        revisar()
    }

    public func iniciarTareas() {
        guard !tareasIniciadas else { return }
        tareasIniciadas = true
        if let act = actualizaciones { act.revisarCadaRato { [unowned self] r in self.llamar("actualizacionRevisada", r) } }
        tareas?()
    }

    public func guardarTodo() { llamar("menu", ["accion": "guardar"]) }

    // MARK: Ventana

    public func mostrar() {
        if ventana == nil { crear() }
        ventana?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private var carpetaUI: URL { Host.recursos.appendingPathComponent("ui") }
    /// ui/ sin enlaces simbólicos, con «/» al final, para comparar rutas.
    private var prefijoUI: String { carpetaUI.resolvingSymlinksInPath().path + "/" }

    private func crear() {
        let control = WKUserContentController()
        control.add(self, name: Host.id)
        control.addUserScript(WKUserScript(source: "window.\(Host.prefijo)HOST = 'mac';", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let conf = WKWebViewConfiguration()
        conf.userContentController = control
        // La interfaz lee sus traducciones (ui/idiomas/*.json) con fetch desde sus propios archivos.
        conf.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        if let medios { conf.setURLSchemeHandler(medios, forURLScheme: Host.id) }
        alConfigurarWeb?(conf)
        let o = Host.opciones
        let w = WKWebView(frame: NSRect(x: 0, y: 0, width: o.ancho, height: o.alto), configuration: conf)
        w.navigationDelegate = self
        w.uiDelegate = self
        w.autoresizingMask = [.width, .height]
        let v = NSWindow(contentRect: NSRect(x: 0, y: 0, width: o.ancho, height: o.alto),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        v.title = Host.nombre
        v.minSize = NSSize(width: o.minAncho, height: o.minAlto)
        v.contentView = w
        v.delegate = self
        v.isReleasedWhenClosed = false
        v.setFrameAutosaveName(Host.nombre)
        if !v.setFrameUsingName(Host.nombre) { v.center() }
        ventana = v
        web = w
        aplicarApariencia()
        w.loadFileURL(carpetaUI.appendingPathComponent("index.html"), allowingReadAccessTo: carpetaUI)
    }

    /// Cerrar la ventana guarda lo pendiente (y, si la app lo pidió, la cierra: applicationShouldTerminateAfterLastWindowClosed).
    public func windowWillClose(_ notification: Notification) { guardarTodo() }

    /// La ventana y los menús siguen la apariencia elegida (pieza «tema»: config.tema = sistema | claro | oscuro).
    public func aplicarApariencia() {
        let a: NSAppearance?
        switch Config.texto("tema") {
        case "claro": a = NSAppearance(named: .aqua)
        case "oscuro": a = NSAppearance(named: .darkAqua)
        default: a = nil
        }
        NSApp.appearance = a
        ventana?.appearance = a
    }

    // MARK: Navegación: la ventana solo muestra la interfaz que viene dentro de la app

    public func webView(_ webView: WKWebView, decidePolicyFor accion: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let u = accion.request.url else { return .cancel }
        if u.isFileURL, u.resolvingSymlinksInPath().path.hasPrefix(prefijoUI) { return .allow }
        // Medios propios (un <video src="<id>://…">) se cargan como subrecursos; una navegación a ellos, nunca.
        if u.scheme == "https", accion.navigationType == .linkActivated { abrirEnlace(u.absoluteString) }
        return .cancel
    }

    /// Un <input type="file"> de la interfaz: el panel del sistema (solo para el marco principal propio).
    public func webView(_ webView: WKWebView, runOpenPanelWith parametros: WKOpenPanelParameters, initiatedByFrame marco: WKFrameInfo) async -> [URL]? {
        guard marco.isMainFrame, marco.securityOrigin.protocol == "file" else { return nil }
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parametros.allowsMultipleSelection
        panel.prompt = Idioma.t("Agregar")
        return panel.runModal() == .OK ? panel.urls : nil
    }

    /// Si el proceso de la página se cae (poca memoria), se vuelve a cargar la interfaz: lo guardado está en el disco.
    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        lista = false
        webView.loadFileURL(carpetaUI.appendingPathComponent("index.html"), allowingReadAccessTo: carpetaUI)
    }

    // MARK: Desde la interfaz

    public func userContentController(_ c: WKUserContentController, didReceive mensaje: WKScriptMessage) {
        // Solo la interfaz local: el marco principal, con un archivo de ui/. Una página de internet o un iframe, nunca.
        guard mensaje.frameInfo.isMainFrame, mensaje.frameInfo.securityOrigin.protocol == "file",
              let u = mensaje.frameInfo.request.url, u.isFileURL, u.resolvingSymlinksInPath().path.hasPrefix(prefijoUI),
              let m = mensaje.body as? [String: Any], let accion = m["accion"] as? String, Texto.calza(accion, Enchufe.nombre) else { return }
        despachar(accion, m["datos"] as? Datos ?? [:])
    }

    /// Una acción declarada: validar → inyectar → (fila) → script con límite → eco → responder → después.
    private func correrDeclarada(_ a: Enchufe.Accion, _ datos: Datos) {
        func responder(_ r: Datos, _ entrada: Datos) {
            guard let f = a.responde else { return }
            var x = r
            for k in a.eco { if let v = entrada[k] { x[k] = v } }
            self.llamar(f, x)
        }
        func error(_ codigo: String, _ campo: String, _ texto: String, _ valores: [String: String], _ entrada: Datos) {
            responder(["ok": false, "codigo": codigo, "campo": campo, "texto": texto, "valores": valores, "error": Idioma.f(texto, valores)], entrada)
        }
        var entrada: Datos
        switch Enchufe.validar(a, datos) {
        // Aunque los datos no pasen, vuelve el eco que sí es válido (la interfaz sabe a qué orden responde el error).
        case .falla(let campo, _): return error("datos", campo, "No entendí lo que pediste. Intenta de nuevo.", [:], Enchufe.ecoValido(a, datos))
        case .ok(let e): entrada = e
        }
        for (campo, fuente) in a.inyectar {
            let v: Any? = inyectores[fuente].flatMap { $0(entrada) }
            if let f = v as? Falta { return error("falta", campo, f.texto, f.valores, entrada) }
            guard let v, !(v is NSNull) else { return error("falta", campo, "Falta algo para hacer esto.", [:], entrada) }
            entrada[campo] = v
        }
        let args = Enchufe.armarArgs(a, entrada)
        let limite = a.limite(para: entrada)
        var progreso: (@MainActor ([[String: Any]]) -> Void)? = nil
        if let p = a.progreso { progreso = { [unowned self] eventos in self.llamar(p, ["eventos": eventos]) } }
        let final = entrada
        let tarea: Fila.Tarea = { [unowned self] listo in
            // «vigilar»: el vigilante conoce el texto que la app escribe ANTES de escribirlo (y el que lee, al leerlo).
            let v = a.vigilar == nil ? nil : self.vigilante
            let ruta: String? = v == nil ? nil : (final["ruta"] as? String)
            let antes = ruta.flatMap { v?.conocidos[$0] }
            if let v, let ruta, a.vigilar == "escribe" { v.conocer(ruta, final["texto"] as? String) }
            Procesador.correr(a.script, args, entrada: a.porArchivo ? final : nil, limite: limite ?? 3600, latido: limite == nil, progreso: progreso) { r in
                if let v, let ruta {
                    let ok = r.respuesta["ok"] as? Bool == true
                    if a.vigilar == "lee", ok, let t = r.respuesta["texto"] as? String { v.conocer(ruta, t) }
                    if a.vigilar == "escribe", !ok { v.conocer(ruta, antes) }
                }
                responder(r.respuesta, final)
                for x in a.despues where x != a.nombre { self.despachar(x, [:]) }
                listo()
            }
        }
        if a.enFila { Fila.agregar(tarea) } else { tarea {} }
    }

    // MARK: Lo que trae el host

    /// Todo lo que pinta la interfaz al abrir: bin/estado.py (si existe) + versión, idioma, plataforma y config + lo de la app.
    public func enviarEstado() {
        guard lista else { return }
        let terminar = { [unowned self] (base: Datos) in
            var b = base
            b.removeValue(forKey: "ok"); b.removeValue(forKey: "error")
            b["version"] = Host.version
            b["idioma"] = Idioma.codigo
            b["plataforma"] = "mac"
            if b["config"] == nil { b["config"] = Config.leer() }
            if let act = self.actualizaciones { b["actualizacion"] = act.disponible() }
            if let extra = self.estado { extra(b) { self.llamar("estado", $0) } } else { self.llamar("estado", b) }
        }
        if let s = Host.opciones.estadoScript, Texto.calza(s, "\\w+\\.py"),
           FileManager.default.fileExists(atPath: Host.recursos.appendingPathComponent("bin").appendingPathComponent(s).path) {
            Procesador.correrJSON(s, [], limite: 60) { terminar($0) }
        } else {
            terminar([:])
        }
    }

    private func guardarConfig(_ d: Datos) {
        let antes = Config.leer()
        let ahora = Config.guardar(d)
        if (antes["idioma_ui"] as? String) != (ahora["idioma_ui"] as? String) { Idioma.olvidar(); instalarMenus() }
        if (antes["tema"] as? String) != (ahora["tema"] as? String) { aplicarApariencia() }
        alCambiarConfig?(ahora, antes)
        if Idioma.elegido { iniciarTareas() }
    }

    /// Solo https (sin usuario ni clave en la dirección), en el navegador de la persona.
    public func abrirEnlace(_ valor: Any?) {
        guard let s = valor as? String, let u = URL(string: s), u.scheme == "https", u.host?.isEmpty == false, u.user == nil, u.password == nil else { return }
        NSWorkspace.shared.open(u)
    }

    public func copiar(_ valor: Any?) -> Bool {
        guard let t = valor as? String, !t.isEmpty, t.utf8.count <= 50 * 1024 * 1024 else { return false }
        NSPasteboard.general.clearContents()
        return NSPasteboard.general.setString(t, forType: .string)
    }

    /// Muestra el archivo (o la carpeta) en el Finder, elegido. Solo rutas que la app ya revisó (Enchufe.dentro).
    @discardableResult
    public func mostrarEnFinder(_ u: URL) -> Bool {
        guard u.isFileURL, FileManager.default.fileExists(atPath: u.path) else { return false }
        NSWorkspace.shared.activateFileViewerSelecting([u])
        return true
    }

    /// A la Papelera (se puede recuperar). Solo rutas que la app ya revisó (Enchufe.dentro).
    public func papelera(_ u: URL) -> Bool { (try? FileManager.default.trashItem(at: u, resultingItemURL: nil)) != nil }

    // MARK: Diálogos del sistema (para las acciones propias de la app)

    /// Una carpeta (sin enlaces) o nil si la persona cancela.
    public func elegirCarpeta(mensaje: String? = nil, boton: String? = nil, desde: URL? = nil, _ fin: @escaping @MainActor (URL?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        if let boton { panel.prompt = boton }
        if let mensaje { panel.message = mensaje }
        if let desde { panel.directoryURL = desde }
        presentar(panel) { ok in fin(ok ? panel.url?.standardizedFileURL.resolvingSymlinksInPath() : nil) }
    }

    /// Archivos (sin enlaces) o [] si la persona cancela. `extensiones`: ["md", "txt"].
    public func elegirArchivos(extensiones: [String] = [], varios: Bool = false, boton: String? = nil, _ fin: @escaping @MainActor ([URL]) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = varios
        if let boton { panel.prompt = boton }
        let tipos = extensiones.compactMap { UTType(filenameExtension: $0) }
        if !tipos.isEmpty { panel.allowedContentTypes = tipos }
        presentar(panel) { ok in fin(ok ? panel.urls.map { $0.standardizedFileURL.resolvingSymlinksInPath() } : []) }
    }

    /// «Guardar como»: escribe `datos` de una vez donde la persona elija. nil si cancela o no se pudo.
    public func guardarComo(nombre: String, extension ext: String, datos: Data, desde: URL? = nil, maximo: Int = 50 * 1024 * 1024,
                            _ fin: @escaping @MainActor (URL?) -> Void) {
        guard !datos.isEmpty, datos.count <= maximo, Texto.calza(ext, "\\w{1,10}") else { return fin(nil) }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [UTType(filenameExtension: ext) ?? .data]
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        panel.nameFieldStringValue = Puente.nombreArchivo(nombre, ext)
        if let desde { panel.directoryURL = desde }
        presentar(panel) { ok in
            guard ok, let u = panel.url, (try? datos.write(to: u, options: .atomic)) != nil else { return fin(nil) }
            fin(u)
        }
    }

    private func presentar(_ panel: NSSavePanel, _ fin: @escaping @MainActor (Bool) -> Void) {
        let alTerminar: (NSApplication.ModalResponse) -> Void = { r in Task { @MainActor in fin(r == .OK) } }
        if let ventana { panel.beginSheetModal(for: ventana, completionHandler: alTerminar) } else { panel.begin(completionHandler: alTerminar) }
    }

    /// Solo el nombre (sin carpetas), con la extensión.
    public static func nombreArchivo(_ valor: String, _ ext: String) -> String {
        var n = valor.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
            .replacingOccurrences(of: "\u{0}", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        n = String(n.prefix(120))
        if n.isEmpty || n.hasPrefix(".") { n = "archivo" + n }
        if !n.lowercased().hasSuffix("." + ext.lowercased()) { n += "." + ext }
        return n
    }

    // MARK: Menús (en el idioma elegido; se rearman al cambiarlo)

    public func instalarMenus() {
        let m = Menus()
        let principal = NSMenu()
        let app = NSMenuItem()
        let menuApp = NSMenu()
        menuApp.addItem(withTitle: Idioma.f("Acerca de {app}", ["app": Host.nombre]), action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        menuApp.addItem(.separator())
        menuApp.addItem(m.item("Ajustes…", "ajustes", ","))
        menuApp.addItem(.separator())
        menuApp.addItem(withTitle: Idioma.f("Ocultar {app}", ["app": Host.nombre]), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        menuApp.addItem(withTitle: Idioma.f("Salir de {app}", ["app": Host.nombre]), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        app.submenu = menuApp
        principal.addItem(app)
        for x in menus?(m) ?? [m.archivo([]), m.edicion(), m.ver([])] { principal.addItem(x) }
        let ventanaMenu = NSMenu(title: Idioma.t("Ventana"))
        ventanaMenu.addItem(withTitle: Idioma.t("Minimizar"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        ventanaMenu.addItem(withTitle: Idioma.t("Zoom"), action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        principal.addItem(m.submenu(ventanaMenu))
        var ayuda: [NSMenuItem] = []
        if Host.opciones.menuAyuda, let s = Host.opciones.sitio { ayuda.append(m.nativo(Idioma.f("Sitio de {app}", ["app": Host.nombre]), traducir: false) { Puente.shared.abrirEnlace(s) }) }
        if Host.opciones.menuAyuda, let c = Host.opciones.codigo { ayuda.append(m.nativo("Código") { Puente.shared.abrirEnlace(c) }) }
        if !ayuda.isEmpty { principal.addItem(m.menu("Ayuda", ayuda)) }
        NSApp.windowsMenu = ventanaMenu
        NSApp.mainMenu = principal
    }

    @objc func menuElegido(_ sender: NSMenuItem) {
        if let accion = sender.representedObject as? String {
            // Lo que es de la app lo hace la interfaz (window.<App>.menu({accion})). Nada antes de elegir el idioma.
            guard Idioma.elegido else { return }
            mostrar()
            llamar("menu", ["accion": accion])
        } else if let caja = sender.representedObject as? Caja {
            caja.fn()
        }
    }
}

/// Para armar menús en el idioma elegido: un ítem que atiende la interfaz (`item`), uno nativo (`nativo`) y los de siempre.
@MainActor
public final class Menus {
    /// Un ítem que la interfaz atiende con window.<App>.menu({accion}).
    public func item(_ titulo: String, _ accion: String, _ tecla: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
        let i = NSMenuItem(title: Idioma.t(titulo), action: #selector(Puente.menuElegido(_:)), keyEquivalent: tecla)
        i.keyEquivalentModifierMask = mods
        i.target = Puente.shared
        i.representedObject = accion
        return i
    }

    /// Un ítem que corre código de la app (elegir una carpeta, mostrar en el Finder).
    public func nativo(_ titulo: String, _ tecla: String = "", _ mods: NSEvent.ModifierFlags = .command, traducir: Bool = true,
                       _ fn: @escaping @MainActor () -> Void) -> NSMenuItem {
        let i = NSMenuItem(title: traducir ? Idioma.t(titulo) : titulo, action: #selector(Puente.menuElegido(_:)), keyEquivalent: tecla)
        i.keyEquivalentModifierMask = mods
        i.target = Puente.shared
        i.representedObject = Caja(fn)
        return i
    }

    public func menu(_ titulo: String, _ items: [NSMenuItem]) -> NSMenuItem {
        let m = NSMenu(title: Idioma.t(titulo))
        for i in items { m.addItem(i) }
        return submenu(m)
    }

    public func submenu(_ m: NSMenu) -> NSMenuItem {
        let x = NSMenuItem()
        x.submenu = m
        return x
    }

    /// Archivo: lo de la app y «Cerrar ventana».
    public func archivo(_ items: [NSMenuItem]) -> NSMenuItem {
        menu("Archivo", items + (items.isEmpty ? [] : [NSMenuItem.separator()]) + [NSMenuItem(title: Idioma.t("Cerrar ventana"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")])
    }

    /// Edición de siempre: deshacer, rehacer, cortar, copiar, pegar y seleccionar todo del sistema (o los de la app).
    public func edicion(deshacer: NSMenuItem? = nil, rehacer: NSMenuItem? = nil) -> NSMenuItem {
        let d = deshacer ?? NSMenuItem(title: Idioma.t("Deshacer"), action: Selector(("undo:")), keyEquivalent: "z")
        let r = rehacer ?? {
            let i = NSMenuItem(title: Idioma.t("Rehacer"), action: Selector(("redo:")), keyEquivalent: "z")
            i.keyEquivalentModifierMask = [.command, .shift]
            return i
        }()
        return menu("Edición", [d, r, NSMenuItem.separator(),
            NSMenuItem(title: Idioma.t("Cortar"), action: #selector(NSText.cut(_:)), keyEquivalent: "x"),
            NSMenuItem(title: Idioma.t("Copiar"), action: #selector(NSText.copy(_:)), keyEquivalent: "c"),
            NSMenuItem(title: Idioma.t("Pegar"), action: #selector(NSText.paste(_:)), keyEquivalent: "v"),
            NSMenuItem(title: Idioma.t("Seleccionar todo"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")])
    }

    /// Ver: lo de la app y «Pantalla completa».
    public func ver(_ items: [NSMenuItem]) -> NSMenuItem {
        let completa = NSMenuItem(title: Idioma.t("Pantalla completa"), action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        completa.keyEquivalentModifierMask = [.command, .control]
        return menu("Ver", items + (items.isEmpty ? [] : [NSMenuItem.separator()]) + [completa])
    }
}

final class Caja: NSObject {
    let fn: @MainActor () -> Void
    init(_ fn: @escaping @MainActor () -> Void) { self.fn = fn }
}

/// `<id>://<nombre>/<ruta>`: un archivo que aprueba el resolvedor de la app, con rangos (Range) para adelantar un video.
@MainActor
final class Medios: NSObject, WKURLSchemeHandler {
    var resolvedores: [String: @MainActor (String) -> URL?] = [:]
    static let trozo: Int64 = 4 << 20

    func archivo(de url: URL) -> URL? {
        guard url.scheme == Host.id, let h = url.host, let resolver = resolvedores[h], url.query == nil, url.fragment == nil,
              url.user == nil, url.password == nil else { return nil }
        let ruta = String(url.path.drop(while: { $0 == "/" }))
        guard !ruta.isEmpty, !ruta.contains("\u{0}"), let u = resolver(ruta), u.isFileURL else { return nil }
        var esDirectorio: ObjCBool = false
        guard FileManager.default.fileExists(atPath: u.path, isDirectory: &esDirectorio), !esDirectorio.boolValue else { return nil }
        return u
    }

    func webView(_ webView: WKWebView, start tarea: WKURLSchemeTask) {
        guard let url = tarea.request.url, let archivo = archivo(de: url),
              let total = (try? FileManager.default.attributesOfItem(atPath: archivo.path))?[.size] as? Int64,
              let h = try? FileHandle(forReadingFrom: archivo) else {
            tarea.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
            return
        }
        defer { try? h.close() }
        let tipo = UTType(filenameExtension: archivo.pathExtension.lowercased())?.preferredMIMEType ?? "application/octet-stream"
        var desde: Int64 = 0, hasta: Int64 = total - 1, conRango = false
        if let r = tarea.request.value(forHTTPHeaderField: "Range"), let m = r.firstMatch(of: #/^bytes=(\d*)-(\d*)$/#) {
            conRango = true
            if m.1.isEmpty {
                desde = max(0, total - (Int64(m.2) ?? 0))
            } else {
                desde = Int64(m.1) ?? 0
                if let b = Int64(m.2) { hasta = min(b, total - 1) }
            }
        }
        guard total > 0, desde <= hasta, desde < total else {
            let vacia = HTTPURLResponse(url: url, statusCode: total == 0 ? 200 : 416, httpVersion: "HTTP/1.1",
                                        headerFields: ["Content-Type": tipo, "Content-Length": "0", "Content-Range": "bytes */\(total)"])!
            tarea.didReceive(vacia)
            tarea.didFinish()
            return
        }
        hasta = min(hasta, desde + Medios.trozo - 1)
        let datos: Data
        do {
            try h.seek(toOffset: UInt64(desde))
            datos = try h.read(upToCount: Int(hasta - desde + 1)) ?? Data()
        } catch {
            tarea.didFailWithError(error)
            return
        }
        let parcial = conRango || Int64(datos.count) < total
        var cabeceras = ["Content-Type": tipo, "Content-Length": "\(datos.count)", "Accept-Ranges": "bytes", "Cache-Control": "no-store"]
        if parcial { cabeceras["Content-Range"] = "bytes \(desde)-\(desde + Int64(datos.count) - 1)/\(total)" }
        tarea.didReceive(HTTPURLResponse(url: url, statusCode: parcial ? 206 : 200, httpVersion: "HTTP/1.1", headerFields: cabeceras)!)
        tarea.didReceive(datos)
        tarea.didFinish()
    }

    func webView(_ webView: WKWebView, stop tarea: WKURLSchemeTask) {}
}
