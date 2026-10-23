import AVFoundation
import AppKit
import SwiftUI
import WebKit

// MARK: - Ventana con forma propia

/// Ventana sin borde de macOS: la interfaz web dibuja la forma de cada universo (esquinas rectas, chaflanes,
/// pergamino rasgado…), sus botones y su marco. La sombra del sistema sigue la forma porque se calcula
/// a partir de los píxeles transparentes.
final class VentanaForma: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }

    override func performKeyEquivalent(with e: NSEvent) -> Bool {
        let mods = e.modifierFlags.intersection([.command, .control, .option, .shift])
        let tecla = e.charactersIgnoringModifiers?.lowercased() ?? ""
        if mods == .command {
            switch tecla {
            case "w": VentanaVisor.shared.cerrar(); return true
            case "m": VentanaVisor.shared.minimizar(); return true
            // La app vive en la barra de menú (sin menú Edición): se encaminan a mano los atajos de texto.
            case "c": return NSApp.sendAction(Selector(("copy:")), to: nil, from: self)
            case "v": return NSApp.sendAction(Selector(("paste:")), to: nil, from: self)
            case "x": return NSApp.sendAction(Selector(("cut:")), to: nil, from: self)
            case "a": return NSApp.sendAction(Selector(("selectAll:")), to: nil, from: self)
            case "z": return NSApp.sendAction(Selector(("undo:")), to: nil, from: self)
            default: break
            }
        }
        if mods == [.command, .shift], tecla == "z" { return NSApp.sendAction(Selector(("redo:")), to: nil, from: self) }
        if mods == [.command, .control], tecla == "f" { VentanaVisor.shared.pantallaCompleta(); return true }
        return super.performKeyEquivalent(with: e)
    }
}

/// Zonas que la interfaz web declara: dónde se arrastra la ventana y dónde se cambia su tamaño.
struct Regiones {
    var arrastre: [CGRect] = []
    var excluir: [CGRect] = []
    var bordes: [(CGRect, String)] = []
}

/// WKWebView que atiende el arrastre y el cambio de tamaño de forma nativa antes de pasarle el clic a la página.
final class WebVentana: WKWebView {
    var regiones = Regiones()

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseDown(with e: NSEvent) {
        let p = convert(e.locationInWindow, from: nil)
        let q = CGPoint(x: p.x, y: isFlipped ? p.y : bounds.height - p.y)
        if let lado = regiones.bordes.first(where: { $0.0.contains(q) })?.1 {
            redimensionar(lado)
            return
        }
        if regiones.arrastre.contains(where: { $0.contains(q) }), !regiones.excluir.contains(where: { $0.contains(q) }) {
            if e.clickCount == 2 { VentanaVisor.shared.alternarZoom() } else { window?.performDrag(with: e) }
            return
        }
        super.mouseDown(with: e)
    }

    /// Bucle de seguimiento del mouse: cambia el marco de la ventana mientras se arrastra un borde.
    private func redimensionar(_ lado: String) {
        guard let w = window, !w.styleMask.contains(.fullScreen) else { return }
        let inicio = NSEvent.mouseLocation
        let f0 = w.frame
        let minimo = w.minSize
        while true {
            guard let ev = w.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) else { break }
            if ev.type == .leftMouseUp { break }
            let m = NSEvent.mouseLocation
            let dx = m.x - inicio.x, dy = m.y - inicio.y
            var f = f0
            if lado.contains("e") { f.size.width = max(minimo.width, f0.width + dx) }
            if lado.contains("w") { let a = max(minimo.width, f0.width - dx); f.origin.x = f0.maxX - a; f.size.width = a }
            if lado.contains("n") { f.size.height = max(minimo.height, f0.height + dy) }
            if lado.contains("s") { let a = max(minimo.height, f0.height - dy); f.origin.y = f0.maxY - a; f.size.height = a }
            w.setFrame(f, display: true)
        }
        VentanaVisor.shared.refrescarSombra()
    }
}

@MainActor
final class VentanaVisor: NSObject, NSWindowDelegate {
    static let shared = VentanaVisor()
    private(set) var ventana: VentanaForma?
    weak var web: WebVentana?
    private var marcoPrevio: NSRect?
    private var minimizadaConTitulo = false
    private var sombraPendiente: DispatchWorkItem?

    func mostrar(model: AppModel) {
        if ventana == nil {
            let w = VentanaForma(contentRect: NSRect(x: 0, y: 0, width: 1080, height: 750),
                                 styleMask: [.borderless, .resizable, .miniaturizable, .closable],
                                 backing: .buffered, defer: false)
            w.title = "Minuta"
            w.isOpaque = false
            w.backgroundColor = .clear
            w.hasShadow = true
            w.isReleasedWhenClosed = false
            w.collectionBehavior = [.fullScreenPrimary, .managed]
            w.minSize = NSSize(width: 980, height: 640)
            w.delegate = self
            let raiz = NSHostingView(rootView: WebHost().ignoresSafeArea().environmentObject(model))
            raiz.sizingOptions = []
            w.contentView = raiz
            w.center()
            w.setFrameAutosaveName("MinutaVisor")
            ventana = w
        }
        NSApp.activate()
        ventana?.makeKeyAndOrderFront(nil)
        refrescarSombra()
    }

    // Botones y atajos
    func cerrar() { ventana?.close() }

    func minimizar() {
        guard let w = ventana else { return }
        w.miniaturize(nil)
        // Algunas versiones de macOS no minimizan ventanas sin barra de título: se le presta una invisible.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self, !w.isMiniaturized, w.isVisible else { return }
            self.minimizadaConTitulo = true
            w.styleMask.insert([.titled, .fullSizeContentView])
            w.titlebarAppearsTransparent = true
            w.titleVisibility = .hidden
            [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].forEach { w.standardWindowButton($0)?.isHidden = true }
            w.miniaturize(nil)
        }
    }

    func pantallaCompleta() { ventana?.toggleFullScreen(nil) }

    func alternarZoom() {
        guard let w = ventana, let pantalla = w.screen?.visibleFrame, !w.styleMask.contains(.fullScreen) else { return }
        if let previo = marcoPrevio, abs(w.frame.width - pantalla.width) < 4, abs(w.frame.height - pantalla.height) < 4 {
            marcoPrevio = nil
            w.setFrame(previo, display: true, animate: true)
        } else {
            marcoPrevio = w.frame
            w.setFrame(pantalla, display: true, animate: true)
        }
        refrescarSombra()
    }

    /// La sombra de una ventana transparente se calcula con su contenido: se recalcula cuando la página cambia de forma.
    func refrescarSombra() {
        sombraPendiente?.cancel()
        let tarea = DispatchWorkItem { [weak self] in
            self?.ventana?.invalidateShadow()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { self?.ventana?.invalidateShadow() }
        }
        sombraPendiente = tarea
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08, execute: tarea)
    }

    private func avisar(_ datos: [String: Any]) {
        guard let json = try? JSONSerialization.data(withJSONObject: datos), let texto = String(data: json, encoding: .utf8) else { return }
        web?.evaluateJavaScript("window.Minuta && window.Minuta.ventana && window.Minuta.ventana(\(texto))")
    }

    // NSWindowDelegate
    func windowWillEnterFullScreen(_ n: Notification) { avisar(["pantalla": true]) }
    func windowDidExitFullScreen(_ n: Notification) { avisar(["pantalla": false]); refrescarSombra() }
    func windowDidBecomeKey(_ n: Notification) { avisar(["activa": true]) }
    func windowDidResignKey(_ n: Notification) { avisar(["activa": false]) }
    func windowDidResize(_ n: Notification) { refrescarSombra() }
    func windowDidDeminiaturize(_ n: Notification) {
        guard minimizadaConTitulo, let w = ventana else { return }
        minimizadaConTitulo = false
        w.styleMask.remove([.titled, .fullSizeContentView])
        refrescarSombra()
    }
}

// MARK: - Contenido web

private struct WebHost: NSViewRepresentable {
    @EnvironmentObject var model: AppModel

    func makeCoordinator() -> Puente { Puente(model: model) }

    func makeNSView(context: Context) -> WebVentana {
        let control = WKUserContentController()
        control.add(context.coordinator, name: "minuta")
        control.addUserScript(WKUserScript(source: "window.MINUTA_HOST = 'mac'; document.documentElement.classList.add('ventana','forma');",
                                           injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let config = WKWebViewConfiguration()
        config.userContentController = control
        let web = WebVentana(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.setValue(false, forKey: "drawsBackground")
        web.underPageBackgroundColor = .clear
        context.coordinator.web = web
        VentanaVisor.shared.web = web
        let ui = Temas.recursos.appendingPathComponent("ui/index.html")
        web.loadFileURL(ui, allowingReadAccessTo: Temas.recursos)
        return web
    }

    func updateNSView(_ web: WebVentana, context: Context) {
        context.coordinator.sincronizar(temaID: model.temaID, seleccion: model.notaSeleccionada, ultima: model.ultimaNota)
    }

    @MainActor
    final class Puente: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let model: AppModel
        weak var web: WebVentana?
        private var listo = false
        private var ultimoTema = ""
        private var ultimaSeleccion: String?
        private var ultimaNota: String?
        private var observador: Any?
        private var observadorNotas: Any?

        init(model: AppModel) {
            self.model = model
            super.init()
            observador = NotificationCenter.default.addObserver(forName: NSWindow.didBecomeKeyNotification, object: nil, queue: .main) { [weak self] aviso in
                let ventana = aviso.object as? NSWindow
                Task { @MainActor in
                    // Solo al volver a la ventana del visor; si no cambió ningún archivo, la interfaz no se redibuja.
                    guard let self, ventana != nil, ventana === self.web?.window else { return }
                    self.enviarTodo()
                }
            }
            observadorNotas = NotificationCenter.default.addObserver(forName: .minutaNotasCambiaron, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.enviarTodo() }
            }
        }

        // JS → Mac
        func userContentController(_ c: WKUserContentController, didReceive mensaje: WKScriptMessage) {
            guard let datos = mensaje.body as? [String: Any], let accion = datos["accion"] as? String else { return }
            switch accion {
            case "tema":
                if let id = datos["id"] as? String { ultimoTema = id; model.temaID = id }
            case "copiar":
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(datos["texto"] as? String ?? "", forType: .string)
            case "obsidian":
                if let ruta = datos["ruta"] as? String { abrirEnObsidian(ruta) }
            case "finder":
                if let ruta = datos["ruta"] as? String { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: ruta)]) }
            case "seleccion":
                if let ruta = datos["ruta"] as? String { ultimaSeleccion = ruta; model.notaSeleccionada = URL(fileURLWithPath: ruta) }
            case "abrir":
                if let url = (datos["url"] as? String).flatMap(URL.init(string:)) { NSWorkspace.shared.open(url) }
            case "reescribir":
                if let ruta = datos["ruta"] as? String, let texto = datos["texto"] as? String, Extras.reescribir(ruta, texto) {
                    NotificationCenter.default.post(name: .minutaNotasCambiaron, object: nil)
                }
            case "corregirIA":
                // La IA corrige la nota según lo que la persona dijo en palabras (bin/corregir.py).
                guard let ruta = datos["ruta"] as? String, let instruccion = datos["instruccion"] as? String else { break }
                let archivo = FileManager.default.temporaryDirectory.appendingPathComponent("minuta-corregir-\(UUID().uuidString).txt")
                guard (try? instruccion.write(to: archivo, atomically: true, encoding: .utf8)) != nil else { break }
                model.correrScriptJSON("corregir.py", [ruta, archivo.path]) { [weak self] r, error in
                    try? FileManager.default.removeItem(at: archivo)
                    NotificationCenter.default.post(name: .minutaNotasCambiaron, object: nil)
                    self?.llamarFuncion("corregido", r ?? ["ok": false, "error": error])
                }
            case "correccion":
                Extras.agregarCorreccion(datos)
            case "quitarCorreccion":
                if let de = datos["de"] as? String { Extras.quitarCorreccion(de) }
            case "voto":
                Extras.votar(datos)
            case "crearUniverso":
                let nombre = (datos["nombre"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                guard !nombre.isEmpty else { break }
                model.crearUniverso(nombre: nombre, notas: datos["notas"] as? String ?? "") { ok, id, texto in
                    NotificationCenter.default.post(name: .minutaNotasCambiaron, object: nil)
                    let r: [String: Any] = ok ? ["ok": true, "id": id, "nombre": texto] : ["ok": false, "error": texto]
                    if let j = try? JSONSerialization.data(withJSONObject: r), let t = String(data: j, encoding: .utf8) {
                        VentanaVisor.shared.web?.evaluateJavaScript("window.Minuta && window.Minuta.forjado(\(t))")
                    }
                }
            case "ajustesAvisos":
                if let d = datos["ajustes"] as? [String: Any] { model.ajustes = AjustesAvisos.desdeJS(d); model.ajustes.guardar() }
            case "abrirAjustesAvisos":
                let id = Bundle.main.bundleIdentifier ?? "app.minuta.mac"
                if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=\(id)") { NSWorkspace.shared.open(url) }
            case "abrirAjustesCalendario":
                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars") { NSWorkspace.shared.open(url) }
            case "pedirAvisos":
                model.pedirPermisoAvisos { [weak self] in self?.enviarEstadoAvisos() }
            case "pedirCalendario":
                model.pedirPermisoCalendario { [weak self] in self?.enviarEstadoAvisos() }
            case "probarAviso":
                model.avisoDePrueba()
            case "estadoAvisos":
                enviarEstadoAvisos()
            case "borrarUniverso":
                if let id = datos["id"] as? String, Extras.borrarUniverso(id) {
                    model.temas = Temas.todos()
                    if model.temaID == id, !model.temas.contains(where: { $0.id == id }) { model.temaID = "cine" }
                    NotificationCenter.default.post(name: .minutaNotasCambiaron, object: nil)
                }
            // ── Asistente de bienvenida ──
            case "bienvenidaEstado":
                enviarBienvenida()
            case "probarIA":
                let id = datos["id"] as? String ?? "claude"
                IA.probar(id) { [weak self] ok, texto in
                    if ok { var p = Perfil.datos(); p["ia"] = id; Perfil.guardar(p) }
                    self?.llamarFuncion("iaProbada", ["id": id, "ok": ok, "texto": texto])
                }
            case "descargarModelo":
                let id = datos["id"] as? String ?? Modelos.recomendado
                var ultimo = -1
                Modelos.descargar(id, progreso: { [weak self] f in
                    let pct = Int(f * 100)
                    if pct != ultimo { ultimo = pct; self?.llamarFuncion("modeloProgreso", ["id": id, "pct": pct]) }
                }, fin: { [weak self] ok, error in
                    if ok { var p = Perfil.datos(); p["modelo_whisper"] = id; Perfil.guardar(p) }
                    self?.llamarFuncion("modeloListo", ["id": id, "ok": ok, "error": error ?? "", "modelos": Modelos.paraJS])
                })
            case "elegirCarpetaNotas":
                Respaldo.elegirCarpeta { [weak self] url in
                    guard let self, let url else { return }
                    var p = Perfil.datos(); p["carpeta_notas"] = Perfil.rutaCorta(url); Perfil.guardar(p)
                    self.llamarFuncion("carpetaNotas", ["ruta": Perfil.rutaCorta(url), "notas": Respaldo.contarNotas(url)])
                    self.enviarTodo()
                }
            case "clonarNotas":
                guard let url = datos["url"] as? String, url.hasPrefix("https://") else { break }
                let proveedor = url.contains("gitlab") ? "gitlab" : "github"
                if let t = datos["token"] as? String, !t.isEmpty { Respaldo.guardarToken(t, cuenta: proveedor) }
                let nombre = URL(string: url)?.deletingPathExtension().lastPathComponent ?? "notas"
                let destino = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents/Minuta/\(nombre)")
                Respaldo.clonar(url, proveedor: proveedor, en: destino) { [weak self] ok, texto in
                    guard let self else { return }
                    if ok {
                        var p = Perfil.datos(); p["carpeta_notas"] = Perfil.rutaCorta(destino); p["respaldo"] = proveedor; p["respaldo_remoto"] = url
                        Perfil.guardar(p)
                        self.enviarTodo()
                    }
                    self.llamarFuncion("repoNotas", ["ok": ok, "texto": ok ? Perfil.rutaCorta(destino) : String(texto.suffix(300)), "notas": ok ? Respaldo.contarNotas(destino) : 0])
                }
            case "crearRepoNotas":
                guard let proveedor = datos["proveedor"] as? String, let token = datos["token"] as? String, !token.isEmpty else { break }
                let nombre = (datos["nombre"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "minuta-notas"
                Respaldo.crearRepo(proveedor: proveedor, token: token, nombre: nombre, carpeta: Perfil.carpetaNotas) { [weak self] ok, texto in
                    self?.llamarFuncion("repoNotas", ["ok": ok, "texto": String(texto.suffix(300)), "creado": true])
                }
            case "abrirURL":
                if let u = datos["url"] as? String, u.hasPrefix("https://"), let url = URL(string: u) { NSWorkspace.shared.open(url) }
            case "pedirMicrofono":
                AVCaptureDevice.requestAccess(for: .audio) { [weak self] ok in
                    Task { @MainActor in self?.llamarFuncion("permisoMicrofono", ["ok": ok]) }
                }
            case "terminarBienvenida":
                var p = Perfil.datos()
                for (k, v) in (datos["perfil"] as? [String: Any] ?? [:]) where Perfil.porDefecto.keys.contains(k) { if let s = v as? String { p[k] = s } }
                Perfil.guardar(p)
                Idioma.olvidar()
                if let tema = datos["tema"] as? String { model.temaID = tema }
                enviarTodo()
                NotificationCenter.default.post(name: .minutaNotasCambiaron, object: nil)
            // ── Actualizaciones ──
            case "buscarActualizacion":
                model.buscarActualizacion()
            case "actualizar":
                guard model.fase == .inactiva, model.enCola.isEmpty else {
                    llamarFuncion("actualizacionProgreso", ["paso": "error", "texto": Idioma.t("Termina la grabación y espera a que se generen las notas antes de actualizar.")]); break
                }
                // El aviso de actualización pasa a mostrar el avance (descargar → preparar → instalar), sin alertas.
                Actualizaciones.instalar { [weak self] ok, error in
                    if ok { Actualizaciones.seguir { d in self?.llamarFuncion("actualizacionProgreso", d) } }
                    else { self?.llamarFuncion("actualizacionProgreso", ["paso": "error", "texto": error]) }
                }
            case "catalogo":
                let tipo = (datos["tipo"] as? String) == "idiomas" ? "idiomas" : "universos"
                Catalogo.indice(tipo) { [weak self] lista, error in
                    var d: [String: Any] = ["tipo": tipo, "lista": lista]
                    if let error { d["error"] = error }
                    self?.llamarFuncion("catalogo", d)
                }
            case "descargarUniverso":
                guard let id = datos["id"] as? String else { break }
                Catalogo.descargarUniverso(id) { [weak self] ok, error in
                    guard let self else { return }
                    if ok { self.model.temas = Temas.todos(); if datos["usar"] as? Bool == true { self.model.temaID = id } }
                    self.enviarTodo()
                    self.llamarFuncion("descargado", ["tipo": "universo", "id": id, "ok": ok, "error": error ?? ""])
                }
            case "descargarIdioma":
                guard let c = datos["codigo"] as? String else { break }
                Catalogo.descargarIdioma(c) { [weak self] ok, error in
                    self?.llamarFuncion("descargado", ["tipo": "idioma", "id": c, "ok": ok, "error": error ?? "", "instalados": Idioma.instalados()])
                }
            case "perfil":
                // Cambios del perfil desde Preferencias (idioma, nombre…): se mezclan con lo que ya hay.
                var p = Perfil.datos()
                for (k, v) in (datos["cambios"] as? [String: Any] ?? [:]) where Perfil.porDefecto.keys.contains(k) { if let s = v as? String { p[k] = s } }
                if let d = try? JSONSerialization.data(withJSONObject: p, options: [.prettyPrinted, .sortedKeys]) { try? d.write(to: Perfil.archivo, options: .atomic) }
                Idioma.olvidar()
                enviarTodo()
                NotificationCenter.default.post(name: .minutaNotasCambiaron, object: nil)
            case "comentariosCuenta":
                Comentarios.cuenta { [weak self] u in self?.llamarFuncion("comentariosCuenta", ["usuario": u ?? NSNull()]) }
            case "votarUniverso":
                guard let numero = datos["numero"] as? Int, let id = datos["id"] as? String else { break }
                let positivo = datos["positivo"] as? Bool ?? true
                Comentarios.votar(numero: numero, positivo: positivo) { [weak self] ok, nuevo in
                    self?.llamarFuncion("votado", ["id": id, "ok": ok, "nuevo": nuevo, "positivo": positivo])
                }
            case "comentarios" where datos["directo"] as? Bool == true:
                // Con la cuenta de GitHub de la persona (la del respaldo): se publica sin abrir el navegador.
                Comentarios.publicar(repo: datos["repo"] as? String ?? "app", titulo: datos["titulo"] as? String ?? "",
                                     cuerpo: datos["cuerpo"] as? String ?? "", etiqueta: datos["etiqueta"] as? String ?? "comentario") { [weak self] ok, texto in
                    self?.llamarFuncion("comentarioEnviado", ["ok": ok, "url": ok ? texto : "", "error": ok ? "" : texto])
                }
            case "comentarios":
                // Abre un issue prellenado en GitHub; el usuario lo revisa y lo publica él mismo.
                var c = URLComponents(string: "https://github.com/\(Comentarios.repos[datos["repo"] as? String ?? "app"] ?? "minuta-app/minuta")/issues/new")!
                c.queryItems = [URLQueryItem(name: "title", value: datos["titulo"] as? String ?? ""),
                                URLQueryItem(name: "body", value: datos["cuerpo"] as? String ?? ""),
                                URLQueryItem(name: "labels", value: datos["etiqueta"] as? String ?? "comentario")]
                if let u = c.url { NSWorkspace.shared.open(u) }
            case "gimnasio":
                guard let modo = datos["modo"] as? String, let entrada = datos["entrada"] else { break }
                let archivo = FileManager.default.temporaryDirectory.appendingPathComponent("minuta-gym-\(UUID().uuidString).json")
                guard let d = try? JSONSerialization.data(withJSONObject: entrada), (try? d.write(to: archivo)) != nil else { break }
                model.correrScriptJSON("gimnasio.py", [modo, archivo.path]) { [weak self] r, error in
                    try? FileManager.default.removeItem(at: archivo)
                    var res: [String: Any] = ["modo": modo, "ok": r != nil]
                    if let r { res["datos"] = r } else { res["error"] = error }
                    self?.llamarFuncion("gym", res)
                }
            case "copiarFormato":
                let pb = NSPasteboard.general
                pb.clearContents()
                if let html = datos["html"] as? String { pb.setString(html, forType: .html) }
                pb.setString(datos["texto"] as? String ?? "", forType: .string)
            case "redactar":
                guard let ruta = datos["ruta"] as? String else { break }
                let forzar = datos["forzar"] as? Bool ?? false
                // Ya redactado: se abre al instante, sin volver a llamar a Claude.
                if !forzar, let g = Extras.mensajeGuardado(ruta) {
                    llamarFuncion("redactado", ["ok": true, "texto": g["texto"] ?? "", "asunto": g["asunto"] ?? "", "guardado": true, "editado": g["editado"] ?? false])
                    break
                }
                llamarFuncion("redactando", [:])
                let archivo = FileManager.default.temporaryDirectory.appendingPathComponent("minuta-indic-\(UUID().uuidString).json")
                if let d = try? JSONSerialization.data(withJSONObject: ["indicaciones": datos["indicaciones"] as? String ?? "", "forzar": forzar]) { try? d.write(to: archivo) }
                model.correrScriptJSON("redactar.py", [ruta, archivo.path]) { [weak self] r, error in
                    try? FileManager.default.removeItem(at: archivo)
                    self?.llamarFuncion("redactado", ["ok": r != nil, "texto": r?["texto"] ?? "", "asunto": r?["asunto"] ?? "", "error": error])
                }
            case "guardarMensaje":
                if let ruta = datos["ruta"] as? String { Extras.guardarMensaje(ruta, asunto: datos["asunto"] as? String ?? "", texto: datos["texto"] as? String ?? "") }
            case "recordatorios":
                let lista = datos["lista"] as? [[String: Any]] ?? []
                guard !lista.isEmpty else { llamarFuncion("aviso", ["t": "No hay compromisos abiertos"]); break }
                model.crearRecordatorios(lista) { [weak self] texto in self?.web?.evaluateJavaScript("window.Minuta && window.Minuta.aviso(\(AppModel.json(texto)))") }
            case "hablar":
                Dictado.shared.cerrar(final: false)
                Voz.shared.alTerminar = { [weak self] in self?.llamarFuncion("vozTermino", [:]) }
                if let t = datos["texto"] as? String { Voz.shared.decir(t) }
            case "escuchar":
                Voz.shared.callar()
                if let s = datos["silencio"] as? Double { Dictado.shared.silencioFinal = s }
                Dictado.shared.alCambiar = { [weak self] texto, final, nivel, escuchando, error in
                    var d: [String: Any] = ["texto": texto, "final": final, "nivel": nivel, "escuchando": escuchando]
                    if let error { d["error"] = error }
                    self?.llamarFuncion("dictado", d)
                }
                Dictado.shared.empezar()
            case "dejarDeEscuchar":
                Dictado.shared.cerrar(final: datos["enviar"] as? Bool ?? false)
            case "callar":
                Voz.shared.callar()
                if datos["mic"] as? Bool ?? true { Dictado.shared.cerrar(final: false) }
            case "preguntar":
                guard let id = datos["id"] as? String, let q = datos["pregunta"] as? String else { break }
                model.correrScriptJSON("preguntar.py", [q]) { [weak self] r, error in
                    var res: [String: Any] = ["id": id, "ok": r != nil]
                    if let r { res["respuesta"] = r["respuesta"] ?? ""; res["fuentes"] = r["fuentes"] ?? [] } else { res["error"] = error }
                    self?.llamarFuncion("respuesta", res)
                }
            case "categorias":
                if let lista = Categorias.desdeJS(datos["lista"]) {
                    model.guardarCategorias(lista)
                    NotificationCenter.default.post(name: .minutaNotasCambiaron, object: nil)
                }
            case "borrar":
                if let ruta = datos["ruta"] as? String { Papelera.borrar(ruta, model: model) }
            case "ventana":
                switch datos["op"] as? String {
                case "cerrar": VentanaVisor.shared.cerrar()
                case "minimizar": VentanaVisor.shared.minimizar()
                case "pantalla": VentanaVisor.shared.pantallaCompleta()
                case "zoom": VentanaVisor.shared.alternarZoom()
                default: break
                }
            case "regiones":
                func rects(_ k: String) -> [CGRect] {
                    ((datos[k] as? [[Double]]) ?? []).compactMap { $0.count >= 4 ? CGRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) : nil }
                }
                var r = Regiones(arrastre: rects("arrastre"), excluir: rects("excluir"))
                r.bordes = ((datos["bordes"] as? [[Any]]) ?? []).compactMap { b in
                    guard b.count >= 5, let x = b[0] as? Double, let y = b[1] as? Double, let w = b[2] as? Double,
                          let h = b[3] as? Double, let lado = b[4] as? String else { return nil }
                    return (CGRect(x: x, y: y, width: w, height: h), lado)
                }
                web?.regiones = r
                VentanaVisor.shared.refrescarSombra()
            default: break
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            listo = true
            enviarTodo()
            VentanaVisor.shared.refrescarSombra()
        }

        func webView(_ webView: WKWebView, decidePolicyFor accion: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if accion.navigationType == .linkActivated, let url = accion.request.url, url.scheme != "file" {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        }

        // Mac → JS
        func sincronizar(temaID: String, seleccion: URL?, ultima: URL?) {
            guard listo else { return }
            if ultima?.path != ultimaNota { ultimaNota = ultima?.path; enviarTodo(seleccion: ultima?.path); return }
            var parcial: [String: Any] = [:]
            if temaID != ultimoTema { ultimoTema = temaID; parcial["temaId"] = temaID }
            if let s = seleccion?.path, s != ultimaSeleccion { ultimaSeleccion = s; parcial["seleccion"] = s }
            if !parcial.isEmpty { llamar(parcial) }
        }

        func enviarBienvenida() {
            let carpeta = Perfil.carpetaNotas
            llamarFuncion("bienvenida", ["ia": IA.paraJS, "modelos": Modelos.paraJS, "perfil": Perfil.paraJS,
                                         "carpeta": Perfil.rutaCorta(carpeta), "notas": Respaldo.contarNotas(carpeta),
                                         "tokens": ["github": Respaldo.token("github") != nil, "gitlab": Respaldo.token("gitlab") != nil]])
            enviarEstadoAvisos()
        }

        func enviarTodo(seleccion: String? = nil) {
            guard listo else { return }
            let carpeta = Perfil.carpetaNotas
            let archivos = (try? FileManager.default.contentsOfDirectory(at: carpeta, includingPropertiesForKeys: nil)) ?? []
            let notas: [[String: String]] = archivos.filter { $0.pathExtension == "md" }.compactMap { url in
                guard let texto = try? String(contentsOf: url, encoding: .utf8) else { return nil }
                return ["ruta": url.path, "texto": texto]
            }
            ultimoTema = model.temaID
            var datos: [String: Any] = ["notas": notas, "temas": Temas.paraJS(), "temaId": model.temaID, "plataforma": "mac", "idioma": Idioma.paraJS,
                                         "categorias": Categorias.paraJS(model.categorias), "agenda": model.agendaJS(),
                                         "correcciones": Extras.correcciones(), "votos": Extras.votos(), "ajustes": model.ajustes.paraJS, "perfil": Perfil.paraJS,
                                         "primeraVez": Perfil.falta, "actualizacion": model.actualizacion, "version": Actualizaciones.version]
            if let s = seleccion ?? model.notaSeleccionada?.path { datos["seleccion"] = s; ultimaSeleccion = s }
            llamar(datos)
            enviarEstadoAvisos()
        }

        func enviarEstadoAvisos() {
            model.estadoAvisos { [weak self] estado in
                guard let self else { return }
                self.llamar(["avisos": estado, "ajustes": self.model.ajustes.paraJS])
            }
        }

        func llamarFuncion(_ f: String, _ datos: [String: Any]) {
            guard let json = try? JSONSerialization.data(withJSONObject: datos), let texto = String(data: json, encoding: .utf8) else { return }
            web?.evaluateJavaScript("window.Minuta && window.Minuta.\(f)(\(texto))")
        }

        private func llamar(_ datos: [String: Any]) {
            guard let json = try? JSONSerialization.data(withJSONObject: datos), let texto = String(data: json, encoding: .utf8) else { return }
            web?.evaluateJavaScript("window.Minuta && window.Minuta.cargar(\(texto))")
        }

        private func abrirEnObsidian(_ ruta: String) {
            var c = URLComponents()
            c.scheme = "obsidian"
            c.host = "open"
            c.queryItems = [URLQueryItem(name: "path", value: ruta)]
            if let url = c.url, NSWorkspace.shared.urlForApplication(toOpen: url) != nil {
                NSWorkspace.shared.open(url)
            } else {
                NSWorkspace.shared.open(URL(fileURLWithPath: ruta))
            }
        }
    }
}


/// Voz de la contraparte en el Gimnasio (voces de macOS en español; prefiere Chile/Latinoamérica).
@MainActor
final class Voz: NSObject, AVSpeechSynthesizerDelegate {
    static let shared = Voz()
    private let sintetizador = AVSpeechSynthesizer()
    /// Avisa cuando terminó de hablar (para que el Gimnasio empiece a escuchar sin oírse a sí mismo).
    var alTerminar: (() -> Void)?

    override init() {
        super.init()
        sintetizador.delegate = self
    }

    func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) {
        DispatchQueue.main.async { self.alTerminar?() }
    }
    private lazy var voz: AVSpeechSynthesisVoice? = {
        let todas = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("es") }
        let orden = ["es-CL", "es-419", "es-MX", "es-US", "es-AR", "es-CO", "es-ES"]
        let mejor = todas.sorted { a, b in
            let ia = orden.firstIndex(of: a.language) ?? 99, ib = orden.firstIndex(of: b.language) ?? 99
            return ia != ib ? ia < ib : a.quality.rawValue > b.quality.rawValue
        }
        return mejor.first ?? AVSpeechSynthesisVoice(language: "es-MX")
    }()

    func decir(_ texto: String) {
        callar()
        let u = AVSpeechUtterance(string: texto)
        u.voice = voz
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 1.02
        sintetizador.speak(u)
    }

    func callar() {
        if sintetizador.isSpeaking { sintetizador.stopSpeaking(at: .immediate) }
    }
}
