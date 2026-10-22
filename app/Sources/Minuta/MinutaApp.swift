import AVFoundation
import EventKit
import ServiceManagement
import SwiftUI
import UserNotifications

enum Fase: Equatable {
    case inactiva
    case grabando(desde: Date)
    case procesando
}

@MainActor
final class AppModel: ObservableObject {
    @Published var fase: Fase = .inactiva
    @Published var titulo = ""
    @Published var categorias: [Categoria] = Categorias.cargar()
    @Published var tipo: String = Categorias.cargar().first?.id ?? "Otra"
    /// true cuando lo elegiste tú; así la detección automática no te pisa la elección.
    @Published var tipoManual = false
    /// true cuando la categoría la eligió Minuta (para mostrarlo en el panel).
    @Published var tipoAuto = false
    @Published private(set) var plataforma = ""
    @Published var estado = ""
    @Published var detectada: String?
    /// Versión nueva disponible: ["hay": Bool, "detalle": String].
    @Published var actualizacion: [String: Any] = ["hay": false]
    /// Reuniones que se están transcribiendo en segundo plano (de a una, para no ahogar el Mac).
    @Published private(set) var enCola: [(dir: URL, titulo: String)] = []
    private var procesandoAhora: URL?
    @Published var ultimaNota: URL?
    @Published var abrirAlIniciar = SMAppService.mainApp.status == .enabled
    @Published var notaSeleccionada: URL?
    @Published var pedirVisor = 0 {
        didSet { VentanaVisor.shared.mostrar(model: self) }
    }
    @Published var temas: [TemaJuego] = Temas.todos()
    @Published var temaID: String = Temas.idGuardado() {
        didSet { Temas.guardar(id: temaID) }
    }
    var temaActual: TemaJuego? { temas.first { $0.id == temaID } ?? temas.first { $0.id == "cine" } ?? temas.first }
    private let delegadoNotificaciones = DelegadoNotificaciones()

    private var mic = MicRecorder()
    private var sistema = SystemAudioRecorder()
    private let detector = MeetingDetector()
    private var carpeta: URL?
    private var inicio = Date()
    private let calendario = EKEventStore()
    private var evento: (titulo: String, asistentes: [String], correos: [String])?

    let base = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("minuta")
    var notas: URL {
        Perfil.carpetaNotas
    }

    var icono: String {
        switch fase {
        case .inactiva: return detectada != nil ? "waveform.badge.exclamationmark" : (enCola.isEmpty ? "waveform" : "hourglass")
        case .grabando: return "record.circle.fill"
        case .procesando: return "hourglass"
        }
    }

    init() {
        for d in ["", "temas", "models", "grabaciones", "idiomas"] {
            try? FileManager.default.createDirectory(at: Temas.base.appendingPathComponent(d), withIntermediateDirectories: true)
        }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        UNUserNotificationCenter.current().delegate = delegadoNotificaciones
        let grabarAccion = UNNotificationAction(identifier: "GRABAR", title: "Grabar ahora", options: [])
        let ahoraNo = UNNotificationAction(identifier: "AHORA_NO", title: "Ahora no", options: [])
        let detenerAccion = UNNotificationAction(identifier: "DETENER", title: "Detener y generar notas", options: [])
        let seguir = UNNotificationAction(identifier: "SEGUIR", title: "Sigue grabando", options: [])
        UNUserNotificationCenter.current().setNotificationCategories([
            UNNotificationCategory(identifier: "REUNION", actions: [grabarAccion, ahoraNo], intentIdentifiers: [], options: [.customDismissAction]),
            UNNotificationCategory(identifier: "FIN", actions: [detenerAccion, seguir], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: "PRUEBA", actions: [], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: "PREP", actions: [], intentIdentifiers: [], options: []),
        ])
        delegadoNotificaciones.alResponder = { [weak self] categoria, accion, info in
            Task { @MainActor in self?.responderNotificacion(categoria: categoria, accion: accion, info: info) }
        }
        delegadoNotificaciones.alHacerClic = { [weak self] ruta in
            Task { @MainActor in
                guard let self else { return }
                if let ruta { self.notaSeleccionada = URL(fileURLWithPath: ruta) }
                self.pedirVisor += 1
            }
        }
        detector.onDetect = { [weak self] app in
            Task { @MainActor in self?.reunionDetectada(app) }
        }
        detector.onFin = { [weak self] app in
            Task { @MainActor in self?.reunionTerminada(app) }
        }
        if CommandLine.arguments.contains("--prueba-captura") {
            pruebaCaptura()
            return
        }
        detector.start()
        vigilarCalendario()
        // Primera vez: abre la ventana para el asistente de bienvenida.
        if Perfil.falta {
            Task { @MainActor in try? await Task.sleep(for: .seconds(1)); self.pedirVisor += 1 }
        }
        // Actualizaciones: al abrir y cada 6 horas.
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(20))
            while true {
                self.buscarActualizacion()
                try? await Task.sleep(for: .seconds(6 * 3600))
            }
        }
        if CommandLine.arguments.contains("--prueba-deteccion") {
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(2))
                self.reunionDetectada("Microsoft Teams")
            }
        }
        if CommandLine.arguments.contains("--prueba-premio") {
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(3))
                if let u = self.ultimaNota { self.anunciarNota(u) }
            }
        }
        if CommandLine.arguments.contains("--prueba-fin") {
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(2))
                AlertaFlotante.shared.mostrar(.init(tipo: .fin, titulo: "«Daily del equipo»: Microsoft Teams se desconectó", detalle: "sigo grabando",
                    principal: "Terminó: generar notas", secundario: "Sigo en reunión", desde: Date().addingTimeInterval(-1934),
                    alPrincipal: {}, alSecundario: {}), estilo: self.temaActual?.estilo)
            }
        }
        if CommandLine.arguments.contains("--visor") {
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(1))
                self.abrirVisor(self.ultimaNota)
            }
        }
        if let ultima = try? String(contentsOf: base.appendingPathComponent("ultima-nota.txt"), encoding: .utf8) {
            let ruta = ultima.trimmingCharacters(in: .whitespacesAndNewlines)
            if FileManager.default.fileExists(atPath: ruta) { ultimaNota = URL(fileURLWithPath: ruta) }
        }
    }

    // MARK: Detección de reuniones (como Granola)

    private var avisados: Set<String> = []
    var ajustes = AjustesAvisos.cargar()

    /// Estado real de los permisos, para Preferencias.
    func estadoAvisos(_ listo: @escaping @MainActor ([String: Any]) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            let permiso: String = switch s.authorizationStatus {
            case .authorized, .provisional: "si"
            case .denied: "no"
            default: "sin_preguntar"
            }
            let estilo: String = switch s.alertStyle {
            case .alert: "alertas"
            case .banner: "banners"
            default: "ninguno"
            }
            let sonido = s.soundSetting == .enabled
            let cal: String = switch EKEventStore.authorizationStatus(for: .event) {
            case .fullAccess: "si"
            case .denied, .restricted, .writeOnly: "no"
            default: "sin_preguntar"
            }
            Task { @MainActor in listo(["permiso": permiso, "estilo": estilo, "sonido": sonido, "calendario": cal]) }
        }
    }

    func pedirPermisoAvisos(_ listo: @escaping @MainActor () -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in Task { @MainActor in listo() } }
    }

    func pedirPermisoCalendario(_ listo: @escaping @MainActor () -> Void) {
        calendario.requestFullAccessToEvents { _, _ in Task { @MainActor in listo() } }
    }

    /// Abre la Agenda del visor (en la preparación de un evento, si viene).
    func abrirPreparacion(_ id: String) {
        pedirVisor += 1
        let js = id.isEmpty ? "window.Minuta && window.Minuta.ir('agenda')" : "window.Minuta && window.Minuta.irBrief(\(Self.json(id)))"
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { VentanaVisor.shared.web?.evaluateJavaScript(js) }
    }

    func avisoDePrueba() {
        AlertaFlotante.shared.mostrar(.init(tipo: .reunion, titulo: "«Daily del equipo» en Microsoft Teams",
            detalle: "Así se ve el aviso (es una prueba: no graba).", principal: "Grabar", secundario: "Ahora no", desde: nil,
            alPrincipal: {}, alSecundario: {}), estilo: temaActual?.estilo, duracion: 20)
    }
    private var relojCalendario: Timer?
    private var finPendiente: Task<Void, Never>?

    /// Una app de reuniones empezó a usar el micrófono.
    private func reunionDetectada(_ app: String) {
        // Volvió a la reunión (era un corte): ya no hay que preguntar si terminó.
        if case .grabando = fase, plataforma.isEmpty || plataforma == app {
            finPendiente?.cancel()
            AlertaFlotante.shared.ocultar(.fin)
            return
        }
        guard fase == .inactiva else { return }
        detectada = app
        autoCategoria(app: app)
        let ev = eventoActual()
        guard ajustes.avisarDeteccion else { return }
        let titulo = ev?.titulo.isEmpty == false ? Idioma.f("«{x}» en {x}", ev!.titulo, app) : Idioma.f("Reunión en {x}", app)
        alertaReunion(titulo, "Un clic y empiezo a grabar y tomar notas.", tituloEvento: ev?.titulo ?? "")
    }

    /// Alerta flotante de reunión: "Grabar" empieza de inmediato.
    private func alertaReunion(_ titulo: String, _ detalle: String, tituloEvento: String) {
        AlertaFlotante.shared.mostrar(.init(
            tipo: .reunion, titulo: titulo, detalle: detalle, principal: "Grabar", secundario: "Ahora no", desde: nil,
            alPrincipal: { [weak self] in
                guard let self, self.fase == .inactiva else { return }
                if self.titulo.trimmingCharacters(in: .whitespaces).isEmpty, !tituloEvento.isEmpty { self.titulo = tituloEvento }
                self.grabar()
            },
            alSecundario: {}), estilo: temaActual?.estilo, duracion: 240)
    }

    /// Alerta flotante de fin: pregunta si terminó, sin cortar nada por su cuenta.
    private func alertaFin(_ app: String) {
        guard case .grabando(let desde) = fase else { return }
        let nombre = titulo.trimmingCharacters(in: .whitespaces).isEmpty ? Idioma.t("Reunión") : "«\(titulo)»"
        AlertaFlotante.shared.mostrar(.init(
            tipo: .fin, titulo: Idioma.f("{x}: {x} se desconectó", nombre, app), detalle: "sigo grabando", principal: "Terminó: generar notas",
            secundario: "Sigo en reunión", desde: desde,
            alPrincipal: { [weak self] in self?.detener() },
            alSecundario: {}), estilo: temaActual?.estilo)
    }

    /// La app de reuniones dejó de usar el micrófono.
    private func reunionTerminada(_ app: String) {
        if fase == .inactiva, detectada == app {
            detectada = nil
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["reunion"])
            AlertaFlotante.shared.ocultar(.reunion)
            return
        }
        // Grabando y la reunión se cerró: espera unos segundos (por si fue un corte) y pregunta si terminó.
        guard ajustes.avisarFin, case .grabando = fase, plataforma.isEmpty || plataforma == app else { return }
        finPendiente?.cancel()
        finPendiente = Task { @MainActor in
            try? await Task.sleep(for: .seconds(8))
            guard !Task.isCancelled, case .grabando = self.fase,
                  !MeetingDetector.appsUsandoMicrofono().contains(where: { MeetingDetector.nombre(de: $0) == app }) else { return }
            self.alertaFin(app)
        }
    }

    /// Avisa 1 minuto antes de las reuniones del calendario (las que tienen invitados o enlace de videollamada).
    private func vigilarCalendario() {
        relojCalendario = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.revisarCalendario() }
        }
    }

    /// Eventos de las próximas 36 h para la Agenda (con invitados, sin contarte a ti).
    func agendaJS() -> [[String: Any]] {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else { return [] }
        let ahora = Date()
        let eventos = calendario.events(matching: calendario.predicateForEvents(withStart: ahora.addingTimeInterval(-3 * 3600),
                                                                               end: ahora.addingTimeInterval(36 * 3600), calendars: nil))
        return eventos.filter { !$0.isAllDay && $0.endDate > ahora }.sorted { $0.startDate < $1.startDate }.prefix(40).map { ev in
            var gente: [[String: String]] = []
            for p in (ev.attendees ?? []) + [ev.organizer].compactMap({ $0 }) where !p.isCurrentUser {
                let u = p.url.absoluteString
                let correo = u.lowercased().hasPrefix("mailto:") ? String(u.dropFirst(7)) : ""
                if gente.contains(where: { $0["email"] == correo && !correo.isEmpty }) { continue }
                gente.append(["nombre": p.name ?? "", "email": correo])
            }
            return ["id": (ev.calendarItemIdentifier) + "@" + String(Int(ev.startDate.timeIntervalSince1970)),
                    "titulo": ev.title ?? "Reunión", "inicio": ev.startDate.timeIntervalSince1970 * 1000,
                    "fin": ev.endDate.timeIntervalSince1970 * 1000, "asistentes": gente, "lugar": ev.location ?? ""]
        }
    }

    private var ultimoResumenCompromisos = UserDefaults.standard.string(forKey: "minuta.resumenCompromisos") ?? ""

    /// 5 minutos antes: "Prepárate" con lo que conviene saber. Una vez al día (desde las 9:00): compromisos de hoy y vencidos.
    private func revisarPreparacion() {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else { return }
        let ahora = Date()
        if ajustes.avisarPrep, fase == .inactiva {
            for ev in agendaJS() {
                guard let id = ev["id"] as? String, let ini = ev["inicio"] as? Double else { continue }
                let falta = ini / 1000 - ahora.timeIntervalSince1970
                guard falta > 150, falta <= 6 * 60, (ev["asistentes"] as? [[String: String]])?.isEmpty == false, !avisados.contains("prep:" + id) else { continue }
                avisados.insert("prep:" + id)
                let titulo = ev["titulo"] as? String ?? "Reunión"
                BarraMenu.shared.textoJS("window.Minuta && window.Minuta.briefTexto(\(Self.json(id)))") { [weak self] texto in
                    let cuerpo = (texto?.isEmpty == false ? texto! : "Toca para ver tu preparación.")
                    self?.notificar("Prepárate: «\(titulo)» en \(max(1, Int(falta / 60))) min", cuerpo, id: "prep", categoria: "PREP", extra: ["evento": id])
                }
            }
        }
        let hoy = ISO8601DateFormatter.string(from: ahora, timeZone: .current, formatOptions: [.withFullDate])
        if ajustes.avisarCompromisos, ultimoResumenCompromisos != hoy, Calendar.current.component(.hour, from: ahora) >= 9 {
            ultimoResumenCompromisos = hoy
            UserDefaults.standard.set(hoy, forKey: "minuta.resumenCompromisos")
            BarraMenu.shared.textoJS("window.Minuta && window.Minuta.resumenCompromisos()") { [weak self] texto in
                guard let texto, !texto.isEmpty else { return }
                self?.notificar("Tus compromisos de hoy", texto, id: "compromisos", categoria: "PREP", extra: ["evento": ""])
            }
        }
    }

    static func json(_ s: String) -> String {
        (try? String(data: JSONSerialization.data(withJSONObject: [s]), encoding: .utf8)).map { String($0.dropFirst().dropLast()) } ?? "\"\""
    }

    /// Crea recordatorios en la app Recordatorios (lista por defecto), sin duplicar los que ya existen sin completar.
    func crearRecordatorios(_ lista: [[String: Any]], alTerminar: @escaping @MainActor (String) -> Void) {
        calendario.requestFullAccessToReminders { ok, _ in
            Task { @MainActor in
                guard ok, let lista0 = self.calendario.defaultCalendarForNewReminders() else {
                    alTerminar("Minuta no tiene permiso para Recordatorios (Ajustes > Privacidad > Recordatorios)."); return
                }
                let pred = self.calendario.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: [lista0])
                self.calendario.fetchReminders(matching: pred) { existentes in
                    let titulos = Set((existentes ?? []).compactMap { $0.title?.lowercased() })
                    Task { @MainActor in
                        var creados = 0, repetidos = 0
                        for d in lista {
                            guard let t = d["titulo"] as? String, !t.isEmpty else { continue }
                            if titulos.contains(t.lowercased()) { repetidos += 1; continue }
                            let r = EKReminder(eventStore: self.calendario)
                            r.title = t
                            r.notes = d["notas"] as? String
                            r.calendar = lista0
                            if let ms = d["fecha"] as? Double {
                                var c = Calendar.current.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: ms / 1000))
                                c.hour = 9; c.minute = 0
                                r.dueDateComponents = c
                                r.addAlarm(EKAlarm(absoluteDate: Calendar.current.date(from: c) ?? Date()))
                            }
                            if (try? self.calendario.save(r, commit: false)) != nil { creados += 1 }
                        }
                        try? self.calendario.commit()
                        alTerminar(creados == 0 && repetidos > 0 ? "Ya estaban en Recordatorios ✓"
                                   : "⏰ \(creados) en Recordatorios\(repetidos > 0 ? " (\(repetidos) ya estaban)" : "")")
                    }
                }
            }
        }
    }

    /// Avisos del coach en vivo (sin sonido, para no interrumpir la reunión).
    func avisoVivo(_ titulo: String, _ cuerpo: String) {
        let c = UNMutableNotificationContent()
        c.title = titulo; c.body = cuerpo
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "vivo", content: c, trigger: nil))
    }

    /// Grabando: a 10 minutos del fin del evento del calendario, recuerda tu hábito.
    private func recordarHabito() {
        guard ajustes.coachVivo, case .grabando = fase else { return }
        let ahora = Date().timeIntervalSince1970
        for ev in agendaJS() {
            guard let id = ev["id"] as? String, let ini = ev["inicio"] as? Double, let fin = ev["fin"] as? Double,
                  ini / 1000 <= ahora, (fin / 1000 - ahora) > 8.5 * 60, (fin / 1000 - ahora) <= 10.5 * 60, !avisados.contains("hab:" + id) else { continue }
            avisados.insert("hab:" + id)
            BarraMenu.shared.textoJS("window.Minuta && window.Minuta.habitoActual()") { [weak self] h in
                self?.avisoVivo("Quedan 10 minutos", (h?.isEmpty == false) ? "Tu hábito: \(h!)" : "Buen momento para cerrar: quién hace qué y para cuándo.")
            }
        }
    }

    private func revisarCalendario() {
        recordarHabito()
        revisarPreparacion()
        guard ajustes.avisarCalendario, fase == .inactiva, EKEventStore.authorizationStatus(for: .event) == .fullAccess else { return }
        let ahora = Date()
        let eventos = calendario.events(matching: calendario.predicateForEvents(withStart: ahora.addingTimeInterval(-60),
                                                                               end: ahora.addingTimeInterval(90), calendars: nil))
        for ev in eventos where !ev.isAllDay && ev.startDate > ahora.addingTimeInterval(-60) && ev.startDate <= ahora.addingTimeInterval(75) {
            let id = (ev.calendarItemIdentifier) + "@" + String(Int(ev.startDate.timeIntervalSince1970))
            guard !avisados.contains(id) else { continue }
            let texto = [ev.location ?? "", ev.notes ?? "", ev.url?.absoluteString ?? ""].joined(separator: " ").lowercased()
            let esVideollamada = ["teams.microsoft", "meet.google", "zoom.us", "webex", "whereby", "facetime"].contains { texto.contains($0) }
            guard esVideollamada || (ev.attendees?.count ?? 0) > 1 else { continue }
            avisados.insert(id)
            let falta = Int(ev.startDate.timeIntervalSince(ahora))
            let titulo = Idioma.f(falta > 20 ? "«{x}» empieza en 1 minuto" : "«{x}» está empezando", ev.title ?? Idioma.t("Reunión"))
            alertaReunion(titulo, "Cuando entres, un clic y empiezo a grabar.", tituloEvento: ev.title ?? "")
        }
    }

    private func responderNotificacion(categoria: String, accion: String, info: [AnyHashable: Any]) {
        switch (categoria, accion) {
        case ("REUNION", "AHORA_NO"), ("REUNION", UNNotificationDismissActionIdentifier):
            break
        case ("PRUEBA", _):
            BarraMenu.shared.mostrar()
        case ("PREP", _):
            abrirPreparacion(info["evento"] as? String ?? "")
        case ("REUNION", _):
            // "Grabar ahora" siempre graba; tocar el aviso graba o solo abre el panel, según Preferencias.
            if fase == .inactiva, accion == "GRABAR" || ajustes.alTocar == "grabar" {
                if titulo.trimmingCharacters(in: .whitespaces).isEmpty, let t = info["titulo"] as? String, !t.isEmpty { titulo = t }
                grabar()
            }
            BarraMenu.shared.mostrar()
        case ("FIN", "SEGUIR"):
            break
        case ("FIN", _):
            detener()
        default:
            break
        }
    }

    /// Elige la categoría según el evento del calendario, el título y la app (si no la elegiste tú).
    func autoCategoria(app: String? = nil) {
        guard !tipoManual else { return }
        let ev = eventoActual()
        let texto = [titulo, ev?.titulo ?? ""].joined(separator: " ")
        if let id = Categorias.elegir(categorias, titulo: texto, correos: ev?.correos ?? [], app: app ?? detectada) {
            tipo = id
            tipoAuto = true
        }
    }

    func elegirTipo(_ id: String) {
        guard categorias.contains(where: { $0.id == id }) else { return }
        tipo = id
        tipoManual = true
        tipoAuto = false
    }

    func guardarCategorias(_ lista: [Categoria]) {
        categorias = lista
        Categorias.guardar(lista)
        if !lista.contains(where: { $0.id == tipo }) { tipo = lista.first?.id ?? "Otra"; tipoManual = false }
    }

    func grabar() {
        calendario.requestFullAccessToEvents { _, _ in
            AVCaptureDevice.requestAccess(for: .audio) { ok in
                Task { @MainActor in
                    if ok { self.empezar() } else { self.estado = "Falta permiso de micrófono (Ajustes > Privacidad)." }
                }
            }
        }
    }

    /// Evento de calendario en curso (o que empieza/terminó hace poco): título e invitados.
    private func eventoActual() -> (titulo: String, asistentes: [String], correos: [String])? {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else { return nil }
        let ahora = Date()
        let predicado = calendario.predicateForEvents(withStart: ahora.addingTimeInterval(-3 * 3600),
                                                      end: ahora.addingTimeInterval(15 * 60), calendars: nil)
        let candidatos = calendario.events(matching: predicado).filter {
            !$0.isAllDay && $0.startDate <= ahora.addingTimeInterval(15 * 60) && $0.endDate >= ahora.addingTimeInterval(-5 * 60)
        }
        guard let ev = candidatos.min(by: { abs($0.startDate.timeIntervalSince(ahora)) < abs($1.startDate.timeIntervalSince(ahora)) })
        else { return nil }
        var nombres: [String] = []
        var correos: [String] = []
        for p in (ev.attendees ?? []) + [ev.organizer].compactMap({ $0 }) where !p.isCurrentUser {
            if let n = p.name, !n.isEmpty, !nombres.contains(n) { nombres.append(n) }
            let u = p.url.absoluteString
            if u.lowercased().hasPrefix("mailto:") { correos.append(String(u.dropFirst(7))) }
        }
        return (ev.title ?? "", nombres, correos)
    }

    private func empezar() {
        let formato = DateFormatter()
        formato.dateFormat = "yyyy-MM-dd_HHmmss"
        let dir = base.appendingPathComponent("grabaciones/\(formato.string(from: Date()))")
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            mic = MicRecorder()
            sistema = SystemAudioRecorder()
            try mic.start(url: dir.appendingPathComponent("yo.caf"))
            do {
                try sistema.start(url: dir.appendingPathComponent("ellos.caf"))
            } catch {
                estado = "Solo micrófono: \(error.localizedDescription)"
            }
            carpeta = dir
            inicio = Date()
            vigilarAudioSistema(dir: dir)
            evento = eventoActual()
            if titulo.trimmingCharacters(in: .whitespaces).isEmpty, let t = evento?.titulo, !t.isEmpty { titulo = t }
            plataforma = detectada ?? ""
            autoCategoria()
            fase = .grabando(desde: inicio)
            if ajustes.coachVivo { CoachVivo.shared.empezar() }
            detectada = nil
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["reunion"])
            AlertaFlotante.shared.ocultar(.reunion)
            if !estado.hasPrefix("Solo") { estado = "" }
        } catch {
            mic.stop(); sistema.stop()
            estado = "No pude grabar: \(error.localizedDescription)"
        }
    }

    /// Si macOS concede el permiso de audio del sistema después de iniciar (primera vez), la captura
    /// no recibe nada hasta reiniciarla. Revisa a los 4 s y a los 10 s; si no llega audio, la reinicia.
    private func vigilarAudioSistema(dir: URL) {
        Task { @MainActor in
            for intento in 1...2 {
                try? await Task.sleep(for: .seconds(intento == 1 ? 4 : 6))
                guard case .grabando = fase, carpeta == dir, sistema.firstBuffer == nil else { return }
                sistema.stop()
                sistema = SystemAudioRecorder()
                do {
                    try sistema.start(url: dir.appendingPathComponent("ellos.caf"))
                } catch {
                    estado = "Solo micrófono: \(error.localizedDescription)"
                    return
                }
            }
            try? await Task.sleep(for: .seconds(4))
            if case .grabando = fase, carpeta == dir, sistema.firstBuffer == nil {
                estado = "⚠️ No llega el audio de los demás. Revisa Ajustes > Privacidad > Grabación de pantalla y audio del sistema > Minuta."
                notificar("Minuta no está grabando a los demás", "Revisa el permiso de audio del sistema.")
            }
        }
    }

    /// Prueba de diagnóstico: `open Minuta.app --args --prueba-captura` graba 8 s de audio del sistema.
    func pruebaCaptura() {
        let url = base.appendingPathComponent("prueba-captura.caf")
        let rec = SystemAudioRecorder()
        var resultado = "ok"
        do { try rec.start(url: url) } catch { resultado = "error: \(error.localizedDescription)" }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(8))
            rec.stop()
            if resultado == "ok" { resultado = rec.firstBuffer == nil ? "sin buffers" : "con audio" }
            try? resultado.write(to: base.appendingPathComponent("prueba-captura.txt"), atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
        }
    }

    func detener() {
        guard case .grabando = fase, let dir = carpeta else { return }
        finPendiente?.cancel()
        CoachVivo.shared.detener()
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["fin"])
        AlertaFlotante.shared.ocultar(.fin)
        mic.stop()
        sistema.stop()
        let meta: [String: Any] = [
            "titulo": titulo.trimmingCharacters(in: .whitespaces),
            "tipo": tipo,
            "plataforma": plataforma,
            "inicio": inicio.timeIntervalSince1970,
            "fin": Date().timeIntervalSince1970,
            "yo_primer_buffer": mic.firstBuffer?.timeIntervalSince1970 ?? 0,
            "ellos_primer_buffer": sistema.firstBuffer?.timeIntervalSince1970 ?? 0,
            "evento": evento?.titulo ?? "",
            "asistentes": evento?.asistentes ?? [],
            "correos": evento?.correos ?? [],
        ]
        if let data = try? JSONSerialization.data(withJSONObject: meta, options: [.prettyPrinted]) {
            try? data.write(to: dir.appendingPathComponent("meta.json"))
        }
        // Queda libre al tiro para otra reunión: las notas se generan en segundo plano.
        let nombre = (meta["titulo"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (evento?.titulo.isEmpty == false ? evento!.titulo : "Reunión")
        fase = .inactiva
        titulo = ""
        tipoManual = false
        tipoAuto = false
        plataforma = ""
        evento = nil
        carpeta = nil
        enCola.append((dir, nombre))
        estado = ""
        procesarSiguiente()
    }

    /// Procesa la cola de a una reunión (Whisper usa mucha CPU; dos a la vez harían sufrir al Mac).
    private func procesarSiguiente() {
        guard procesandoAhora == nil, let siguiente = enCola.first else { return }
        let dir = siguiente.dir
        procesandoAhora = dir
        ejecutar(script: "procesar.py", argumentos: [dir.path], log: dir.appendingPathComponent("procesar.log")) { [weak self] ok in
            guard let self else { return }
            self.procesandoAhora = nil
            self.enCola.removeAll { $0.dir == dir }
            defer { self.procesarSiguiente() }
            if ok, let ruta = try? String(contentsOf: dir.appendingPathComponent("nota.txt"), encoding: .utf8) {
                let url = URL(fileURLWithPath: ruta.trimmingCharacters(in: .whitespacesAndNewlines))
                self.ultimaNota = url
                self.estado = "Lista: \(url.deletingPathExtension().lastPathComponent)"
                self.notaSeleccionada = url
                self.anunciarNota(url)
                Respaldo.sincronizar()
            } else {
                self.estado = "Falló el procesamiento de «\(siguiente.titulo)». Revisa procesar.log en \(dir.lastPathComponent)."
                self.notificar("Minuta: error al procesar", "Revisa procesar.log")
            }
        }
    }

    /// Nota lista: si trajo logros o rango, alerta de recompensa (se abre con efecto); si no, "Notas listas".
    private func anunciarNota(_ url: URL) {
        let nombre = url.deletingPathExtension().lastPathComponent.replacingOccurrences(of: #"^\d{4}-\d{2}-\d{2} \d{4} - "#, with: "", options: .regularExpression)
        BarraMenu.shared.premios(url.path) { [weak self] p in
            guard let self else { return }
            let logros = p?["logros"] as? [[String: Any]] ?? []
            let rango = p?["rango"] as? [String: Any]
            if !logros.isEmpty || rango != nil {
                let titulo: String, emoji: String
                var detalle: String
                if let rango {
                    titulo = Idioma.f("¡Subiste a «{x}»!", rango["nombre"] as? String ?? "")
                    emoji = rango["emoji"] as? String ?? "⬆️"
                    detalle = logros.isEmpty ? Idioma.f("Con tu reunión «{x}».", nombre) : Idioma.f(logros.count > 1 ? "Y desbloqueaste {x} logros." : "Y desbloqueaste {x} logro.", "\(logros.count)")
                } else {
                    titulo = Idioma.f("Desbloqueaste «{x}»", logros[0]["nombre"] as? String ?? "")
                    emoji = logros[0]["emoji"] as? String ?? "🏆"
                    detalle = logros.count > 1 ? Idioma.f(logros.count > 2 ? "Y {x} logros más." : "Y {x} logro más.", "\(logros.count - 1)") : Idioma.f("Con tu reunión «{x}».", nombre)
                }
                if let xp = p?["xp"] as? Int, let moneda = p?["moneda"] as? String { detalle += " +\(xp) \(moneda)" }
                AlertaFlotante.shared.mostrar(.init(tipo: .logro, titulo: titulo, detalle: detalle, principal: "Abrir", secundario: "Después", desde: nil,
                    alPrincipal: { [weak self] in self?.abrirRevelacion(url) }, alSecundario: {}, emoji: emoji),
                    estilo: self.temaActual?.estilo, duracion: 300)
            } else if self.ajustes.avisarNotas {
                AlertaFlotante.shared.mostrar(.init(tipo: .listo, titulo: nombre, detalle: "Resumen, tu desempeño y el mensaje para enviar.",
                    principal: "Ver notas", secundario: "Después", desde: nil,
                    alPrincipal: { [weak self] in self?.abrirVisor(url) }, alSecundario: {}),
                    estilo: self.temaActual?.estilo, duracion: 120)
            }
        }
    }

    /// Abre el visor en la nota y lanza la revelación (espera a que la ventana tenga la nota cargada).
    func abrirRevelacion(_ url: URL) {
        abrirVisor(url)
        func intentar(_ n: Int) {
            let js = "window.Minuta && window.Minuta.revelar ? window.Minuta.revelar(\(Self.json(url.path))) : false"
            VentanaVisor.shared.web?.evaluateJavaScript(js) { r, _ in
                Task { @MainActor in
                    if (r as? Bool) != true, n < 20 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { intentar(n + 1) } }
                }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { intentar(0) }
    }

    func buscarActualizacion() {
        Actualizaciones.revisar { [weak self] hay, detalle in
            guard let self else { return }
            self.actualizacion = ["hay": hay, "detalle": detalle, "version": Actualizaciones.version]
            if let json = try? JSONSerialization.data(withJSONObject: self.actualizacion), let t = String(data: json, encoding: .utf8) {
                VentanaVisor.shared.web?.evaluateJavaScript("window.Minuta && window.Minuta.actualizacion && window.Minuta.actualizacion(\(t))")
            }
        }
    }

    func resumenSemanal() {
        estado = "Generando resumen semanal…"
        let log = base.appendingPathComponent("semana.log")
        ejecutar(script: "semana.py", argumentos: [], log: log) { [weak self] ok in
            guard let self else { return }
            if ok, let ruta = try? String(contentsOf: self.base.appendingPathComponent("ultimo-semanal.txt"), encoding: .utf8) {
                let url = URL(fileURLWithPath: ruta.trimmingCharacters(in: .whitespacesAndNewlines))
                self.estado = "Resumen semanal listo."
                NSWorkspace.shared.open(url)
            } else {
                self.estado = "No pude generar el resumen semanal (ver semana.log)."
            }
        }
    }

    /// Python que viene dentro de la app; si no está (desarrollo), el del sistema.
    static var python: URL {
        let candidatos = [Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/python/bin/python3").path,
                          "/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"]
        return URL(fileURLWithPath: candidatos.first { FileManager.default.isExecutableFile(atPath: $0) } ?? "/usr/bin/python3")
    }

    private func ejecutar(script: String, argumentos: [String], log: URL, alTerminar: @escaping @MainActor (Bool) -> Void) {
        let proceso = Process()
        proceso.executableURL = Self.python
        // Los scripts buscan aquí el transcriptor y el separador de voces que vienen dentro de la app.
        var entorno = ProcessInfo.processInfo.environment
        entorno["MINUTA_HERRAMIENTAS"] = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS").path
        entorno["PYTHONDONTWRITEBYTECODE"] = "1"
        entorno["MINUTA_RECURSOS"] = Temas.recursos.path
        proceso.environment = entorno
        proceso.arguments = [Temas.recursos.appendingPathComponent("bin/\(script)").path] + argumentos
        FileManager.default.createFile(atPath: log.path, contents: nil)
        if let handle = try? FileHandle(forWritingTo: log) {
            proceso.standardOutput = handle
            proceso.standardError = handle
        }
        proceso.terminationHandler = { p in
            let ok = p.terminationStatus == 0
            Task { @MainActor in alTerminar(ok) }
        }
        do { try proceso.run() } catch {
            estado = "No pude ejecutar \(script): \(error.localizedDescription)"
            Task { @MainActor in alTerminar(false) }
        }
    }

    /// Corre un script de ~/minuta/bin que escribe su resultado JSON en un archivo temporal.
    func correrScriptJSON(_ script: String, _ args: [String], alTerminar: @escaping @MainActor ([String: Any]?, String) -> Void) {
        let salida = FileManager.default.temporaryDirectory.appendingPathComponent("minuta-\(UUID().uuidString).json")
        let log = FileManager.default.temporaryDirectory.appendingPathComponent("minuta-\(script).log")
        ejecutar(script: script, argumentos: args + [salida.path], log: log) { _ in
            let datos = (try? Data(contentsOf: salida)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            let error = (try? String(contentsOf: log, encoding: .utf8))?.split(separator: "\n").last.map(String.init) ?? "sin respuesta"
            try? FileManager.default.removeItem(at: salida)
            alTerminar(datos, error)
        }
    }

    /// Crea un universo con Claude (bin/universo.py). Devuelve (ok, id, nombre o error).
    func crearUniverso(nombre: String, notas: String, alTerminar: @escaping @MainActor (Bool, String, String) -> Void) {
        let log = base.appendingPathComponent("universo.log")
        ejecutar(script: "universo.py", argumentos: [nombre, notas], log: log) { [weak self] ok in
            guard let self else { return }
            let salida = (try? String(contentsOf: log, encoding: .utf8)) ?? ""
            let linea = salida.split(separator: "\n").map(String.init).last { $0.hasPrefix("OK ") || $0.hasPrefix("ERROR ") } ?? "ERROR sin respuesta"
            self.temas = Temas.todos()
            if ok, linea.hasPrefix("OK ") {
                let partes = linea.dropFirst(3).split(separator: " ", maxSplits: 1).map(String.init)
                let id = partes.first ?? "", nombreFinal = partes.count > 1 ? partes[1] : nombre
                self.notificar("Universo listo: \(nombreFinal)", "Ábrelo en la galería de universos.")
                alTerminar(true, id, nombreFinal)
            } else {
                alTerminar(false, "", String(linea.dropFirst(6)))
            }
        }
    }

    func cambiarInicioAutomatico(_ activar: Bool) {
        do {
            if activar { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
        } catch {
            estado = "No pude cambiar el inicio automático: \(error.localizedDescription)"
        }
        abrirAlIniciar = SMAppService.mainApp.status == .enabled
    }

    func abrirVisor(_ nota: URL? = nil) {
        if let nota { notaSeleccionada = nota }
        pedirVisor += 1
    }

    private func notificar(_ titulo: String, _ cuerpo: String, nota: String? = nil, id: String? = nil,
                           categoria: String? = nil, extra: [String: String] = [:]) {
        let contenido = UNMutableNotificationContent()
        contenido.title = titulo
        contenido.body = cuerpo
        contenido.sound = .default
        var info: [String: String] = extra
        if let nota { info["nota"] = nota }
        contenido.userInfo = info
        if let categoria {
            contenido.categoryIdentifier = categoria
        }
        let request = UNNotificationRequest(identifier: id ?? UUID().uuidString, content: contenido, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}

@main
struct MinutaApp: App {
    @NSApplicationDelegateAdaptor(DelegadoApp.self) private var delegado

    var body: some Scene {
        // Todo vive en la barra de menú (BarraMenu) y en la ventana propia del visor (VentanaVisor).
        Settings { EmptyView() }
    }
}

@MainActor
final class DelegadoApp: NSObject, NSApplicationDelegate {
    let model = AppModel()

    func applicationDidFinishLaunching(_ aviso: Notification) {
        BarraMenu.shared.instalar(model: model)
    }
}

final class DelegadoNotificaciones: NSObject, UNUserNotificationCenterDelegate {
    var alHacerClic: ((String?) -> Void)?
    var alResponder: ((String, String, [AnyHashable: Any]) -> Void)?

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let contenido = response.notification.request.content
        if contenido.categoryIdentifier.isEmpty {
            alHacerClic?(contenido.userInfo["nota"] as? String)
        } else {
            alResponder?(contenido.categoryIdentifier, response.actionIdentifier, contenido.userInfo)
        }
        completionHandler()
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
}
