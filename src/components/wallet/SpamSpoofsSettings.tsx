/**
 * "Spam & Spoofs" settings section: two independent, device-wide switches —
 * hide spam tokens from token lists, and hide spoof (fake look-alike)
 * transactions from activity. Both are recoverable; nothing is deleted.
 */
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useHideSuspiciousActivity } from "@/lib/activity-prefs";
import { useFeature } from "@/lib/feature-prefs";

export function SpamSpoofsSettings() {
  const [hideSpam, setHideSpam] = useFeature("hideSpamTokens");
  const [hideSpoofs, setHideSpoofs] = useHideSuspiciousActivity();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor="hide-spam-tokens" className="text-sm font-medium">
            Hide spam tokens
          </Label>
          <p className="text-xs text-muted-foreground">
            Fake or worthless tokens stay out of your token lists.
          </p>
        </div>
        <Switch id="hide-spam-tokens" checked={hideSpam} onCheckedChange={setHideSpam} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor="hide-suspicious-activity" className="text-sm font-medium">
            Hide spoof transactions
          </Label>
          <p className="text-xs text-muted-foreground">
            Fake look-alike transfers stay out of your activity history.
          </p>
        </div>
        <Switch
          id="hide-suspicious-activity"
          checked={hideSpoofs}
          onCheckedChange={setHideSpoofs}
        />
      </div>
    </div>
  );
}
