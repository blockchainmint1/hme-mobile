import { Link } from "@tanstack/react-router";
import { ArrowLeft, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Shown in place of any swap / bridge screen on builds where exchange
 * features are disabled (iOS App Store build).
 */
export function ExchangeUnavailable({ title = "Not available" }: { title?: string }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <Link
        to="/wallet"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <h1 className="text-2xl font-semibold mb-4">{title}</h1>
      <Card>
        <CardContent className="pt-6 space-y-4">
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Swap and bridge features aren&apos;t offered in this version of the app.
              You can still send, receive and hold every supported coin.
            </span>
          </p>
          <Button asChild className="w-full" size="lg">
            <Link to="/wallet">Back to wallet</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
