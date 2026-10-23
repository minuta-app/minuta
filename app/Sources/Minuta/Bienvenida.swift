import AppKit
import Foundation
import Security

// MARK: - Modelos de transcripción (se descargan en la bienvenida, verificados por SHA-256)

struct ModeloWhisper {
    let id: String, nombre: String, archivo: String, bytes: Int64, sha256: String, detalle: String
}

@MainActor
enum Modelos {
    static var carpeta: URL { Temas.base.appendingPathComponent("models") }
    private static let hf = "https://huggingface.co/"

    static let transcripcion: [ModeloWhisper] = [
        .init(id: "turbo", nombre: "Preciso", archivo: "ggml-large-v3-turbo-q5_0.bin", bytes: 574_041_195,
              sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2", detalle: "El mejor para reuniones; recomendado con 8 GB de RAM o más."),
        .init(id: "small", nombre: "Liviano", archivo: "ggml-small-q5_1.bin", bytes: 190_085_487,
              sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb", detalle: "Más rápido y pequeño; para Macs con poca memoria."),
    ]
    static let vad = ModeloWhisper(id: "vad", nombre: "Detector de voz", archivo: "ggml-silero-v5.1.2.bin", bytes: 885_098,
                                   sha256: "29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf", detalle: "")

    static func url(_ m: ModeloWhisper) -> URL {
        URL(string: hf + (m.id == "vad" ? "ggml-org/whisper-vad" : "ggerganov/whisper.cpp") + "/resolve/main/" + m.archivo)!
    }
    static func existe(_ m: ModeloWhisper) -> Bool {
        let a = (try? FileManager.default.attributesOfItem(atPath: carpeta.appendingPathComponent(m.archivo).path))?[.size] as? Int64
        return a == m.bytes
    }
    static var recomendado: String { ProcessInfo.processInfo.physicalMemory >= 8 << 30 ? "turbo" : "small" }

    static var paraJS: [String: Any] {
        ["recomendado": recomendado, "ram": Int(ProcessInfo.processInfo.physicalMemory >> 30), "elegido": Perfil.datos()["modelo_whisper"] ?? "",
         "lista": transcripcion.map { ["id": $0.id, "nombre": $0.nombre, "mb": Int($0.bytes / 1_000_000), "detalle": $0.detalle, "listo": existe($0)] },
         "vadListo": existe(vad)]
    }

    private static var descargando: DescargaModelo?

    /// Descarga el modelo elegido (y el detector de voz si falta), informando el avance. Verifica la huella antes de dejarlo.
    static func descargar(_ id: String, progreso: @escaping @MainActor (Double) -> Void, fin: @escaping @MainActor (Bool, String?) -> Void) {
        guard let m = transcripcion.first(where: { $0.id == id }) else { fin(false, "modelo desconocido"); return }
        let pendientes = [m, vad].filter { !existe($0) }
        guard !pendientes.isEmpty else { fin(true, nil); return }
        let total = pendientes.reduce(Int64(0)) { $0 + $1.bytes }
        var hechos: Int64 = 0
        func siguiente(_ i: Int) {
            guard i < pendientes.count else { descargando = nil; fin(true, nil); return }
            let mod = pendientes[i]
            let d = DescargaModelo(desde: url(mod), sha256: mod.sha256, destino: carpeta.appendingPathComponent(mod.archivo),
                                   progreso: { bytes in progreso(Double(hechos + bytes) / Double(total)) },
                                   fin: { ok, error in
                                       if ok { hechos += mod.bytes; siguiente(i + 1) } else { descargando = nil; fin(false, error) }
                                   })
            descargando = d
            d.empezar()
        }
        try? FileManager.default.createDirectory(at: carpeta, withIntermediateDirectories: true)
        siguiente(0)
    }
}

/// Descarga con avance a un archivo temporal; solo lo mueve a su lugar si la huella SHA-256 coincide.
final class DescargaModelo: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    let desde: URL, sha256: String, destino: URL
    let progreso: @MainActor (Int64) -> Void, fin: @MainActor (Bool, String?) -> Void
    private var sesion: URLSession?

    init(desde: URL, sha256: String, destino: URL, progreso: @escaping @MainActor (Int64) -> Void, fin: @escaping @MainActor (Bool, String?) -> Void) {
        self.desde = desde; self.sha256 = sha256; self.destino = destino; self.progreso = progreso; self.fin = fin
    }

    func empezar() {
        sesion = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        sesion?.downloadTask(with: desde).resume()
    }

    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didWriteData _: Int64, totalBytesWritten t: Int64, totalBytesExpectedToWrite _: Int64) {
        Task { @MainActor in self.progreso(t) }
    }

    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo ubicacion: URL) {
        let temporal = destino.appendingPathExtension("descarga")
        try? FileManager.default.removeItem(at: temporal)
        do { try FileManager.default.moveItem(at: ubicacion, to: temporal) } catch {
            Task { @MainActor in self.fin(false, "No pude guardar la descarga.") }; return
        }
        // Huella con la herramienta del sistema (no carga 500 MB en memoria).
        let p = Process(), salida = Pipe()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/shasum")
        p.arguments = ["-a", "256", temporal.path]
        p.standardOutput = salida
        try? p.run(); p.waitUntilExit()
        let huella = String(data: salida.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.split(separator: " ").first.map(String.init) ?? ""
        guard huella == sha256 else {
            try? FileManager.default.removeItem(at: temporal)
            Task { @MainActor in self.fin(false, "La descarga llegó dañada. Intenta de nuevo.") }; return
        }
        try? FileManager.default.removeItem(at: destino)
        let ok = (try? FileManager.default.moveItem(at: temporal, to: destino)) != nil
        Task { @MainActor in self.fin(ok, ok ? nil : "No pude guardar el modelo.") }
        s.finishTasksAndInvalidate()
    }

    func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        Task { @MainActor in self.fin(false, error.localizedDescription) }
        s.finishTasksAndInvalidate()
    }
}

// MARK: - IA del usuario (su propia cuenta: se detecta, no se configura a mano)

@MainActor
enum IA {
    /// Gemini: primero Antigravity CLI (`agy`, el reemplazo de Google para cuentas personales) y si no, el Gemini CLI antiguo.
    static let conocidas: [(id: String, nombre: String, comandos: [String], soportada: Bool, guia: String)] = [
        ("claude", "Claude", ["claude"], true, "https://minuta-app.github.io/minuta/ia.html#claude"),
        ("codex", "ChatGPT (Codex)", ["codex"], true, "https://minuta-app.github.io/minuta/ia.html#codex"),
        ("gemini", "Gemini", ["agy", "gemini"], true, "https://minuta-app.github.io/minuta/ia.html#gemini"),
    ]

    /// Rutas típicas donde quedan estas herramientas (la app no hereda el PATH de la Terminal).
    static func buscar(_ comandos: [String]) -> String? {
        for c in comandos { if let r = dirs().map({ "\($0)/\(c)" }).first(where: { FileManager.default.isExecutableFile(atPath: $0) }) { return r } }
        return nil
    }

    /// Carpetas donde suelen quedar los CLI de IA (instalador propio, Homebrew, npm, nvm, volta, bun).
    static func dirs() -> [String] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        var d = ["/opt/homebrew/bin", "/usr/local/bin", "\(home)/.local/bin", "\(home)/.claude/local", "\(home)/.codex/bin", "\(home)/.npm-global/bin",
                 "\(home)/.volta/bin", "\(home)/.bun/bin", "/usr/bin"]
        let nvm = "\(home)/.nvm/versions/node"
        let versiones = ((try? FileManager.default.contentsOfDirectory(atPath: nvm)) ?? []).sorted { $0.compare($1, options: .numeric) == .orderedDescending }
        d += versiones.map { "\(nvm)/\($0)/bin" }
        return d
    }

    /// Cómo se le pide una respuesta de texto a cada IA, sin que toque archivos (mismo criterio que bin/perfil.py).
    static func argumentos(_ id: String, ruta: String = "") -> [String] {
        switch id {
        case "codex": return ["exec", "--skip-git-repo-check", "-s", "read-only", "-"]
        case "gemini" where (ruta as NSString).lastPathComponent == "agy":
            return ["--output-format", "text", "--sandbox", "-p", "Responde solo con la palabra: listo"]
        case "gemini": return ["-p", "Responde a las instrucciones de arriba.", "-o", "text"]
        default: return ["-p", "--output-format", "text"]
        }
    }

    static var paraJS: [[String: Any]] {
        conocidas.map { ["id": $0.id, "nombre": $0.nombre, "ruta": buscar($0.comandos) ?? NSNull(), "soportada": $0.soportada, "guia": $0.guia] }
    }

    /// Prueba real: le pide a la IA una palabra. Así sabemos que está instalada y con la sesión iniciada.
    static func probar(_ id: String, _ fin: @escaping @MainActor (Bool, String) -> Void) {
        guard let ia = conocidas.first(where: { $0.id == id }), let ruta = buscar(ia.comandos) else { fin(false, "No está instalada."); return }
        let p = Process(), salida = Pipe(), error = Pipe(), entrada = Pipe()
        p.executableURL = URL(fileURLWithPath: ruta)
        p.arguments = argumentos(id, ruta: ruta)
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = (dirs() + ["/bin"]).joined(separator: ":")
        p.environment = env
        p.currentDirectoryURL = FileManager.default.temporaryDirectory
        p.standardInput = entrada; p.standardOutput = salida; p.standardError = error
        p.terminationHandler = { pr in
            let texto = String(data: salida.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            let err = String(data: error.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            Task { @MainActor in
                fin(pr.terminationStatus == 0 && !texto.isEmpty, pr.terminationStatus == 0 ? texto.trimmingCharacters(in: .whitespacesAndNewlines) : String(err.prefix(300)))
            }
        }
        do { try p.run() } catch { fin(false, error.localizedDescription); return }
        entrada.fileHandleForWriting.write("Responde solo con la palabra: listo".data(using: .utf8)!)
        try? entrada.fileHandleForWriting.close()
        DispatchQueue.main.asyncAfter(deadline: .now() + 90) { if p.isRunning { p.terminate() } }
    }
}

// MARK: - Notas: carpeta, importar desde git y respaldo en la cuenta del usuario

@MainActor
enum Respaldo {
    private static let servicio = "Minuta · respaldo de notas"

    static func guardarToken(_ token: String, cuenta: String) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: servicio, kSecAttrAccount as String: cuenta]
        SecItemDelete(base as CFDictionary)
        var nuevo = base
        nuevo[kSecValueData as String] = Data(token.utf8)
        SecItemAdd(nuevo as CFDictionary, nil)
    }

    static func token(_ cuenta: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: servicio,
                                kSecAttrAccount as String: cuenta, kSecReturnData as String: true]
        var r: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &r) == errSecSuccess, let d = r as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    /// Cuántas notas .md hay en una carpeta (para mostrarlo al elegirla).
    static func contarNotas(_ url: URL) -> Int {
        ((try? FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: nil)) ?? []).filter { $0.pathExtension == "md" }.count
    }

    static func elegirCarpeta(_ fin: @escaping @MainActor (URL?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.canCreateDirectories = true
        panel.prompt = Idioma.t("Usar esta carpeta")
        panel.message = Idioma.t("Elige la carpeta donde están (o donde quieres guardar) tus notas")
        NSApp.activate()
        panel.begin { r in Task { @MainActor in fin(r == .OK ? panel.url : nil) } }
    }

    /// Encabezado de autenticación para git sin escribir el token en disco (va en memoria, solo para ese comando).
    static func encabezado(_ proveedor: String, _ token: String) -> String {
        let usuario = proveedor == "gitlab" ? "oauth2" : "x-access-token"
        return "Authorization: Basic " + Data("\(usuario):\(token)".utf8).base64EncodedString()
    }

    static func git(_ args: [String], en carpeta: URL, proveedor: String? = nil, _ fin: @escaping @MainActor (Bool, String) -> Void) {
        let p = Process(), salida = Pipe()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        var a = args
        if let proveedor, let t = token(proveedor) { a = ["-c", "http.extraHeader=\(encabezado(proveedor, t))"] + args }
        p.arguments = a
        p.currentDirectoryURL = carpeta
        p.standardOutput = salida; p.standardError = salida
        p.terminationHandler = { pr in
            let texto = String(data: salida.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            Task { @MainActor in fin(pr.terminationStatus == 0, texto) }
        }
        do { try p.run() } catch { fin(false, error.localizedDescription) }
    }

    /// Trae notas que ya están en un repositorio git (GitHub, GitLab o cualquiera) a una carpeta local.
    static func clonar(_ url: String, proveedor: String?, en destino: URL, _ fin: @escaping @MainActor (Bool, String) -> Void) {
        try? FileManager.default.createDirectory(at: destino.deletingLastPathComponent(), withIntermediateDirectories: true)
        git(["clone", url, destino.path], en: destino.deletingLastPathComponent(), proveedor: proveedor, fin)
    }

    /// Crea un repositorio PRIVADO en la cuenta del usuario y deja la carpeta de notas conectada a él.
    static func crearRepo(proveedor: String, token: String, nombre: String, carpeta: URL, _ fin: @escaping @MainActor (Bool, String) -> Void) {
        var pedido: URLRequest
        if proveedor == "gitlab" {
            pedido = URLRequest(url: URL(string: "https://gitlab.com/api/v4/projects")!)
            pedido.setValue(token, forHTTPHeaderField: "PRIVATE-TOKEN")
            pedido.httpBody = try? JSONSerialization.data(withJSONObject: ["name": nombre, "visibility": "private"])
        } else {
            pedido = URLRequest(url: URL(string: "https://api.github.com/user/repos")!)
            pedido.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            pedido.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            pedido.httpBody = try? JSONSerialization.data(withJSONObject: ["name": nombre, "private": true, "description": "Mis notas de reuniones (Minuta)"])
        }
        pedido.httpMethod = "POST"
        pedido.setValue("application/json", forHTTPHeaderField: "Content-Type")
        URLSession.shared.dataTask(with: pedido) { datos, resp, _ in
            let codigo = (resp as? HTTPURLResponse)?.statusCode ?? 0
            let o = datos.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            let urlClonar = (o["clone_url"] as? String) ?? (o["http_url_to_repo"] as? String)
            Task { @MainActor in
                guard (200..<300).contains(codigo), let urlClonar else {
                    let msg = (o["message"] as? String) ?? ((o["message"] as? [String: Any]).map { "\($0)" }) ?? "Respuesta \(codigo)"
                    fin(false, msg); return
                }
                guardarToken(token, cuenta: proveedor)
                conectar(carpeta: carpeta, remoto: urlClonar, proveedor: proveedor) { ok, texto in fin(ok, ok ? urlClonar : texto) }
            }
        }.resume()
    }

    /// Deja la carpeta como repo git con el remoto indicado y sube lo que haya.
    static func conectar(carpeta: URL, remoto: String, proveedor: String, _ fin: @escaping @MainActor (Bool, String) -> Void) {
        try? FileManager.default.createDirectory(at: carpeta, withIntermediateDirectories: true)
        let ignorar = carpeta.appendingPathComponent(".gitignore")
        if !FileManager.default.fileExists(atPath: ignorar.path) { try? ".DS_Store\n.obsidian/workspace*\n".write(to: ignorar, atomically: true, encoding: .utf8) }
        let pasos: [[String]] = [["init", "-b", "main"], ["remote", "remove", "origin"], ["remote", "add", "origin", remoto],
                                 ["add", "-A"], ["-c", "user.name=Minuta", "-c", "user.email=minuta@localhost", "commit", "-m", "Notas de reuniones", "--allow-empty"],
                                 ["push", "-u", "origin", "main"]]
        func paso(_ i: Int) {
            guard i < pasos.count else {
                var p = Perfil.datos(); p["respaldo"] = proveedor; p["respaldo_remoto"] = remoto; Perfil.guardar(p)
                fin(true, ""); return
            }
            git(pasos[i], en: carpeta, proveedor: i == pasos.count - 1 ? proveedor : nil) { ok, texto in
                if !ok, pasos[i][0] == "push" || pasos[i][0] == "init" { fin(false, texto); return }
                paso(i + 1)
            }
        }
        paso(0)
    }

    /// Después de cada reunión: guarda y sube los cambios de la carpeta de notas (si el usuario activó el respaldo).
    static func sincronizar() {
        let p = Perfil.datos()
        guard let proveedor = p["respaldo"], !proveedor.isEmpty else { return }
        let carpeta = Perfil.carpetaNotas
        git(["add", "-A"], en: carpeta) { _, _ in
            git(["-c", "user.name=Minuta", "-c", "user.email=minuta@localhost", "commit", "-m", "Reunión \(ISO8601DateFormatter().string(from: Date()))"], en: carpeta) { _, _ in
                git(["pull", "--rebase", "--autostash"], en: carpeta, proveedor: proveedor) { _, _ in
                    git(["push"], en: carpeta, proveedor: proveedor) { ok, texto in
                        if !ok { NSLog("Minuta: no pude respaldar las notas: %@", texto) }
                    }
                }
            }
        }
    }
}

// MARK: - Actualizaciones (sin perder nada: los datos viven fuera de la app)

@MainActor
enum Actualizaciones {
    static var version: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0" }
    /// Repo público de la app. Cada versión es un Release con `Minuta-macOS.zip` y `Minuta-macOS.zip.sha256`.
    static let repoPublico = "minuta-app/minuta"
    private static var raiz: URL { Temas.base }
    /// Instalación de desarrollo: ~/minuta es un checkout de git (se actualiza con git pull + build.sh).
    static var esDesarrollo: Bool { FileManager.default.fileExists(atPath: raiz.appendingPathComponent(".git").path) }
    private static var zip: URL?, huella: URL?

    /// Revisa si hay versión nueva. Devuelve (hay, detalle) en el hilo principal.
    static func revisar(_ fin: @escaping @MainActor (Bool, String) -> Void) {
        if esDesarrollo {
            Respaldo.git(["fetch", "--quiet", "origin", "main"], en: raiz) { ok, _ in
                guard ok else { fin(false, ""); return }
                Respaldo.git(["rev-list", "--count", "HEAD..origin/main"], en: raiz) { _, n in
                    let cambios = Int(n.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
                    guard cambios > 0 else { fin(false, ""); return }
                    Respaldo.git(["log", "--format=%s", "-n", "3", "HEAD..origin/main"], en: raiz) { _, log in
                        fin(true, log.split(separator: "\n").map { "• " + $0 }.joined(separator: "\n"))
                    }
                }
            }
            return
        }
        var pedido = URLRequest(url: URL(string: "https://api.github.com/repos/\(repoPublico)/releases/latest")!)
        pedido.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        pedido.setValue("Minuta/\(version)", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: pedido) { datos, _, _ in
            let o = datos.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            let tag = (o["tag_name"] as? String ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "v"))
            let assets = o["assets"] as? [[String: Any]] ?? []
            let url = { (n: String) in (assets.first { $0["name"] as? String == n }?["browser_download_url"] as? String).flatMap(URL.init(string:)) }
            Task { @MainActor in
                guard !tag.isEmpty, tag.compare(version, options: .numeric) == .orderedDescending,
                      let z = url("Minuta-macOS.zip"), let h = url("Minuta-macOS.zip.sha256") else { fin(false, ""); return }
                zip = z; huella = h
                let notas = (o["body"] as? String ?? "").split(separator: "\n").prefix(4).joined(separator: "\n")
                fin(true, "Versión \(tag)\n" + notas)
            }
        }.resume()
    }

    /// Instala la versión nueva y vuelve a abrir Minuta. Notas, perfil, universos y modelos no se tocan (viven en ~/minuta).
    static func instalar(_ fin: @escaping @MainActor (Bool, String) -> Void) {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("minuta-actualizacion")
        let guion = tmp.appendingPathComponent("actualizar.sh")
        try? FileManager.default.removeItem(at: tmp)
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        let pid = ProcessInfo.processInfo.processIdentifier
        let texto: String
        if esDesarrollo {
            texto = """
            #!/bin/bash
            export PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin
            cd "\(raiz.path)" || exit 1
            { git pull --ff-only && bash ./build.sh && open "$HOME/Applications/Minuta.app"; } > /tmp/minuta-actualizar.log 2>&1 || open "$HOME/Applications/Minuta.app"
            """
        } else {
            guard let zip, let huella else { fin(false, Idioma.t("No encontré la descarga de la versión nueva.")); return }
            let app = Bundle.main.bundlePath
            texto = """
            #!/bin/bash
            # Baja la versión nueva, verifica su huella, espera a que Minuta se cierre, la reemplaza y la abre.
            set -e
            cd "\(tmp.path)"
            curl -fsSL "\(zip.absoluteString)" -o Minuta-macOS.zip
            curl -fsSL "\(huella.absoluteString)" -o Minuta-macOS.zip.sha256
            [ "$(shasum -a 256 Minuta-macOS.zip | cut -d' ' -f1)" = "$(cut -d' ' -f1 Minuta-macOS.zip.sha256)" ] || { echo "huella distinta"; exit 1; }
            ditto -x -k Minuta-macOS.zip nueva
            xattr -dr com.apple.quarantine nueva/Minuta.app 2>/dev/null || true
            osascript -e 'tell application id "app.minuta.mac" to quit' 2>/dev/null || true
            while kill -0 \(pid) 2>/dev/null; do sleep 0.5; done
            rm -rf "\(app).anterior"; mv "\(app)" "\(app).anterior"
            ditto nueva/Minuta.app "\(app)" && rm -rf "\(app).anterior" || mv "\(app).anterior" "\(app)"
            open "\(app)"
            """
        }
        do { try texto.write(to: guion, atomically: true, encoding: .utf8) } catch { fin(false, error.localizedDescription); return }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = ["-c", "nohup /bin/bash '\(guion.path)' > /tmp/minuta-actualizar.log 2>&1 &"]
        do {
            try p.run(); fin(true, "")
            // Versión publicada: Minuta se cierra para que el guion la reemplace (en desarrollo lo hace build.sh).
            if !esDesarrollo { DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { NSApp.terminate(nil) } }
        } catch { fin(false, error.localizedDescription) }
    }
}
