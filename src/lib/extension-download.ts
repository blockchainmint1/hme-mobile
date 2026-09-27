/**
 * Shared helper for handing out the browser-extension package.
 *
 * The zip lives in public/ and is rebuilt by scripts/build-extension.mjs. A
 * plain <a href download> doesn't survive the preview host (static files sit
 * behind auth there), so we fetch the bytes and hand them over as a blob.
 * Used by both the landing page section and the site footer so the two can
 * never drift apart.
 */

export const EXTENSION_ZIP_PATH = "/hme-wallet-extension.zip";
export const EXTENSION_ZIP_NAME = "hme-wallet-extension.zip";

export function downloadExtensionZip() {
  fetch(EXTENSION_ZIP_PATH)
    .then((res) => {
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = EXTENSION_ZIP_NAME;
      a.click();
      URL.revokeObjectURL(url);
    })
    .catch((err) => alert(err instanceof Error ? err.message : String(err)));
}
