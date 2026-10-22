import FluidAudio
import Foundation

/// Separa las voces de una pista (quién habla cuándo) con el pipeline offline pyannote Community-1
/// de FluidAudio (CoreML, en el Mac). Uso: minuta-diarizar <audio.wav> <salida.json>
@main
struct Diarizar {
    static func main() async {
        let args = CommandLine.arguments
        guard args.count >= 3 else {
            fputs("uso: minuta-diarizar <audio.wav> <salida.json>\n", stderr)
            exit(2)
        }
        do {
            let manager = OfflineDiarizerManager(config: OfflineDiarizerConfig())
            try await manager.prepareModels()
            let samples = try AudioConverter().resampleAudioFile(path: args[1])
            let result = try await manager.process(audio: samples)
            let segmentos: [[String: Any]] = result.segments.map {
                ["hablante": "\($0.speakerId)",
                 "ini": Double($0.startTimeSeconds),
                 "fin": Double($0.endTimeSeconds)]
            }
            let data = try JSONSerialization.data(withJSONObject: segmentos, options: [.prettyPrinted])
            try data.write(to: URL(fileURLWithPath: args[2]))
            print("\(segmentos.count) segmentos, \(Set(segmentos.compactMap { $0["hablante"] as? String }).count) hablantes")
        } catch {
            fputs("error: \(error)\n", stderr)
            exit(1)
        }
    }
}
