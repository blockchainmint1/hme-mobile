/**
 * Animated QR display for Vault signing requests. Short payloads show a
 * single static QR; long ones cycle through HMQR2 frames (~700ms each),
 * matching HME Vault's scanner.
 */
import { useEffect, useMemo, useState } from "react";
import { QrCode } from "@/components/wallet/QrCode";
import { toParts } from "@/lib/vault-link/qr-parts";

export function VaultAnimatedQr({ text, size = 260 }: { text: string; size?: number }) {
  const parts = useMemo(() => toParts(text), [text]);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);
    if (parts.length <= 1) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % parts.length), 700);
    return () => clearInterval(t);
  }, [parts]);

  return (
    <div className="flex flex-col items-center gap-2">
      <QrCode value={parts[frame] ?? ""} size={size} />
      {parts.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Part {frame + 1} of {parts.length} — keep the Vault camera pointed here
        </p>
      )}
    </div>
  );
}
