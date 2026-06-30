/**
 * Compact contact picker. Renders nothing if no contacts match the chain.
 */
import { useEffect, useState } from "react";
import { BookUser } from "lucide-react";
import { contactsForChain, type Contact, type ContactChain } from "@/lib/address-book";

export function ContactPicker({
  chain,
  onPick,
}: {
  chain: ContactChain;
  onPick: (address: string) => void;
}) {
  const [items, setItems] = useState<Contact[]>([]);

  useEffect(() => {
    const load = () => setItems(contactsForChain(chain).sort((a, b) => a.name.localeCompare(b.name)));
    load();
    window.addEventListener("hme:contacts-changed", load);
    return () => window.removeEventListener("hme:contacts-changed", load);
  }, [chain]);

  if (items.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <BookUser className="h-4 w-4 text-muted-foreground shrink-0" />
      <select
        aria-label="Pick from address book"
        defaultValue=""
        onChange={(e) => {
          const c = items.find((x) => x.id === e.target.value);
          if (c) onPick(c.address);
          e.currentTarget.value = "";
        }}
        className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="" disabled>
          Pick from address book…
        </option>
        {items.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
