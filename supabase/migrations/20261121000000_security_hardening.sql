-- Sigurnosno zatvaranje nalaza Supabase security advisora (2026-11-21).
-- Sve ispod je provjereno protiv koda: nijedna od ovih tablica/viewova/funkcija se ne
-- koristi iz preglednika (anon/authenticated). Service role ih i dalje vidi (zaobilazi RLS
-- i nije pogođen revokeom). Idempotentno i sigurno za svježu bazu (sve je uvjetno).

-- 1) Tablice u public bez RLS-a — svatko je mogao čitati i pisati.
do $$
declare t text;
begin
  foreach t in array array['user_subscriptions', 'content_import_jobs', 'Sve tablice'] loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- 2) active_subscriptions: SECURITY DEFINER view sa user_id/Stripe podacima (isti obrazac
--    kao active_user_plan u T1.1). Poštuj RLS pozivatelja i makni ga s browser rola.
do $$
begin
  if to_regclass('public.active_subscriptions') is not null then
    alter view public.active_subscriptions set (security_invoker = true);
    revoke all on public.active_subscriptions from anon, authenticated;
  end if;
end $$;

-- 3) Interni analitički viewovi — ne koriste se iz aplikacije; event_stats_daily nosi user_id.
do $$
declare v text;
begin
  foreach v in array array['event_stats_daily', 'funnel_prijemni', 'conversion_rates'] loop
    if to_regclass(format('public.%I', v)) is not null then
      execute format('revoke all on public.%I from anon, authenticated', v);
    end if;
  end loop;
end $$;

-- 4) SECURITY DEFINER funkcije koje primaju proizvoljni p_user_id bez provjere auth.uid()
--    (IDOR: bilo tko je mogao anonimizirati tuđu analitiku, slati obavijesti drugim
--    korisnicima ili mijenjati tuđi AI brojač), plus trigger funkcije izložene kao RPC.
--    Samo service role / trigeri; trigger izvršavanje ne traži EXECUTE pozivatelja.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'anonymize_user_analytics',
        'create_user_notification',
        'check_and_increment_ai_usage',
        'handle_new_user',
        'sync_discere_progress',
        'sync_simulator_progress',
        'sync_skripte_progress'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
