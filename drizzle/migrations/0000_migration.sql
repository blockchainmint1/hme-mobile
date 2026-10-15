CREATE TABLE public.nfc_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_address text NOT NULL,
  uid_hash text NOT NULL UNIQUE,
  label text NOT NULL DEFAULT 'My card',
  pocket_account integer NOT NULL,
  pocket_address text NOT NULL,
  return_address text NOT NULL,
  pin_hash text,
  pin_salt text,
  pin_rule text NOT NULL DEFAULT 'never',
  pin_above_usd numeric NOT NULL DEFAULT 0,
  per_tap_usd numeric NOT NULL DEFAULT 100,
  daily_usd numeric NOT NULL DEFAULT 500,
  wrong_pins integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  telegram_code text UNIQUE,
  approver_chat_ids bigint[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nfc_cards_owner_idx ON public.nfc_cards(owner_address);

CREATE TABLE public.nfc_card_keys (
  card_id uuid PRIMARY KEY REFERENCES public.nfc_cards(id) ON DELETE CASCADE,
  enc_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.nfc_card_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES public.nfc_cards(id) ON DELETE CASCADE,
  invoice_id text NOT NULL,
  merchant text,
  pay_to text NOT NULL,
  amount_units bigint NOT NULL,
  usd numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reason text,
  txid text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX nfc_card_payments_card_idx ON public.nfc_card_payments(card_id, created_at DESC);
CREATE UNIQUE INDEX nfc_card_payments_invoice_once ON public.nfc_card_payments(invoice_id) WHERE status IN ('pending','approval','paid');

GRANT ALL ON public.nfc_cards TO service_role;
GRANT ALL ON public.nfc_card_keys TO service_role;
GRANT ALL ON public.nfc_card_payments TO service_role;
ALTER TABLE public.nfc_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfc_card_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfc_card_payments ENABLE ROW LEVEL SECURITY;