/*
  Usage caps + per-request logging (Supabase / Postgres)

  What this adds:
  - `usage_events` supports reservation + finalization to avoid race conditions
  - Atomic "check + reserve" RPC: prevents concurrent requests from overspending caps
  - Finalize/cancel RPCs: marks actual cost after provider response

  Assumptions:
  - `public.users` has a `tier` column (plan name), e.g. 'FREE', 'PRO'
  - `public.usage_limits` rows exist for any plan you want capped (plan text is matched)
  - Caps are in dollars (numeric), summed over `usage_events.cost` (charged) or `reserved_cost` (reserved)
*/

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- -----------------------------
-- Table hardening / columns
-- -----------------------------

alter table if exists public.usage_events
  add column if not exists status text not null default 'reserved',
  add column if not exists reserved_cost numeric not null default 0,
  add column if not exists input_tokens bigint,
  add column if not exists output_tokens bigint,
  add column if not exists expires_at timestamptz,
  add column if not exists finalized_at timestamptz,
  add column if not exists error text;

-- If you *haven't* migrated `usage_events.id` to uuid yet, do that manually:
-- - You cannot safely ALTER bigint -> uuid in place.
-- - Recommended: create a new uuid PK column, backfill, swap PK, then drop old column.

do $$
begin
  begin
    alter table public.usage_events
      alter column reserved_cost set default 0;
  exception when undefined_table then
    -- ignore
  end;
end $$;

do $$
begin
  begin
    alter table public.usage_events
      add constraint usage_events_cost_nonneg check (cost is null or cost >= 0);
  exception when duplicate_object then
    -- already exists
  when undefined_table then
    -- ignore
  end;
end $$;

do $$
begin
  begin
    alter table public.usage_events
      add constraint usage_events_reserved_cost_nonneg check (reserved_cost >= 0);
  exception when duplicate_object then
    -- already exists
  when undefined_table then
    -- ignore
  end;
end $$;

create index if not exists usage_events_user_created_at_idx
  on public.usage_events (user_id, created_at desc);

create index if not exists usage_events_user_status_created_at_idx
  on public.usage_events (user_id, status, created_at desc);

-- Optional: `usage_limits` should be readable (caps aren't sensitive).
alter table if exists public.usage_limits enable row level security;
alter table if exists public.usage_events enable row level security;

do $$
begin
  begin
    create policy usage_limits_read_all
      on public.usage_limits
      for select
      using (true);
  exception when duplicate_object then
    -- already exists
  when undefined_table then
    -- ignore
  end;
end $$;

do $$
begin
  begin
    create policy usage_events_read_own
      on public.usage_events
      for select
      using (auth.uid() = user_id);
  exception when duplicate_object then
    -- already exists
  when undefined_table then
    -- ignore
  end;
end $$;

-- -----------------------------
-- RPC helpers
-- -----------------------------

create or replace function public._usage_lock_key(p_user_id uuid)
returns bigint
language sql
immutable
as $$
  select ('x' || substr(md5(p_user_id::text), 1, 16))::bit(64)::bigint;
$$;

-- -----------------------------
-- RPC: Reserve (atomic check)
-- -----------------------------

create or replace function public.usage_reserve_request(
  p_provider text,
  p_model text,
  p_reserved_cost numeric,
  p_reserved_input_tokens bigint default null,
  p_reserved_output_tokens bigint default null
)
returns table (
  allowed boolean,
  usage_event_id uuid,
  reason text,
  four_hour_spend numeric,
  four_hour_limit numeric,
  monthly_spend numeric,
  monthly_limit numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan text;
  v_four_hour_limit numeric;
  v_monthly_limit numeric;
  v_four_hour_spend numeric := 0;
  v_monthly_spend numeric := 0;
  v_now timestamptz := now();
  v_month_start timestamptz := date_trunc('month', v_now);
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_reserved_cost is null or p_reserved_cost < 0 then
    raise exception 'p_reserved_cost must be a non-negative number';
  end if;

  -- Serialize per-user to prevent concurrent overspend.
  perform pg_advisory_xact_lock(public._usage_lock_key(v_user_id));

  select u.tier
    into v_plan
  from public.users u
  where u.id = v_user_id;

  if v_plan is null then
    v_plan := 'FREE';
  end if;

  select ul.four_hour_limit, ul.monthly_limit
    into v_four_hour_limit, v_monthly_limit
  from public.usage_limits ul
  where lower(ul.plan) = lower(v_plan)
  order by ul.created_at desc
  limit 1;

  -- If no limits row exists for this plan, treat as unlimited.
  if v_four_hour_limit is null and v_monthly_limit is null then
    allowed := true;
    reason := null;
    four_hour_spend := 0;
    four_hour_limit := null;
    monthly_spend := 0;
    monthly_limit := null;

    usage_event_id := gen_random_uuid();
    insert into public.usage_events (
      id, user_id, created_at, provider, model, status,
      cost, reserved_cost, input_tokens, output_tokens, expires_at
    ) values (
      usage_event_id, v_user_id, v_now, p_provider, p_model, 'reserved',
      0, p_reserved_cost, p_reserved_input_tokens, p_reserved_output_tokens, v_now + interval '10 minutes'
    );

    return next;
    return;
  end if;

  select coalesce(sum(
    case
      when status = 'reserved' then reserved_cost
      else cost
    end
  ), 0)
    into v_four_hour_spend
  from public.usage_events
  where user_id = v_user_id
    and created_at >= v_now - interval '4 hours'
    and status in ('reserved', 'charged')
    and (status <> 'reserved' or expires_at is null or expires_at > v_now);

  select coalesce(sum(
    case
      when status = 'reserved' then reserved_cost
      else cost
    end
  ), 0)
    into v_monthly_spend
  from public.usage_events
  where user_id = v_user_id
    and created_at >= v_month_start
    and status in ('reserved', 'charged')
    and (status <> 'reserved' or expires_at is null or expires_at > v_now);

  four_hour_spend := v_four_hour_spend;
  four_hour_limit := v_four_hour_limit;
  monthly_spend := v_monthly_spend;
  monthly_limit := v_monthly_limit;

  if v_four_hour_limit is not null and (v_four_hour_spend + p_reserved_cost) > v_four_hour_limit then
    allowed := false;
    reason := 'FOUR_HOUR_LIMIT';
    usage_event_id := null;
    return next;
    return;
  end if;

  if v_monthly_limit is not null and (v_monthly_spend + p_reserved_cost) > v_monthly_limit then
    allowed := false;
    reason := 'MONTHLY_LIMIT';
    usage_event_id := null;
    return next;
    return;
  end if;

  allowed := true;
  reason := null;
  usage_event_id := gen_random_uuid();

  insert into public.usage_events (
    id, user_id, created_at, provider, model, status,
    cost, reserved_cost, input_tokens, output_tokens, expires_at
  ) values (
    usage_event_id, v_user_id, v_now, p_provider, p_model, 'reserved',
    0, p_reserved_cost, p_reserved_input_tokens, p_reserved_output_tokens, v_now + interval '10 minutes'
  );

  return next;
end;
$$;

-- -----------------------------
-- RPC: Finalize / Cancel
-- -----------------------------

create or replace function public.usage_finalize_request(
  p_usage_event_id uuid,
  p_cost numeric,
  p_input_tokens bigint default null,
  p_output_tokens bigint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_cost is null or p_cost < 0 then
    raise exception 'p_cost must be a non-negative number';
  end if;

  perform pg_advisory_xact_lock(public._usage_lock_key(v_user_id));

  update public.usage_events
    set status = 'charged',
        cost = p_cost,
        input_tokens = coalesce(p_input_tokens, input_tokens),
        output_tokens = coalesce(p_output_tokens, output_tokens),
        finalized_at = v_now,
        expires_at = null,
        error = null
  where id = p_usage_event_id
    and user_id = v_user_id
    and status in ('reserved', 'charged');

  if not found then
    raise exception 'usage_event not found or not owned by user';
  end if;
end;
$$;

create or replace function public.usage_cancel_request(
  p_usage_event_id uuid,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  perform pg_advisory_xact_lock(public._usage_lock_key(v_user_id));

  update public.usage_events
    set status = 'canceled',
        cost = 0,
        reserved_cost = 0,
        finalized_at = v_now,
        expires_at = null,
        error = p_error
  where id = p_usage_event_id
    and user_id = v_user_id
    and status = 'reserved';
end;
$$;

-- Allow authenticated clients to call the RPCs.
grant execute on function public.usage_reserve_request(text, text, numeric, bigint, bigint) to authenticated;
grant execute on function public.usage_finalize_request(uuid, numeric, bigint, bigint) to authenticated;
grant execute on function public.usage_cancel_request(uuid, text) to authenticated;

-- -----------------------------
-- RPC: Read current cap status
-- -----------------------------

create or replace function public.usage_get_status()
returns table (
  plan text,
  four_hour_spend numeric,
  four_hour_limit numeric,
  monthly_spend numeric,
  monthly_limit numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan text;
  v_four_hour_limit numeric;
  v_monthly_limit numeric;
  v_now timestamptz := now();
  v_month_start timestamptz := date_trunc('month', v_now);
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select u.tier
    into v_plan
  from public.users u
  where u.id = v_user_id;

  if v_plan is null then
    v_plan := 'FREE';
  end if;

  select ul.four_hour_limit, ul.monthly_limit
    into v_four_hour_limit, v_monthly_limit
  from public.usage_limits ul
  where lower(ul.plan) = lower(v_plan)
  order by ul.created_at desc
  limit 1;

  plan := v_plan;

  select coalesce(sum(
    case
      when status = 'reserved' then reserved_cost
      else cost
    end
  ), 0)
    into four_hour_spend
  from public.usage_events
  where user_id = v_user_id
    and created_at >= v_now - interval '4 hours'
    and status in ('reserved', 'charged')
    and (status <> 'reserved' or expires_at is null or expires_at > v_now);

  select coalesce(sum(
    case
      when status = 'reserved' then reserved_cost
      else cost
    end
  ), 0)
    into monthly_spend
  from public.usage_events
  where user_id = v_user_id
    and created_at >= v_month_start
    and status in ('reserved', 'charged')
    and (status <> 'reserved' or expires_at is null or expires_at > v_now);

  four_hour_limit := v_four_hour_limit;
  monthly_limit := v_monthly_limit;

  return next;
end;
$$;

grant execute on function public.usage_get_status() to authenticated;
