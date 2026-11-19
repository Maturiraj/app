-- Extends the private schema from 20261119163143_admin_overview_metrics.sql.
-- Public RPCs use invoker rights. Only the private functions perform writes.
revoke create on schema maturiraj_admin from public, anon, authenticated;

create table maturiraj_admin.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  action text not null,
  target text not null,
  before_value text,
  after_value text,
  reason text,
  occurred_at timestamptz not null default now()
);
create index on maturiraj_admin.audit_log (occurred_at desc);

create table maturiraj_admin.content_review (
  subject_id text not null,
  artifact_kind text not null check (artifact_kind in ('exam', 'chapter')),
  artifact_key text not null,
  revision text not null,
  state text not null check (state in ('review', 'approved', 'withdrawn')),
  source_url text not null,
  issues text[] not null default '{}',
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (subject_id, artifact_kind, artifact_key, revision)
);

create table maturiraj_admin.calendar_draft (
  event_id text primary key,
  scheduled_date date not null,
  start_minute integer not null check (start_minute between 0 and 1439),
  segments integer[] not null,
  source_url text not null,
  version integer not null check (version > 0),
  updated_at timestamptz not null default now()
);

create table maturiraj_admin.calendar_release (
  event_id text primary key,
  scheduled_date date not null,
  start_minute integer not null check (start_minute between 0 and 1439),
  segments integer[] not null,
  source_url text not null,
  version integer not null check (version > 0),
  released_at timestamptz not null default now()
);

create table maturiraj_admin.operational_event (
  key text primary key,
  route text not null,
  kind text not null,
  duration_ms integer,
  occurred_at timestamptz not null default now()
);
create index on maturiraj_admin.operational_event (occurred_at desc);

alter table maturiraj_admin.audit_log enable row level security;
alter table maturiraj_admin.content_review enable row level security;
alter table maturiraj_admin.calendar_draft enable row level security;
alter table maturiraj_admin.calendar_release enable row level security;
alter table maturiraj_admin.operational_event enable row level security;
revoke all on table maturiraj_admin.audit_log, maturiraj_admin.content_review,
  maturiraj_admin.calendar_draft, maturiraj_admin.calendar_release,
  maturiraj_admin.operational_event from public, anon, authenticated, service_role;
revoke all on sequence maturiraj_admin.audit_log_id_seq from public, anon, authenticated, service_role;

create function maturiraj_admin.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not exists (
    select 1
    from public.profiles profile
    join auth.users account on account.id = profile.id
    where profile.id = actor and profile.role = 'admin'
      and account.deleted_at is null and account.is_anonymous is not true
      and (account.banned_until is null or account.banned_until <= now())
  ) then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  return actor;
end;
$$;

create function maturiraj_admin.can_manage_roles(actor uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1 from auth.users
    where id = actor and raw_app_meta_data->'maturiraj_manage_roles' = 'true'::jsonb
  );
$$;

create function maturiraj_admin.read_workspace(
  panel text, search_term text, period_days integer, page_number integer,
  subject_filter text, mode_filter text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := maturiraj_admin.require_admin();
  days integer := case when period_days in (7, 30, 90) then period_days else 30 end;
  collected_at timestamptz := now();
  since timestamptz := collected_at - make_interval(days => days);
  term text := lower(left(trim(coalesce(search_term, '')), 128));
  page_index integer := least(greatest(coalesce(page_number, 0), 0), 10000);
  result jsonb;
begin
  if panel = 'users' then
    select jsonb_build_object(
      'canManageRoles', maturiraj_admin.can_manage_roles(actor),
      'rows', coalesce(jsonb_agg(to_jsonb(rows)), '[]'::jsonb)
    ) into result from (
      select u.id, u.email, u.created_at, u.confirmed_at,
             coalesce(u.banned_until > now(), false) as blocked,
             coalesce(p.role, 'user') as role,
             s.plan, s.status as payment_status, s.current_period_end
      from auth.users u left join public.profiles p on p.id = u.id
      left join lateral (
        select plan, status, current_period_end from public.subscriptions
        where user_id = u.id
        order by (status in ('active', 'trialing') and current_period_end > collected_at) desc nulls last,
                 updated_at desc nulls last, id limit 1
      ) s on true
      where u.deleted_at is null and u.is_anonymous is not true
        and (term = '' or position(term in lower(coalesce(u.email, ''))) > 0 or u.id::text = term)
      order by u.created_at desc, u.id offset (page_index * 25) limit 26
    ) rows;
  elsif panel = 'content' then
    select jsonb_build_object('reviews', coalesce((
      select jsonb_agg(to_jsonb(rows)) from (
        select subject_id, artifact_kind, artifact_key, revision, state, source_url, issues, version, updated_at
        from maturiraj_admin.content_review
        where coalesce(subject_filter, '') = '' or subject_id = subject_filter
        order by updated_at desc, subject_id, artifact_kind, artifact_key, revision
        offset (page_index * 25) limit 26
      ) rows
    ), '[]'::jsonb)) into result;
  elsif panel = 'learning' then
    select jsonb_build_object(
      'days', days,
      'visits', activity.visits,
      'activeAccounts', activity.accounts,
      'chapterRecordsUpdated', (select count(*) from public.chapter_progress where updated_at between since and collected_at),
      'plans', (select count(*) from public.study_plans where created_at between since and collected_at),
      'attempts', coalesce((select jsonb_agg(to_jsonb(rows)) from (
        select subject_id, mode, count(*) as count
        from (
          select case when subject ~ '^[a-z]{2,12}$' then subject else 'other' end as subject_id,
                 case when exam_mode then 'exam' else 'practice' end as mode
          from public.sim_progress where created_at between since and collected_at
        ) attempts
        where (coalesce(subject_filter, '') = '' or subject_id = subject_filter)
          and (coalesce(mode_filter, '') = '' or mode = mode_filter)
        group by subject_id, mode order by subject_id, mode
      ) rows), '[]'::jsonb)
    ) into result from (
      select count(*) as visits, count(distinct event.user_id) as accounts
      from public.activity_events event
      join auth.users account on account.id = event.user_id
      where event.visited_at between since and collected_at
        and account.deleted_at is null and account.is_anonymous is not true
    ) activity;
  elsif panel = 'billing' then
    with active as (
      select user_id, max(current_period_end) as active_until
      from public.subscriptions
      where status in ('active', 'trialing') and current_period_end > collected_at
      group by user_id
    )
    select jsonb_build_object(
      'days', days,
      'active', (select count(*) from active),
      'expiring', (select count(*) from active where active_until <= collected_at + interval '7 days'),
      'inactive', (select count(*) from public.subscriptions where updated_at >= since
                   and status in ('inactive', 'canceled')),
      'attention', coalesce((select jsonb_agg(to_jsonb(rows)) from (
        select event_type, status, attempt_count, updated_at
        from public.stripe_webhook_events
        where (status = 'failed' or (status = 'processing' and
               (lease_expires_at is null or lease_expires_at <= collected_at)))
          and updated_at >= since order by updated_at desc, event_id limit 40
      ) rows), '[]'::jsonb)
    ) into result;
  elsif panel = 'admissions' then
    select jsonb_build_object(
      'drafts', coalesce((select jsonb_agg(to_jsonb(d) order by event_id) from maturiraj_admin.calendar_draft d), '[]'::jsonb),
      'released', coalesce((select jsonb_agg(to_jsonb(r) order by event_id) from maturiraj_admin.calendar_release r), '[]'::jsonb),
      'pendingThresholds', (select count(*) from public.pragovi_staging
                            where diff_status in ('changed', 'new', 'unmatched')),
      'imports', coalesce((select jsonb_agg(to_jsonb(rows)) from (
        select source, status, rows_total, rows_changed, started_at, finished_at
        from public.scraper_runs order by started_at desc nulls last, id limit 12
      ) rows), '[]'::jsonb)
    ) into result;
  elsif panel = 'health' then
    select jsonb_build_object(
      'days', days,
      'measurements', coalesce((select jsonb_agg(to_jsonb(rows)) from (
        select route, kind, count(*) as count, max(occurred_at) as latest,
          round(percentile_cont(0.95) within group (order by duration_ms)::numeric)::integer as p95_ms
        from maturiraj_admin.operational_event where occurred_at >= since
        group by route, kind order by route, kind
      ) rows), '[]'::jsonb),
      'reports', coalesce((select jsonb_agg(to_jsonb(rows)) from (
        select id, question_id, reason, status, created_at from public.game_question_reports
        where status in ('open', 'reviewed') order by created_at desc, id limit 40
      ) rows), '[]'::jsonb)
    ) into result;
  elsif panel = 'audit' then
    select jsonb_build_object('rows', coalesce(jsonb_agg(to_jsonb(rows)), '[]'::jsonb))
    into result from (
      select actor_id, action, target, before_value, after_value, reason, occurred_at
      from (
        select id, actor_id, action, target, before_value, after_value, reason, occurred_at
        from maturiraj_admin.audit_log
        union all
        select id, changed_by, 'threshold.' || action, coalesce(studij_id, '-') || ':' || coalesce(godina::text, '-'),
               null::text, null::text, null::text, created_at
        from public.pragovi_audit
      ) events where occurred_at >= since
      order by occurred_at desc, action, target, id desc offset (page_index * 25) limit 26
    ) rows;
  elsif panel = 'attention' then
    select jsonb_build_object(
      'contentReviews', (select count(*) from maturiraj_admin.content_review where state = 'review'),
      'questionReports', (select count(*) from public.game_question_reports where status in ('open', 'reviewed')),
      'thresholds', (select count(*) from public.pragovi_staging where diff_status in ('changed', 'new', 'unmatched')),
      'webhookIssues', (select count(*) from public.stripe_webhook_events
                        where updated_at >= since
                          and (status = 'failed' or (status = 'processing' and
                               (lease_expires_at is null or lease_expires_at <= collected_at)))),
      'clientErrors', (select count(*) from maturiraj_admin.operational_event
                       where occurred_at >= since and kind in ('client_error', 'media_error', 'submission_error'))
    ) into result;
  else
    raise exception 'Unknown admin panel' using errcode = '22023';
  end if;

  if panel in ('users', 'billing', 'audit') then
    insert into maturiraj_admin.audit_log (actor_id, action, target)
    values (actor, 'panel.read', panel);
  end if;
  return result;
end;
$$;

create function maturiraj_admin.change_workspace(action_name text, input jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := maturiraj_admin.require_admin();
  reason_text text := nullif(trim(input->>'reason'), '');
  target_id text;
  previous text;
  next_value text;
  changed boolean := true;
  artifact_subject text := input->>'subject';
  artifact_kind_value text := input->>'kind';
  artifact_id text := input->>'key';
  artifact_revision text := input->>'revision';
  source_link text := input->>'source';
  issue_codes text[];
  review maturiraj_admin.content_review%rowtype;
  draft maturiraj_admin.calendar_draft%rowtype;
  published maturiraj_admin.calendar_release%rowtype;
  version_field text;
  requested_version integer;
  duration_parts integer[];
  event_date date;
  minute integer;
begin
  if jsonb_typeof(input) is distinct from 'object'
     or jsonb_typeof(input->'reason') is distinct from 'string'
     or reason_text is null or length(reason_text) > 300 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;

  if action_name in ('content.review', 'calendar.draft', 'calendar.publish', 'calendar.withdraw') then
    version_field := case when action_name = 'content.review' then 'expectedVersion' else 'version' end;
    if input ? version_field and coalesce(input->>version_field, '') !~ '^(0|[1-9][0-9]{0,8})$' then
      raise exception 'Invalid version' using errcode = '22023';
    end if;
    requested_version := coalesce((input->>version_field)::integer, 0);
  end if;

  if action_name = 'role.set' then
    if not maturiraj_admin.can_manage_roles(actor) then
      raise exception 'Role management permission required' using errcode = '42501';
    end if;
    target_id := (input->>'id')::uuid::text;
    next_value := input->>'role';
    if target_id is null or target_id = actor::text or next_value is null
       or next_value not in ('user', 'editor') then
      raise exception 'Invalid role change' using errcode = '22023';
    end if;
    select profile.role into previous
    from public.profiles profile join auth.users account on account.id = profile.id
    where profile.id = target_id::uuid
      and account.deleted_at is null and account.is_anonymous is not true
    for update of profile;
    if previous = 'admin' then
      raise exception 'Administrator role is protected' using errcode = '42501';
    end if;
    if not found or previous is distinct from input->>'expected' then
      raise exception 'Role changed since opening' using errcode = '40001';
    end if;
    if previous is distinct from next_value then
      update public.profiles set role = next_value where id = target_id::uuid;
    else
      changed := false;
    end if;
  elsif action_name = 'content.review' then
    next_value := input->>'state';
    if artifact_subject is null or artifact_subject !~ '^[a-z]{2,12}$'
       or artifact_kind_value is null or artifact_kind_value not in ('exam','chapter')
       or artifact_id is null or artifact_id !~ '^[a-zA-Z0-9_.-]{1,100}$'
       or artifact_revision is null or artifact_revision !~ '^[a-zA-Z0-9:_.-]{1,130}$'
       or next_value is null or next_value not in ('review','approved','withdrawn')
       or source_link is null or length(source_link) > 508
       or source_link !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' then
      raise exception 'Invalid content record' using errcode = '22023';
    end if;
    if input ? 'issues' and jsonb_typeof(input->'issues') is distinct from 'array' then
      raise exception 'Invalid content issues' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct code order by code), '{}')
      into issue_codes
      from jsonb_array_elements_text(coalesce(input->'issues', '[]')) as entries(code);
    if array_position(issue_codes, null) is not null
       or not (issue_codes <@ array['missing_key','ambiguous','missing_media','missing_source','rights_pending'])
       or (next_value = 'approved' and cardinality(issue_codes) > 0) then
      raise exception 'Unresolved content issues' using errcode = '22023';
    end if;
    target_id := concat_ws('/', artifact_subject, artifact_kind_value, artifact_id, artifact_revision);
    perform pg_advisory_xact_lock(20261119, hashtext(target_id));
    select * into review from maturiraj_admin.content_review
    where subject_id = artifact_subject and artifact_kind = artifact_kind_value
      and artifact_key = artifact_id and revision = artifact_revision;
    if coalesce(review.version, 0) <> requested_version
       or review.state is distinct from nullif(input->>'expected', '') then
      raise exception 'Review changed since opening' using errcode = '40001';
    end if;
    if review.state = next_value and review.source_url = source_link and review.issues = issue_codes then
      changed := false;
    else
      if review.version is not null then
        previous := jsonb_build_object('state', review.state, 'version', review.version,
                      'source_url', review.source_url, 'issues', review.issues)::text;
      end if;
      insert into maturiraj_admin.content_review
        (subject_id, artifact_kind, artifact_key, revision, state, source_url, issues, version)
      values (artifact_subject, artifact_kind_value, artifact_id, artifact_revision,
              next_value, source_link, issue_codes, requested_version + 1)
      on conflict (subject_id, artifact_kind, artifact_key, revision) do update
        set state = excluded.state, source_url = excluded.source_url, issues = excluded.issues,
            version = excluded.version, updated_at = now();
      next_value := jsonb_build_object('state', next_value, 'version', requested_version + 1,
                     'source_url', source_link, 'issues', issue_codes)::text;
    end if;
  elsif action_name in ('calendar.draft', 'calendar.publish', 'calendar.withdraw') then
    target_id := input->>'id';
    if target_id is null or length(target_id) > 100
       or target_id !~ '^2027-(prvi|drugi)-[a-z]{2,12}(-[A-Za-z-]+)?$' then
      raise exception 'Invalid exam event' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(20271119, hashtext(target_id));
    select * into draft from maturiraj_admin.calendar_draft where event_id = target_id;
    if coalesce(draft.version, 0) <> requested_version then
      raise exception 'Calendar draft changed since opening' using errcode = '40001';
    end if;
    if action_name = 'calendar.draft' then
      if coalesce(input->>'date', '') !~ '^2027-[0-9]{2}-[0-9]{2}$'
         or coalesce(input->>'minute', '') !~ '^(0|[1-9][0-9]{0,3})$'
         or jsonb_typeof(input->'segments') is distinct from 'array'
         or source_link is null
         or source_link !~ '^https://www[.]ncvvo[.]hr/[^[:space:]?#]{1,470}(#[A-Za-z0-9=._-]{1,30})?$' then
        raise exception 'Invalid official schedule data' using errcode = '22023';
      end if;
      if jsonb_array_length(input->'segments') not between 1 and 4 or exists (
        select 1 from jsonb_array_elements(input->'segments') as entries(segment)
        where jsonb_typeof(segment) is distinct from 'number'
           or coalesce(segment #>> '{}', '') !~ '^[1-9][0-9]{0,2}$'
      ) then
        raise exception 'Invalid official schedule data' using errcode = '22023';
      end if;
      begin
        event_date := (input->>'date')::date;
      exception when datetime_field_overflow or invalid_datetime_format then
        raise exception 'Invalid official schedule date' using errcode = '22023';
      end;
      minute := (input->>'minute')::integer;
      duration_parts := array(
        select segment::integer from jsonb_array_elements_text(input->'segments')
          with ordinality as entries(segment, segment_order)
        order by segment_order
      );
      if minute not between 0 and 1439
         or exists (select 1 from unnest(duration_parts) part where part not between 1 and 360)
         or minute + (select sum(part) from unnest(duration_parts) part) >= 1440 then
        raise exception 'Invalid official schedule data' using errcode = '22023';
      end if;
      if draft.version is not null then
        previous := to_jsonb(draft)::text;
      end if;
      insert into maturiraj_admin.calendar_draft as saved
        (event_id, scheduled_date, start_minute, segments, source_url, version)
      values (
        target_id, event_date, minute, duration_parts, source_link, requested_version + 1
      ) on conflict (event_id) do update set
        scheduled_date = excluded.scheduled_date, start_minute = excluded.start_minute,
        segments = excluded.segments, source_url = excluded.source_url, version = excluded.version, updated_at = now()
      returning to_jsonb(saved)::text into next_value;
    elsif action_name = 'calendar.publish' and draft.version is not null then
      select * into published from maturiraj_admin.calendar_release where event_id = target_id;
      if published.version = draft.version then
        changed := false;
      else
        if published.version is not null then
          previous := to_jsonb(published)::text;
        end if;
        insert into maturiraj_admin.calendar_release as saved
          (event_id, scheduled_date, start_minute, segments, source_url, version)
        values (
          target_id, draft.scheduled_date, draft.start_minute, draft.segments, draft.source_url, draft.version
        ) on conflict (event_id) do update set
          scheduled_date = excluded.scheduled_date, start_minute = excluded.start_minute,
          segments = excluded.segments, source_url = excluded.source_url, version = excluded.version, released_at = now()
        returning to_jsonb(saved)::text into next_value;
      end if;
    elsif action_name = 'calendar.withdraw' then
      delete from maturiraj_admin.calendar_release as removed where event_id = target_id
        returning to_jsonb(removed)::text into previous;
      changed := found;
    else
      raise exception 'Calendar draft required' using errcode = '22023';
    end if;
  elsif action_name = 'question.resolve' then
    target_id := (input->>'id')::uuid::text;
    next_value := input->>'state';
    if target_id is null or next_value is null or next_value not in ('reviewed','resolved','dismissed') then
      raise exception 'Invalid question report status' using errcode = '22023';
    end if;
    select status into previous from public.game_question_reports where id = target_id::uuid for update;
    if not found or previous is distinct from input->>'expected' or previous not in ('open','reviewed') then
      raise exception 'Report changed since opening' using errcode = '40001';
    end if;
    if previous is distinct from next_value then
      update public.game_question_reports set status = next_value where id = target_id::uuid;
    else
      changed := false;
    end if;
  else
    raise exception 'Unknown operation' using errcode = '22023';
  end if;

  if changed then
    insert into maturiraj_admin.audit_log (actor_id, action, target, before_value, after_value, reason)
    values (actor, action_name, target_id, previous, next_value, reason_text);
  end if;
end;
$$;

create function maturiraj_admin.record_event(route_name text, event_kind text, time_ms integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  bucket bigint := floor(extract(epoch from now()) / 60);
begin
  if actor is null or route_name is null or route_name not in (
    'home','dashboard','discere','skripte','plan-ucenja','prijemni',
    'kalkulator','termini','ai-profesor','roditelji','admin','other'
  ) or event_kind is null or event_kind not in (
    'client_error','media_error','document_load','submission_error'
  ) or (event_kind = 'document_load' and (time_ms is null or time_ms not between 0 and 120000))
  or (event_kind <> 'document_load' and time_ms is not null) then
    return;
  end if;
  insert into maturiraj_admin.operational_event (key, route, kind, duration_ms)
  values (md5(concat_ws(':', actor, route_name, event_kind, bucket)), route_name, event_kind, time_ms)
  on conflict (key) do nothing;
end;
$$;

create function maturiraj_admin.published_calendar()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(rows)), '[]'::jsonb)
  from (select event_id, scheduled_date, start_minute, segments, source_url
        from maturiraj_admin.calendar_release order by event_id) rows;
$$;

revoke all on function maturiraj_admin.require_admin(),
  maturiraj_admin.can_manage_roles(uuid) from public, anon, authenticated, service_role;
revoke all on function maturiraj_admin.read_workspace(text,text,integer,integer,text,text),
  maturiraj_admin.change_workspace(text,jsonb),
  maturiraj_admin.record_event(text,text,integer),
  maturiraj_admin.published_calendar() from public, anon, authenticated, service_role;
grant execute on function maturiraj_admin.read_workspace(text,text,integer,integer,text,text),
  maturiraj_admin.change_workspace(text,jsonb),
  maturiraj_admin.record_event(text,text,integer) to authenticated;
grant usage on schema maturiraj_admin to anon, authenticated;
grant execute on function maturiraj_admin.published_calendar() to anon, authenticated;

create function public.admin_workspace_read(
  panel text, search_term text, period_days integer, page_number integer,
  subject_filter text, mode_filter text
)
returns jsonb language sql security invoker set search_path = ''
as $$ select maturiraj_admin.read_workspace(panel, search_term, period_days, page_number, subject_filter, mode_filter); $$;

create function public.admin_workspace_change(action_name text, input jsonb)
returns void language sql security invoker set search_path = ''
as $$ select maturiraj_admin.change_workspace(action_name, input); $$;

create function public.record_operational_event(route_name text, event_kind text, time_ms integer)
returns void language sql security invoker set search_path = ''
as $$ select maturiraj_admin.record_event(route_name, event_kind, time_ms); $$;

create function public.matura_published_calendar()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select maturiraj_admin.published_calendar(); $$;

revoke all on function public.admin_workspace_read(text,text,integer,integer,text,text),
  public.admin_workspace_change(text,jsonb), public.record_operational_event(text,text,integer),
  public.matura_published_calendar() from public, anon, authenticated, service_role;
grant execute on function public.admin_workspace_read(text,text,integer,integer,text,text),
  public.admin_workspace_change(text,jsonb), public.record_operational_event(text,text,integer) to authenticated;
grant execute on function public.matura_published_calendar() to anon, authenticated;
