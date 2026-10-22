import Foundation

/// Tipo de reunión configurable. El `id` es lo que se guarda en cada nota (frontmatter `tipo`), así que
/// renombrar una categoría no rompe las notas antiguas.
struct Categoria: Codable, Identifiable, Equatable {
    var id: String
    var nombre: String
    var emoji: String
    var color: String
    /// Descripción corta para la interfaz ("ventas y demos").
    var descripcion: String
    /// Qué debe evaluar Claude en el feedback de este tipo de reunión.
    var enfoque: String
    /// Reglas para elegirla sola: dominios de correo de los invitados, palabras en el título y apps.
    var dominios: [String]
    var palabras: [String]
    var apps: [String]
}

enum Categorias {
    static var archivo: URL { Temas.base.appendingPathComponent("categorias.json") }

    static let porDefecto: [Categoria] = [
        Categoria(id: "Personal", nombre: "Personal", emoji: "🏡", color: "#a855f7", descripcion: "conversaciones personales",
                  enfoque: "Es una reunión o conversación personal. Da feedback de comunicación general, breve y amable.",
                  dominios: [], palabras: [], apps: []),
        Categoria(id: "Otra", nombre: "Otra", emoji: "💬", color: "#94a3b8", descripcion: "feedback general",
                  enfoque: "Evalúa la comunicación en general: claridad, escucha, preguntas y cierre.",
                  dominios: [], palabras: [], apps: []),
    ]

    static func cargar() -> [Categoria] {
        if let data = try? Data(contentsOf: archivo), let lista = try? JSONDecoder().decode([Categoria].self, from: data), !lista.isEmpty {
            return lista
        }
        guardar(porDefecto)
        return porDefecto
    }

    static func guardar(_ lista: [Categoria]) {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        if let data = try? enc.encode(lista) { try? data.write(to: archivo, options: .atomic) }
    }

    /// Lista para la interfaz web.
    static func paraJS(_ lista: [Categoria]) -> Any {
        (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(lista))) ?? []
    }

    static func desdeJS(_ valor: Any?) -> [Categoria]? {
        guard let valor, let data = try? JSONSerialization.data(withJSONObject: valor),
              let lista = try? JSONDecoder().decode([Categoria].self, from: data), !lista.isEmpty else { return nil }
        return lista
    }

    /// Elige la categoría que mejor calza: dominio de correo (3 pts) > palabra en el título (2) > app (1).
    static func elegir(_ lista: [Categoria], titulo: String, correos: [String], app: String?) -> String? {
        let t = titulo.lowercased()
        let dominios = correos.compactMap { $0.split(separator: "@").last.map { $0.lowercased() } }
        var mejor: (id: String, puntos: Int)?
        for c in lista {
            var p = 0
            if c.dominios.contains(where: { d in let d = d.lowercased(); return !d.isEmpty && dominios.contains { $0 == d || $0.hasSuffix("." + d) } }) { p += 3 }
            if c.palabras.contains(where: { !$0.isEmpty && t.contains($0.lowercased()) }) { p += 2 }
            if let app, c.apps.contains(where: { !$0.isEmpty && app.localizedCaseInsensitiveContains($0) }) { p += 1 }
            if p > 0, p > (mejor?.puntos ?? 0) { mejor = (c.id, p) }
        }
        return mejor?.id
    }
}
