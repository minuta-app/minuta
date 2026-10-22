import AppKit
import SwiftUI
import WebKit

// MARK: - Modelo de notas

struct Nota: Identifiable, Hashable {
    let url: URL
    let titulo: String
    let fecha: Date
    let tipo: String
    let duracionMin: Double
    let participantes: [String]
    let contenido: String
    let fm: [String: String]
    var id: URL { url }
}

@MainActor
final class NotasStore: ObservableObject {
    @Published var notas: [Nota] = []
    @Published var busqueda = ""

    let carpeta = Perfil.carpetaNotas

    var filtradas: [Nota] {
        let q = busqueda.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return notas }
        return notas.filter { $0.titulo.lowercased().contains(q) || $0.contenido.lowercased().contains(q) }
    }

    static func todasLasNotas() -> [Nota] {
        let carpeta = Perfil.carpetaNotas
        let archivos = (try? FileManager.default.contentsOfDirectory(at: carpeta, includingPropertiesForKeys: nil)) ?? []
        return archivos.filter { $0.pathExtension == "md" }.compactMap(leer)
    }

    func recargar() {
        let archivos = (try? FileManager.default.contentsOfDirectory(at: carpeta, includingPropertiesForKeys: nil)) ?? []
        notas = archivos
            .filter { $0.pathExtension == "md" }
            .compactMap(Self.leer)
            .sorted { $0.fecha > $1.fecha }
    }

    static func leer(_ url: URL) -> Nota? {
        guard let texto = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let (fm, cuerpo) = separarFrontmatter(texto)
        let titulo = cuerpo.split(separator: "\n").first(where: { $0.hasPrefix("# ") }).map { String($0.dropFirst(2)) }
            ?? url.deletingPathExtension().lastPathComponent
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm"
        let fecha = f.date(from: "\(fm["fecha"] ?? "") \(fm["hora"] ?? "00:00")")
            ?? ((try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date())
        let participantes = (fm["participantes"] ?? "")
            .trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: " \"")) }
            .filter { !$0.isEmpty }
        return Nota(url: url, titulo: titulo, fecha: fecha, tipo: fm["tipo"] ?? "",
                    duracionMin: Double(fm["duracion_min"] ?? "") ?? 0, participantes: participantes, contenido: cuerpo, fm: fm)
    }

    static func separarFrontmatter(_ texto: String) -> ([String: String], String) {
        guard texto.hasPrefix("---\n"), let fin = texto.range(of: "\n---\n", range: texto.index(texto.startIndex, offsetBy: 4)..<texto.endIndex)
        else { return ([:], texto) }
        var fm: [String: String] = [:]
        for linea in texto[texto.index(texto.startIndex, offsetBy: 4)..<fin.lowerBound].split(separator: "\n") {
            if let i = linea.firstIndex(of: ":") {
                fm[String(linea[..<i]).trimmingCharacters(in: .whitespaces)] =
                    String(linea[linea.index(after: i)...]).trimmingCharacters(in: .whitespaces)
            }
        }
        return (fm, String(texto[fin.upperBound...]))
    }
}

// MARK: - Markdown → HTML compacto

enum Render {
    static func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
    }

    static func inline(_ s: String) -> String {
        var t = esc(s)
        let reglas: [(String, String)] = [
            (#"\*\*(.+?)\*\*"#, "<strong>$1</strong>"),
            (#"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])"#, "<em>$1</em>"),
            (#"`([^`]+)`"#, "<code>$1</code>"),
            (#"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]"#, "$1"),
            (#"\[([^\]]+)\]\((https?://[^)\s]+)\)"#, "<a href=\"$2\">$1</a>"),
        ]
        for (patron, reemplazo) in reglas {
            t = t.replacingOccurrences(of: patron, with: reemplazo, options: .regularExpression)
        }
        return t
    }

    /// Convierte el subconjunto de markdown que generan las notas (títulos, listas anidadas,
    /// tareas, tablas, citas, párrafos) a HTML.
    static func html(_ md: String, claseTop: String? = nil) -> String {
        var out = ""
        var pilaListas: [Int] = []  // sangrías abiertas
        var parrafo: [String] = []
        var tabla: [String] = []
        let lineas = md.components(separatedBy: "\n")

        func cerrarParrafo() {
            if !parrafo.isEmpty { out += "<p>\(inline(parrafo.joined(separator: " ")))</p>"; parrafo = [] }
        }
        func cerrarListas(hasta nivel: Int = -1) {
            while let ultimo = pilaListas.last, ultimo > nivel { out += "</li></ul>"; pilaListas.removeLast() }
        }
        func cerrarTabla() {
            guard !tabla.isEmpty else { return }
            let filas = tabla.filter { !$0.replacingOccurrences(of: #"[\s|:\-]"#, with: "", options: .regularExpression).isEmpty }
            out += "<table>"
            for (i, fila) in filas.enumerated() {
                let celdas = fila.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "|"))
                    .components(separatedBy: "|").map { inline($0.trimmingCharacters(in: .whitespaces)) }
                let tag = i == 0 ? "th" : "td"
                out += "<tr>" + celdas.map { "<\(tag)>\($0)</\(tag)>" }.joined() + "</tr>"
            }
            out += "</table>"
            tabla = []
        }

        for cruda in lineas {
            let linea = cruda.replacingOccurrences(of: "\t", with: "    ")
            let recortada = linea.trimmingCharacters(in: .whitespaces)

            if recortada.hasPrefix("|") { cerrarParrafo(); cerrarListas(); tabla.append(recortada); continue }
            cerrarTabla()

            if recortada.isEmpty { cerrarParrafo(); continue }

            if let m = recortada.range(of: #"^#{1,6} "#, options: .regularExpression) {
                cerrarParrafo(); cerrarListas()
                let nivel = recortada[m].count - 1
                out += "<h\(nivel)>\(inline(String(recortada[m.upperBound...])))</h\(nivel)>"
                continue
            }

            if let m = linea.range(of: #"^(\s*)([-*+]|\d+\.)\s+"#, options: .regularExpression) {
                cerrarParrafo()
                let sangria = linea.prefix(while: { $0 == " " }).count
                var texto = String(linea[m.upperBound...])
                var clase = ""
                if texto.hasPrefix("[ ] ") { clase = " class=\"tarea\""; texto = "<span class=\"check\"></span>" + inline(String(texto.dropFirst(4))) }
                else if texto.lowercased().hasPrefix("[x] ") { clase = " class=\"tarea hecha\""; texto = "<span class=\"check\">✓</span>" + inline(String(texto.dropFirst(4))) }
                else { texto = inline(texto) }
                if let ultimo = pilaListas.last, sangria > ultimo {
                    out += "<ul>"; pilaListas.append(sangria)
                } else if pilaListas.isEmpty {
                    out += "<ul>"; pilaListas.append(sangria)
                } else {
                    cerrarListas(hasta: sangria)
                    if pilaListas.isEmpty { out += "<ul>"; pilaListas.append(sangria) } else { out += "</li>" }
                }
                if clase.isEmpty, pilaListas.count == 1, let claseTop { clase = " class=\"\(claseTop)\"" }
                out += "<li\(clase)>\(texto)"
                continue
            }

            if recortada.hasPrefix(">") {
                cerrarParrafo(); cerrarListas()
                out += "<blockquote>\(inline(String(recortada.drop(while: { $0 == ">" || $0 == " " }))))</blockquote>"
                continue
            }

            if !pilaListas.isEmpty && linea.hasPrefix("  ") {  // continuación de una viñeta
                out += " " + inline(recortada)
                continue
            }
            cerrarListas()
            parrafo.append(recortada)
        }
        cerrarParrafo(); cerrarListas(); cerrarTabla()
        return out
    }

    /// Cada sección "### " de las notas va en su propia tarjeta.
    static func tarjetasSecciones(_ md: String) -> String {
        var bloques: [[String]] = [[]]
        for linea in md.components(separatedBy: "\n") {
            if linea.hasPrefix("### ") || linea.hasPrefix("## ") { bloques.append([]) }
            bloques[bloques.count - 1].append(linea)
        }
        return bloques
            .map { $0.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .map { "<section class=\"card\">\(html($0))</section>" }
            .joined()
    }

    /// Divide la nota en: notas principales, feedback, métricas y transcripción.
    enum Vista: String, CaseIterable, Identifiable {
        case puntos = "Puntos"
        case feedback = "Feedback"
        case metricas = "Métricas"
        case transcripcion = "Transcripción"
        case logros = "Logros"
        var id: String { rawValue }
    }

    static func pagina(_ nota: Nota, vista: Vista, todas: [Nota] = [], tema: TemaJuego? = nil) -> String {
        if vista == .logros { return documento(panelLogros(todas: todas, tema: tema), tema: tema) }
        var cuerpo = nota.contenido
        if let r = cuerpo.range(of: #"^# .*\n"#, options: .regularExpression) { cuerpo.removeSubrange(r) }
        func seccion(_ titulo: String) -> (antes: String, contenido: String)? {
            guard let r = cuerpo.range(of: "\n## \(titulo)") ?? (cuerpo.hasPrefix("## \(titulo)") ? cuerpo.range(of: "## \(titulo)") : nil)
            else { return nil }
            let resto = cuerpo[r.upperBound...]
            let fin = resto.range(of: "\n## ")?.lowerBound ?? resto.endIndex
            let contenido = String(resto[resto.startIndex..<fin]).components(separatedBy: "\n").dropFirst().joined(separator: "\n")
            let antes = String(cuerpo[..<r.lowerBound]) + String(resto[fin...])
            return (antes, contenido)
        }
        var feedback = "", metricas = "", transcripcion = ""
        if let s = seccion("Transcripción") { transcripcion = s.contenido; cuerpo = s.antes }
        if let s = seccion("Métricas") { metricas = s.contenido; cuerpo = s.antes }
        if let s = seccion("Feedback para") { feedback = s.contenido; cuerpo = s.antes }

        let f = DateFormatter()
        f.locale = Locale(identifier: "es_CL")
        f.dateFormat = "EEEE d 'de' MMMM · HH:mm"
        var chips = ["<span>\(esc(f.string(from: nota.fecha)).capitalized(with: Locale(identifier: "es_CL")))</span>"]
        if nota.duracionMin > 0 { chips.append("<span>\(Int(nota.duracionMin.rounded())) min</span>") }
        if !nota.tipo.isEmpty { chips.append("<span class=\"tipo\">\(esc(nota.tipo))</span>") }
        if !nota.participantes.isEmpty { chips.append("<span>👥 \(esc(nota.participantes.joined(separator: ", ")))</span>") }

        var html = "<h1>\(esc(nota.titulo))</h1><div class=\"chips\">\(chips.joined())</div>"
        switch vista {
        case .puntos:
            html += "<article>\(tarjetasSecciones(cuerpo))</article>"
        case .feedback:
            html += feedback.isEmpty ? "<p class=\"vacio\">Esta reunión no tiene feedback.</p>"
                                     : "<article class=\"feedback\">\(Render.html(feedback, claseTop: "top"))</article>"
        case .metricas:
            html += panelTema(nota, todas: todas, tema: tema)
            if !metricas.isEmpty { html += "<div class=\"titulo-datos\">Datos de la conversación</div>" + tarjetas(metricas) }
        case .transcripcion, .logros:
            break
        }
        if vista != .transcripcion {
            // nada más que agregar
        } else if transcripcion.isEmpty {
            html += "<p class=\"vacio\">Esta reunión no tiene transcripción guardada.</p>"
        } else {
            var filas = ""
            for linea in transcripcion.components(separatedBy: "\n") {
                let l = linea.trimmingCharacters(in: CharacterSet(charactersIn: "> "))
                guard let m = l.range(of: #"^\[(\d{2}:\d{2}:\d{2})\] ([^:]+): "#, options: .regularExpression) else { continue }
                let cabecera = String(l[m]).dropFirst().dropLast(2)
                let partes = cabecera.components(separatedBy: "] ")
                let hora = partes.first ?? "", quien = partes.dropFirst().joined(separator: "] ")
                let clase = quien == "Yo" ? "yo" : "otro"
                filas += "<div class=\"turno\"><span class=\"hora\">\(esc(hora))</span><span class=\"quien \(clase)\">\(esc(quien))</span><span>\(esc(String(l[m.upperBound...])))</span></div>"
            }
            html += "<div class=\"turnos\">\(filas)</div>"
        }
        return documento(html, tema: tema)
    }

    /// Convierte la tabla de métricas en tarjetas: valor grande arriba, nombre abajo.
    static func tarjetas(_ md: String) -> String {
        var out = "<div class=\"tarjetas\">"
        for linea in md.components(separatedBy: "\n") where linea.hasPrefix("|") {
            let celdas = linea.trimmingCharacters(in: CharacterSet(charactersIn: "| ")).components(separatedBy: "|")
                .map { $0.trimmingCharacters(in: .whitespaces) }
            guard celdas.count >= 2, celdas[0] != "Métrica", !celdas[0].hasPrefix("---") else { continue }
            var valor = celdas[1], detalle = ""
            if let i = valor.firstIndex(of: "(") {  // "38% (0.4 min vs 0.6 min de los demás)"
                detalle = String(valor[i...]).trimmingCharacters(in: CharacterSet(charactersIn: "()"))
                valor = String(valor[..<i]).trimmingCharacters(in: .whitespaces)
            }
            let ancha = valor.count > 18 ? " ancha" : ""
            out += "<div class=\"tarjeta\(ancha)\"><div class=\"valor\">\(inline(valor))</div><div class=\"nombre\">\(esc(celdas[0]))</div>"
            if !detalle.isEmpty { out += "<div class=\"detalle\">\(esc(detalle))</div>" }
            out += "</div>"
        }
        return out + "</div>"
    }

}

// MARK: - Vistas

struct WebView: NSViewRepresentable {
    let html: String

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let web = WKWebView()
        web.navigationDelegate = context.coordinator
        web.setValue(false, forKey: "drawsBackground")
        return web
    }

    func updateNSView(_ web: WKWebView, context: Context) {
        if context.coordinator.ultimo != html {
            context.coordinator.ultimo = html
            web.loadHTMLString(html, baseURL: nil)
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var ultimo = ""
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if action.navigationType == .linkActivated, let url = action.request.url {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        }
    }
}

struct VisorView: View {
    @EnvironmentObject var model: AppModel
    @StateObject private var store = NotasStore()
    @State private var vista: Render.Vista = .puntos
    @State private var mostrarGaleria = false

    private var estilo: TemaJuego.Estilo? { model.temaActual?.estilo }

    private var seleccion: Binding<String?> {
        Binding(get: { model.notaSeleccionada?.path },
                set: { model.notaSeleccionada = $0.map { URL(fileURLWithPath: $0) } })
    }

    @State private var mostrarLateral = true
    @Namespace private var pestanas

    private var notaActual: Nota? {
        guard let ruta = model.notaSeleccionada?.path else { return nil }
        return store.notas.first { $0.url.path == ruta }
    }
    private var cTexto: Color { estilo?.cTexto ?? .primary }
    private var cSuave: Color { estilo?.cSuave ?? .secondary }
    private var rc: CGFloat { estilo?.radioControl ?? 10 }

    var body: some View {
        HStack(spacing: 0) {
            if mostrarLateral {
                barraLateral
                    .frame(width: 286)
                    .transition(.move(edge: .leading).combined(with: .opacity))
                Rectangle().fill(cTexto.opacity(0.08)).frame(width: 1).ignoresSafeArea()
            }
            VStack(spacing: 0) {
                barraSuperior
                Rectangle().fill(cTexto.opacity(0.08)).frame(height: 1)
                contenido
            }
        }
        .background(fondoVentana.ignoresSafeArea())
        .ignoresSafeArea(.container, edges: .top)
        .frame(minWidth: 920, minHeight: 600)
        .tint(estilo?.cAcento ?? .accentColor)
        .preferredColorScheme(estilo.map { $0.oscuro ? .dark : .light })
        .background(VentanaTematica(color: estilo?.fondo))
        .animation(.easeInOut(duration: 0.35), value: model.temaID)
        .sheet(isPresented: $mostrarGaleria) { GaleriaUniversos().environmentObject(model) }
        .background {
            // Atajos: ⌘1–⌘5 pestañas, ⌘U universo, ⌘\\ barra lateral
            Group {
                Button("") { vista = .puntos }.keyboardShortcut("1", modifiers: .command)
                Button("") { vista = .feedback }.keyboardShortcut("2", modifiers: .command)
                Button("") { vista = .metricas }.keyboardShortcut("3", modifiers: .command)
                Button("") { vista = .transcripcion }.keyboardShortcut("4", modifiers: .command)
                Button("") { vista = .logros }.keyboardShortcut("5", modifiers: .command)
                Button("") { mostrarGaleria = true }.keyboardShortcut("u", modifiers: .command)
                Button("") { withAnimation(.spring(duration: 0.3)) { mostrarLateral.toggle() } }.keyboardShortcut("\\", modifiers: .command)
            }
            .opacity(0)
            .allowsHitTesting(false)
        }
        .onAppear {
            store.recargar()
            if model.notaSeleccionada == nil || !store.notas.contains(where: { $0.url.path == model.notaSeleccionada?.path }) {
                model.notaSeleccionada = store.notas.first?.url
            }
        }
        .onChange(of: model.ultimaNota) { _, nueva in
            store.recargar()
            if let nueva { model.notaSeleccionada = nueva }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didBecomeKeyNotification)) { _ in store.recargar() }
    }

    // MARK: Piezas

    private var fondoVentana: some View {
        ZStack {
            LinearGradient(colors: [estilo?.cFondo ?? Color(nsColor: .windowBackgroundColor),
                                    estilo?.cFondo2 ?? Color(nsColor: .windowBackgroundColor)],
                           startPoint: .top, endPoint: .bottom)
            RadialGradient(colors: [(estilo?.cAcento ?? .clear).opacity(0.12), .clear], center: .topTrailing, startRadius: 10, endRadius: 700)
        }
    }

    private var barraLateral: some View {
        VStack(alignment: .leading, spacing: 10) {
            Color.clear.frame(height: 30)  // espacio para los botones de la ventana
            Button { mostrarGaleria = true } label: {
                NivelView(notas: store.notas, tema: model.temaActual)
            }
            .buttonStyle(.plain)
            .help("Tu nivel · clic para cambiar de universo (⌘U)")

            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass").font(.system(size: 12, weight: .semibold)).foregroundStyle(cSuave)
                TextField("Buscar en reuniones", text: $store.busqueda)
                    .textFieldStyle(.plain).font(.system(size: 13)).foregroundStyle(cTexto)
                if !store.busqueda.isEmpty {
                    Button { store.busqueda = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(cSuave) }
                        .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 8)
            .background(cTexto.opacity(0.07), in: RoundedRectangle(cornerRadius: rc, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: rc, style: .continuous).strokeBorder((estilo?.cAcento ?? .clear).opacity(store.busqueda.isEmpty ? 0.12 : 0.6)))

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 3, pinnedViews: [.sectionHeaders]) {
                    ForEach(grupos, id: \.0) { grupo in
                        Section {
                            ForEach(grupo.1) { nota in
                                FilaNota(nota: nota, estilo: estilo, elegida: model.notaSeleccionada?.path == nota.url.path, detalle: detalle(nota))
                                    .onTapGesture { withAnimation(.easeOut(duration: 0.15)) { model.notaSeleccionada = nota.url } }
                            }
                        } header: {
                            Text(grupo.0.uppercased())
                                .font(.system(size: 10, weight: .bold)).tracking(0.7)
                                .foregroundStyle(cSuave)
                                .padding(.horizontal, 6).padding(.top, 8).padding(.bottom, 4)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(estilo?.cFondo2.opacity(0.0) ?? .clear)
                        }
                    }
                }
                .padding(.bottom, 14)
            }
            .scrollIndicators(.never)
            .overlay {
                if store.notas.isEmpty {
                    VStack(spacing: 8) {
                        Text(model.temaActual?.emoji ?? "🎙️").font(.system(size: 34))
                        Text("Sin reuniones aún").font(.system(size: 13, weight: .semibold)).foregroundStyle(cTexto)
                        Text("Graba desde el ícono de la barra de menú.").font(.system(size: 11)).foregroundStyle(cSuave)
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .background(
            LinearGradient(colors: [(estilo?.cFondo2 ?? .clear).opacity(0.9), (estilo?.cFondo ?? .clear).opacity(0.9)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea())
    }

    private var barraSuperior: some View {
        HStack(spacing: 10) {
            if !mostrarLateral { Color.clear.frame(width: 64) }
            BotonTema(icono: "sidebar.left", ayuda: "Mostrar u ocultar la barra lateral (⌘\\)", estilo: estilo) {
                withAnimation(.spring(duration: 0.3)) { mostrarLateral.toggle() }
            }
            Text(notaActual?.titulo ?? "Minuta")
                .font(estilo?.fuenteTitulo(14) ?? .system(size: 14, weight: .bold))
                .foregroundStyle(cTexto)
                .lineLimit(1)
                .frame(maxWidth: 260, alignment: .leading)
            Spacer(minLength: 8)
            HStack(spacing: 2) {
                ForEach(Array(Render.Vista.allCases.enumerated()), id: \.element) { i, v in
                    Button { withAnimation(.spring(duration: 0.3)) { vista = v } } label: {
                        Text(estilo?.mayusculas == true ? v.rawValue.uppercased() : v.rawValue)
                            .font(estilo?.fuenteControl(12.5, activo: vista == v) ?? .system(size: 12.5, weight: vista == v ? .bold : .medium))
                            .tracking(estilo?.mayusculas == true ? 0.6 : 0)
                            .foregroundStyle(vista == v ? (estilo?.textoSobreAcento ?? .white) : cTexto.opacity(0.78))
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .background {
                                if vista == v {
                                    RoundedRectangle(cornerRadius: max(2, rc - 3), style: .continuous)
                                        .fill(LinearGradient(colors: [estilo?.cAcento ?? .accentColor, (estilo?.cAcento ?? .accentColor).opacity(0.85)],
                                                             startPoint: .top, endPoint: .bottom))
                                        .matchedGeometryEffect(id: "pestana", in: pestanas)
                                        .shadow(color: (estilo?.cAcento ?? .accentColor).opacity(0.35), radius: 6, y: 2)
                                }
                            }
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help("⌘\(i + 1)")
                }
            }
            .padding(3)
            .background(cTexto.opacity(0.07), in: RoundedRectangle(cornerRadius: rc, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: rc, style: .continuous).strokeBorder(cTexto.opacity(0.09)))
            Spacer(minLength: 8)
            BotonTema(icono: "sparkles", ayuda: "Elegir universo (⌘U)", estilo: estilo) { mostrarGaleria = true }
            if let nota = notaActual {
                BotonTema(icono: "doc.on.doc", ayuda: "Copiar lo que estás viendo", estilo: estilo) { copiar(nota) }
                BotonTema(icono: "arrow.up.forward.app", ayuda: "Abrir en Obsidian", estilo: estilo) { abrirEnObsidian(nota) }
                BotonTema(icono: "folder", ayuda: "Mostrar en Finder", estilo: estilo) { NSWorkspace.shared.activateFileViewerSelecting([nota.url]) }
            }
        }
        .padding(.leading, 14).padding(.trailing, 14)
        .padding(.top, 10)
        .frame(height: 54)
        .background((estilo?.cFondo ?? .clear).opacity(0.55))
    }

    @ViewBuilder private var contenido: some View {
        if let nota = notaActual {
            WebView(html: Render.pagina(nota, vista: vista, todas: store.notas, tema: model.temaActual))
        } else {
            VStack(spacing: 10) {
                Text(model.temaActual?.emoji ?? "📝").font(.system(size: 46))
                Text("Elige una reunión").font(estilo?.fuenteTitulo(20) ?? .title2).foregroundStyle(cTexto)
                Text("O graba una nueva desde la barra de menú.").foregroundStyle(cSuave)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var grupos: [(String, [Nota])] {
        let cal = Calendar.current
        let f = DateFormatter()
        f.locale = Locale(identifier: "es_CL")
        f.dateFormat = "EEEE d 'de' MMMM"
        var orden: [String] = []
        var mapa: [String: [Nota]] = [:]
        for nota in store.filtradas {
            let clave: String
            if cal.isDateInToday(nota.fecha) { clave = "Hoy" }
            else if cal.isDateInYesterday(nota.fecha) { clave = "Ayer" }
            else { clave = f.string(from: nota.fecha).capitalized(with: Locale(identifier: "es_CL")) }
            if mapa[clave] == nil { orden.append(clave) }
            mapa[clave, default: []].append(nota)
        }
        return orden.map { ($0, mapa[$0] ?? []) }
    }

    private func detalle(_ n: Nota) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        var partes = [f.string(from: n.fecha)]
        if n.duracionMin > 0 { partes.append("\(Int(n.duracionMin.rounded())) min") }
        if !n.tipo.isEmpty { partes.append(n.tipo) }
        return partes.joined(separator: " · ")
    }

    private func copiar(_ nota: Nota) {
        var texto = nota.contenido
        if vista == .transcripcion {
            if let r = texto.range(of: "## Transcripción") { texto = String(texto[r.upperBound...]) }
            texto = texto.components(separatedBy: "\n")
                .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "> ")) }
                .filter { $0.hasPrefix("[") }
                .joined(separator: "\n")
        } else if vista == .feedback || vista == .metricas {
            let titulo = vista == .feedback ? "## Feedback para \(Perfil.nombre.isEmpty ? "ti" : Perfil.nombre)" : "## Métricas"
            if let r = texto.range(of: titulo) {
                let resto = texto[r.upperBound...]
                texto = String(resto[..<(resto.range(of: "\n## ")?.lowerBound ?? resto.endIndex)])
            }
        } else if let r = texto.range(of: "\n## Feedback para") ?? texto.range(of: "\n## Métricas") {
            texto = String(texto[..<r.lowerBound])
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(texto.trimmingCharacters(in: .whitespacesAndNewlines), forType: .string)
    }

    private func abrirEnObsidian(_ nota: Nota) {
        var c = URLComponents()
        c.scheme = "obsidian"
        c.host = "open"
        c.queryItems = [URLQueryItem(name: "path", value: nota.url.path)]
        if let url = c.url, NSWorkspace.shared.urlForApplication(toOpen: url) != nil {
            NSWorkspace.shared.open(url)
        } else {
            NSWorkspace.shared.open(nota.url)
        }
    }
}


/// Fila de la barra lateral: punto de color por tipo, título y detalle.
struct FilaNota: View {
    let nota: Nota
    let estilo: TemaJuego.Estilo?
    let elegida: Bool
    let detalle: String

    private var colorTipo: Color {
        switch nota.tipo {
        case "Ventas": return .green
        case "Equipo": return .orange
        case "Personal": return .purple
        default: return .gray
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            RoundedRectangle(cornerRadius: 2).fill(colorTipo).frame(width: 4).padding(.vertical, 3)
            VStack(alignment: .leading, spacing: 3) {
                Text(nota.titulo).font(.system(size: 13, weight: .semibold)).lineLimit(2)
                    .foregroundStyle(elegida ? (estilo?.cTexto ?? .primary) : (estilo?.cTexto ?? .primary).opacity(0.92))
                Text(detalle).font(.system(size: 11)).foregroundStyle(estilo?.cSuave ?? .secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 7)
        .padding(.horizontal, 8)
        .background(
            RoundedRectangle(cornerRadius: estilo?.radioControl ?? 10, style: .continuous)
                .fill(elegida ? (estilo?.cAcento ?? .accentColor).opacity(0.22) : Color.clear))
        .overlay(RoundedRectangle(cornerRadius: estilo?.radioControl ?? 10, style: .continuous)
            .strokeBorder(elegida ? (estilo?.cAcento ?? .accentColor).opacity(0.55) : .clear))
        .contentShape(Rectangle())
    }
}


/// Botón redondo con los colores del universo.
struct BotonTema: View {
    let icono: String
    let ayuda: String
    let estilo: TemaJuego.Estilo?
    let accion: () -> Void
    @State private var encima = false

    var body: some View {
        Button(action: accion) {
            Image(systemName: icono)
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundStyle(estilo?.cTexto ?? .primary)
                .frame(width: 30, height: 30)
                .background((encima ? (estilo?.cAcento ?? .primary).opacity(0.22) : (estilo?.cTexto ?? .primary).opacity(0.06)),
                            in: RoundedRectangle(cornerRadius: estilo?.radioControl ?? 15, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: estilo?.radioControl ?? 15, style: .continuous).strokeBorder((estilo?.cTexto ?? .primary).opacity(0.08)))
        }
        .buttonStyle(.plain)
        .help(ayuda)
        .onHover { encima = $0 }
        .animation(.easeOut(duration: 0.12), value: encima)
    }
}

/// Pinta la ventana con el color del universo (sin franjas blancas ni barra de título del sistema).
struct VentanaTematica: NSViewRepresentable {
    let color: String?

    func makeNSView(context: Context) -> NSView { NSView() }

    func updateNSView(_ view: NSView, context: Context) {
        DispatchQueue.main.async {
            guard let w = view.window else { return }
            w.titlebarAppearsTransparent = true
            w.titleVisibility = .hidden
            w.styleMask.insert(.fullSizeContentView)
            w.isMovableByWindowBackground = true
            if let color {
                var v: UInt64 = 0
                Scanner(string: color.trimmingCharacters(in: CharacterSet(charactersIn: "#"))).scanHexInt64(&v)
                w.backgroundColor = NSColor(srgbRed: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255,
                                            blue: CGFloat(v & 0xFF) / 255, alpha: 1)
            }
        }
    }
}
