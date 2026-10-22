import AVFoundation
import Speech

/// Dictado en español para el Gimnasio: escucha el micrófono, manda el texto parcial a la interfaz
/// y da la intervención por terminada tras un silencio corto (como en una conversación real).
@MainActor
final class Dictado {
    static let shared = Dictado()

    /// (texto, final, nivel 0–1, escuchando, error)
    var alCambiar: ((String, Bool, Double, Bool, String?) -> Void)?

    private let motor = AVAudioEngine()
    private var pedido: SFSpeechAudioBufferRecognitionRequest?
    private var tarea: SFSpeechRecognitionTask?
    private var reconocedor: SFSpeechRecognizer?
    private var ultimoTexto = ""
    private var ultimoCambio = Date()
    private var reloj: Timer?
    private var nivel = 0.0
    private(set) var activo = false
    private var termino = false
    /// Segundos de silencio (después de haber dicho algo) para dar por cerrada la intervención.
    var silencioFinal = 1.6

    func empezar() {
        guard !activo else { return }
        SFSpeechRecognizer.requestAuthorization { estado in
            Task { @MainActor in
                guard estado == .authorized else {
                    self.alCambiar?("", false, 0, false, "Falta el permiso de Reconocimiento de voz (Ajustes del Sistema › Privacidad y seguridad).")
                    return
                }
                AVCaptureDevice.requestAccess(for: .audio) { ok in
                    Task { @MainActor in
                        if ok { self.arrancar() } else { self.alCambiar?("", false, 0, false, "Falta el permiso de micrófono para Minuta.") }
                    }
                }
            }
        }
    }

    private func arrancar() {
        let opciones = ["es-CL", "es-419", "es-MX", "es-US", "es-ES"].compactMap { SFSpeechRecognizer(locale: Locale(identifier: $0)) }
        guard let r = opciones.first(where: { $0.isAvailable }) ?? opciones.first else {
            alCambiar?("", false, 0, false, "El reconocimiento de voz en español no está disponible en este Mac.")
            return
        }
        reconocedor = r
        let p = SFSpeechAudioBufferRecognitionRequest()
        p.shouldReportPartialResults = true
        p.taskHint = .dictation
        if #available(macOS 13, *) { p.addsPunctuation = true }
        if r.supportsOnDeviceRecognition { p.requiresOnDeviceRecognition = true }
        pedido = p
        ultimoTexto = ""; ultimoCambio = Date(); termino = false

        let entrada = motor.inputNode
        let formato = entrada.outputFormat(forBus: 0)
        entrada.removeTap(onBus: 0)
        entrada.installTap(onBus: 0, bufferSize: 1024, format: formato) { [weak self] buffer, _ in
            p.append(buffer)
            guard let canal = buffer.floatChannelData?[0] else { return }
            let n = Int(buffer.frameLength)
            var suma: Float = 0
            for i in 0..<n { suma += canal[i] * canal[i] }
            let rms = sqrt(suma / Float(max(n, 1)))
            let db = 20 * log10(max(rms, 0.000_01))
            let v = Double(max(0, min(1, (db + 55) / 40)))
            Task { @MainActor in self?.nivel = v }
        }
        motor.prepare()
        do { try motor.start() } catch {
            entrada.removeTap(onBus: 0)
            alCambiar?("", false, 0, false, "No pude abrir el micrófono: \(error.localizedDescription)")
            return
        }
        activo = true
        tarea = r.recognitionTask(with: p) { [weak self] resultado, error in
            let texto = resultado?.bestTranscription.formattedString
            let final = resultado?.isFinal ?? false
            Task { @MainActor in
                guard let self, self.activo || final else { return }
                if let texto, texto != self.ultimoTexto { self.ultimoTexto = texto; self.ultimoCambio = Date() }
                if final || (error != nil && !self.termino) { self.cerrar(final: true) }
            }
        }
        reloj = Timer.scheduledTimer(withTimeInterval: 0.12, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.activo else { return }
                self.alCambiar?(self.ultimoTexto, false, self.nivel, true, nil)
                // Dijo algo y luego se quedó callado: intervención lista.
                if !self.ultimoTexto.isEmpty, Date().timeIntervalSince(self.ultimoCambio) > self.silencioFinal, self.nivel < 0.35 {
                    self.cerrar(final: true)
                }
            }
        }
    }

    /// Termina la escucha. Con `final` envía el texto como intervención; sin él, solo silencia el micrófono.
    func cerrar(final: Bool) {
        guard activo else { return }
        activo = false; termino = true
        reloj?.invalidate(); reloj = nil
        motor.inputNode.removeTap(onBus: 0)
        motor.stop()
        pedido?.endAudio()
        tarea?.cancel()
        tarea = nil; pedido = nil
        alCambiar?(ultimoTexto, final, 0, false, nil)
    }
}
