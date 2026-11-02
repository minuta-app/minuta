import Foundation

/// Catálogo público de Minuta (repo `minuta-catalogo` en GitHub): universos (tipo `temas`) e idiomas que se descargan a pedido.
/// Bajarlos, revisar su huella SHA-256 y guardarlos es de la pieza «catálogo» (`PiezaCatalogo`, `bin/catalogo.py`; repo y tipos
/// en `app.json` → `catalogo`). Aquí queda lo propio de Minuta: el repo para comentarios y votos, y dónde quedan los idiomas.
enum CatalogoPublico {
    nonisolated static let repo = "minuta-app/minuta-catalogo"
    /// Idiomas descargados (la pieza los guarda en <datos>/idiomas, y los datos de Minuta son ~/minuta).
    nonisolated static var idiomas: URL { Temas.base.appendingPathComponent("idiomas") }
    /// Los tipos de la pieza: la interfaz pide «universos» o «idiomas»; los universos se guardan en ~/minuta/temas.
    static func tipo(_ pedido: String?) -> String { pedido == "idiomas" ? "idiomas" : "temas" }
}

/// Idioma de la interfaz. El español es el idioma base del código; el inglés viene incluido (ui/idiomas/en.json)
/// y los demás se descargan del catálogo a ~/minuta/idiomas/.
enum Idioma {
    static var codigo: String { (Perfil.datos()["idioma_ui"] ?? "es").trimmingCharacters(in: .whitespaces).isEmpty ? "es" : Perfil.datos()["idioma_ui"]! }

    static func paquete(_ c: String) -> [String: Any]? {
        for dir in [CatalogoPublico.idiomas, Temas.recursos.appendingPathComponent("ui/idiomas")] {
            if let d = try? Data(contentsOf: dir.appendingPathComponent("\(c).json")),
               let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { return o }
        }
        return nil
    }

    /// Idiomas disponibles sin descargar nada más.
    static func instalados() -> [[String: Any]] {
        var lista: [[String: Any]] = [["codigo": "es", "nombre": "Español", "bandera": "🇪🇸", "incluido": true]]
        var vistos: Set<String> = ["es"]
        for (dir, incluido) in [(Temas.recursos.appendingPathComponent("ui/idiomas"), true), (CatalogoPublico.idiomas, false)] {
            for url in (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [] where url.pathExtension == "json" {
                guard let o = (try? Data(contentsOf: url)).flatMap({ try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }),
                      let c = o["codigo"] as? String, !vistos.contains(c) else { continue }
                vistos.insert(c)
                lista.append(["codigo": c, "nombre": o["nombre"] ?? c, "bandera": o["bandera"] ?? "", "incluido": incluido])
            }
        }
        return lista
    }

    private static var cacheTextos: (String, [String: String])?
    /// Traduce un texto de la app nativa (avisos, menús). Clave = texto en español.
    static func t(_ es: String) -> String {
        let c = codigo
        guard c != "es" else { return es }
        if cacheTextos?.0 != c { cacheTextos = (c, paquete(c)?["textos"] as? [String: String] ?? [:]) }
        return cacheTextos?.1[es] ?? es
    }
    static func olvidar() { cacheTextos = nil }

    /// Plantilla con huecos {x}: se traduce la plantilla y luego se rellenan los valores en orden.
    /// Ej.: Idioma.f("Con tu reunión «{x}».", nombre)
    static func f(_ plantilla: String, _ valores: String...) -> String {
        var r = t(plantilla)
        for v in valores {
            guard let rango = r.range(of: "{x}") ?? r.range(of: "{n}") else { break }
            r.replaceSubrange(rango, with: v)
        }
        return r
    }

    static var paraJS: [String: Any] {
        let c = codigo
        let p = c == "es" ? nil : paquete(c)
        // "sistema": idioma del Mac, para sugerirlo en la pantalla de idioma de la bienvenida.
        return ["codigo": c, "textos": p?["textos"] ?? [:], "palabras": p?["palabras"] ?? NSNull(), "instalados": instalados(),
                "sistema": Locale.preferredLanguages.first ?? ""]
    }
}
