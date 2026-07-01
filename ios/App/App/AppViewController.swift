import Capacitor
import UIKit

/// Native entry point for the HME Wallet iOS shell.
///
/// We normally rely on `capacitor.config.json`, but recent debug builds kept
/// falling back to Capacitor's default `capacitor://localhost` URL even after
/// sync. Pinning the production URL here gives the archive a second, native
/// source of truth so the wallet loads the published mobile app reliably.
class AppViewController: CAPBridgeViewController {
    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        descriptor.serverURL = "https://mobile.honest.money"
        descriptor.urlScheme = "https"
        descriptor.urlHostname = "mobile.honest.money"
        descriptor.allowedNavigationHostnames = ["mobile.honest.money", "nectar-pay.com"]
        return descriptor
    }
}