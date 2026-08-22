import { useCallback, useEffect, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";

const DEFAULT_DURATION = 2000;

export function useCopyFeedback(duration = DEFAULT_DURATION) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), duration);
    return () => clearTimeout(t);
  }, [copied, duration]);

  const copy = useCallback(
    async (text: string) => {
      const ok = await copyToClipboard(text);
      if (ok) setCopied(true);
      return ok;
    },
    [],
  );

  return { copied, copy };
}
