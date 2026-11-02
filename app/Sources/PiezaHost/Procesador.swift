// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
import Foundation

/// Pieza «host-mac»: corre los scripts de bin/ con el Python portátil. Equivale a procesador.js de «host-escritorio».
/// Contrato (nucleo.script): `script.py <args…> [entrada.json] <salida.json>`.
///  · Lo que manda la interfaz va en el archivo de entrada, nunca como argumento (cualquier programa ve los argumentos).
///  · Un secreto (la llave de un conector) va por la entrada estándar: nunca en un archivo, un argumento ni el entorno.
///  · Ninguna variable <ID>_* de afuera llega al script: solo las que pone el host.
///  · Todo tiene límite de tiempo: al cumplirse se corta el script y todo lo que lanzó (sus descendientes). Un trabajo largo
///    (`latido: true`, «limite»: "trabajo") no tiene tope, pero tiene que latir (pieza «trabajos»: <ID>_LATIDO): si deja de
///    latir, se corta igual.
///  · Al salir de la app se corta lo que siga corriendo (`cortarTodo`): un trabajo queda «interrumpido» y se sigue después.
///  · Entrada y salida viven en una carpeta temporal propia (0700) que se borra al terminar.
@MainActor
public enum Procesador {
    public struct Resultado {
        public let respuesta: [String: Any]
        public let salidaEstandar: String
        public let porLimite: Bool
    }

    public static let textoLimite = "Tardó demasiado y lo detuve. Intenta de nuevo."
    public static let textoLatido = "Dejó de avanzar y lo detuve. Intenta de nuevo."
    public static let textoFallo = "No pude terminar. Intenta de nuevo."
    /// Un trabajo sin latido por más que esto se corta (lo mismo que `trabajos.MUERTO`); el primero tiene `latidoPrimero`.
    public static var latidoMuerto: TimeInterval = 45
    public static var latidoPrimero: TimeInterval = 120
    public static var latidoRevisar: TimeInterval = 5

    /// Cuántos scripts están corriendo (para no actualizar ni cerrar en medio de uno).
    public private(set) static var enCurso = 0
    /// Los que están corriendo (para cortarlos al salir).
    private static var vivos: [Int32: Process] = [:]

    public typealias Lector = (ruta: String, empezar: @MainActor () -> Void, terminar: @MainActor () -> Void)
    /// Pieza «trabajos» (LectorProgreso), si la app la tiene: `Procesador.lectorProgreso = { aviso in let l = LectorProgreso(
    /// prefijo: Host.id, aviso: aviso); return (l.url.path, l.empezar, l.terminar) }`.
    public static var lectorProgreso: (@MainActor (@escaping @MainActor ([[String: Any]]) -> Void) -> Lector)?

    /// Detiene todo lo que sigue corriendo (y lo que lanzó). Lo llama el host al salir.
    public static func cortarTodo() {
        for p in vivos.values where p.isRunning { matarArbol(p.processIdentifier, SIGTERM) }
    }

    /// Lo de bajo nivel. `entrada`: los datos de la interfaz (van en un archivo, después de `args`).
    /// `latido: true`: sin tope de tiempo mientras el script lata (pieza «trabajos»); `limite` no cuenta.
    public static func correr(_ script: String, _ args: [String], entrada: [String: Any]? = nil, secreto: String? = nil, limite: Int = 120,
                              latido: Bool = false, entorno: [String: String] = [:], progreso: (@MainActor ([[String: Any]]) -> Void)? = nil,
                              fin: @escaping @MainActor (Resultado) -> Void) {
        let falla = { (e: String) in fin(Resultado(respuesta: ["ok": false, "error": e], salidaEstandar: "", porLimite: false)) }
        guard Texto.calza(script, "\\w+\\.py") else { return falla("script raro") }
        let ruta = Host.recursos.appendingPathComponent("bin").appendingPathComponent(script)
        guard FileManager.default.fileExists(atPath: ruta.path) else { return falla("no está bin/\(script)") }
        guard args.allSatisfy({ !$0.contains("\u{0}") }) else { return falla("argumentos raros") }
        let segundos = min(max(limite, 1), 3600)

        // Una carpeta temporal propia (0700) para la entrada y la salida.
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("\(Host.id)-\(UUID().uuidString)")
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        } catch { return falla(error.localizedDescription) }
        let salida = dir.appendingPathComponent("salida.json")
        var argumentos = args
        if let entrada {
            let archivo = dir.appendingPathComponent("entrada.json")
            guard Archivos.escribirJSON(archivo, entrada) else {
                try? FileManager.default.removeItem(at: dir)
                return falla("No pude preparar la entrada.")
            }
            argumentos.append(archivo.path)
        }

        let p = Process()
        p.executableURL = Host.python
        p.arguments = [ruta.path] + argumentos + [salida.path]
        let prefijo = Host.prefijo
        var env = ProcessInfo.processInfo.environment.filter { !$0.key.uppercased().hasPrefix(prefijo) }
        for (k, v) in entorno where Texto.calza(k, "[A-Z][A-Z0-9_]{0,60}") { env[k] = v }
        env[prefijo + "RECURSOS"] = Host.recursos.path
        env[prefijo + "DATOS"] = Host.datos.path
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUTF8"] = "1"
        env["PYTHONDONTWRITEBYTECODE"] = "1"  // sin __pycache__ dentro de la app (rompería su firma)
        var lector: Lector? = nil
        if let progreso, let crear = lectorProgreso {
            let l = crear(progreso)
            env[prefijo + "PROGRESO"] = l.ruta
            lector = l
        }
        // Un trabajo late tocando este archivo (trabajos.latir_host): el host mira cuándo fue la última vez.
        let archivoLatido = dir.appendingPathComponent("latido")
        if latido {
            FileManager.default.createFile(atPath: archivoLatido.path, contents: nil, attributes: [.posixPermissions: 0o600])
            env[prefijo + "LATIDO"] = archivoLatido.path
        }
        p.environment = env
        p.currentDirectoryURL = dir
        let estado = EstadoProceso()
        let tuboEntrada = Pipe()
        let tuboSalida = Pipe()
        p.standardInput = secreto == nil ? FileHandle.nullDevice : tuboEntrada
        p.standardOutput = secreto == nil ? FileHandle.nullDevice : tuboSalida
        p.standardError = FileHandle.nullDevice
        if secreto != nil {
            tuboSalida.fileHandleForReading.readabilityHandler = { h in estado.sumar(h.availableData) }
        }
        let lectorFinal = lector
        p.terminationHandler = { proceso in
            let pid = proceso.processIdentifier
            if secreto != nil {
                tuboSalida.fileHandleForReading.readabilityHandler = nil
                estado.sumar(tuboSalida.fileHandleForReading.readDataToEndOfFile())
            }
            Task { @MainActor in
                guard estado.terminar() else { return }
                enCurso -= 1
                vivos.removeValue(forKey: pid)
                lectorFinal?.terminar()
                var r = estado.porLimite ? [:] : Archivos.leerJSON(salida)
                try? FileManager.default.removeItem(at: dir)
                if estado.porLimite && latido {
                    r = ["ok": false, "codigo": "limite", "texto": textoLatido, "valores": [String: Any](), "error": Idioma.t(textoLatido)]
                } else if estado.porLimite {
                    r = ["ok": false, "codigo": "limite", "texto": textoLimite, "valores": ["s": segundos], "error": Idioma.t(textoLimite)]
                } else if r.isEmpty {
                    r = ["ok": false, "codigo": "fallo", "texto": textoFallo, "valores": [String: Any](), "error": Idioma.t(textoFallo)]
                }
                fin(Resultado(respuesta: r, salidaEstandar: estado.texto, porLimite: estado.porLimite))
            }
        }
        enCurso += 1
        do { try p.run() } catch {
            enCurso -= 1
            lectorFinal?.terminar()
            try? FileManager.default.removeItem(at: dir)
            return falla(error.localizedDescription)
        }
        vivos[p.processIdentifier] = p
        lectorFinal?.empezar()
        if let secreto {
            tuboEntrada.fileHandleForWriting.write(Data(secreto.utf8))
            try? tuboEntrada.fileHandleForWriting.close()
        }
        // El límite: primero se le pide que termine (a él y a lo que lanzó) y, si sigue, se corta.
        let cortar: @Sendable () -> Void = {
            guard p.isRunning else { return }
            estado.marcarLimite()
            matarArbol(p.processIdentifier, SIGTERM)
            DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(3)) {
                if p.isRunning { matarArbol(p.processIdentifier, SIGKILL) }
            }
        }
        if latido {
            revisarLatido(p, archivoLatido, inicio: Date(), cortar)
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(segundos)) { cortar() }
        }
    }

    /// Cada pocos segundos: si el archivo del latido no se tocó hace más de `latidoMuerto` (el primero tiene `latidoPrimero`),
    /// el trabajo quedó colgado y se corta.
    private static func revisarLatido(_ p: Process, _ archivo: URL, inicio: Date, _ cortar: @escaping @Sendable () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + latidoRevisar) {
            Task { @MainActor in
                guard p.isRunning else { return }
                let tocado = (try? FileManager.default.attributesOfItem(atPath: archivo.path))?[.modificationDate] as? Date ?? inicio
                let ultimo = max(tocado, inicio.addingTimeInterval(latidoPrimero - latidoMuerto))
                if Date().timeIntervalSince(ultimo) > latidoMuerto { cortar() } else { revisarLatido(p, archivo, inicio: inicio, cortar) }
            }
        }
    }

    /// El JSON de salida del script (o ["ok": false, "codigo", "texto", "error"]).
    public static func correrJSON(_ script: String, _ args: [String], limite: Int = 120, latido: Bool = false,
                                  progreso: (@MainActor ([[String: Any]]) -> Void)? = nil, fin: @escaping @MainActor ([String: Any]) -> Void) {
        correr(script, args, limite: limite, latido: latido, progreso: progreso) { fin($0.respuesta) }
    }

    /// Lo que manda la interfaz va en un archivo de entrada (después de `args`, antes de la salida).
    public static func conEntrada(_ script: String, _ args: [String], _ datos: [String: Any], limite: Int = 120, latido: Bool = false,
                                  progreso: (@MainActor ([[String: Any]]) -> Void)? = nil, fin: @escaping @MainActor ([String: Any]) -> Void) {
        correr(script, args, entrada: datos, limite: limite, latido: latido, progreso: progreso) { fin($0.respuesta) }
    }

    /// La forma de siempre: `conEntrada("ia.py", "probar", ["ia": "claude"])`.
    public static func conEntrada(_ script: String, _ accion: String, _ datos: [String: Any], limite: Int = 120, latido: Bool = false,
                                  progreso: (@MainActor ([[String: Any]]) -> Void)? = nil, fin: @escaping @MainActor ([String: Any]) -> Void) {
        conEntrada(script, [accion], datos, limite: limite, latido: latido, progreso: progreso, fin: fin)
    }

    /// Un secreto por la entrada estándar (patrón de los conectores). La salida estándar vuelve en `salidaEstandar`.
    public static func conSecreto(_ script: String, _ args: [String], secreto: String, limite: Int = 120,
                                  fin: @escaping @MainActor (Resultado) -> Void) {
        correr(script, args, secreto: secreto, limite: limite, fin: fin)
    }

    /// El proceso y todos sus descendientes (la IA, ffmpeg…): primero los hijos, para que ninguno quede huérfano.
    nonisolated static func matarArbol(_ pid: pid_t, _ senal: Int32) {
        for hijo in hijos(de: pid) { matarArbol(hijo, senal) }
        kill(pid, senal)
    }

    nonisolated private static func hijos(de pid: pid_t) -> [pid_t] {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        p.arguments = ["-P", String(pid)]
        let tubo = Pipe()
        p.standardOutput = tubo
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return [] }
        let d = tubo.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return (String(data: d, encoding: .utf8) ?? "").split(whereSeparator: \.isNewline).compactMap { pid_t($0) }
    }
}

/// Lo que comparten el reloj del límite y el fin del proceso (hilos distintos): con candado.
final class EstadoProceso: @unchecked Sendable {
    private let candado = NSLock()
    private var datos = Data()
    private var limite = false
    private var terminado = false
    static let maximo = 1024 * 1024

    func sumar(_ d: Data) {
        candado.lock(); defer { candado.unlock() }
        if datos.count < EstadoProceso.maximo { datos.append(d.prefix(EstadoProceso.maximo - datos.count)) }
    }
    func marcarLimite() { candado.lock(); limite = true; candado.unlock() }
    var porLimite: Bool { candado.lock(); defer { candado.unlock() }; return limite }
    var texto: String { candado.lock(); defer { candado.unlock() }; return String(data: datos, encoding: .utf8) ?? "" }
    /// true solo la primera vez.
    func terminar() -> Bool {
        candado.lock(); defer { candado.unlock() }
        if terminado { return false }
        terminado = true
        return true
    }
}

/// Una fila: las tareas corren de a una y en el orden en que llegaron (guardar nunca pisa un guardado más nuevo).
@MainActor
public enum Fila {
    public typealias Tarea = @MainActor (@escaping @MainActor () -> Void) -> Void
    private static var cola: [Tarea] = []
    private static var ocupada = false

    public static var pendientes: Int { cola.count + (ocupada ? 1 : 0) }

    public static func agregar(_ tarea: @escaping Tarea) {
        cola.append(tarea)
        siguiente()
    }

    private static func siguiente() {
        guard !ocupada, !cola.isEmpty else { return }
        ocupada = true
        let t = cola.removeFirst()
        t {
            ocupada = false
            siguiente()
        }
    }
}
