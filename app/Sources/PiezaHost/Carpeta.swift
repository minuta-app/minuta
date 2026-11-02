// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
import AppKit
import CoreServices

/// Pieza «host-mac»: la carpeta que elige la persona, con un marcador del sistema (la sigue aunque la mueva o le cambie el
/// nombre). Equivale a `host.carpeta`
/// de «host-escritorio».
///
///     p.carpeta = CarpetaElegida()                      // marcador en UserDefaults «carpeta.marcador», ruta en config.carpeta
///     p.registrar("elegirCarpeta") { _ in p.carpeta?.elegir(mensaje: "Elige tu carpeta") { u in … } }
///
/// `clave`: la clave de config (en app.json con "interfaz": false) donde queda la ruta para los scripts; nil = solo el marcador.
@MainActor
public final class CarpetaElegida {
    public let marcador: String
    public let clave: String?
    /// Lo que responde una acción que necesita la carpeta (`carpetaActual`) si no hay ninguna.
    public var textoFalta = "Elige una carpeta primero."
    /// Al elegir otra (o nil al olvidarla). El host lo usa para mover el vigilante.
    public var alCambiar: (@MainActor (URL?) -> Void)?

    public init(marcador: String = "carpeta.marcador", clave: String? = "carpeta") {
        self.marcador = marcador
        self.clave = clave
    }

    /// La carpeta elegida (ruta real), si todavía existe. Primero el marcador (si la persona la movió, se pone al día también
    /// config.<clave>); si no hay marcador, config.<clave>.
    public func actual() -> URL? {
        if let d = UserDefaults.standard.data(forKey: marcador) {
            var vieja = false
            if let u = try? URL(resolvingBookmarkData: d, options: [.withoutUI], relativeTo: nil, bookmarkDataIsStale: &vieja) {
                if vieja, let nueva = try? u.bookmarkData() { UserDefaults.standard.set(nueva, forKey: marcador) }
                let real = u.standardizedFileURL.resolvingSymlinksInPath()
                if let clave, Config.texto(clave) != real.path { _ = Config.guardar([clave: real.path], desdeInterfaz: false) }
                return CarpetaElegida.esCarpeta(real) ? real : nil
            }
        }
        guard let clave else { return nil }
        let c = Config.texto(clave)
        guard c.hasPrefix("/") else { return nil }
        let u = URL(fileURLWithPath: c).standardizedFileURL.resolvingSymlinksInPath()
        return CarpetaElegida.esCarpeta(u) ? u : nil
    }

    /// Deja `u` como la actual (una carpeta que eligió la persona o que la app leyó de lo suyo, nunca de la interfaz).
    @discardableResult
    public func usar(_ u: URL) -> URL {
        let real = u.standardizedFileURL.resolvingSymlinksInPath()
        if let m = try? real.bookmarkData() { UserDefaults.standard.set(m, forKey: marcador) }
        if let clave { _ = Config.guardar([clave: real.path], desdeInterfaz: false) }
        alCambiar?(real)
        return real
    }

    public func olvidar() {
        UserDefaults.standard.removeObject(forKey: marcador)
        if let clave { _ = Config.guardar([clave: ""], desdeInterfaz: false) }
        alCambiar?(nil)
    }

    /// El selector del sistema (en la ventana, si hay); `fin(nil)` si la persona cancela.
    public func elegir(mensaje: String? = nil, boton: String? = nil, _ fin: @escaping @MainActor (URL?) -> Void) {
        Puente.shared.elegirCarpeta(mensaje: mensaje.map { Idioma.t($0) }, boton: boton.map { Idioma.t($0) }, desde: actual()) { [weak self] u in
            guard let self, let u else { return fin(nil) }
            fin(self.usar(u))
        }
    }

    static func esCarpeta(_ u: URL) -> Bool {
        var dir: ObjCBool = false
        return FileManager.default.fileExists(atPath: u.path, isDirectory: &dir) && dir.boolValue
    }
}

/// Pieza «host-mac»: vigilar la carpeta (FSEvents). Si un archivo que la app tiene abierto cambia en el disco (otro editor, git
/// pull…), la app se entera; si cambia algo más de la carpeta, también (para volver a listarla). Equivale a
/// `Vigilante` de «host-escritorio».
///
/// La app recuerda el último texto que leyó o escribió de cada archivo abierto (`conocer(ruta, texto)`, o una acción declarada
/// con «vigilar»): así lo que escribe ella misma nunca se avisa como un cambio de afuera (el texto queda conocido ANTES de
/// escribirlo). Cuando algo cambia, espera a que la carpeta quede quieta y:
///   1. relee cada archivo conocido; si su texto no es el conocido → `alCambiarArchivo(ruta, texto)` (por defecto, la interfaz
///      recibe `archivoCambiado {ruta, texto}`);
///   2. `alCambiar(base)`: la app vuelve a listar si quiere.
/// Lo que pasa dentro de .git, node_modules y otras carpetas pesadas no cuenta.
@MainActor
public final class Vigilante {
    public static let fuera: Set<String> = [".git", "node_modules", ".venv", "venv", "env", "__pycache__", ".mypy_cache", ".pytest_cache", ".tox",
                                            "dist", "build", ".next", ".nuxt", "target", ".gradle", ".idea", ".terraform", ".aws", ".ssh",
                                            ".gnupg", ".cache", "Pods", "DerivedData", ".build"]
    /// [".md", ".mmd"]: solo esos archivos (y las carpetas) cuentan. nil: todo.
    public let extensiones: [String]?
    public let espera: Double
    public let maximo: Int
    public var alCambiarArchivo: @MainActor (String, String) -> Void = { ruta, texto in Puente.shared.llamar("archivoCambiado", ["ruta": ruta, "texto": texto]) }
    public var alCambiar: (@MainActor (URL) -> Void)?
    /// ruta relativa → último texto que la app leyó o escribió.
    public private(set) var conocidos: [String: String] = [:]
    public private(set) var base: URL?

    private var flujo: FSEventStreamRef?
    private var reloj: DispatchWorkItem?
    private var revisando = false
    /// Los vigilantes que están corriendo, por número (lo único que viaja por la función de C de FSEvents).
    private static var activos: [Int: Vigilante] = [:]
    private static var siguiente = 1
    private var numero = 0

    public init(extensiones: [String]? = nil, espera: Double = 0.35, maximo: Int = 2 * 1024 * 1024) {
        self.extensiones = extensiones?.map { ($0.hasPrefix(".") ? $0 : "." + $0).lowercased() }
        self.espera = espera
        self.maximo = maximo
    }

    /// Recuerda el texto que la app leyó o escribió (nil lo olvida).
    public func conocer(_ ruta: String, _ texto: String?) { conocidos[ruta] = texto }
    public func olvidar(_ ruta: String) { conocidos.removeValue(forKey: ruta) }

    /// La ruta absoluta de `relativa` dentro de la carpeta vigilada (la guarda de nucleo.ruta_en), o nil.
    public func absoluta(_ relativa: Any?) -> URL? {
        guard let base else { return nil }
        return Enchufe.dentro(base, relativa, extensiones: extensiones)
    }

    public func empezar(_ u: URL) {
        if base == u, flujo != nil { return }
        detener()
        base = u
        conocidos = [:]
        numero = Vigilante.siguiente
        Vigilante.siguiente += 1
        Vigilante.activos[numero] = self
        var contexto = FSEventStreamContext(version: 0, info: UnsafeMutableRawPointer(bitPattern: numero), retain: nil, release: nil, copyDescription: nil)
        // Función de C: no puede capturar nada. Pasa las rutas (con «es carpeta») a la cola principal; ahí se filtran.
        let alCambiar: FSEventStreamCallback = { _, info, cuantos, rutas, banderas, _ in
            let n = Int(bitPattern: info)
            let todas = Unmanaged<CFArray>.fromOpaque(rutas).takeUnretainedValue() as NSArray
            var cambios: [(String, Bool)] = []
            for i in 0..<cuantos {
                guard let r = todas[i] as? String else { continue }
                let b = Int(banderas[i])
                cambios.append((r, b & kFSEventStreamEventFlagItemIsDir != 0 || b & kFSEventStreamEventFlagMustScanSubDirs != 0))
            }
            let lista = cambios
            Task { @MainActor in Vigilante.activos[n]?.cambios(lista) }
        }
        let banderas = FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagNoDefer)
        guard let f = FSEventStreamCreate(kCFAllocatorDefault, alCambiar, &contexto, [u.path] as CFArray,
                                          FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.3, banderas) else { return }
        FSEventStreamSetDispatchQueue(f, DispatchQueue.main)
        FSEventStreamStart(f)
        flujo = f
    }

    public func detener() {
        if let f = flujo {
            FSEventStreamStop(f)
            FSEventStreamInvalidate(f)
            FSEventStreamRelease(f)
        }
        flujo = nil
        base = nil
        reloj?.cancel()
        Vigilante.activos.removeValue(forKey: numero)
    }

    /// ¿Puede importar esta ruta (relativa a la carpeta)? Un archivo de las extensiones o una carpeta, fuera de las pesadas.
    public func importa(_ relativa: String, carpeta: Bool) -> Bool {
        if relativa.split(separator: "/").contains(where: { Vigilante.fuera.contains(String($0)) }) { return false }
        guard let extensiones, !carpeta else { return true }
        let ext = (relativa as NSString).pathExtension.lowercased()
        return extensiones.contains("." + ext)
    }

    func cambios(_ lista: [(String, Bool)]) {
        guard let b = base?.path else { return }
        let alguna = lista.contains { par -> Bool in
            let (r, carpeta) = par
            let rel = r.hasPrefix(b + "/") ? String(r.dropFirst(b.count + 1)) : r == b ? "" : r
            return self.importa(rel, carpeta: carpeta)
        }
        if alguna { programar() }
    }

    /// Un editor o git escriben varias veces seguidas: se espera a que la carpeta quede quieta.
    public func programar() {
        reloj?.cancel()
        let n = numero
        let t = DispatchWorkItem { Task { @MainActor in Vigilante.activos[n]?.revisar() } }
        reloj = t
        DispatchQueue.main.asyncAfter(deadline: .now() + espera, execute: t)
    }

    func revisar() {
        guard let b = base, !revisando else { return }
        revisando = true
        defer { revisando = false }
        for (ruta, conocido) in conocidos {
            guard let u = absoluta(ruta), let texto = leerTexto(u), texto != conocido else { continue }
            conocidos[ruta] = texto
            alCambiarArchivo(ruta, texto)
        }
        alCambiar?(b)
    }

    /// El texto de un archivo (UTF-8; lo que no lo es se reemplaza), o nil si no es un archivo o pesa más que `maximo`.
    public func leerTexto(_ u: URL) -> String? {
        guard let a = try? FileManager.default.attributesOfItem(atPath: u.path), (a[.type] as? FileAttributeType) == .typeRegular,
              let tam = a[.size] as? Int, tam <= maximo, let d = try? Data(contentsOf: u) else { return nil }
        return String(decoding: d, as: UTF8.self)
    }
}
