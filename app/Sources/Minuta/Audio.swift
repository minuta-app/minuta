import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation

enum MinutaError: LocalizedError {
    case coreAudio(String, OSStatus)
    case formato(String)

    var errorDescription: String? {
        switch self {
        case .coreAudio(let paso, let status): return "Core Audio falló al \(paso) (código \(status))"
        case .formato(let msg): return msg
        }
    }
}

/// Graba el micrófono ("Yo") en un archivo .caf con el formato nativo del dispositivo.
final class MicRecorder {
    private let engine = AVAudioEngine()
    private var file: AVAudioFile?
    private let lock = NSLock()
    private(set) var firstBuffer: Date?

    func start(url: URL) throws {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw MinutaError.formato("No hay micrófono disponible")
        }
        file = try AVAudioFile(forWriting: url,
                               settings: format.settings,
                               commonFormat: format.commonFormat,
                               interleaved: format.isInterleaved)
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            self.lock.lock(); defer { self.lock.unlock() }
            if self.firstBuffer == nil { self.firstBuffer = Date() }
            try? self.file?.write(from: buffer)
            if let d = buffer.floatChannelData?[0] { CoachVivo.shared.nivel(yo: true, muestras: d, n: Int(buffer.frameLength)) }
        }
        engine.prepare()
        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        lock.lock(); file = nil; lock.unlock()
    }
}

/// Graba el audio del sistema ("Ellos") con un process tap de Core Audio (macOS 14.4+),
/// el mismo mecanismo que usan Granola y similares. No necesita drivers virtuales.
final class SystemAudioRecorder {
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private var file: AVAudioFile?
    private let queue = DispatchQueue(label: "cl.minuta.systemaudio", qos: .userInitiated)
    private let lock = NSLock()
    private(set) var firstBuffer: Date?

    func start(url: URL) throws {
        let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        description.uuid = UUID()
        description.name = "Minuta"
        description.isPrivate = true
        description.muteBehavior = .unmuted

        var status = AudioHardwareCreateProcessTap(description, &tapID)
        guard status == noErr else { throw MinutaError.coreAudio("crear el tap de audio", status) }

        let outputUID = try Self.defaultOutputDeviceUID()
        let aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Minuta-Tap",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceMainSubDeviceKey: outputUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
            kAudioAggregateDeviceTapListKey: [[
                kAudioSubTapDriftCompensationKey: true,
                kAudioSubTapUIDKey: description.uuid.uuidString,
            ]],
        ]
        status = AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &aggregateID)
        guard status == noErr else { throw MinutaError.coreAudio("crear el dispositivo agregado", status) }

        let asbd = try Self.tapFormat(tapID)
        let sampleRate = asbd.mSampleRate > 0 ? asbd.mSampleRate : 48000
        // Se escribe en mono Float32: el callback mezcla todos los canales que lleguen, sea cual sea su formato.
        guard let mono = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false) else {
            throw MinutaError.formato("Formato de audio del sistema no soportado")
        }
        file = try AVAudioFile(forWriting: url, settings: mono.settings, commonFormat: .pcmFormatFloat32, interleaved: false)

        status = AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateID, queue) { [weak self] _, inputData, _, _, _ in
            guard let self else { return }
            let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inputData))
            var frames = 0
            var canales = 0
            for b in buffers where b.mData != nil && b.mNumberChannels > 0 {
                frames = max(frames, Int(b.mDataByteSize) / MemoryLayout<Float32>.size / Int(b.mNumberChannels))
                canales += Int(b.mNumberChannels)
            }
            guard frames > 0, canales > 0,
                  let out = AVAudioPCMBuffer(pcmFormat: mono, frameCapacity: AVAudioFrameCount(frames)),
                  let destino = out.floatChannelData?[0] else { return }
            for i in 0..<frames { destino[i] = 0 }
            for b in buffers where b.mData != nil && b.mNumberChannels > 0 {
                let n = Int(b.mNumberChannels)
                let origen = b.mData!.assumingMemoryBound(to: Float32.self)
                let disponibles = Int(b.mDataByteSize) / MemoryLayout<Float32>.size / n
                for i in 0..<min(frames, disponibles) {
                    for c in 0..<n { destino[i] += origen[i * n + c] }
                }
            }
            let escala = 1 / Float32(canales)
            for i in 0..<frames { destino[i] *= escala }
            out.frameLength = AVAudioFrameCount(frames)
            self.lock.lock(); defer { self.lock.unlock() }
            if self.firstBuffer == nil { self.firstBuffer = Date() }
            try? self.file?.write(from: out)
            CoachVivo.shared.nivel(yo: false, muestras: destino, n: frames)
        }
        guard status == noErr else { throw MinutaError.coreAudio("registrar la captura", status) }

        status = AudioDeviceStart(aggregateID, procID)
        guard status == noErr else { throw MinutaError.coreAudio("iniciar la captura", status) }
    }

    func stop() {
        if aggregateID != kAudioObjectUnknown, let procID {
            AudioDeviceStop(aggregateID, procID)
            AudioDeviceDestroyIOProcID(aggregateID, procID)
        }
        procID = nil
        if aggregateID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = AudioObjectID(kAudioObjectUnknown)
        }
        if tapID != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = AudioObjectID(kAudioObjectUnknown)
        }
        lock.lock(); file = nil; lock.unlock()
    }

    private static func defaultOutputDeviceUID() throws -> String {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var device = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device)
        guard status == noErr else { throw MinutaError.coreAudio("leer la salida de audio", status) }

        address.mSelector = kAudioDevicePropertyDeviceUID
        var uid: Unmanaged<CFString>?
        size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        status = AudioObjectGetPropertyData(device, &address, 0, nil, &size, &uid)
        guard status == noErr, let uid else { throw MinutaError.coreAudio("leer el UID de la salida", status) }
        return uid.takeRetainedValue() as String
    }

    private static func tapFormat(_ tap: AudioObjectID) throws -> AudioStreamBasicDescription {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var asbd = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        let status = AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &asbd)
        guard status == noErr else { throw MinutaError.coreAudio("leer el formato del tap", status) }
        return asbd
    }
}

/// Detecta cuándo una app de reuniones empieza a usar el micrófono (APIs públicas de macOS 14.2+).
final class MeetingDetector {
    var onDetect: ((String) -> Void)?
    private var timer: Timer?
    private var activos: Set<String> = []

    static let lista: [(prefijo: String, nombre: String)] = [
        ("us.zoom", "Zoom"),
        ("com.microsoft.teams", "Microsoft Teams"),
        ("com.tinyspeck.slackmacgap", "Slack"),
        ("com.google.Chrome", "Chrome / Meet"),
        ("com.apple.Safari", "Safari / Meet"),
        ("com.apple.WebKit", "Safari / Meet"),
        ("company.thebrowser", "Arc / Meet"),
        ("com.microsoft.edgemac", "Edge / Meet"),
        ("com.brave.Browser", "Brave / Meet"),
        ("com.apple.FaceTime", "FaceTime"),
        ("com.apple.avconferenced", "FaceTime"),
        ("net.whatsapp.WhatsApp", "WhatsApp"),
        ("desktop.WhatsApp", "WhatsApp"),
        ("com.hnc.Discord", "Discord"),
        ("Cisco-Systems.Spark", "Webex"),
    ]

    var onFin: ((String) -> Void)?

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.revisar() }
    }

    /// Nombre amigable de la app de reuniones según su bundle (nil si no es una app de reuniones).
    static func nombre(de bundle: String) -> String? {
        MeetingDetector.lista.first(where: { bundle.hasPrefix($0.prefijo) })?.nombre
    }

    private func revisar() {
        let propio = Bundle.main.bundleIdentifier ?? ""
        let ahora = Set(Self.appsUsandoMicrofono().filter { $0 != propio })
        let nuevas = ahora.subtracting(activos)
        let terminadas = activos.subtracting(ahora)
        activos = ahora
        let nombresAhora = Set(ahora.compactMap(Self.nombre(de:)))
        for nombre in Set(terminadas.compactMap(Self.nombre(de:))) where !nombresAhora.contains(nombre) {
            onFin?(nombre)
        }
        if let nombre = nuevas.compactMap(Self.nombre(de:)).first {
            onDetect?(nombre)
        }
    }

    static func appsUsandoMicrofono() -> [String] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyProcessObjectList,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        let system = AudioObjectID(kAudioObjectSystemObject)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr, size > 0 else { return [] }
        var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(system, &address, 0, nil, &size, &ids) == noErr else { return [] }

        var resultado: [String] = []
        for id in ids {
            var running: UInt32 = 0
            var rSize = UInt32(MemoryLayout<UInt32>.size)
            var rAddr = AudioObjectPropertyAddress(
                mSelector: kAudioProcessPropertyIsRunningInput,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain)
            guard AudioObjectGetPropertyData(id, &rAddr, 0, nil, &rSize, &running) == noErr, running != 0 else { continue }

            var bAddr = AudioObjectPropertyAddress(
                mSelector: kAudioProcessPropertyBundleID,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain)
            var bundle: Unmanaged<CFString>?
            var bSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
            if AudioObjectGetPropertyData(id, &bAddr, 0, nil, &bSize, &bundle) == noErr, let bundle {
                resultado.append(bundle.takeRetainedValue() as String)
            }
        }
        return resultado
    }
}
