import Foundation

// MARK: - Universos (temas)

struct TemaJuego: Codable, Identifiable, Hashable {
    struct Arquetipo: Codable, Hashable { let nombre: String; let referencia: String; let frase: String }
    struct Rango: Codable, Hashable { let nombre: String; let frase: String }
    struct Logro: Codable, Hashable { let nombre: String; let descripcion: String }
    struct Estilo: Codable, Hashable {
        let modo: String, fondo: String, fondo2: String, panel: String, texto: String, suave: String, linea: String
        let acento: String, acento_texto: String, acento2: String
        let fuente: String, peso: Int, mayusculas: Bool, cursiva: Bool, patron: String, radio: Int
        var oscuro: Bool { modo == "oscuro" }
    }

    let id: String
    let nombre: String
    let emoji: String
    let xp: String
    let personaje_por_defecto: String
    let elogios: [String]
    let apartados: [String: [Arquetipo]]
    let rangos: [Rango]
    let logros: [String: Logro]
    var iconos_logros: [String: String]?
    var iconos_apartados: [String: String]?
    var iconos_rangos: [String]?
    var estilo: Estilo?

    func iconoLogro(_ def: Juego.LogroDef) -> String { iconos_logros?[def.id] ?? def.emoji }
    func iconoApartado(_ a: Juego.Apartado) -> String { iconos_apartados?[a.clave] ?? a.emoji }
    func iconoRango(_ i: Int) -> String { (iconos_rangos?.count ?? 0) > i ? iconos_rangos![i] : emoji }
}

enum Temas {
    /// Datos del usuario (perfil, temas descargados, modelos, grabaciones). Nunca va dentro de la app.
    static let base = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("minuta")
    /// Código que usa la app (bin/, ui/, universos/): dentro de Minuta.app, salvo en una instalación de desarrollo
    /// (~/minuta es un checkout de git), donde se usa el checkout para ver los cambios al tiro.
    static var recursos: URL {
        if FileManager.default.fileExists(atPath: base.appendingPathComponent(".git").path),
           FileManager.default.fileExists(atPath: base.appendingPathComponent("ui/index.html").path) { return base }
        return Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/minuta")
    }
    static var carpeta: URL { base.appendingPathComponent("temas") }
    static var config: URL { base.appendingPathComponent("config.json") }

    /// Universos que vienen con la app (en el repo). Los descargados o creados viven en `carpeta` (~/minuta/temas).
    static var incluidos: URL { recursos.appendingPathComponent("universos") }

    /// Archivos de universo: los incluidos y los tuyos (si tienes uno con el mismo id, gana el tuyo).
    static func archivos() -> [URL] {
        var porId: [String: URL] = [:]
        for dir in [incluidos, carpeta] {
            for url in (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
            where url.pathExtension == "json" && !url.lastPathComponent.hasPrefix("_") {
                porId[url.deletingPathExtension().lastPathComponent] = url
            }
        }
        return porId.keys.sorted().map { porId[$0]! }
    }

    /// Para la interfaz: cada universo con su estilo dentro y si viene incluido o se puede borrar.
    static func paraJS() -> [[String: Any]] {
        let estilos = (try? JSONSerialization.jsonObject(with: Data(contentsOf: carpeta.appendingPathComponent("_estilos.json")))) as? [String: Any] ?? [:]
        let ids = Set(((try? FileManager.default.contentsOfDirectory(at: incluidos, includingPropertiesForKeys: nil)) ?? []).map { $0.deletingPathExtension().lastPathComponent })
        return archivos().compactMap { url in
            guard var o = (try? Data(contentsOf: url)).flatMap({ try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }),
                  let id = o["id"] as? String else { return nil }
            if o["estilo"] == nil, let e = estilos[id] { o["estilo"] = e }
            o["incluido"] = ids.contains(id) && url.deletingLastPathComponent().standardizedFileURL == incluidos.standardizedFileURL
            return o
        }
    }

    /// Todos los universos disponibles, ordenados por nombre ("Cine variado" al final).
    static func todos() -> [TemaJuego] {
        let estilos = (try? JSONDecoder().decode([String: TemaJuego.Estilo].self,
                                                 from: Data(contentsOf: carpeta.appendingPathComponent("_estilos.json")))) ?? [:]
        return archivos()
            .compactMap { url -> TemaJuego? in
                guard var t = try? JSONDecoder().decode(TemaJuego.self, from: Data(contentsOf: url)) else { return nil }
                if t.estilo == nil { t.estilo = estilos[t.id] }
                return t
            }
            .filter { t in Juego.apartados.allSatisfy { (t.apartados[$0.clave]?.count ?? 0) == 10 } && t.rangos.count == 10 }
            .sorted { ($0.id == "cine" ? "zzz" : $0.nombre) < ($1.id == "cine" ? "zzz" : $1.nombre) }
    }

    static func idGuardado() -> String {
        guard let data = try? Data(contentsOf: config),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = json["tema"] as? String else { return "cine" }
        return id
    }

    static func guardar(id: String) {
        var json: [String: Any] = [:]
        if let data = try? Data(contentsOf: config), let previo = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            json = previo
        }
        json["tema"] = id
        if let data = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted]) {
            try? data.write(to: config)
        }
    }

    static func cargar(_ id: String) -> TemaJuego? {
        let todos = todos()
        return todos.first { $0.id == id } ?? todos.first { $0.id == "cine" } ?? todos.first
    }
}

// MARK: - Motor de juego

enum Juego {
    struct Apartado { let clave: String; let titulo: String; let emoji: String }

    static let apartados = [
        Apartado(clave: "claridad", titulo: "Claridad", emoji: "💬"),
        Apartado(clave: "escucha", titulo: "Escucha", emoji: "👂"),
        Apartado(clave: "preguntas", titulo: "Preguntas", emoji: "❓"),
        Apartado(clave: "cierre", titulo: "Cierre", emoji: "🎯"),
    ]

    static let umbralesRango = [0, 300, 800, 1500, 2500, 3800, 5400, 7300, 9500, 12000]
    static let xpPorLogro = 100

    // Lectura de datos de una nota

    static func puntajes(de nota: Nota) -> [String: Int]? {
        guard let linea = nota.contenido.components(separatedBy: "\n").first(where: { $0.contains("Puntajes") }) else { return nil }
        var res: [String: Int] = [:]
        for a in apartados {
            if let r = linea.range(of: "\(a.titulo)[^0-9\\n]{0,25}?(\\d{1,2})", options: [.regularExpression, .caseInsensitive]),
               let n = Int(linea[r].filter(\.isNumber)) {
                res[a.clave] = min(10, max(1, n))
            }
        }
        return res.count == apartados.count ? res : nil
    }

    static func personaje(de nota: Nota) -> String? {
        guard let linea = nota.contenido.components(separatedBy: "\n").first(where: { $0.contains("**Personaje:**") }) else { return nil }
        return linea.components(separatedBy: "**Personaje:**").last?.trimmingCharacters(in: .whitespaces)
    }

    static func numero(_ nota: Nota, _ clave: String) -> Double { Double(nota.fm[clave] ?? "") ?? 0 }

    static func sinMuletillas(_ nota: Nota) -> Bool {
        nota.contenido.components(separatedBy: "\n").contains { $0.hasPrefix("| Muletillas |") && $0.contains("—") }
    }

    static func xp(_ p: [String: Int]) -> Int { p.values.reduce(0, +) * 10 }

    static func arquetipo(_ tema: TemaJuego, _ clave: String, _ puntaje: Double) -> TemaJuego.Arquetipo? {
        guard let lista = tema.apartados[clave], lista.count == 10 else { return nil }
        return lista[min(9, max(0, Int(puntaje.rounded()) - 1))]
    }

    static func rango(_ tema: TemaJuego, xp: Int) -> (indice: Int, actual: TemaJuego.Rango, siguienteXP: Int?) {
        let i = umbralesRango.lastIndex(where: { xp >= $0 }) ?? 0
        return (i, tema.rangos[i], i + 1 < umbralesRango.count ? umbralesRango[i + 1] : nil)
    }

    // MARK: Logros

    struct LogroDef {
        let id: String
        let emoji: String
        let objetivo: Double
        let formato: (Double) -> String   // cómo mostrar el progreso
    }

    static let entero: (Double) -> String = { "\(Int($0))" }
    static let horas: (Double) -> String = { String(format: "%.1f h", $0 / 60) }
    static let minutos: (Double) -> String = { "\(Int($0)) min" }
    static let sino: (Double) -> String = { $0 >= 1 ? "Logrado" : "Pendiente" }

    static let logros: [LogroDef] = [
        LogroDef(id: "primera_reunion", emoji: "🎬", objetivo: 1, formato: entero),
        LogroDef(id: "reuniones_10", emoji: "🔟", objetivo: 10, formato: entero),
        LogroDef(id: "reuniones_25", emoji: "🥉", objetivo: 25, formato: entero),
        LogroDef(id: "reuniones_50", emoji: "🥈", objetivo: 50, formato: entero),
        LogroDef(id: "reuniones_100", emoji: "🥇", objetivo: 100, formato: entero),
        LogroDef(id: "horas_5", emoji: "⏱️", objetivo: 300, formato: horas),
        LogroDef(id: "horas_20", emoji: "⏳", objetivo: 1200, formato: horas),
        LogroDef(id: "minutos_hablados_60", emoji: "🎙️", objetivo: 60, formato: minutos),
        LogroDef(id: "minutos_hablados_300", emoji: "📣", objetivo: 300, formato: minutos),
        LogroDef(id: "preguntas_50", emoji: "❓", objetivo: 50, formato: entero),
        LogroDef(id: "preguntas_10_en_una", emoji: "🔎", objetivo: 10, formato: entero),
        LogroDef(id: "escucha_activa", emoji: "👂", objetivo: 1, formato: sino),
        LogroDef(id: "cero_interrupciones_5", emoji: "🤐", objetivo: 5, formato: entero),
        LogroDef(id: "puntaje_perfecto", emoji: "💯", objetivo: 1, formato: sino),
        LogroDef(id: "reunion_9", emoji: "🌟", objetivo: 1, formato: sino),
        LogroDef(id: "racha_semana", emoji: "🔥", objetivo: 5, formato: entero),
        LogroDef(id: "maraton", emoji: "🏃", objetivo: 90, formato: minutos),
        LogroDef(id: "express", emoji: "⚡", objetivo: 1, formato: sino),
        LogroDef(id: "sin_muletillas", emoji: "🧼", objetivo: 1, formato: sino),
        LogroDef(id: "mejora_cierre", emoji: "📈", objetivo: 1, formato: sino),
        LogroDef(id: "madrugador", emoji: "🌅", objetivo: 1, formato: sino),
        LogroDef(id: "nocturno", emoji: "🌙", objetivo: 1, formato: sino),
    ]

    struct EstadoLogro {
        let def: LogroDef
        var progreso: Double = 0
        var fecha: Date?
        var nota: String?   // ruta de la nota donde se desbloqueó
        var listo: Bool { fecha != nil }
    }

    /// Recorre las reuniones en orden y calcula el progreso de cada logro (y cuándo se desbloqueó).
    static func calcularLogros(_ notas: [Nota], hasta limite: Date? = nil) -> [EstadoLogro] {
        var estados = logros.map { EstadoLogro(def: $0) }
        let orden = notas.filter { limite == nil || $0.fecha <= limite! }.sorted { $0.fecha < $1.fecha }
        let cal = Calendar(identifier: .iso8601)
        var cuenta = 0.0, minutosTotales = 0.0, hablados = 0.0, preguntas = 0.0, maxPreguntas = 0.0
        var racha = 0.0, mejorRacha = 0.0, maxDuracion = 0.0, maxDias = 0.0
        var escucha = 0.0, perfecto = 0.0, nueve = 0.0, express = 0.0, limpio = 0.0, mejora = 0.0, temprano = 0.0, tarde = 0.0
        var dias: [String: Set<Int>] = [:]
        var cierres: [Int] = []

        for n in orden {
            let dur = n.duracionMin
            cuenta += 1
            minutosTotales += dur
            hablados += numero(n, "habla_yo_min")
            let q = numero(n, "preguntas_yo")
            preguntas += q
            maxPreguntas = max(maxPreguntas, q)
            if numero(n, "interrupciones_yo") == 0 { racha += 1 } else { racha = 0 }
            mejorRacha = max(mejorRacha, racha)
            maxDuracion = max(maxDuracion, dur)
            let comp = cal.dateComponents([.yearForWeekOfYear, .weekOfYear, .weekday, .hour, .minute], from: n.fecha)
            let semana = "\(comp.yearForWeekOfYear ?? 0)-\(comp.weekOfYear ?? 0)"
            dias[semana, default: []].insert(comp.weekday ?? 0)
            maxDias = max(maxDias, Double(dias[semana]!.count))
            let minutoDelDia = (comp.hour ?? 0) * 60 + (comp.minute ?? 0)
            if minutoDelDia < 8 * 60 + 30 { temprano = 1 }
            if minutoDelDia >= 20 * 60 { tarde = 1 }
            if dur >= 15 && numero(n, "habla_yo_pct") > 0 && numero(n, "habla_yo_pct") <= 35 { escucha = 1 }
            if dur >= 15 && sinMuletillas(n) { limpio = 1 }
            if let p = puntajes(de: n) {
                if p.values.contains(10) { perfecto = 1 }
                if Double(p.values.reduce(0, +)) / 4 >= 9 { nueve = 1 }
                if dur > 0 && dur <= 15 && (p["cierre"] ?? 0) >= 8 { express = 1 }
                cierres.append(p["cierre"] ?? 0)
                if cierres.count >= 10 {
                    let ultimos = cierres.suffix(5), previos = cierres.dropLast(5).suffix(5)
                    if Double(ultimos.reduce(0, +)) / 5 - Double(previos.reduce(0, +)) / 5 >= 2 { mejora = 1 }
                }
            }
            let valores: [String: Double] = [
                "primera_reunion": cuenta, "reuniones_10": cuenta, "reuniones_25": cuenta, "reuniones_50": cuenta,
                "reuniones_100": cuenta, "horas_5": minutosTotales, "horas_20": minutosTotales,
                "minutos_hablados_60": hablados, "minutos_hablados_300": hablados, "preguntas_50": preguntas,
                "preguntas_10_en_una": maxPreguntas, "escucha_activa": escucha, "cero_interrupciones_5": mejorRacha,
                "puntaje_perfecto": perfecto, "reunion_9": nueve, "racha_semana": maxDias, "maraton": maxDuracion,
                "express": express, "sin_muletillas": limpio, "mejora_cierre": mejora,
                "madrugador": temprano, "nocturno": tarde,
            ]
            for i in estados.indices {
                estados[i].progreso = valores[estados[i].def.id] ?? 0
                if !estados[i].listo && estados[i].progreso >= estados[i].def.objetivo {
                    estados[i].fecha = n.fecha
                    estados[i].nota = n.url.path
                }
            }
        }
        return estados
    }

    /// XP total hasta una fecha: puntajes de cada reunión + bono por logro.
    static func xpTotal(_ notas: [Nota], hasta: Date) -> Int {
        let reuniones = notas.filter { $0.fecha <= hasta }.compactMap(puntajes).reduce(0) { $0 + xp($1) }
        let bono = calcularLogros(notas, hasta: hasta).filter(\.listo).count * xpPorLogro
        return reuniones + bono
    }
}

