// Polyfill Buffer globally for browser code that uses bitcoinjs-lib / bip32 / ecpair.
// SSR (Node / workerd with nodejs_compat) already has Buffer.
import { Buffer as BufferPolyfill } from "buffer";

if (typeof globalThis !== "undefined" && !(globalThis as { Buffer?: unknown }).Buffer) {
  (globalThis as { Buffer: typeof BufferPolyfill }).Buffer = BufferPolyfill;
}

export {};
