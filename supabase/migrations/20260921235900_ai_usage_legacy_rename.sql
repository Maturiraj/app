-- Produkcija je imala stariji AI sustav (reserve_ai_message / complete_ai_message /
-- refund_ai_message) s vlastitom tablicom public.ai_usage_reservations drugačijeg oblika
-- (idempotency_key, endpoint, status...). Kod ga više ne koristi, a ime se sudara s
-- ledgerom iz 20260922000000_ai_usage_ledger.sql, pa ta migracija na produkciji nije
-- mogla proći i svi AI pozivi padali su na "ledger unavailable".
--
-- Ako postoji stara tablica (prepoznata po stupcu idempotency_key), preimenuj je u
-- *_legacy i zatvori stare funkcije za preglednik. Na svježoj bazi ovo je no-op.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_usage_reservations'
      and column_name = 'idempotency_key'
  ) then
    alter table public.ai_usage_reservations rename to ai_usage_reservations_legacy;
    revoke all on public.ai_usage_reservations_legacy from anon, authenticated;
  end if;
  -- Imena constrainta/indeksa ostaju nakon preimenovanja tablice i sudarila bi se s
  -- ai_usage_reservations_pkey nove tablice.
  if to_regclass('public.ai_usage_reservations_legacy') is not null then
    if exists (select 1 from pg_constraint where conname = 'ai_usage_reservations_pkey'
               and conrelid = 'public.ai_usage_reservations_legacy'::regclass) then
      alter table public.ai_usage_reservations_legacy
        rename constraint ai_usage_reservations_pkey to ai_usage_reservations_legacy_pkey;
    end if;
    if exists (select 1 from pg_constraint where conname = 'ai_usage_reservations_idempotency_key_key'
               and conrelid = 'public.ai_usage_reservations_legacy'::regclass) then
      alter table public.ai_usage_reservations_legacy
        rename constraint ai_usage_reservations_idempotency_key_key to ai_usage_reservations_legacy_idempotency_key_key;
    end if;
  end if;
end $$;

do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('reserve_ai_message', 'complete_ai_message', 'refund_ai_message')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
