import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-background/60 py-8 mt-12">
      <div className="mx-auto max-w-5xl px-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm text-muted-foreground">
        <p>
          Part of the{" "}
          <a
            href="https://honest.money"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            honest.money
          </a>{" "}
          ecosystem.
        </p>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link to="/manifesto" className="hover:text-foreground">
            Manifesto
          </Link>
          <Link to="/legal/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link to="/legal/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <a
            href="https://texitcoin.org/build"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            Build on TEXITcoin
          </a>
        </nav>
      </div>
    </footer>
  );
}
