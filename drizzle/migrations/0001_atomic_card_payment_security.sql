CREATE OR REPLACE FUNCTION public.card_check_pin(p_card_id uuid, p_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.nfc_cards%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.nfc_cards WHERE id = p_card_id FOR UPDATE;
  IF NOT FOUND OR c.status <> 'active' OR c.wrong_pins >= 5 THEN RETURN 'locked'; END IF;
  IF c.pin_hash IS NULL OR c.pin_salt IS NULL THEN RETURN 'pin_setup_required'; END IF;
  IF p_hash IS NULL OR p_hash <> c.pin_hash THEN
    UPDATE public.nfc_cards SET wrong_pins = wrong_pins + 1, status = CASE WHEN wrong_pins + 1 >= 5 THEN 'locked' ELSE status END, updated_at = now() WHERE id = c.id;
    RETURN CASE WHEN c.wrong_pins + 1 >= 5 THEN 'locked' ELSE 'wrong_pin' END;
  END IF;
  UPDATE public.nfc_cards SET wrong_pins = 0 WHERE id = c.id;
  RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION public.card_check_pin(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.card_check_pin(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.card_payment_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.nfc_cards%ROWTYPE; spent numeric;
BEGIN
  SELECT * INTO c FROM public.nfc_cards WHERE id = NEW.card_id FOR UPDATE;
  IF NOT FOUND OR c.status <> 'active' THEN RAISE EXCEPTION 'Card is not active'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.amount_units <= 0 OR NEW.amount_units > 9007199254740991 OR NEW.usd <= 0 OR NEW.usd = 'NaN'::numeric OR NEW.usd = 'Infinity'::numeric OR NEW.usd = '-Infinity'::numeric THEN RAISE EXCEPTION 'Invalid payment amount'; END IF;
    IF abs(NEW.amount_units::numeric / 100000000 - NEW.usd) > NEW.usd * 0.01 THEN RAISE EXCEPTION 'TSD and invoice amounts do not match'; END IF;
    NEW.usd := NEW.amount_units::numeric / 100000000;
    SELECT coalesce(sum(amount_units::numeric / 100000000), 0) INTO spent FROM public.nfc_card_payments WHERE card_id = c.id AND status IN ('paid', 'pending') AND created_at >= now() - interval '24 hours';
    IF NEW.usd > c.per_tap_usd OR spent + NEW.usd > c.daily_usd THEN NEW.status := 'approval'; ELSE NEW.status := 'pending'; END IF;
  END IF;
  IF NEW.status = 'pending' AND EXISTS (SELECT 1 FROM public.nfc_card_payments WHERE card_id = c.id AND status = 'pending' AND id <> NEW.id) THEN RAISE EXCEPTION 'Another card payment is still sending'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.card_payment_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER card_payment_insert_guard BEFORE INSERT ON public.nfc_card_payments FOR EACH ROW EXECUTE FUNCTION public.card_payment_guard();
CREATE TRIGGER card_payment_pending_guard BEFORE UPDATE OF status ON public.nfc_card_payments FOR EACH ROW WHEN (NEW.status = 'pending' AND OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION public.card_payment_guard();