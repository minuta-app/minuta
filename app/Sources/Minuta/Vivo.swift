import AppKit
import Foundation

/// Coach en vivo: mientras grabas, estima con el volumen (sin transcribir, casi sin CPU) cuánto hablas tú,
/// cuánto llevas hablando de corrido y cuántas veces entras mientras otro habla. Es aproximado.
final class CoachVivo: @unchecked Sendable {
    static let shared = CoachVivo()
    private let lock = NSLock()
    private var nivelYo: Float = -90, nivelOtros: Float = -90
    private var pisoYo: Float = -60, pisoOtros: Float = -70

    // Estado (solo en el hilo principal)
    private var activo = false
    private var tYo = 0.0, tOtros = 0.0, racha = 0.0, silencioYo = 0.0, rachaMax = 0.0, otrosHace = 99.0
    private var interrupciones = 0, ultimaInterrupcion = Date.distantPast, yoAntes = false
    /// Cuánto lleva hablando la otra persona sin pausa, y el posible corte en evaluación.
    private var otrosRacha = 0.0, candidato: Double?, candidatoYo = 0.0
    private var avisoMonologo = false
    private var reloj: Timer?
    var alActualizar: (([String: Any]) -> Void)?
    var alMonologoLargo: ((Int) -> Void)?

    /// Se llama desde los hilos de audio con cada bloque de muestras.
    func nivel(yo: Bool, muestras: UnsafePointer<Float>, n: Int) {
        guard n > 0 else { return }
        var suma: Float = 0
        var i = 0
        while i < n { let v = muestras[i]; suma += v * v; i += 2 }
        let db = 10 * log10(max(1e-9, suma / Float((n + 1) / 2)))
        lock.lock()
        if yo { nivelYo = max(db, nivelYo * 0.6 + db * 0.4) } else { nivelOtros = max(db, nivelOtros * 0.6 + db * 0.4) }
        lock.unlock()
    }

    @MainActor func empezar() {
        activo = true
        tYo = 0; tOtros = 0; racha = 0; silencioYo = 0; rachaMax = 0; otrosHace = 99; interrupciones = 0; yoAntes = false; avisoMonologo = false
        otrosRacha = 0; candidato = nil; candidatoYo = 0
        lock.lock(); nivelYo = -90; nivelOtros = -90; pisoYo = -60; pisoOtros = -70; lock.unlock()
        reloj?.invalidate()
        reloj = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.paso(0.25) }
        }
    }

    @MainActor func detener() {
        activo = false
        reloj?.invalidate(); reloj = nil
    }

    @MainActor private func paso(_ dt: Double) {
        guard activo else { return }
        lock.lock()
        let y = nivelYo, o = nivelOtros
        nivelYo -= 6; nivelOtros -= 6   // decae si no llegan bloques
        // piso de ruido: baja rápido, sube muy lento
        pisoYo = y < pisoYo ? y : pisoYo + 0.02
        pisoOtros = o < pisoOtros ? o : pisoOtros + 0.02
        let pY = pisoYo, pO = pisoOtros
        lock.unlock()

        let otros = o > max(pO + 12, -55)
        // Sin audífonos el micrófono también capta a los demás: si ellos hablan, exige más volumen para contarte a ti.
        let yo = y > max(pY + (otros ? 22 : 12), -50)
        if otros { tOtros += dt; otrosHace = 0; otrosRacha += dt } else { otrosHace += dt; if otrosHace > 0.6 { otrosRacha = 0 } }
        // Interrupción = le quitas la palabra a alguien: entras mientras habla (llevaba ≥1 s), sigues ≥1,5 s
        // y la otra persona se calla. Un "sí/ya" corto o hablar encima sin que el otro pare no cuenta.
        if yo, !yoAntes, candidato == nil, otrosHace < 0.3, otrosRacha >= 1.0 { candidato = 0; candidatoYo = 0 }
        if let c = candidato {
            let t = c + dt
            candidato = t
            if yo { candidatoYo += dt }
            if candidatoYo >= 1.5, otrosHace >= 0.6, Date().timeIntervalSince(ultimaInterrupcion) > 6 {
                interrupciones += 1; ultimaInterrupcion = Date(); candidato = nil
            } else if t > 4 || (!yo && candidatoYo < 1.5 && silencioYo > 0.8) {
                candidato = nil
            }
        }
        if yo {
            tYo += dt; racha += dt; silencioYo = 0
            rachaMax = max(rachaMax, racha)
        } else {
            silencioYo += dt
            if silencioYo > 1.5 { racha = 0; avisoMonologo = false }
        }
        yoAntes = yo
        if racha >= 90, !avisoMonologo { avisoMonologo = true; alMonologoLargo?(Int(racha)) }
        let total = tYo + tOtros
        alActualizar?(["pct": total > 20 ? Int((tYo / total * 100).rounded()) : -1, "racha": Int(racha), "rachaMax": Int(rachaMax),
                       "interrupciones": interrupciones, "hablandoAhora": yo, "otrosAhora": otros])
    }
}
