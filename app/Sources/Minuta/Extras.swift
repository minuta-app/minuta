import Foundation

/// Archivos auxiliares de Minuta: correcciones de transcripción, votos 👍/👎 y edición de notas.
enum Extras {
    static var correccionesURL: URL { Temas.base.appendingPathComponent("correcciones.json") }
    static var votosURL: URL { Temas.base.appendingPathComponent("votos.json") }
    static var vocabularioURL: URL { Temas.base.appendingPathComponent("vocabulario.txt") }

    private static func leerJSON(_ url: URL) -> Any? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    private static func escribirJSON(_ valor: Any, _ url: URL) {
        if let data = try? JSONSerialization.data(withJSONObject: valor, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]) {
            try? data.write(to: url, options: .atomic)
        }
    }

    // MARK: Correcciones

    static func correcciones() -> [[String: Any]] { (leerJSON(correccionesURL) as? [[String: Any]]) ?? [] }

    static func agregarCorreccion(_ d: [String: Any]) {
        guard let de = (d["de"] as? String)?.trimmingCharacters(in: .whitespaces), let a = (d["a"] as? String)?.trimmingCharacters(in: .whitespaces),
              !de.isEmpty, !a.isEmpty else { return }
        var lista = correcciones().filter { ($0["de"] as? String) != de }
        lista.append(["de": de, "a": a, "palabra": d["palabra"] as? Bool ?? true, "mayus": d["mayus"] as? Bool ?? true])
        escribirJSON(lista, correccionesURL)
        // También al vocabulario, para que Whisper la escriba bien de entrada.
        var vocab = (try? String(contentsOf: vocabularioURL, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
            ?? "Reunión de trabajo."
        if !vocab.localizedCaseInsensitiveContains(a) {
            vocab = vocab.hasSuffix(".") ? String(vocab.dropLast()) + ", \(a)." : vocab + " \(a)."
            try? vocab.write(to: vocabularioURL, atomically: true, encoding: .utf8)
        }
    }

    static func quitarCorreccion(_ de: String) {
        escribirJSON(correcciones().filter { ($0["de"] as? String) != de }, correccionesURL)
    }

    // MARK: Votos

    static func votos() -> [String: Any] { (leerJSON(votosURL) as? [String: Any]) ?? [:] }

    static func votar(_ d: [String: Any]) {
        guard let clave = d["clave"] as? String else { return }
        var todos = votos()
        let v = (d["v"] as? Int) ?? Int((d["v"] as? Double) ?? 0)
        if v == 0 {
            todos.removeValue(forKey: clave)
        } else {
            var registro = d
            registro.removeValue(forKey: "accion")
            registro.removeValue(forKey: "clave")
            registro["v"] = v
            registro["fecha"] = ISO8601DateFormatter().string(from: Date())
            todos[clave] = registro
        }
        escribirJSON(todos, votosURL)
    }

    // MARK: Notas

    /// Reescribe una nota (solo .md dentro de la carpeta de reuniones).
    static func reescribir(_ ruta: String, _ texto: String) -> Bool {
        let url = URL(fileURLWithPath: ruta).standardizedFileURL
        guard url.pathExtension == "md",
              url.deletingLastPathComponent().standardizedFileURL.path == Papelera.carpeta.standardizedFileURL.path,
              FileManager.default.fileExists(atPath: url.path), !texto.isEmpty else { return false }
        return (try? texto.write(to: url, atomically: true, encoding: .utf8)) != nil
    }

    // MARK: Mensajes para enviar (redactados por Claude, uno por nota)

    static var mensajesURL: URL { Temas.base.appendingPathComponent("mensajes") }

    static func mensajeURL(_ ruta: String) -> URL {
        mensajesURL.appendingPathComponent(URL(fileURLWithPath: ruta).deletingPathExtension().lastPathComponent + ".json")
    }

    static func mensajeGuardado(_ ruta: String) -> [String: Any]? {
        guard let d = leerJSON(mensajeURL(ruta)) as? [String: Any], let t = d["texto"] as? String, !t.isEmpty else { return nil }
        return d
    }

    /// Guarda lo que el usuario edita a mano, para que al volver a abrir esté tal cual lo dejó.
    static func guardarMensaje(_ ruta: String, asunto: String, texto: String) {
        guard !texto.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        try? FileManager.default.createDirectory(at: mensajesURL, withIntermediateDirectories: true)
        var d = mensajeGuardado(ruta) ?? [:]
        d["asunto"] = asunto; d["texto"] = texto; d["editado"] = true
        d["fecha"] = ISO8601DateFormatter().string(from: Date())
        escribirJSON(d, mensajeURL(ruta))
    }

    /// Mueve a la Papelera un universo descargado o creado (los que vienen con Minuta no se pueden borrar).
    static func borrarUniverso(_ id: String) -> Bool {
        guard id.range(of: "^[a-z0-9]+$", options: .regularExpression) != nil else { return false }
        let url = Temas.carpeta.appendingPathComponent("\(id).json")
        guard FileManager.default.fileExists(atPath: url.path) else { return false }
        return (try? FileManager.default.trashItem(at: url, resultingItemURL: nil)) != nil
    }
}

/// Preferencias de avisos de Minuta (~/minuta/ajustes.json).
struct AjustesAvisos: Codable, Equatable {
    var avisarDeteccion = true
    var avisarCalendario = true
    var avisarFin = true
    var avisarNotas = true
    /// "grabar": tocar el aviso empieza a grabar. "panel": solo abre el panel.
    var alTocar = "grabar"
    var avisarPrep = true
    var avisarCompromisos = true
    var coachVivo = true
    var avisoMonologo = true

    init() {}

    /// Tolerante: si falta una opción nueva en el archivo, usa su valor por defecto en vez de perder todo.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        avisarDeteccion = try c.decodeIfPresent(Bool.self, forKey: .avisarDeteccion) ?? true
        avisarCalendario = try c.decodeIfPresent(Bool.self, forKey: .avisarCalendario) ?? true
        avisarFin = try c.decodeIfPresent(Bool.self, forKey: .avisarFin) ?? true
        avisarNotas = try c.decodeIfPresent(Bool.self, forKey: .avisarNotas) ?? true
        alTocar = try c.decodeIfPresent(String.self, forKey: .alTocar) ?? "grabar"
        avisarPrep = try c.decodeIfPresent(Bool.self, forKey: .avisarPrep) ?? true
        avisarCompromisos = try c.decodeIfPresent(Bool.self, forKey: .avisarCompromisos) ?? true
        coachVivo = try c.decodeIfPresent(Bool.self, forKey: .coachVivo) ?? true
        avisoMonologo = try c.decodeIfPresent(Bool.self, forKey: .avisoMonologo) ?? true
    }

    static var archivo: URL { Temas.base.appendingPathComponent("ajustes.json") }

    static func cargar() -> AjustesAvisos {
        guard let data = try? Data(contentsOf: archivo), let a = try? JSONDecoder().decode(AjustesAvisos.self, from: data) else { return AjustesAvisos() }
        return a
    }

    func guardar() {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? enc.encode(self) { try? data.write(to: Self.archivo, options: .atomic) }
    }

    var paraJS: [String: Any] {
        ["avisarDeteccion": avisarDeteccion, "avisarCalendario": avisarCalendario, "avisarFin": avisarFin, "avisarNotas": avisarNotas, "alTocar": alTocar,
         "avisarPrep": avisarPrep, "avisarCompromisos": avisarCompromisos, "coachVivo": coachVivo, "avisoMonologo": avisoMonologo]
    }

    static func desdeJS(_ d: [String: Any]) -> AjustesAvisos {
        var a = AjustesAvisos()
        a.avisarDeteccion = d["avisarDeteccion"] as? Bool ?? true
        a.avisarCalendario = d["avisarCalendario"] as? Bool ?? true
        a.avisarFin = d["avisarFin"] as? Bool ?? true
        a.avisarNotas = d["avisarNotas"] as? Bool ?? true
        a.alTocar = (d["alTocar"] as? String) == "panel" ? "panel" : "grabar"
        a.avisarPrep = d["avisarPrep"] as? Bool ?? true
        a.avisarCompromisos = d["avisarCompromisos"] as? Bool ?? true
        a.coachVivo = d["coachVivo"] as? Bool ?? true
        a.avisoMonologo = d["avisoMonologo"] as? Bool ?? true
        return a
    }
}
