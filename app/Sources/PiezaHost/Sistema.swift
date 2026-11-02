// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
import AppKit
import Security
import UserNotifications

/// Pieza «host-mac»: secretos en el Llavero (tokens, llaves de un conector): nunca en archivos, argumentos ni el entorno. Equivale
/// a `host.secretos(nombre)` de «host-escritorio».
///
///     let s = Secretos(servicio: "Ana · conexiones")      // o Secretos.deLaApp (servicio = el nombre de la app)
///     s.guardar("llave-123", cuenta: "banco")  ·  s.leer("banco")  ·  s.borrar("banco")
///
/// Un secreto llega a un script por la entrada estándar (`Procesador.conSecreto`), nunca de otra forma.
public struct Secretos: Sendable {
    public let servicio: String
    public init(servicio: String) { self.servicio = servicio }
    @MainActor public static var deLaApp: Secretos { Secretos(servicio: Host.nombre) }

    /// Siempre en el Mac (el Llavero de la persona).
    public var disponible: Bool { true }

    static func cuentaValida(_ c: String) -> Bool { Texto.calza(c, "[\\w.@-]{1,100}") }

    private func base(_ cuenta: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: servicio, kSecAttrAccount as String: cuenta]
    }

    @discardableResult
    public func guardar(_ valor: String, cuenta: String) -> Bool {
        guard Secretos.cuentaValida(cuenta), !valor.isEmpty, valor.utf8.count <= 100_000 else { return false }
        SecItemDelete(base(cuenta) as CFDictionary)
        var nuevo = base(cuenta)
        nuevo[kSecValueData as String] = Data(valor.utf8)
        // Solo en este Mac y con la sesión abierta (no viaja a iCloud ni a una copia de otro equipo).
        nuevo[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        return SecItemAdd(nuevo as CFDictionary, nil) == errSecSuccess
    }

    public func leer(_ cuenta: String) -> String? {
        guard Secretos.cuentaValida(cuenta) else { return nil }
        var q = base(cuenta)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var r: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &r) == errSecSuccess, let d = r as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    public func borrar(_ cuenta: String) {
        guard Secretos.cuentaValida(cuenta) else { return }
        SecItemDelete(base(cuenta) as CFDictionary)
    }
}

/// Pieza «host-mac»: avisos del sistema (Centro de notificaciones). Equivale a
/// `host.notificaciones` de «host-escritorio». El permiso lo pide la app cuando tiene sentido (al activar los avisos), nunca al
/// abrir; nada se muestra antes de elegir el idioma. Tocar un aviso abre la ventana y llama `alTocar(id)`.
///
///     Notificaciones.pedirPermiso { ok in … }
///     Notificaciones.mostrar(id: "pago", titulo: Idioma.t("Tienes un pago por vencer"), texto: "")
@MainActor
public enum Notificaciones {
    /// Cuando la persona toca un aviso (después de mostrar la ventana).
    public static var alTocar: (@MainActor (String) -> Void)?
    private static var delegado: Delegado?

    private static var centro: UNUserNotificationCenter? {
        // Sin paquete de app (una prueba, `swift run`) el centro no existe y pedirlo cerraría el programa.
        guard Bundle.main.bundleIdentifier != nil else { return nil }
        return UNUserNotificationCenter.current()
    }

    /// Deja al host atendiendo los toques (lo hace solo con `Host.Configuracion(avisos: true)` al arrancar).
    public static func preparar() {
        guard let c = centro, delegado == nil else { return }
        let d = Delegado()
        delegado = d
        c.delegate = d
    }

    public static func pedirPermiso(_ fin: @escaping @MainActor (Bool) -> Void) {
        guard let c = centro else { return fin(false) }
        preparar()
        c.requestAuthorization(options: [.alert, .sound]) { ok, _ in Task { @MainActor in fin(ok) } }
    }

    /// Un aviso ya. `id` (letras, números, «.», «-», «_») para quitarlo o saber cuál tocó la persona. false si no se pudo.
    @discardableResult
    public static func mostrar(id: String, titulo: String, texto: String = "", sonido: Bool = true) -> Bool {
        guard Idioma.elegido, Texto.calza(id, "[\\w.-]{1,60}"), !titulo.isEmpty, let c = centro else { return false }
        preparar()
        let contenido = UNMutableNotificationContent()
        contenido.title = String(titulo.prefix(200))
        contenido.body = String(texto.prefix(1000))
        if sonido { contenido.sound = .default }
        c.add(UNNotificationRequest(identifier: id, content: contenido, trigger: nil))
        return true
    }

    public static func quitar(_ id: String) {
        centro?.removeDeliveredNotifications(withIdentifiers: [id])
        centro?.removePendingNotificationRequests(withIdentifiers: [id])
    }

    final class Delegado: NSObject, UNUserNotificationCenterDelegate {
        /// Con la app adelante, el aviso se ve igual.
        func userNotificationCenter(_ centro: UNUserNotificationCenter, willPresent aviso: UNNotification,
                                    withCompletionHandler fin: @escaping (UNNotificationPresentationOptions) -> Void) {
            fin([.banner, .sound])
        }

        func userNotificationCenter(_ centro: UNUserNotificationCenter, didReceive respuesta: UNNotificationResponse,
                                    withCompletionHandler fin: @escaping () -> Void) {
            let id = respuesta.notification.request.identifier
            Task { @MainActor in
                Puente.shared.mostrar()
                Notificaciones.alTocar?(id)
            }
            fin()
        }
    }
}
