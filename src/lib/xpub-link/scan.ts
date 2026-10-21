import { parseLinkInput } from "@/lib/nectar/link";
import { parseTsdLinkInput } from "@/lib/rewards/tsd-link";

/** Recognition only: the link page still validates the manifest and asks for approval. */
export function ecosystemLinkScanPayload(raw: string): string | null {
  return parseTsdLinkInput(raw) ?? parseLinkInput(raw);
}