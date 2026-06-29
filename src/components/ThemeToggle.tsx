import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const opts: { value: Theme; icon: typeof Sun; label: string }[] = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "system", icon: Monitor, label: "Auto" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-muted/40 p-1",
        className,
      )}
    >
      {opts.map((o) => {
        const Icon = o.icon;
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            onClick={() => setTheme(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ThemeIconButton({ className }: { className?: string }) {
  const { resolved, setTheme } = useTheme();
  const Icon = resolved === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}
      onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
