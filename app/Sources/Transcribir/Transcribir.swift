import Foundation
import whisper

/// Transcriptor de Minuta para macOS: whisper.cpp (framework oficial, usa Metal) dentro de la app, sin Homebrew.
/// Acepta las mismas opciones que `whisper-cli` que usa bin/procesar.py, así en Windows y Linux se usa el whisper-cli
/// oficial de cada sistema sin cambiar nada más:
///   minuta-transcribir -m <modelo> -l <idioma|auto> -t <hilos> -f <audio.wav> -oj -of <salida sin .json>
///                      [-np] [-sns] [-mc <n>] [--prompt <texto>] [--vad -vm <modelo_vad>]
/// Escribe <salida>.json con {"transcription": [{"offsets": {"from": ms, "to": ms}, "text": "..."}]}.
@main
struct Transcribir {
    static func main() {
        var modelo = "", idioma = "auto", audio = "", salida = "", prompt = "", modeloVAD = ""
        var hilos: Int32 = 4, maxContexto: Int32 = -1, sinNoHabla = false, vad = false
        var args = Array(CommandLine.arguments.dropFirst())
        func siguiente() -> String { args.isEmpty ? "" : args.removeFirst() }
        while !args.isEmpty {
            switch siguiente() {
            case "-m": modelo = siguiente()
            case "-l": idioma = siguiente()
            case "-t": hilos = Int32(siguiente()) ?? 4
            case "-f": audio = siguiente()
            case "-of": salida = siguiente()
            case "-mc": maxContexto = Int32(siguiente()) ?? -1
            case "--prompt": prompt = siguiente()
            case "-vm": modeloVAD = siguiente()
            case "--vad": vad = true
            case "-sns": sinNoHabla = true
            case "-oj", "-np": break
            case let otro: fputs("opción desconocida: \(otro)\n", stderr)
            }
        }
        guard !modelo.isEmpty, !audio.isEmpty, !salida.isEmpty else {
            fputs("uso: minuta-transcribir -m modelo -f audio.wav -of salida [-l es] [-t 4] [--prompt …] [--vad -vm modelo]\n", stderr)
            exit(2)
        }
        guard let muestras = leerWAV(audio) else { fputs("no pude leer \(audio) (debe ser WAV 16 kHz mono PCM16)\n", stderr); exit(1) }

        whisper_log_set({ _, _, _ in }, nil)  // sin ruido en la consola
        var cparams = whisper_context_default_params()
        cparams.use_gpu = true
        cparams.flash_attn = true
        guard let ctx = whisper_init_from_file_with_params(modelo, cparams) else { fputs("no pude cargar el modelo \(modelo)\n", stderr); exit(1) }
        defer { whisper_free(ctx) }

        // Mismos valores por defecto que whisper-cli: búsqueda en haz de 5 y 5 candidatos.
        var p = whisper_full_default_params(WHISPER_SAMPLING_BEAM_SEARCH)
        p.n_threads = hilos
        p.beam_search.beam_size = 5
        p.greedy.best_of = 5
        p.print_progress = false
        p.print_realtime = false
        p.print_timestamps = false
        p.print_special = false
        p.suppress_nst = sinNoHabla
        if maxContexto >= 0 { p.n_max_text_ctx = maxContexto }
        let cIdioma = strdup(idioma), cPrompt = strdup(prompt), cVAD = strdup(modeloVAD)
        defer { free(cIdioma); free(cPrompt); free(cVAD) }
        p.language = UnsafePointer(cIdioma)
        p.detect_language = false
        if !prompt.isEmpty { p.initial_prompt = UnsafePointer(cPrompt) }
        if vad, !modeloVAD.isEmpty, FileManager.default.fileExists(atPath: modeloVAD) {
            p.vad = true
            p.vad_model_path = UnsafePointer(cVAD)
            p.vad_params = whisper_vad_default_params()
        }

        let r = muestras.withUnsafeBufferPointer { whisper_full(ctx, p, $0.baseAddress, Int32($0.count)) }
        guard r == 0 else { fputs("whisper falló (\(r))\n", stderr); exit(1) }

        var segmentos: [[String: Any]] = []
        for i in 0..<whisper_full_n_segments(ctx) {
            let texto = whisper_full_get_segment_text(ctx, i).map { String(cString: $0) } ?? ""
            // whisper entrega centésimas de segundo; el JSON de whisper-cli usa milisegundos.
            let desde = Int(whisper_full_get_segment_t0(ctx, i)) * 10, hasta = Int(whisper_full_get_segment_t1(ctx, i)) * 10
            segmentos.append(["offsets": ["from": desde, "to": hasta], "text": texto])
        }
        do {
            let data = try JSONSerialization.data(withJSONObject: ["transcription": segmentos], options: [.prettyPrinted])
            try data.write(to: URL(fileURLWithPath: salida + ".json"))
        } catch {
            fputs("no pude escribir la salida: \(error)\n", stderr)
            exit(1)
        }
    }

    /// Lee un WAV PCM 16 bits mono (como lo deja afconvert) y lo pasa a Float en [-1, 1].
    static func leerWAV(_ ruta: String) -> [Float]? {
        guard let d = FileManager.default.contents(atPath: ruta), d.count > 44,
              String(data: d[0..<4], encoding: .ascii) == "RIFF" else { return nil }
        var i = 12
        while i + 8 <= d.count {
            let id = String(data: d[i..<i + 4], encoding: .ascii) ?? ""
            let tam = Int(d[i + 4]) | Int(d[i + 5]) << 8 | Int(d[i + 6]) << 16 | Int(d[i + 7]) << 24
            if id == "data" {
                let ini = i + 8, fin = min(d.count, ini + tam)
                var salida = [Float](repeating: 0, count: (fin - ini) / 2)
                d.withUnsafeBytes { crudo in
                    for k in 0..<salida.count {
                        salida[k] = Float(Int16(littleEndian: crudo.loadUnaligned(fromByteOffset: ini + 2 * k, as: Int16.self))) / 32768
                    }
                }
                return salida
            }
            i += 8 + tam + (tam & 1)
        }
        return nil
    }
}
