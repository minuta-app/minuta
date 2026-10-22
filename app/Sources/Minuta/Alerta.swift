import AppKit
import SwiftUI

/// Alerta flotante propia de Minuta (estilo Granola): aparece arriba a la derecha, sobre cualquier app
/// —también en pantalla completa—, no depende de los permisos de notificaciones y un clic basta.
@MainActor
final class AlertaFlotante {
    static let shared = AlertaFlotante()

    enum Tipo { case reunion, fin, listo, logro }

    private var panel: NSPanel?
    private var cierre: Task<Void, Never>?
    private(set) var tipo: Tipo?

    struct Datos {
        var tipo: Tipo
        var titulo: String
        var detalle: String
        var principal: String
        var secundario: String
        var desde: Date?
        var alPrincipal: () -> Void
        var alSecundario: () -> Void
        /// Emoji grande en vez del ícono (logros, rangos).
        var emoji: String? = nil
    }

    func mostrar(_ d: Datos, estilo: TemaJuego.Estilo?, duracion: Double? = nil) {
        ocultar(animado: false)
        tipo = d.tipo
        var datos = d
        let principal = d.alPrincipal, secundario = d.alSecundario
        datos.alPrincipal = { [weak self] in self?.ocultar(); principal() }
        datos.alSecundario = { [weak self] in self?.ocultar(); secundario() }

        let vista = TarjetaAlerta(d: datos, e: PaletaAlerta(estilo), cerrar: { [weak self] in self?.ocultar(); secundario() })
        let host = HostPrimerClic(rootView: vista)
        host.frame = NSRect(x: 0, y: 0, width: 372, height: 10)
        let alto = ceil(host.fittingSize.height)
        host.sizingOptions = []   // que el panel no se agrande solo y se salga de la pantalla
        host.frame = NSRect(x: 0, y: 0, width: 372, height: alto)
        let p = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 372, height: alto),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.isFloatingPanel = true
        p.level = .statusBar
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        p.backgroundColor = .clear
        p.isOpaque = false
        p.hasShadow = true
        p.hidesOnDeactivate = false
        p.isMovableByWindowBackground = false
        p.contentView = host

        let pantalla = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens[0]
        let v = pantalla.visibleFrame
        let destino = NSPoint(x: v.maxX - 372 - 14, y: v.maxY - alto - 10)
        p.setFrameOrigin(NSPoint(x: destino.x + 24, y: destino.y))  // entra deslizándose desde la derecha
        p.alphaValue = 0
        p.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.28
            ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
            p.animator().alphaValue = 1
            p.animator().setFrame(NSRect(origin: destino, size: p.frame.size), display: true)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { if p.frame.origin != destino { p.setFrameOrigin(destino) } }
        panel = p
        NSSound(named: d.tipo == .reunion ? "Glass" : d.tipo == .logro ? "Hero" : "Pop")?.play()
        if let duracion {
            cierre = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(duracion))
                guard !Task.isCancelled else { return }
                self?.ocultar()
            }
        }
    }

    func ocultar(_ solo: Tipo? = nil, animado: Bool = true) {
        if let solo, tipo != solo { return }
        cierre?.cancel(); cierre = nil
        guard let p = panel else { return }
        panel = nil; tipo = nil
        guard animado else { p.orderOut(nil); return }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.2
            p.animator().alphaValue = 0
            p.animator().setFrame(p.frame.offsetBy(dx: 18, dy: 0), display: true)
        }, completionHandler: { p.orderOut(nil) })
    }
}

/// El primer clic sobre la alerta funciona aunque Minuta no sea la app activa.
private final class HostPrimerClic<V: View>: NSHostingView<V> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

private struct PaletaAlerta {
    let fondo: Color, panel: Color, texto: Color, suave: Color, linea: Color, acento: Color, acentoTexto: Color, radio: CGFloat, oscuro: Bool
    init(_ e: TemaJuego.Estilo?) {
        guard let e else {
            fondo = Color(hex: "#1c1c1f"); panel = Color(hex: "#2a2a2e"); texto = .white; suave = Color(hex: "#a1a1aa")
            linea = Color(hex: "#3a3a40"); acento = Color(hex: "#ef4444"); acentoTexto = .white; radio = 16; oscuro = true
            return
        }
        fondo = Color(hex: e.fondo); panel = Color(hex: e.panel); texto = Color(hex: e.texto); suave = Color(hex: e.suave)
        linea = Color(hex: e.linea); acento = Color(hex: e.acento)
        acentoTexto = Self.luminancia(e.acento) > 0.55 ? Color(hex: "#111111") : .white
        radio = CGFloat(min(max(e.radio, 6), 20)); oscuro = e.oscuro
    }
}

extension PaletaAlerta {
    /// Texto legible sobre el color de acento (claro → texto oscuro).
    static func luminancia(_ hex: String) -> Double {
        let h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard h.count >= 6, let v = UInt32(h.prefix(6), radix: 16) else { return 0 }
        let r = Double((v >> 16) & 0xff) / 255, g = Double((v >> 8) & 0xff) / 255, b = Double(v & 0xff) / 255
        return 0.299 * r + 0.587 * g + 0.114 * b
    }
}

private struct TarjetaAlerta: View {
    let d: AlertaFlotante.Datos
    let e: PaletaAlerta
    let cerrar: () -> Void
    @State private var pulso = false
    @State private var sobre = false

    private var cabecera: String {
        switch d.tipo {
        case .reunion: Idioma.t("MINUTA · REUNIÓN DETECTADA")
        case .fin: Idioma.t("MINUTA · ¿TERMINÓ LA REUNIÓN?")
        case .listo: Idioma.t("MINUTA · NOTAS LISTAS")
        case .logro: Idioma.t("MINUTA · ¡RECOMPENSA!")
        }
    }
    private var icono: String {
        switch d.tipo {
        case .reunion: "waveform"
        case .fin: "stop.circle"
        case .listo: "doc.text"
        case .logro: "trophy.fill"
        }
    }
    private var iconoBoton: String {
        switch d.tipo {
        case .reunion: "record.circle.fill"
        case .fin: "stop.fill"
        case .listo: "arrow.up.right"
        case .logro: "gift.fill"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 11) {
                ZStack {
                    Circle().fill(e.acento.opacity(0.18)).frame(width: 38, height: 38)
                        .scaleEffect(pulso ? 1.18 : 0.92).opacity(pulso ? 0.35 : 1)
                    if let emoji = d.emoji {
                        Text(emoji).font(.system(size: 21))
                            .rotationEffect(.degrees(pulso ? 8 : -8)).scaleEffect(pulso ? 1.12 : 0.96)
                    } else {
                        Image(systemName: icono).font(.system(size: 17, weight: .semibold)).foregroundStyle(e.acento)
                    }
                }
                .frame(width: 38, height: 38)
                VStack(alignment: .leading, spacing: 3) {
                    Text(cabecera)
                        .font(.system(size: 9.5, weight: .bold)).tracking(0.6).foregroundStyle(e.suave)
                    Text(d.titulo).font(.system(size: 14, weight: .semibold)).foregroundStyle(e.texto)
                        .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    if let desde = d.desde {
                        HStack(spacing: 4) {
                            Circle().fill(Color.red).frame(width: 6, height: 6)
                            Text(desde, style: .timer).monospacedDigit()
                            Text("· " + Idioma.t(d.detalle)).lineLimit(2)
                        }
                        .font(.system(size: 12)).foregroundStyle(e.suave)
                    } else {
                        Text(Idioma.t(d.detalle)).font(.system(size: 12)).foregroundStyle(e.suave).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
                Button(action: cerrar) {
                    Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundStyle(e.suave)
                        .frame(width: 22, height: 22).background(Circle().fill(e.panel.opacity(sobre ? 1 : 0)))
                }
                .buttonStyle(.plain).help(Idioma.t("Cerrar"))
            }
            HStack(spacing: 8) {
                Button(action: d.alPrincipal) {
                    HStack(spacing: 6) {
                        Image(systemName: iconoBoton).font(.system(size: 12, weight: .bold))
                        Text(Idioma.t(d.principal)).font(.system(size: 13, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 9)
                    .foregroundStyle(e.acentoTexto)
                    .background(RoundedRectangle(cornerRadius: e.radio * 0.6).fill(e.acento))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.defaultAction)
                Button(action: d.alSecundario) {
                    Text(Idioma.t(d.secundario)).font(.system(size: 13, weight: .medium)).foregroundStyle(e.texto)
                        .padding(.vertical, 9).padding(.horizontal, 14)
                        .background(RoundedRectangle(cornerRadius: e.radio * 0.6).fill(e.panel))
                        .overlay(RoundedRectangle(cornerRadius: e.radio * 0.6).stroke(e.linea, lineWidth: 1))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        .frame(width: 372, alignment: .leading)
        .fixedSize(horizontal: true, vertical: true)
        .background(RoundedRectangle(cornerRadius: e.radio, style: .continuous).fill(e.fondo))
        .overlay(RoundedRectangle(cornerRadius: e.radio, style: .continuous).stroke(e.linea, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: e.radio, style: .continuous))
        .onHover { sobre = $0 }
        .onAppear { withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { pulso = true } }
        .environment(\.colorScheme, e.oscuro ? .dark : .light)
    }
}
