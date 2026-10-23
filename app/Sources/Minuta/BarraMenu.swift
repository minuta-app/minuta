import AppKit
import Combine
import WebKit

extension Notification.Name {
    static let minutaNotasCambiaron = Notification.Name("minutaNotasCambiaron")
}

/// Borrado seguro de reuniones: solo notas .md de la carpeta de reuniones, y siempre a la Papelera (recuperable).
enum Papelera {
    static var carpeta: URL { Perfil.carpetaNotas }

    /// Borra una nota. Con respaldo en GitHub/GitLab la persona elige: `delRespaldo` la quita también del repositorio
    /// (va a la Papelera y se sincroniza al tiro); si no, se mueve a `archivadas/` (Minuta no la muestra, el respaldo la conserva).
    @MainActor
    static func borrar(_ ruta: String, model: AppModel?, delRespaldo: Bool = true) {
        let url = URL(fileURLWithPath: ruta).standardizedFileURL
        guard url.pathExtension == "md",
              url.deletingLastPathComponent().standardizedFileURL.path == carpeta.standardizedFileURL.path,
              FileManager.default.fileExists(atPath: url.path) else { return }
        let conRespaldo = !(Perfil.datos()["respaldo"] ?? "").isEmpty
        do {
            if conRespaldo && !delRespaldo {
                let archivadas = carpeta.appendingPathComponent("archivadas", isDirectory: true)
                try FileManager.default.createDirectory(at: archivadas, withIntermediateDirectories: true)
                let destino = archivadas.appendingPathComponent(url.lastPathComponent)
                try? FileManager.default.removeItem(at: destino)
                try FileManager.default.moveItem(at: url, to: destino)
            } else {
                try FileManager.default.trashItem(at: url, resultingItemURL: nil)
            }
            try? FileManager.default.removeItem(at: Extras.mensajeURL(url.path))
        } catch {
            model?.estado = "No pude mover la nota a la Papelera: \(error.localizedDescription)"
            return
        }
        if model?.notaSeleccionada?.standardizedFileURL == url { model?.notaSeleccionada = nil }
        if conRespaldo { Respaldo.sincronizar() }
        NotificationCenter.default.post(name: .minutaNotasCambiaron, object: nil)
    }
}

/// Panel que no activa la app: se puede escribir en él sin quitarle el foco a Teams o al navegador.
final class PanelFlotante: NSPanel {
    override var canBecomeKey: Bool { true }

    override func performKeyEquivalent(with e: NSEvent) -> Bool {
        let mods = e.modifierFlags.intersection([.command, .control, .option, .shift])
        let tecla = e.charactersIgnoringModifiers?.lowercased() ?? ""
        if mods == .command {
            let accion: String? = ["c": "copy:", "v": "paste:", "x": "cut:", "a": "selectAll:", "z": "undo:"][tecla]
            if let accion { return NSApp.sendAction(Selector(accion), to: nil, from: self) }
            if tecla == "w" { BarraMenu.shared.ocultar(); return true }
        }
        return super.performKeyEquivalent(with: e)
    }
}

/// Ícono de la barra de menú + panel temático (la misma interfaz web del visor, en modo panel).
@MainActor
final class BarraMenu: NSObject, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    static let shared = BarraMenu()

    private var item: NSStatusItem!
    private var panel: PanelFlotante!
    private var web: WKWebView!
    private weak var model: AppModel?
    private var listo = false
    private var monitor: Any?
    private var suscripcion: AnyCancellable?
    private var ultimaNota: String?
    private var ultimoTema = ""
    private var ultimoIcono = ""
    private let ancho: CGFloat = 386
    private var alto: CGFloat = 560

    func instalar(model: AppModel) {
        self.model = model
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.imagePosition = .imageLeft
        item.button?.target = self
        item.button?.action = #selector(alternar)
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        actualizarIcono()

        panel = PanelFlotante(contentRect: NSRect(x: 0, y: 0, width: ancho, height: alto),
                              styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.delegate = self

        let control = WKUserContentController()
        control.add(self, name: "minuta")
        control.addUserScript(WKUserScript(
            source: "window.MINUTA_HOST = 'mac'; window.MINUTA_PANEL = true; document.documentElement.classList.add('ventana','forma','panel');",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let config = WKWebViewConfiguration()
        config.userContentController = control
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: ancho, height: alto), configuration: config)
        web.setValue(false, forKey: "drawsBackground")
        web.underPageBackgroundColor = .clear
        web.navigationDelegate = self
        web.autoresizingMask = [.width, .height]
        panel.contentView = web
        web.loadFileURL(Temas.recursos.appendingPathComponent("ui/index.html"), allowingReadAccessTo: Temas.recursos)

        NotificationCenter.default.addObserver(forName: .minutaNotasCambiaron, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in if self?.panel.isVisible == true { self?.enviarTodo() } }
        }
        Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.listo, let m = self.model else { return }
                self.llamar("cargar", ["agenda": m.agendaJS()])
                VentanaVisor.shared.web?.evaluateJavaScript("window.Minuta && window.Minuta.cargar(\(Self.jsonObj(["agenda": m.agendaJS()])))")
            }
        }
        var ultimoVivo = Date.distantPast
        CoachVivo.shared.alActualizar = { [weak self] d in
            guard let self else { return }
            let racha = d["racha"] as? Int ?? 0
            self.item.button?.title = racha >= 60 ? String(format: " %d:%02d", racha / 60, racha % 60) : ""
            if Date().timeIntervalSince(ultimoVivo) >= 1, self.panel.isVisible { ultimoVivo = Date(); self.llamar("vivo", d) }
        }
        CoachVivo.shared.alMonologoLargo = { [weak model] seg in
            guard let model, model.ajustes.avisoMonologo else { return }
            model.avisoVivo("Llevas \(seg / 60):\(String(format: "%02d", seg % 60)) hablando", "Buen momento para una pregunta: «¿cómo lo ven ustedes?»")
        }
        suscripcion = model.objectWillChange.sink { [weak self] _ in
            DispatchQueue.main.async { self?.cambio() }
        }
    }

    // MARK: Ícono

    private func actualizarIcono() {
        guard let model, let boton = item?.button else { return }
        let grabando: Bool = { if case .grabando = model.fase { return true } else { return false } }()
        if !grabando { boton.title = "" }
        let clave = model.icono + (grabando ? "-rojo" : "")
        guard clave != ultimoIcono else { return }
        ultimoIcono = clave
        var img = NSImage(systemSymbolName: model.icono, accessibilityDescription: "Minuta")
        if grabando {
            img = img?.withSymbolConfiguration(.init(paletteColors: [.systemRed]))
            img?.isTemplate = false
        } else {
            img?.isTemplate = true
        }
        boton.image = img
        boton.toolTip = grabando ? "Minuta · grabando" : "Minuta"
    }

    // MARK: Mostrar / ocultar

    @objc private func alternar() {
        panel.isVisible ? ocultar() : mostrar()
    }

    func mostrar() {
        posicionar()
        enviarTodo()
        enviarEstado(abierto: true)
        panel.orderFrontRegardless()
        panel.makeKey()
        item.button?.highlight(true)
        monitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            Task { @MainActor in self?.ocultar() }
        }
        refrescarSombra()
    }

    func ocultar() {
        guard panel?.isVisible == true else { return }
        panel.orderOut(nil)
        item.button?.highlight(false)
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }

    func windowDidResignKey(_ n: Notification) {
        // Al pasar a otra ventana (p. ej. el visor), el panel se guarda solo.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            guard let self, self.panel.isVisible, !self.panel.isKeyWindow else { return }
            self.ocultar()
        }
    }

    private func posicionar() {
        guard let bw = item.button?.window, let pantalla = (bw.screen ?? NSScreen.main)?.visibleFrame else { return }
        let r = bw.frame
        let h = min(alto, pantalla.height - 20)
        let x = min(max(r.midX - ancho / 2, pantalla.minX + 6), pantalla.maxX - ancho - 6)
        let tope = min(r.minY - 2, pantalla.maxY)
        panel.setFrame(NSRect(x: x, y: tope - h, width: ancho, height: h), display: true)
    }

    private func refrescarSombra() {
        for d in [0.08, 0.35] {
            DispatchQueue.main.asyncAfter(deadline: .now() + d) { [weak self] in self?.panel.invalidateShadow() }
        }
    }

    // MARK: Mac → JS

    private func cambio() {
        actualizarIcono()
        guard let model, listo, panel.isVisible else { return }
        if model.ultimaNota?.path != ultimaNota { enviarTodo() } else if model.temaID != ultimoTema {
            ultimoTema = model.temaID
            llamar("cargar", ["temaId": model.temaID])
        }
        enviarEstado()
    }

    private func enviarEstado(abierto: Bool = false) {
        guard let model, listo else { return }
        var d: [String: Any] = [
            "fase": "inactiva", "desde": 0, "titulo": model.titulo, "tipo": model.tipo, "tipoAuto": model.tipoAuto, "plataforma": model.plataforma,
            "estado": model.estado, "inicio": model.abrirAlIniciar, "detectada": model.detectada ?? NSNull(),
        ]
        switch model.fase {
        case .inactiva: break
        case .grabando(let desde): d["fase"] = "grabando"; d["desde"] = desde.timeIntervalSince1970 * 1000
        case .procesando: d["fase"] = "procesando"
        }
        d["procesando"] = model.enCola.map { $0.titulo }
        d["actualizacion"] = model.actualizacion
        if abierto { d["abierto"] = true }
        llamar("panel", d)
    }

    private func enviarTodo() {
        guard let model, listo else { return }
        ultimaNota = model.ultimaNota?.path
        ultimoTema = model.temaID
        let carpeta = Perfil.carpetaNotas
        let archivos = (try? FileManager.default.contentsOfDirectory(at: carpeta, includingPropertiesForKeys: nil)) ?? []
        let notas: [[String: String]] = archivos.filter { $0.pathExtension == "md" }.compactMap { url in
            guard let texto = try? String(contentsOf: url, encoding: .utf8) else { return nil }
            return ["ruta": url.path, "texto": texto]
        }
        llamar("cargar", ["notas": notas, "temas": Temas.paraJS(), "temaId": model.temaID, "plataforma": "mac",
                          "categorias": Categorias.paraJS(model.categorias), "agenda": model.agendaJS(), "perfil": Perfil.paraJS,
                          "idioma": Idioma.paraJS])
    }

    /// Evalúa JS en la interfaz del panel (siempre cargada) y devuelve un texto.
    static func jsonObj(_ d: [String: Any]) -> String {
        (try? JSONSerialization.data(withJSONObject: d)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    func textoJS(_ js: String, _ fin: @escaping @MainActor (String?) -> Void) {
        guard listo else { fin(nil); return }
        web.evaluateJavaScript(js) { r, _ in Task { @MainActor in fin(r as? String) } }
    }

    /// Qué logros y rango trajo una nota recién generada (recarga las notas en el panel antes de calcular).
    func premios(_ ruta: String, _ fin: @escaping @MainActor ([String: Any]?) -> Void) {
        guard listo else { fin(nil); return }
        enviarTodo()
        textoJS("JSON.stringify(window.Minuta && window.Minuta.premios ? window.Minuta.premios(\(AppModel.json(ruta))) : null)") { s in
            guard let s, let d = s.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { fin(nil); return }
            fin(o)
        }
    }

    private func llamar(_ funcion: String, _ datos: [String: Any]) {
        guard let json = try? JSONSerialization.data(withJSONObject: datos), let texto = String(data: json, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.Minuta && window.Minuta.\(funcion)(\(texto))")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        listo = true
        enviarTodo()
        enviarEstado()
    }

    // MARK: JS → Mac

    func userContentController(_ c: WKUserContentController, didReceive mensaje: WKScriptMessage) {
        guard let model, let datos = mensaje.body as? [String: Any], let accion = datos["accion"] as? String else { return }
        switch accion {
        case "tema":
            if let id = datos["id"] as? String { ultimoTema = id; model.temaID = id }
        case "tipo":
            if let t = datos["tipo"] as? String { model.elegirTipo(t) }
        case "titulo":
            model.titulo = datos["texto"] as? String ?? ""
        case "grabar":
            if let t = datos["titulo"] as? String { model.titulo = t }
            model.grabar()
        case "detener":
            model.detener()
        case "semana":
            model.resumenSemanal()
        case "visor":
            ocultar()
            model.abrirVisor((datos["ruta"] as? String).map { URL(fileURLWithPath: $0) })
        case "inicio":
            model.cambiarInicioAutomatico(datos["activo"] as? Bool ?? false)
        case "borrar":
            if let ruta = datos["ruta"] as? String { Papelera.borrar(ruta, model: model, delRespaldo: datos["delRespaldo"] as? Bool ?? true) }
        case "categorias":
            if let lista = Categorias.desdeJS(datos["lista"]) {
                model.guardarCategorias(lista)
                NotificationCenter.default.post(name: .minutaNotasCambiaron, object: nil)
            }
        case "preferencias":
            ocultar()
            VentanaVisor.shared.mostrar(model: model)
            VentanaVisor.shared.web?.evaluateJavaScript("window.Minuta && window.Minuta.ir && window.Minuta.ir('preferencias')")
        case "visorEnviar":
            guard let ruta = datos["ruta"] as? String else { break }
            ocultar()
            model.abrirVisor(URL(fileURLWithPath: ruta))
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                VentanaVisor.shared.web?.evaluateJavaScript("window.Minuta && window.Minuta.abrirEnviar(\(AppModel.json(ruta)))")
            }
        case "prep":
            ocultar()
            model.abrirPreparacion(datos["id"] as? String ?? "")
        case "actualizar":
            // Desde el panel: se abre la ventana y el avance de la actualización se muestra ahí.
            ocultar()
            VentanaVisor.shared.mostrar(model: model)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                VentanaVisor.shared.web?.evaluateJavaScript("window.Minuta && window.Minuta.iniciarActualizacion && window.Minuta.iniciarActualizacion()")
            }
        case "salir":
            NSApp.terminate(nil)
        case "cerrarPanel":
            ocultar()
        case "panelAlto":
            if let a = datos["alto"] as? Double, a > 100, abs(CGFloat(a) - alto) > 1 {
                alto = CGFloat(a)
                if panel.isVisible { posicionar() }
            }
            refrescarSombra()
        default: break
        }
    }
}
