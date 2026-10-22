import Foundation

/// Perfil del usuario (~/minuta/perfil.json): nombre, rol, idioma y dónde se guardan las notas.
/// Todo lo personal vive aquí, no en el código. Lo comparten la app, los scripts de Python y la interfaz.
enum Perfil {
    static var archivo: URL { Temas.base.appendingPathComponent("perfil.json") }

    static let porDefecto: [String: String] = [
        "nombre": "", "nombre_completo": "", "descripcion": "", "pais": "", "gentilicio": "",
        "idioma": "español", "carpeta_notas": "~/Documents/Minuta/Reuniones",
        "idioma_audio": "auto", "idioma_ui": "es",
        "ia": "claude", "modelo_whisper": "", "respaldo": "", "respaldo_remoto": "",
    ]

    /// Guarda el perfil completo (solo claves conocidas).
    static func guardar(_ p: [String: String]) {
        let limpio = p.filter { porDefecto.keys.contains($0.key) }
        if let d = try? JSONSerialization.data(withJSONObject: limpio, options: [.prettyPrinted, .sortedKeys]) {
            try? FileManager.default.createDirectory(at: archivo.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? d.write(to: archivo, options: .atomic)
        }
    }

    /// Primera vez: no hay perfil todavía → se muestra el asistente de bienvenida.
    static var falta: Bool { !FileManager.default.fileExists(atPath: archivo.path) }

    /// Ruta para guardar en el perfil, con ~ en vez de la carpeta personal (así el perfil no lleva el nombre de usuario del Mac).
    static func rutaCorta(_ url: URL) -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return url.path.hasPrefix(home) ? "~" + url.path.dropFirst(home.count) : url.path
    }

    static func datos() -> [String: String] {
        var d = porDefecto
        if let data = try? Data(contentsOf: archivo), let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            for (k, v) in o { if let s = v as? String { d[k] = s } }
        }
        return d
    }

    /// Carpeta de las notas (.md). Se crea si no existe.
    static var carpetaNotas: URL {
        let ruta = (datos()["carpeta_notas"] ?? "").trimmingCharacters(in: .whitespaces)
        let url = URL(fileURLWithPath: NSString(string: ruta.isEmpty ? porDefecto["carpeta_notas"]! : ruta).expandingTildeInPath)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    static var nombre: String { datos()["nombre"]?.trimmingCharacters(in: .whitespaces) ?? "" }

    static var paraJS: [String: Any] { datos() }
}
