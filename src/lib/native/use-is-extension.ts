import { useEffect, useState } from "react";
import { isExtension } from "./platform";

/** Hydration-safe: false on first render, true after mount inside the extension. */
export function useIsExtension(): boolean {
  const [ext, setExt] = useState(false);
  useEffect(() => setExt(isExtension()), []);
  return ext;
}
