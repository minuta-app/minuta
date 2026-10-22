import Foundation

/// Catálogo público de Minuta (repo `minuta-catalogo` en GitHub): universos e idiomas que se descargan a pedido.
/// No hay servidor propio: son archivos JSON servidos por GitHub. Todo lo descargado es solo datos y se valida antes de usarse.
@MainActor
enum Catalogo {
    nonisolated static let repo = "soydavidcornejo/minuta-catalogo"
    nonisolated static var raiz: URL { URL(string: "https://raw.githubusercontent.com/\(repo)/main/")! }
    /// Comentarios de los usuarios: se abren como issue en el repo público (no hay servidor ni base de datos).
    nonisolated static var urlComentarios: String { "https://github.com/\(repo)/issues/new" }

    nonisolated static var cache: URL { Temas.base.appendingPathComponent("catalogo") }
    nonisolated static var idiomas: URL { Temas.base.appendingPathComponent("idiomas") }

    private static func bajar(_ ruta: String, _ fin: @escaping @MainActor (Data?, String?) -> Void) {
        var pedido = URLRequest(url: raiz.appendingPathComponent(ruta), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        pedido.setValue("Minuta", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: pedido) { datos, respuesta, error in
            let codigo = (respuesta as? HTTPURLResponse)?.statusCode ?? 0
            Task { @MainActor in
                if let datos, codigo == 200 { fin(datos, nil) } else { fin(nil, error?.localizedDescription ?? "Respuesta \(codigo)") }
            }
        }.resume()
    }

    /// Índice (universos o idiomas). Si no hay internet, devuelve la última copia guardada.
    static func indice(_ tipo: String, _ fin: @escaping @MainActor ([[String: Any]], String?) -> Void) {
        let copia = cache.appendingPathComponent("\(tipo).json")
        bajar("\(tipo)/index.json") { datos, error in
            if let datos, let lista = try? JSONSerialization.jsonObject(with: datos) as? [[String: Any]] {
                try? FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
                try? datos.write(to: copia, options: .atomic)
                fin(lista, nil)
            } else {
                let guardada = (try? Data(contentsOf: copia)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [[String: Any]] } ?? []
                fin(guardada, error)
            }
        }
    }

    /// Descarga un universo y lo deja en ~/minuta/temas solo si pasa la validación.
    static func descargarUniverso(_ id: String, _ fin: @escaping @MainActor (Bool, String?) -> Void) {
        guard id.range(of: "^[a-z0-9]{2,40}$", options: .regularExpression) != nil else { fin(false, "id inválido"); return }
        bajar("universos/\(id).json") { datos, error in
            guard let datos else { fin(false, error); return }
            guard var o = try? JSONSerialization.jsonObject(with: datos) as? [String: Any], o["id"] as? String == id,
                  let t = try? JSONDecoder().decode(TemaJuego.self, from: datos),
                  t.rangos.count == 10, Juego.apartados.allSatisfy({ (t.apartados[$0.clave]?.count ?? 0) == 10 }) else {
                fin(false, "El universo no tiene el formato esperado.")
                return
            }
            o["descargado"] = true
            try? FileManager.default.createDirectory(at: Temas.carpeta, withIntermediateDirectories: true)
            guard let limpio = try? JSONSerialization.data(withJSONObject: o, options: [.prettyPrinted]),
                  (try? limpio.write(to: Temas.carpeta.appendingPathComponent("\(id).json"), options: .atomic)) != nil else {
                fin(false, "No pude guardarlo.")
                return
            }
            fin(true, nil)
        }
    }

    /// Descarga un paquete de idioma (solo textos) a ~/minuta/idiomas.
    static func descargarIdioma(_ codigo: String, _ fin: @escaping @MainActor (Bool, String?) -> Void) {
        guard codigo.range(of: "^[a-z]{2}(-[A-Z]{2})?$", options: .regularExpression) != nil else { fin(false, "código inválido"); return }
        bajar("idiomas/\(codigo).json") { datos, error in
            guard let datos else { fin(false, error); return }
            guard let o = try? JSONSerialization.jsonObject(with: datos) as? [String: Any], o["codigo"] as? String == codigo,
                  let textos = o["textos"] as? [String: String], !textos.isEmpty else {
                fin(false, "El idioma no tiene el formato esperado.")
                return
            }
            try? FileManager.default.createDirectory(at: idiomas, withIntermediateDirectories: true)
            let ok = (try? datos.write(to: idiomas.appendingPathComponent("\(codigo).json"), options: .atomic)) != nil
            fin(ok, ok ? nil : "No pude guardarlo.")
        }
    }
}

/// Idioma de la interfaz. El español es el idioma base del código; el inglés viene incluido (ui/idiomas/en.json)
/// y los demás se descargan del catálogo a ~/minuta/idiomas/.
enum Idioma {
    static var codigo: String { (Perfil.datos()["idioma_ui"] ?? "es").trimmingCharacters(in: .whitespaces).isEmpty ? "es" : Perfil.datos()["idioma_ui"]! }

    static func paquete(_ c: String) -> [String: Any]? {
        for dir in [Catalogo.idiomas, Temas.recursos.appendingPathComponent("ui/idiomas")] {
            if let d = try? Data(contentsOf: dir.appendingPathComponent("\(c).json")),
               let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { return o }
        }
        return nil
    }

    /// Idiomas disponibles sin descargar nada más.
    static func instalados() -> [[String: Any]] {
        var lista: [[String: Any]] = [["codigo": "es", "nombre": "Español", "bandera": "🇪🇸", "incluido": true]]
        var vistos: Set<String> = ["es"]
        for (dir, incluido) in [(Temas.recursos.appendingPathComponent("ui/idiomas"), true), (Catalogo.idiomas, false)] {
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
        return ["codigo": c, "textos": p?["textos"] ?? [:], "palabras": p?["palabras"] ?? NSNull(), "instalados": instalados()]
    }
}
