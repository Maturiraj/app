-- Keep privileged aggregation outside the schemas exposed by the Data API.
create schema if not exists maturiraj_admin;
revoke all on schema maturiraj_admin from public, anon;
grant usage on schema maturiraj_admin to authenticated;

create or replace function maturiraj_admin.overview_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  collected_at timestamptz := now();
  period_start timestamptz := collected_at - interval '30 days';
  result jsonb;
begin
  if actor_id is null or not exists (
    select 1 from public.profiles as profile
    where profile.id = actor_id and profile.role = 'admin'
  ) then
    raise exception 'Administrator required' using errcode = '42501';
  end if;

  with accounts as (
    select
      count(*) as registered,
      count(*) filter (where account.created_at >= period_start) as recent
    from auth.users as account
    where account.deleted_at is null and account.is_anonymous is not true
  ),
  activity as (
    select
      event.user_id,
      case
        when event.section in (
          'ai-profesor', 'checklist', 'discere', 'formule',
          'kalkulator', 'plan-ucenja', 'prijemni', 'skripte'
        ) then event.section
        else 'other'
      end as section
    from public.activity_events as event
    join auth.users as account on account.id = event.user_id
    where event.visited_at >= period_start and event.visited_at <= collected_at
      and account.deleted_at is null and account.is_anonymous is not true
  ),
  totals as (
    select count(*) as visits, count(distinct user_id) as accounts from activity
  ),
  sections as (
    select section, count(*) as visits from activity group by section
  ),
  attempts as (
    select
      count(*) filter (where exam_mode) as exams,
      count(*) filter (where not exam_mode) as practice
    from public.sim_progress
    where created_at >= period_start and created_at <= collected_at
  )
  select jsonb_build_object(
    'collectedAt', collected_at,
    'periodStart', period_start,
    'registeredAccounts', accounts.registered,
    'newAccounts', accounts.recent,
    'activeAccounts', totals.accounts,
    'recordedVisits', totals.visits,
    'savedExams', attempts.exams,
    'savedPractice', attempts.practice,
    'newStudyPlans', (
      select count(*) from public.study_plans
      where created_at >= period_start and created_at <= collected_at
    ),
    'visitsBySection', coalesce((
      select jsonb_agg(jsonb_build_object('section', section, 'visits', visits)
                       order by visits desc, section asc)
      from sections
    ), '[]'::jsonb)
  )
  into result
  from accounts cross join totals cross join attempts;

  return result;
end;
$function$;

revoke all on function maturiraj_admin.overview_metrics() from public, anon, authenticated;
grant execute on function maturiraj_admin.overview_metrics() to authenticated;

-- Public RPC is invoker-only. The internal function rechecks the live profile role.
create or replace function public.admin_overview_metrics()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select maturiraj_admin.overview_metrics();
$function$;

revoke all on function public.admin_overview_metrics() from public, anon, authenticated;
grant execute on function public.admin_overview_metrics() to authenticated;
