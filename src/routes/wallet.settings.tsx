import { useIsExtension } from "@/lib/native/use-is-extension";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  BookUser,
  ChevronRight,
  Palette,
  ShieldCheck,
  Wallet,
  Layers,
  Coins,
  RefreshCw,
  Sparkles,
  PenLine,
  ArrowDownUp,
  RotateCw,
  KeyRound,
  AlertTriangle,
  Link2,
  ScrollText,
  ArrowLeftRight,
  Smartphone,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ChainsCard } from "@/components/wallet/ChainsCard";
import { TokensCard } from "@/components/wallet/TokensCard";
import { TxcTokensCard } from "@/components/wallet/TxcTokensCard";
import { RotationPolicyCard } from "@/components/wallet/RotationPolicyCard";
import { DeepRescanCard } from "@/components/wallet/DeepRescanCard";
import { FeaturesCard } from "@/components/wallet/FeaturesCard";
import { SecurityCheckupCard } from "@/components/wallet/SecurityCheckupCard";
import { SignMessageCard } from "@/components/wallet/SignMessageCard";
import { EcosystemLinksCard } from "@/components/wallet/EcosystemLinksCard";
import { HmeProfileCard } from "@/components/wallet/HmeProfileCard";

import { UpdateCheckCard } from "@/components/wallet/UpdateCheckCard";
import { TsdCashoutKeyCard } from "@/components/wallet/TsdCashoutKeyCard";
import { TsdNudgeToggleCard } from "@/components/wallet/TsdNudgeToggleCard";
import { AddSeedCard } from "@/components/wallet/AddSeedCard";
import { ProfilesCard } from "@/components/wallet/ProfilesCard";
import { useFeature } from "@/lib/feature-prefs";
import { DELEGATE_LINKS_EVENT, listDelegateLinks } from "@/lib/xpub-link/delegate";
import { useWallet } from "@/lib/txc/wallet-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { disableBiometric } from "@/lib/native/biometric";

export const Route = createFileRoute("/wallet/settings")({
  head: () => ({ meta: [{ title: "Settings — HME Wallet" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const isExt = useIsExtension();
  const { unlocked, forget, profiles, activeProfileId } = useWallet();
  const keyOnly = unlocked?.mode === "keyonly";
  const activeLabel =
    profiles.find((p) => p.id === activeProfileId)?.label ?? "this wallet";

  // Trading pocket (Seeds) only appears once a trading link actually exists.
  const [sharedOn] = useFeature("sharedWallets");
  const [tradingLinks, setTradingLinks] = useState(0);
  useEffect(() => {
    const h = () => setTradingLinks(listDelegateLinks().length);
    h();
    window.addEventListener(DELEGATE_LINKS_EVENT, h);
    return () => window.removeEventListener(DELEGATE_LINKS_EVENT, h);
  }, []);

  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState("");

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <Link to="/wallet" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Settings</h1>

      {/* ---------- This device: app-wide settings, shared by every wallet ---------- */}
      <GroupLabel
        icon={Smartphone}
        title="This device"
        description="Applies to every wallet on this device."
      />
      <Accordion type="multiple" className="mt-3 space-y-3">
        <SettingsSection
          value="appearance"
          icon={Palette}
          title="Appearance"
          description="Light, dark, or follow your system."
        >
          <ThemeToggle />
        </SettingsSection>

        {!keyOnly && (
          <>
            <SettingsSection
              value="chains"
              icon={Layers}
              title="Chains"
              description="Turn chains on or off — shared by all your wallets."
            >
              <ChainsCard compact />
            </SettingsSection>

            <SettingsSection
              value="tokens"
              icon={Coins}
              title="Tokens"
              description="Choose which EVM tokens to show — shared by all your wallets."
            >
              <TokensCard compact />
            </SettingsSection>

            <SettingsSection
              value="txc-tokens"
              icon={Coins}
              title="TXC tokens (Omni)"
              description="Toggle Omni Layer tokens under TXC."
            >
              <TxcTokensCard compact />
            </SettingsSection>
          </>
        )}

        <SettingsSection
          value="updates"
          icon={RotateCw}
          title="Updates"
          description="Check for new app versions."
        >
          {!isExt && <UpdateCheckCard compact />}
        </SettingsSection>

        <Link to="/wallet/contacts" className="block">
          <Card className="hover:bg-accent/30 transition-colors">
            <CardContent className="py-4 flex items-center gap-3">
              <BookUser className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-base font-semibold">Address book</div>
                <div className="text-xs text-muted-foreground">
                  Save names for addresses you send to most.
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>

        <SettingsSection
          value="hme-profile"
          icon={Link2}
          title="Honest Money profile"
          description="Optional: link your member account so your referrer gets credit."
        >
          <HmeProfileCard />
        </SettingsSection>
      </Accordion>

      {/* ---------- This wallet: settings tied to the active wallet's keys ---------- */}
      <GroupLabel
        icon={Wallet}
        title={`This wallet — ${activeLabel}`}
        description="Only affects the wallet you're currently using."
      />
      <Accordion type="multiple" className="mt-3 space-y-3">
        <SettingsSection
          value="security"
          icon={ShieldCheck}
          title="Security checkup"
          description="A quick self-test of this device."
        >
          <SecurityCheckupCard compact />
        </SettingsSection>

        <SettingsSection
          value="wallets"
          icon={Wallet}
          title="Your wallets"
          description="Rename, switch, or add wallets."
        >
          <ProfilesCard compact />
        </SettingsSection>

        <Link to="/wallet/backup" className="block">
          <Card className="hover:bg-accent/30 transition-colors">
            <CardContent className="py-4 flex items-center gap-3">
              <ScrollText className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-base font-semibold">Backup</div>
                <div className="text-xs text-muted-foreground">
                  Reveal your seed phrase — the only way to restore your wallet. It asks for your
                  password first.
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>

        {keyOnly ? (
          <>
            <SettingsSection
              value="key-only"
              icon={KeyRound}
              title="Key-only wallet"
              description="No seed phrase — each key is its own tile."
            >
              <p className="text-sm text-muted-foreground">
                This wallet has no seed phrase, so HD chain tiles, address rotation and deep rescan
                don&apos;t apply. Each imported private key is its own tile. Keep your own offline
                backup of every WIF — it can&apos;t be regenerated from anything stored here.
              </p>
            </SettingsSection>

            <SettingsSection
              value="add-seed"
              icon={Sparkles}
              title="Add a seed phrase"
              description="Upgrade to a full HD wallet."
            >
              <AddSeedCard compact />
            </SettingsSection>
          </>
        ) : (
          <>
            <SettingsSection
              value="rotation"
              icon={RefreshCw}
              title="Receive address rotation"
              description="How often the Receive screen shows a fresh address."
            >
              <RotationPolicyCard compact />
            </SettingsSection>

            <SettingsSection
              value="rescan"
              icon={RefreshCw}
              title="Deep rescan (TXC)"
              description="Recover if a balance ever looks wrong."
            >
              <DeepRescanCard compact />
            </SettingsSection>
          </>
        )}

        <SettingsSection
          value="features"
          icon={Sparkles}
          title="Extra features"
          description="Opt-in features and safety checks."
        >
          <FeaturesCard compact />
        </SettingsSection>

        <SettingsSection
          value="sign-message"
          icon={PenLine}
          title="Sign & verify message"
          description="Prove you control a TEXITcoin address."
        >
          <SignMessageCard />
        </SettingsSection>

        <SettingsSection
          value="merchant-link"
          icon={Link2}
          title="Ecosystem links"
          description="Link Nectar Pay, Bonfire, File Fingerprint, TSD Swap and more."
        >
          <EcosystemLinksCard />
        </SettingsSection>

        {(sharedOn || tradingLinks > 0) && (
          <Link to="/wallet/shared" className="block">
            <Card className="hover:bg-accent/30 transition-colors">
              <CardContent className="py-4 flex items-center gap-3">
                <ArrowLeftRight className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-base font-semibold">Shared wallets</div>
                  <div className="text-xs text-muted-foreground">
                    Small wallets a trading site or tap card can spend from.
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        )}

        <SettingsSection
          value="tsd-cashout"
          icon={ArrowDownUp}
          title="TSD settings"
          description="Cash-out API key and TSD reminders."
        >
          <div className="space-y-6">
            <TsdCashoutKeyCard compact />
            <TsdNudgeToggleCard compact />
          </div>
        </SettingsSection>

        <SettingsSection
          value="danger"
          icon={AlertTriangle}
          title="Danger zone"
          description="Remove the encrypted wallet from this device."
        >
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Removes the encrypted seed from this device. Make sure you have your seed phrase
              written down first — without it you cannot recover the wallet.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Delete wallet and all data</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete wallet and all data?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes the encrypted wallet, biometric unlock, address book,
                    and all cached data from this device. Your funds stay on the blockchain and can
                    only be restored on any device using your seed phrase. Type{" "}
                    <strong>DELETE</strong> to confirm.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div>
                  <Label htmlFor="confirm">Confirmation</Label>
                  <Input
                    id="confirm"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="Type DELETE"
                    className="mt-1"
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setConfirmText("")}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={confirmText !== "DELETE"}
                    onClick={async () => {
                      await disableBiometric();
                      forget();
                      navigate({ to: "/" });
                    }}
                  >
                    Delete wallet and all data
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </SettingsSection>
      </Accordion>
    </main>
  );
}

function GroupLabel({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="mt-8 flex items-center gap-3 first:mt-6">
      <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <h2 className="text-lg font-semibold leading-tight">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function SettingsSection({
  value,
  icon: Icon,
  title,
  description,
  children,
}: {
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <AccordionItem value={value} className="border rounded-xl px-4">
      <AccordionTrigger className="hover:no-underline py-4">
        <div className="flex items-center gap-3 text-left">
          {Icon && <Icon className="h-5 w-5 text-muted-foreground shrink-0" />}
          <div className="min-w-0">
            <div className="text-base font-semibold">{title}</div>
            {description && (
              <div className="text-xs text-muted-foreground font-normal">{description}</div>
            )}
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="pb-4">{children}</div>
      </AccordionContent>
    </AccordionItem>
  );
}
