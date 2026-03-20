create table if not exists public.user_minute_balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  available_seconds integer not null default 0 check (available_seconds >= 0),
  enterprise_rate_per_minute numeric(10, 4),
  last_enterprise_amount numeric(10, 2),
  last_enterprise_minutes integer,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.user_minute_balances enable row level security;

create policy "Users can view own minute balance"
on public.user_minute_balances
for select
using (auth.uid() = user_id);

create trigger update_user_minute_balances_updated_at
before update on public.user_minute_balances
for each row execute function public.update_updated_at_column();

create table if not exists public.minute_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  call_log_id uuid references public.call_logs(id) on delete set null,
  kind text not null check (kind in ('signup_credit', 'admin_credit', 'demo_deduction', 'live_deduction')),
  source text not null,
  seconds_delta integer not null,
  rate_per_minute numeric(10, 4),
  amount numeric(10, 2),
  notes text,
  created_at timestamp with time zone not null default now()
);

alter table public.minute_transactions enable row level security;

create policy "Users can view own minute transactions"
on public.minute_transactions
for select
using (auth.uid() = user_id);

alter table public.call_logs
  add column if not exists billing_status text not null default 'pending',
  add column if not exists billing_source text,
  add column if not exists billed_seconds integer,
  add column if not exists billed_minutes integer,
  add column if not exists billed_rate_per_minute numeric(10, 4),
  add column if not exists billed_amount numeric(10, 2);

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');

  insert into public.user_minute_balances (
    user_id,
    available_seconds,
    enterprise_rate_per_minute,
    last_enterprise_amount,
    last_enterprise_minutes
  )
  values (
    new.id,
    300,
    0.10,
    0,
    5
  )
  on conflict (user_id) do nothing;

  insert into public.minute_transactions (
    user_id,
    kind,
    source,
    seconds_delta,
    rate_per_minute,
    amount,
    notes
  )
  values (
    new.id,
    'signup_credit',
    'free',
    300,
    0.10,
    0,
    'Initial free signup credit'
  );

  return new;
end;
$$ language plpgsql security definer set search_path = public;

insert into public.user_minute_balances (
  user_id,
  available_seconds,
  enterprise_rate_per_minute,
  last_enterprise_amount,
  last_enterprise_minutes
)
select
  p.user_id,
  300,
  0.10,
  0,
  5
from public.profiles p
left join public.user_minute_balances b on b.user_id = p.user_id
where b.user_id is null;

insert into public.minute_transactions (
  user_id,
  kind,
  source,
  seconds_delta,
  rate_per_minute,
  amount,
  notes
)
select
  p.user_id,
  'signup_credit',
  'free',
  300,
  0.10,
  0,
  'Backfilled free signup credit'
from public.profiles p
left join public.minute_transactions t
  on t.user_id = p.user_id
 and t.kind = 'signup_credit'
where t.id is null;
