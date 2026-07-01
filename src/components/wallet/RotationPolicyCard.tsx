import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { RefreshCw } from "lucide-react";
import {
  getRotationPolicy,
  setRotationPolicy,
  ROTATION_POLICY_LABELS,
  type RotationPolicy,
} from "@/lib/address-prefs";

const OPTIONS: RotationPolicy[] = ["on-receive", "on-load", "manual", "never"];

export function RotationPolicyCard() {
  const [policy, setPolicy] = useState<RotationPolicy>(() => getRotationPolicy());

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5" /> Receive address rotation
        </CardTitle>
        <CardDescription>
          How often the Receive screen shows a fresh address. Old addresses always keep working —
          your balance and history merge across every address this wallet has ever used.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RadioGroup
          value={policy}
          onValueChange={(v) => {
            const next = v as RotationPolicy;
            setPolicy(next);
            setRotationPolicy(next);
          }}
          className="space-y-3"
        >
          {OPTIONS.map((opt) => {
            const meta = ROTATION_POLICY_LABELS[opt];
            return (
              <div key={opt} className="flex items-start gap-3">
                <RadioGroupItem value={opt} id={`rot-${opt}`} className="mt-1" />
                <Label htmlFor={`rot-${opt}`} className="flex-1 cursor-pointer">
                  <div className="text-sm font-medium">{meta.title}</div>
                  <div className="text-xs text-muted-foreground">{meta.description}</div>
                </Label>
              </div>
            );
          })}
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
