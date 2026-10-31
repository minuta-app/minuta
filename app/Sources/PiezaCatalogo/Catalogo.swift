// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
import CryptoKit
import Foundation

/// Pieza «catálogo» (Mac). Equivale a escritorio/src/catalogo.js. Baja el índice y los archivos de un catálogo de la comunidad
/// SOLO desde `https://raw.githubusercontent.com/<repo>/<rama>/`, sin seguir redirecciones, con tamaño máximo. El índice lo valida
/// bin/catalogo.py (con el validador que pone la app); cada archivo se busca solo en ese índice validado (nunca en lo que manda
/// la interfaz) y se compara su tamaño y su SHA-256 antes de que Python lo vuelva a validar y lo guarde en la carpeta de datos.
///
/// Va en su propio target de SwiftPM (`PiezaCatalogo`): nada de la app adentro. Repo y tipos salen de app.json (sección
/// «catalogo»); correr un script lo hace la app (su `Procesador.conEntrada`), que se pasa como `correr`.
///
///     Catalogo.configurar(appJSON: Rutas.recursos.appendingPathComponent("app.json"), agente: "Ana/\(version)") { s, a, d, fin in
///         Procesador.conEntrada(s, a, d, fin: fin) }
///     // case "catalogo":            Catalogo.listar(tipo) { self.llamar("catalogoListo", $0) }
///     // case "descargarDelCatalogo": Catalogo.descargar(tipo, id) { self.llamar("catalogoDescargado", $0) }
@MainActor
public enum Catalogo {
    public typealias Correr = @MainActor (_ script: String, _ accion: String, _ datos: [String: Any],
                                          _ fin: @escaping @MainActor ([String: Any]) -> Void) -> Void

    /// Frases en español (claves de traducción): la interfaz las muestra con Tp(plantilla). Las mismas de bin/catalogo.py.
    public static let errores: [String: String] = [
        "sin_conexion": "No pude conectarme. Revisa tu conexión.",
        "indice": "No pude leer el catálogo.",
        "no_valido": "Eso no es válido.",
        "danado": "Llegó dañado. Intenta de nuevo.",
        "no_esta": "Ya no está en el catálogo. Vuelve a abrirlo.",
    ]
    public static let host = "raw.githubusercontent.com"

    struct Tipo {
        let id: String, indice: String, maxBytes: Int, maxIndice: Int, patron: String
    }
    private static var base = ""
    private static var prefijo = ""
    private static var tipos: [String: Tipo] = [:]
    private static var agente = "Pieza"
    private static var correr: Correr?
    /// Lo último que validó Python por tipo: de aquí salen la ruta, el tamaño y la huella de cada descarga.
    private static var indices: [String: [[String: Any]]] = [:]

    private static func calza(_ s: String, _ patron: String) -> Bool { s.range(of: patron, options: .regularExpression) != nil }

    private static func entero(_ v: Any?, _ defecto: Int, _ tope: Int) -> Int {
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.intValue > 0, n.intValue <= tope,
              Double(n.intValue) == n.doubleValue else { return defecto }
        return n.intValue
    }

    /// Lee la sección «catalogo» de app.json (las mismas reglas que bin/catalogo.py). Devuelve false si no sirve.
    @discardableResult
    public static func configurar(appJSON: URL, agente: String, correr: @escaping Correr) -> Bool {
        guard let d = try? Data(contentsOf: appJSON), d.count < 1_000_000,
              let app = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let c = app["catalogo"] as? [String: Any], let repo = c["repo"] as? String,
              calza(repo, #"^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$"#) else { return false }
        let rama = c["rama"] as? String ?? "main"
        guard calza(rama, #"^[A-Za-z0-9._-]{1,60}$"#), !rama.contains("..") else { return false }
        var t: [String: Tipo] = [:]
        for (id, x) in c["tipos"] as? [String: Any] ?? [:] {
            guard calza(id, #"^[a-z][a-z0-9-]{0,30}$"#), let x = x as? [String: Any] else { return false }
            let indice = x["indice"] as? String ?? "\(id)/index.json"
            guard calza(indice, #"^(?:[a-z0-9-]+/)?[a-z0-9-]+\.json$"#) else { return false }
            let ident = "[a-z0-9]+(-[a-z0-9]+)*"
            t[id] = Tipo(id: id, indice: indice, maxBytes: entero(x["max_bytes"], 100 * 1024, 5 * 1024 * 1024),
                         maxIndice: entero(x["max_indice"], 1024 * 1024, 20 * 1024 * 1024),
                         patron: "^\(id)/\(ident)/\(ident)\\.json$")
        }
        base = "https://\(host)/\(repo)/\(rama)/"
        prefijo = "/\(repo)/\(rama)/"
        tipos = t
        self.agente = agente
        self.correr = correr
        return true
    }

    private static func error(_ codigo: String, _ extra: [String: Any] = [:]) -> [String: Any] {
        let texto = errores[codigo] ?? errores["no_valido"]!
        return ["ok": false, "codigo": codigo, "plantilla": texto, "error": texto].merging(extra) { a, _ in a }
    }

    /// Lo que llega de `pedir`: los datos, «grande» (pasó del máximo: no es lo del índice) o nada (sin conexión).
    enum Respuesta { case datos(Data), grande, nada }

    /// Pide `ruta` (relativa a la base): solo una respuesta 200 del mismo dominio, sin redirecciones y sin pasar del máximo.
    private static func pedir(_ ruta: String, maximo: Int, _ fin: @escaping @MainActor (Respuesta) -> Void) {
        guard !base.isEmpty, let u = URL(string: base + ruta), u.scheme == "https", u.host == host, u.port == nil,
              u.path.hasPrefix(prefijo), u.query == nil, u.fragment == nil else { fin(.nada); return }
        var pedido = URLRequest(url: u, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        pedido.setValue(agente, forHTTPHeaderField: "User-Agent")
        pedido.httpShouldHandleCookies = false
        let dominio = host
        let sesion = URLSession(configuration: .ephemeral, delegate: SinRedirecciones(), delegateQueue: nil)
        sesion.dataTask(with: pedido) { datos, respuesta, _ in
            let r = respuesta as? HTTPURLResponse
            let res: Respuesta
            if r?.statusCode == 200, r?.url?.host == dominio, let datos {
                res = datos.count <= maximo ? .datos(datos) : .grande
            } else {
                res = .nada
            }
            sesion.finishTasksAndInvalidate()
            Task { @MainActor in fin(res) }
        }.resume()
    }

    private static func temporal(_ datos: Data) -> URL? {
        let u = FileManager.default.temporaryDirectory.appendingPathComponent("pieza-catalogo-\(UUID().uuidString).json")
        guard FileManager.default.createFile(atPath: u.path, contents: datos, attributes: [.posixPermissions: 0o600]) else { return nil }
        return u
    }

    /// El índice de un tipo, validado por Python: {ok, tipo, <tipo>: [...]} o {ok: false, codigo, plantilla, error}.
    public static func listar(_ tipo: String, _ fin: @escaping @MainActor ([String: Any]) -> Void) {
        guard let t = tipos[tipo], let correr else { return fin(error("no_valido", ["tipo": tipo])) }
        pedir(t.indice, maximo: t.maxIndice) { res in
            guard case .datos(let datos) = res else { return fin(error(res.esGrande ? "indice" : "sin_conexion", ["tipo": tipo])) }
            guard let archivo = temporal(datos) else { return fin(error("indice", ["tipo": tipo])) }
            correr("catalogo.py", "indice", ["tipo": tipo, "archivo": archivo.path]) { r in
                try? FileManager.default.removeItem(at: archivo)
                guard r["ok"] as? Bool == true, let lista = r[tipo] as? [[String: Any]] else { return fin(error("indice", ["tipo": tipo])) }
                indices[tipo] = lista
                fin(r)
            }
        }
    }

    /// Descarga uno del índice validado, revisa tamaño y huella, y Python lo valida y lo guarda.
    public static func descargar(_ tipo: String, _ id: String, _ fin: @escaping @MainActor ([String: Any]) -> Void) {
        let malo = { (c: String) in fin(error(c, ["tipo": tipo, "id": id])) }
        guard let t = tipos[tipo], let correr else { return malo("no_valido") }
        guard let e = (indices[tipo] ?? []).first(where: { $0["id"] as? String == id }) else { return malo("no_esta") }
        guard let ruta = e["ruta"] as? String, calza(ruta, t.patron), let huella = e["sha256"] as? String,
              calza(huella, "^[0-9a-f]{64}$"), let tamano = (e["tamano"] as? NSNumber)?.intValue, tamano > 0,
              tamano <= t.maxBytes else { return malo("no_valido") }
        pedir(ruta, maximo: tamano) { res in
            guard case .datos(let datos) = res else { return malo(res.esGrande ? "danado" : "sin_conexion") }
            let calculada = SHA256.hash(data: datos).map { String(format: "%02x", $0) }.joined()
            guard datos.count == tamano, calculada == huella else { return malo("danado") }
            guard let archivo = temporal(datos) else { return malo("danado") }
            correr("catalogo.py", "instalar", ["tipo": tipo, "archivo": archivo.path, "id": id, "sha256": huella]) { r in
                try? FileManager.default.removeItem(at: archivo)
                if r["ok"] as? Bool == true { return fin(r) }
                let c = r["codigo"] as? String
                malo(c.flatMap { errores[$0] != nil ? $0 : nil } ?? "no_valido")
            }
        }
    }
}

extension Catalogo.Respuesta {
    var esGrande: Bool { if case .grande = self { return true } else { return false } }
}

/// Nunca sigue una redirección: una respuesta 3xx queda como está (y no es 200, así que se descarta).
final class SinRedirecciones: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest) async -> URLRequest? {
        nil
    }
}
