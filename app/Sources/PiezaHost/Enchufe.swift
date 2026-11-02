// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
import Foundation

/// Pieza «host-mac»: las acciones declaradas (docs/enchufe.md, «Una acción»). `acciones.json` lo arma `pieza.py` con los
/// pieza.json de las piezas y el app.json de la app, y va dentro de la app junto a app.json. Al cargar se vuelven a revisar
/// con las mismas reglas que `pieza.py` (y que enchufe.js de «host-escritorio»): lo que no pasa no se carga.
public enum Enchufe {
    public struct Accion {
        public let nombre: String
        public let script: String
        public let args: [String]
        public let datos: [String: [String: Any]]
        public let pasarResto: Bool
        public let porArchivo: Bool
        public let inyectar: [String: String]
        public let responde: String?
        public let progreso: String?
        public let eco: [String]
        public let despues: [String]
        public let enFila: Bool
        /// Segundos (1 a 3600), "trabajo" o {segun, valores, otro}: ver `limite(para:)`.
        public let limites: Any
        /// Bytes que puede pesar la entrada (5 MB salvo que la acción diga «maximo», hasta 50 MB).
        public let maximo: Int
        /// "lee" | "escribe": el vigilante de la carpeta conoce el texto (así no avisa lo que escribió la app). nil: nada.
        public let vigilar: String?

        /// El límite de esta vez: segundos, o nil = "trabajo" (sin tope mientras el script lata; pieza «trabajos»).
        public func limite(para entrada: [String: Any]) -> Int? {
            var l = limites
            if let d = limites as? [String: Any] {
                let v = (d["segun"] as? String).flatMap { entrada[$0] as? String }
                l = (v.flatMap { (d["valores"] as? [String: Any])?[$0] }) ?? d["otro"] ?? 120
            }
            if l as? String == "trabajo" { return nil }
            return Texto.entero(l) ?? 120
        }
    }

    static let tipos: Set<String> = ["texto", "enum", "bool", "entero", "rutaRelativa", "base64", "lista"]
    static let prohibidos: Set<String> = ["__proto__", "constructor", "prototype"]
    public static let maximoEntrada = 5 * 1024 * 1024
    /// «maximo» de una acción como mucho.
    public static let topeEntrada = 50 * 1024 * 1024
    static let nombre = "[A-Za-z][A-Za-z0-9]{0,60}"
    static let campo = "[A-Za-z_]\\w{0,60}"

    /// Las acciones que pasan la revisión, y lo que no pasó (para el registro).
    public static func cargar(_ recursos: URL) -> (acciones: [String: Accion], errores: [String]) {
        let url = recursos.appendingPathComponent("acciones.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return ([:], []) }
        let d = Archivos.leerJSON(url, maximo: 2 * 1024 * 1024)
        guard Texto.entero(d["formato"]) == 1, let lista = d["acciones"] as? [String: Any] else { return ([:], ["acciones.json: formato desconocido"]) }
        var acciones: [String: Accion] = [:]
        var errores: [String] = []
        for (n, valor) in lista {
            guard let a = valor as? [String: Any] else { errores.append("acción «\(n)»: no es un objeto"); continue }
            var e = self.errores(n, a)
            if e.isEmpty, let s = a["script"] as? String,
               !FileManager.default.fileExists(atPath: recursos.appendingPathComponent("bin").appendingPathComponent(s).path) {
                e.append("acción «\(n)»: no está bin/\(s)")
            }
            if !e.isEmpty { errores += e; continue }
            acciones[n] = Accion(
                nombre: n, script: a["script"] as! String, args: a["args"] as? [String] ?? [],
                datos: (a["datos"] as? [String: Any] ?? [:]).compactMapValues { $0 as? [String: Any] },
                pasarResto: (a["datos"] as? [String: Any])?["*"] as? String == "pasar",
                porArchivo: a["entrada"] as? String == "archivo", inyectar: a["inyectar"] as? [String: String] ?? [:],
                responde: a["responde"] as? String, progreso: a["progreso"] as? String, eco: a["eco"] as? [String] ?? [],
                despues: a["despues"] as? [String] ?? [], enFila: a["cola"] as? String == "escritura", limites: a["limite"] ?? 120,
                maximo: Texto.entero(a["maximo"]) ?? maximoEntrada, vigilar: a["vigilar"] as? String)
        }
        return (acciones, errores)
    }

    /// Las mismas reglas que pieza.py (errores_accion) y enchufe.js (erroresAccion).
    public static func errores(_ n: String, _ a: [String: Any]) -> [String] {
        let donde = "acción «\(n)»"
        var e: [String] = []
        if !Texto.calza(n, nombre) { e.append("\(donde): nombre raro") }
        guard let s = a["script"] as? String, Texto.calza(s, "\\w+\\.py") else { return e + ["\(donde): «script» debe ser nombre.py"] }
        let datosCrudos = a["datos"] ?? [String: Any]()
        let argsCrudos = a["args"] ?? [Any]()
        guard let datos = datosCrudos as? [String: Any] else { return e + ["\(donde): «datos» es {campo: regla}"] }
        guard let lista = argsCrudos as? [Any], let args = lista as? [String], args.count == lista.count else {
            return e + ["\(donde): «args» es una lista de textos"]
        }
        var maximo = maximoEntrada
        if let m = a["maximo"] {
            if let n = Texto.entero(m), (1...topeEntrada).contains(n) { maximo = n } else {
                e.append("\(donde): «maximo» (bytes de la entrada) es un entero hasta \(topeEntrada)")
            }
        }
        for (c, regla) in datos {
            if c == "*" {
                if regla as? String != "pasar" { e.append("\(donde): «*» solo puede ser \"pasar\"") }
                continue
            }
            if !Texto.calza(c, campo) || prohibidos.contains(c) { e.append("\(donde): campo raro «\(c)»") }
            e += erroresRegla("\(donde): «\(c)»", regla, maximo: maximo)
        }
        for arg in args {
            if arg.hasPrefix("$") {
                let r = datos[String(arg.dropFirst())] as? [String: Any]
                // Regla de oro: lo que escribe la persona nunca va como argumento del proceso, solo por el archivo de entrada.
                if !["enum", "entero"].contains(r?["tipo"] as? String ?? "") { e.append("\(donde): el argumento \(arg) solo puede ser un campo enum o entero") }
            } else if !Texto.calza(arg, "[\\w.-]+") {
                e.append("\(donde): argumento literal raro «\(arg)»")
            }
        }
        var porArchivo = datos.keys.filter { $0 == "*" || !args.contains("$" + $0) }
        let inyectarCrudo = a["inyectar"] ?? [String: Any]()
        if let inyectar = inyectarCrudo as? [String: Any],
           inyectar.allSatisfy({ k, v in Texto.calza(k, campo) && !prohibidos.contains(k) && (v as? String).map { Texto.calza($0, campo) } == true }) {
            for k in inyectar.keys where datos[k] != nil { e.append("\(donde): «\(k)» lo pone el host: no puede venir también en «datos»") }
            porArchivo += inyectar.keys
        } else {
            e.append("\(donde): «inyectar» es {campo: fuente}")
        }
        let entrada = a["entrada"]
        if !porArchivo.isEmpty, entrada as? String != "archivo" { e.append("\(donde): \(porArchivo.sorted().joined(separator: ", ")) no van en args: necesita \"entrada\": \"archivo\"") }
        if let x = entrada, !(x is NSNull), x as? String != "archivo" { e.append("\(donde): «entrada» es \"archivo\" o null") }
        e += erroresLimite(donde, a["limite"], datos)
        if let v = a["vigilar"] {
            let ruta = (datos["ruta"] as? [String: Any])?["tipo"] as? String, texto = (datos["texto"] as? [String: Any])?["tipo"] as? String
            let s = v as? String
            if !(s == "lee" || s == "escribe") || ruta != "rutaRelativa" || (s == "escribe" && texto != "texto") {
                e.append("\(donde): «vigilar» es \"lee\" o \"escribe\", con «ruta» (rutaRelativa) en datos (y «texto» para escribe)")
            }
        }
        if let r = a["responde"], !(r is NSNull), !((r as? String).map { Texto.calza($0, nombre) } ?? false) { e.append("\(donde): «responde» es el nombre de una función") }
        if let r = a["progreso"], !((r as? String).map { Texto.calza($0, nombre) } ?? false) { e.append("\(donde): «progreso» es el nombre de una función") }
        for (k, patron) in [("eco", campo), ("despues", nombre)] {
            if let x = a[k], !((x as? [Any]).map { $0.allSatisfy { ($0 as? String).map { Texto.calza($0, patron) } ?? false } } ?? false) {
                e.append("\(donde): «\(k)» es una lista de nombres")
            }
        }
        if let c = a["cola"], c as? String != "escritura" { e.append("\(donde): «cola» solo puede ser \"escritura\"") }
        return e
    }

    static func limiteOk(_ x: Any?) -> Bool {
        if x as? String == "trabajo" { return true }
        return Texto.entero(x).map { (1...3600).contains($0) } ?? false
    }

    /// «limite»: segundos (1 a 3600), "trabajo" (sin tope, mientras lata: pieza «trabajos») o según el valor de un campo enum:
    /// {"segun": "orden", "valores": {"documentar": "trabajo", "leer": 60}, "otro": 120}.
    static func erroresLimite(_ donde: String, _ limite: Any?, _ datos: [String: Any]) -> [String] {
        let malo = ["\(donde): «limite» es obligatorio: segundos (1 a 3600), \"trabajo\" o {\"segun\": campo, \"valores\": {…}, \"otro\": …}"]
        guard let l = limite as? [String: Any] else { return limiteOk(limite) ? [] : malo }
        guard Set(l.keys).isSubset(of: ["segun", "valores", "otro"]), let segun = l["segun"] as? String,
              let regla = datos[segun] as? [String: Any], regla["tipo"] as? String == "enum",
              let permitidos = regla["valores"] as? [Any], let valores = l["valores"] as? [String: Any], limiteOk(l["otro"]),
              valores.allSatisfy({ k, v in permitidos.contains { ($0 as? String) == k } && limiteOk(v) }) else { return malo }
        return []
    }

    static func erroresRegla(_ donde: String, _ regla: Any, maximo: Int = maximoEntrada) -> [String] {
        guard let r = regla as? [String: Any], let tipo = r["tipo"] as? String, tipos.contains(tipo) else { return ["\(donde): tipo desconocido"] }
        var e: [String] = []
        switch tipo {
        case "texto":
            if !((Texto.entero(r["max"]).map { $0 > 0 && $0 <= maximo }) ?? false) { e.append("\(donde): un texto necesita «max»") }
        case "enum":
            let v = r["valores"] as? [Any] ?? []
            if v.isEmpty || !v.allSatisfy({ ($0 as? String).map { Texto.calza($0, "[\\w.-]+") } ?? false }) { e.append("\(donde): un enum necesita «valores» (textos simples)") }
        case "entero":
            for k in ["min", "max"] where r[k] != nil && Texto.entero(r[k]) == nil { e.append("\(donde): «min»/«max» son enteros") }
        case "base64":
            if !((Texto.entero(r["maxBytes"]).map { $0 > 0 && $0 <= maximo }) ?? false) { e.append("\(donde): base64 necesita «maxBytes»") }
        case "rutaRelativa":
            if let x = r["extensiones"], !((x as? [Any]).map { $0.allSatisfy { ($0 as? String).map { Texto.calza($0, "\\.\\w{1,10}") } ?? false } } ?? false) {
                e.append("\(donde): «extensiones» es una lista como [\".md\"]")
            }
        case "lista":
            if r["max"] != nil, !((Texto.entero(r["max"]).map { $0 > 0 && $0 <= 10000 }) ?? false) { e.append("\(donde): «max» de una lista es un entero") }
            if let de = r["de"] {
                if (de as? [String: Any])?["tipo"] as? String == "lista" { e.append("\(donde): una lista de listas no") } else { e += erroresRegla(donde + " (cada uno)", de, maximo: maximo) }
            }
        default: break
        }
        return e
    }

    // MARK: Validar lo que manda la interfaz

    public enum Validado {
        case ok([String: Any])
        case falla(campo: String, codigo: String)
    }

    /// Solo lo declarado, con su tipo. Un campo que va en args es obligatorio; los demás, solo si dicen "requerido".
    /// "*": "pasar" deja pasar el resto (el script valida todo). Lo de «inyectar» nunca viene de la interfaz.
    public static func validar(_ a: Accion, _ datos: [String: Any]) -> Validado {
        var entrada: [String: Any] = [:]
        let enArgs = Set(a.args.filter { $0.hasPrefix("$") }.map { String($0.dropFirst()) })
        for (c, r) in a.datos {
            let v = datos[c]
            if v == nil || v is NSNull {
                if enArgs.contains(c) || (Texto.esBool(r["requerido"]) && r["requerido"] as? Bool == true) { return .falla(campo: c, codigo: "falta") }
                continue
            }
            guard let x = valor(r, v!) else { return .falla(campo: c, codigo: "invalido") }
            entrada[c] = x
        }
        if a.pasarResto {
            for (k, v) in datos where a.datos[k] == nil && a.inyectar[k] == nil && Texto.calza(k, campo) && !prohibidos.contains(k) {
                entrada[k] = v
            }
        }
        guard JSONSerialization.isValidJSONObject(entrada), let d = try? JSONSerialization.data(withJSONObject: entrada) else {
            return .falla(campo: "*", codigo: "invalido")
        }
        if d.count > a.maximo { return .falla(campo: "*", codigo: "grande") }
        return .ok(entrada)
    }

    /// Los campos de «eco» que se pueden devolver aunque los datos no pasen: solo los que son válidos por sí solos (así la
    /// interfaz sabe a qué orden responde el error, y nunca vuelve algo que no calza con su regla).
    public static func ecoValido(_ a: Accion, _ datos: [String: Any]) -> [String: Any] {
        var r: [String: Any] = [:]
        for k in a.eco {
            guard let regla = a.datos[k], let v = datos[k], !(v is NSNull), let x = valor(regla, v) else { continue }
            r[k] = x
        }
        return r
    }

    public static func valor(_ r: [String: Any], _ v: Any) -> Any? {
        switch r["tipo"] as? String {
        case "texto":
            guard let s = v as? String, let max = Texto.entero(r["max"]) else { return nil }
            if s.count <= max { return s }
            return (Texto.esBool(r["recortar"]) && r["recortar"] as? Bool == true) ? String(s.prefix(max)) : nil
        case "enum":
            guard let s = v as? String, (r["valores"] as? [String] ?? []).contains(s) else { return nil }
            return s
        case "bool":
            return Texto.esBool(v) ? v : nil
        case "entero":
            guard let n = Texto.entero(v) else { return nil }
            if let min = Texto.entero(r["min"]), n < min { return nil }
            if let max = Texto.entero(r["max"]), n > max { return nil }
            return n
        case "rutaRelativa":
            guard let s = v as? String, esRelativa(s) else { return nil }
            if let ext = r["extensiones"] as? [String], !ext.contains(where: { s.lowercased().hasSuffix($0.lowercased()) }) { return nil }
            return s
        case "base64":
            guard let s = v as? String, let max = Texto.entero(r["maxBytes"]), s.count <= (max + 2) / 3 * 4 + 4,
                  let d = Data(base64Encoded: s), d.count <= max else { return nil }
            return s
        case "lista":
            guard let l = v as? [Any], l.count <= (Texto.entero(r["max"]) ?? 100) else { return nil }
            let de = r["de"] as? [String: Any] ?? ["tipo": "texto", "max": 2000]
            var salida: [Any] = []
            for x in l {
                guard let y = valor(de, x) else { return nil }
                salida.append(y)
            }
            return salida
        default:
            return nil
        }
    }

    /// Los argumentos: literales, o el valor de un campo enum/entero ya validado. Nada más.
    public static func armarArgs(_ a: Accion, _ entrada: [String: Any]) -> [String] {
        a.args.map { $0.hasPrefix("$") ? "\(entrada[String($0.dropFirst())] ?? "")" : $0 }
    }

    // MARK: Rutas que manda la interfaz (igual que nucleo.ruta_en)

    public static func esRelativa(_ s: String, maximo: Int = 400) -> Bool {
        guard !s.isEmpty, s.count <= maximo, !s.contains("\u{0}"), !s.hasPrefix("/"), !s.hasPrefix("\\"),
              !Texto.calza(String(s.prefix(2)), "[A-Za-z]:") else { return false }
        let partes = s.split(separator: "/", omittingEmptySubsequences: false).flatMap { $0.split(separator: "\\", omittingEmptySubsequences: false) }
        return partes.allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }

    /// La ruta absoluta de `relativa` dentro de `base`, o nil si se sale (absoluta, «..», enlaces hacia afuera). Si el archivo
    /// aún no existe, se revisa la carpeta que lo contendría.
    public static func dentro(_ base: URL, _ relativa: Any?, extensiones: [String]? = nil) -> URL? {
        guard let s = relativa as? String, esRelativa(s) else { return nil }
        if let extensiones, !extensiones.contains(where: { s.lowercased().hasSuffix($0.lowercased()) }) { return nil }
        let raiz = base.resolvingSymlinksInPath().standardizedFileURL.path
        let partes = s.split(separator: "/").flatMap { $0.split(separator: "\\") }.map(String.init)
        let unida = partes.reduce(URL(fileURLWithPath: raiz)) { $0.appendingPathComponent($1) }
        let real: URL
        if FileManager.default.fileExists(atPath: unida.path) {
            real = unida.resolvingSymlinksInPath().standardizedFileURL
        } else {
            real = unida.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL.appendingPathComponent(unida.lastPathComponent)
        }
        return real.path.hasPrefix(raiz + "/") ? real : nil
    }
}
