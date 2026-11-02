// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "Minuta",
    platforms: [.macOS("15.0")],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", from: "0.12.4"),
    ],
    targets: [
        .executableTarget(
            name: "Minuta",
            dependencies: ["PiezaCatalogo", "PiezaHost", "PiezaActualizaciones"],
            path: "Sources/Minuta"
        ),
        // Pieza «host-mac» de Pieza (no se edita aquí). Minuta usa de ella lo que calza con una app de barra de menú con ventana
        // propia: rutas y app.json (Host.configurar), el Procesador (límite de tiempo, entorno limpio, entrada por archivo), las
        // reglas de las acciones declaradas en acciones.json (Enchufe) y los secretos del Llavero (Secretos). Ver AGENTS.md.
        .target(
            name: "PiezaHost",
            path: "Sources/PiezaHost"
        ),
        // Pieza «actualizaciones» de Pieza (no se edita aquí): Releases con su .sha256 y la instalación de desarrollo (git pull +
        // empaquetar.sh). Minuta la configura con su repo y su nombre en AppModel.init.
        .target(
            name: "PiezaActualizaciones",
            path: "Sources/PiezaActualizaciones"
        ),
        // Pieza «catálogo» de Pieza (universos e idiomas de la comunidad, con huella SHA-256): su propio target, no se edita aquí.
        .target(
            name: "PiezaCatalogo",
            path: "Sources/PiezaCatalogo"
        ),
        // whisper.cpp oficial (framework para Apple, usa Metal). Misma versión que se probó con whisper-cli.
        .binaryTarget(
            name: "whisper",
            url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-v1.8.3-xcframework.zip",
            checksum: "a970006f256c8e689bc79e73f7fa7ddb8c1ed2703ad43ee48eb545b5bb6de6af"
        ),
        .executableTarget(
            name: "minuta-transcribir",
            dependencies: ["whisper"],
            path: "Sources/Transcribir",
            linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks",
                                           "-Xlinker", "-rpath", "-Xlinker", "@executable_path"])]
        ),
        .executableTarget(
            name: "minuta-diarizar",
            dependencies: [.product(name: "FluidAudio", package: "FluidAudio")],
            path: "Sources/Diarizar"
        ),
    ]
)
