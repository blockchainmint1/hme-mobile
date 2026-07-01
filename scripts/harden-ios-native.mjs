import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const iosDir = resolve(root, "ios");
const infoPlistPath = resolve(root, "ios/App/App/Info.plist");
const iosGitignorePath = resolve(root, "ios/.gitignore");
const pbxprojPath = resolve(root, "ios/App/App.xcodeproj/project.pbxproj");

if (!existsSync(iosDir)) {
  console.log("iOS project not present; skipping native hardening.");
  process.exit(0);
}

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CAPACITOR_DEBUG</key>
	<string>$(CAPACITOR_DEBUG)</string>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleDisplayName</key>
	<string>HME Wallet</string>
	<key>CFBundleExecutable</key>
	<string>$(EXECUTABLE_NAME)</string>
	<key>CFBundleIdentifier</key>
	<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$(PRODUCT_NAME)</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>$(MARKETING_VERSION)</string>
	<key>CFBundleVersion</key>
	<string>$(CURRENT_PROJECT_VERSION)</string>
	<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleTypeRole</key>
			<string>Editor</string>
			<key>CFBundleURLName</key>
			<string>money.honest.txcwallet.nectar</string>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>nectar</string>
			</array>
		</dict>
	</array>
	<key>ITSAppUsesNonExemptEncryption</key>
	<false/>
	<key>LSRequiresIPhoneOS</key>
	<true/>
	<key>NSCameraUsageDescription</key>
	<string>HME Wallet uses the camera to scan wallet address and payment QR codes.</string>
	<key>NSFaceIDUsageDescription</key>
	<string>HME Wallet uses Face ID to unlock your wallet.</string>
	<key>UILaunchStoryboardName</key>
	<string>LaunchScreen</string>
	<key>UIMainStoryboardFile</key>
	<string>Main</string>
	<key>UIRequiredDeviceCapabilities</key>
	<array>
		<string>arm64</string>
	</array>
	<key>UISupportedInterfaceOrientations</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
	</array>
	<key>UISupportedInterfaceOrientations~ipad</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
		<string>UIInterfaceOrientationLandscapeLeft</string>
		<string>UIInterfaceOrientationLandscapeRight</string>
	</array>
	<key>UIViewControllerBasedStatusBarAppearance</key>
	<true/>
</dict>
</plist>
`;

await writeFile(infoPlistPath, infoPlist);

if (existsSync(iosGitignorePath)) {
  const current = await readFile(iosGitignorePath, "utf8");
  const next = current
    .split("\n")
    .filter((line) => line.trim() !== "App/App/capacitor.config.json")
    .join("\n")
    .replace(/\n*$/, "\n");
  await writeFile(iosGitignorePath, next);
}

if (existsSync(pbxprojPath)) {
  const pbx = await readFile(pbxprojPath, "utf8");
  const patched = pbx.replace(/TARGETED_DEVICE_FAMILY = "1,2";/g, 'TARGETED_DEVICE_FAMILY = "1";');
  if (patched !== pbx) await writeFile(pbxprojPath, patched);
}

console.log("Hardened iOS native shell for HME Wallet.");