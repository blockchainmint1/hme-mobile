import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useHideSuspiciousActivity } from "@/lib/activity-prefs";

export function ActivityFilterSettings() {
  const [enabled, setEnabled] = useHideSuspiciousActivity();
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor="hide-suspicious-activity" className="text-sm font-medium">
        Hide suspicious activity
      </Label>
      <Switch id="hide-suspicious-activity" checked={enabled} onCheckedChange={setEnabled} />
    </div>
  );
}