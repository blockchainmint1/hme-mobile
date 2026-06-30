// Polyfill Buffer globally for browser code that uses bitcoinjs-lib / bip32 / ecpair.
// Importing from `buffer/` forces the browser polyfill package instead of Vite's
// empty Node built-in shim for `buffer` in production builds.
import { Buffer as BufferPolyfill } from "buffer/";

if (typeof globalThis !== "undefined" && !(globalThis as { Buffer?: unknown }).Buffer) {
  (globalThis as unknown as { Buffer: typeof BufferPolyfill }).Buffer = BufferPolyfill;
}

export {};
