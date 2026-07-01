/**
 * Icon-button address book picker. Opens a dialog listing contacts for
 * the given chain. Renders even when empty so users can jump to the
 * contacts screen.
 */
import { useEffect, useState } from "react";
import { BookUser, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { contactsForChain, type Contact, type ContactChain } from "@/lib/address-book";

export function AddressBookButton({
  chain,
  onPick,
}: {
  chain: ContactChain;
  onPick: (address: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Contact[]>([]);

  useEffect(() => {
    const load = () =>
      setItems(contactsForChain(chain).sort((a, b) => a.name.localeCompare(b.name)));
    load();
    window.addEventListener("hme:contacts-changed", load);
    return () => window.removeEventListener("hme:contacts-changed", load);
  }, [chain]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => setOpen(true)}
        title="Address book"
        aria-label="Address book"
      >
        <BookUser className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Address book</DialogTitle>
          </DialogHeader>
          {items.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No saved contacts for this chain yet.
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-border/60">
              {items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(c.address);
                      setOpen(false);
                    }}
                    className="w-full text-left py-3 hover:bg-accent rounded-md px-2"
                  >
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">
                      {c.address}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="pt-2 flex justify-end">
            <Button asChild variant="ghost" size="sm" onClick={() => setOpen(false)}>
              <Link to="/wallet/contacts">
                <Plus className="h-4 w-4 mr-1" /> Manage contacts
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
