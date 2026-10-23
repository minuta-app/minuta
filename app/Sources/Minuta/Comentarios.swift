import Foundation

/// Comentarios y votos desde la app, sin servidor propio.
/// Si la persona conectó su GitHub para el respaldo, se publican con SU cuenta (el token ya está en su Llavero);
/// si no, la app abre GitHub en el navegador con el mensaje listo, como siempre.
@MainActor
enum Comentarios {
    /// Únicos repositorios donde la app publica: el de la app y el catálogo.
    static let repos = ["app": "minuta-app/minuta", "catalogo": Catalogo.repo]
    private static var usuario: String?

    private static func pedido(_ ruta: String, metodo: String = "GET", cuerpo: [String: Any]? = nil) -> URLRequest? {
        guard let token = Respaldo.token("github"), let url = URL(string: "https://api.github.com/" + ruta) else { return nil }
        var p = URLRequest(url: url, timeoutInterval: 20)
        p.httpMethod = metodo
        p.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        p.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        p.setValue("Minuta", forHTTPHeaderField: "User-Agent")
        if let cuerpo { p.httpBody = try? JSONSerialization.data(withJSONObject: cuerpo); p.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        return p
    }

    private static func llamar(_ p: URLRequest, _ fin: @escaping @MainActor (Int, [String: Any]) -> Void) {
        URLSession.shared.dataTask(with: p) { datos, respuesta, _ in
            let codigo = (respuesta as? HTTPURLResponse)?.statusCode ?? 0
            let json = (datos.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
            Task { @MainActor in fin(codigo, json) }
        }.resume()
    }

    /// Usuario de GitHub con el que se publicaría (nil si no hay cuenta conectada o el token ya no sirve).
    static func cuenta(_ fin: @escaping @MainActor (String?) -> Void) {
        if let usuario { fin(usuario); return }
        guard let p = pedido("user") else { fin(nil); return }
        llamar(p) { codigo, json in
            usuario = codigo == 200 ? json["login"] as? String : nil
            fin(usuario)
        }
    }

    /// Publica un issue con la cuenta de la persona. Devuelve la dirección del issue o el error.
    static func publicar(repo: String, titulo: String, cuerpo: String, etiqueta: String, _ fin: @escaping @MainActor (Bool, String) -> Void) {
        guard let r = repos[repo], let p = pedido("repos/\(r)/issues", metodo: "POST", cuerpo: ["title": titulo, "body": cuerpo, "labels": [etiqueta]]) else {
            fin(false, "Sin cuenta de GitHub conectada."); return
        }
        llamar(p) { codigo, json in
            if codigo == 201, let url = json["html_url"] as? String { fin(true, url) }
            else { fin(false, (json["message"] as? String) ?? "GitHub respondió \(codigo)") }
        }
    }

    /// Vota un universo con una reacción 👍/👎 en su issue de votos. `nuevo` es falso si ya había votado igual.
    static func votar(numero: Int, positivo: Bool, _ fin: @escaping @MainActor (Bool, Bool) -> Void) {
        guard let p = pedido("repos/\(Catalogo.repo)/issues/\(numero)/reactions", metodo: "POST", cuerpo: ["content": positivo ? "+1" : "-1"]) else { fin(false, false); return }
        llamar(p) { codigo, _ in fin(codigo == 200 || codigo == 201, codigo == 201) }
    }
}
