/**
 * Settings toggle: whether the wallet reminds the user to move TSD sitting on
 * derived addresses into the main balance. Nudge only — the wallet never
 * sweeps funds automatically.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useFeature } from "@/lib/feature-prefs";

export function TsdNudgeToggleCard({ compact }: { compact?: boolean }) {
  const [on, setOn] = useFeature("tsdConsolidateNudge");

  const body = (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor="tsd-nudge" className="text-sm">
          Nudge me to move TSD to my main balance
        </Label>
        <p className="text-xs text-muted-foreground">
          Show a reminder when TSD is sitting on other addresses in this wallet. Nothing moves
          unless you choose to consolidate.
        </p>
      </div>
      <Switch id="tsd-nudge" checked={on} onCheckedChange={setOn} />
    </div>
  );

  return (
    <Card className={compact ? "rounded-none border-0 bg-transparent shadow-none" : "mt-5"}>
      {!compact && (
        <CardHeader>
          <CardTitle>TSD reminders</CardTitle>
          <CardDescription>Control the consolidate reminder.</CardDescription>
        </CardHeader>
      )}
      <CardContent className={compact ? "p-0" : undefined}>{body}</CardContent>
    </Card>
  );
}
