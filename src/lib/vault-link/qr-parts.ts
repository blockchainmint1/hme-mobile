/**
 * HMQR2 animated-QR framing — must stay byte-compatible with HME Vault's
 * src/lib/signer/qr-parts.ts. Long payloads (PSBTs, signed transactions) are
 * split into content-labelled chunks shown as a cycling QR; the receiver
 * collects parts until the transfer is complete. Legacy HMQR frames remain
 * readable.
 */
export const PART_SIZE = 600;
const MAX_TEXT = 3 * 1024 * 1024;
const MAX_PARTS = Math.ceil(MAX_TEXT / PART_SIZE);

export function toParts(text: string, size = PART_SIZE): string[] {
  if (text.length > MAX_TEXT || !Number.isInteger(size) || size < PART_SIZE || size > 2000)
    throw new Error("QR transfer is too large.");
  if (text.length <= size) return [text];
  // Stable content label prevents accidentally mixing two cycling transfers.
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  const tag = (hash >>> 0).toString(16).padStart(8, "0");
  const total = Math.ceil(text.length / size);
  return Array.from({ length: total }, (_, i) => `HMQR2:${tag}:${i + 1}/${total}:${text.slice(i * size, (i + 1) * size)}`);
}

export class PartCollector {
  private parts = new Map<number, string>();
  private total = 0;
  private tag = "";

  /** Returns the reassembled text when complete, null while parts are missing. */
  add(code: string): string | null {
    if (code.length > MAX_TEXT) throw new Error("Transfer is too large.");
    const modern = /^HMQR2:([a-f0-9]{8}):(\d+)\/(\d+):([\s\S]*)$/.exec(code);
    const legacy = /^HMQR:(\d+)\/(\d+):([\s\S]*)$/.exec(code);
    if (!modern && !legacy) {
      if (code.startsWith("HMQR")) throw new Error("Invalid QR part.");
      return code;
    }
    const n = Number(modern ? modern[2] : legacy?.[1]);
    const total = Number(modern ? modern[3] : legacy?.[2]);
    const chunk = modern ? modern[4] : legacy?.[3] ?? "";
    const tag = modern?.[1] ?? "legacy";
    if (!Number.isInteger(n) || n < 1 || n > total || total < 1 || total > MAX_PARTS || !chunk || chunk.length > 2000)
      throw new Error("Invalid QR part.");
    if (this.total && (this.total !== total || this.tag !== tag))
      throw new Error("Different transfer detected. Close the scanner and start again.");
    if (this.parts.has(n) && this.parts.get(n) !== chunk)
      throw new Error("Conflicting QR part. Start again.");
    this.total = total;
    this.tag = tag;
    this.parts.set(n, chunk);
    if (this.parts.size !== total) return null;
    const text = Array.from({ length: total }, (_, i) => this.parts.get(i + 1) ?? "").join("");
    if (text.length > MAX_TEXT) throw new Error("Transfer is too large.");
    if (modern && toParts(text)[0]?.split(":")[1] !== tag)
      throw new Error("QR transfer was damaged. Start again.");
    return text;
  }

  get progress() {
    return { have: this.parts.size, total: this.total };
  }
}
