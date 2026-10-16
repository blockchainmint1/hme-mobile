/** Shared compatibility API for existing feature callers; no store-specific exclusions. */
export function exchangeFeaturesAllowed(): boolean {
  return true;
}

export function useExchangeFeaturesAllowed(): boolean {
  return exchangeFeaturesAllowed();
}
