-- ═══════════════════════════════════════════════════════════════════════════
-- Finance OS — full PostgreSQL schema for Supabase
-- ═══════════════════════════════════════════════════════════════════════════
-- Aligns with: src/services/types.ts (domain entities).
-- Run in: Supabase → SQL → New query → Run (entire file).
--
-- Conventions:
--   • org-scoped primary keys: text (e.g. org-001, txn-…) matching the app.
--   • user_id: uuid → auth.users (Supabase Auth).
--   • JSON columns: jsonb for nested objects / string[] where the TS type uses arrays/objects.
--   • Tighten RLS policies before production; service_role bypasses RLS for admin jobs.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Extensions (uuid helpers; usually already enabled on Supabase) ──────────
create extension if not exists "pgcrypto";

-- ═══════════════════════════════════════════════════════════════════════════
-- CORE: organizations, profiles, memberships
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.organizations (
  id text primary key,
  slug text unique,
  name text not null,
  logo text,
  currency text not null default 'USD',
  fiscal_year_start text not null default '01-01',
  created_at timestamptz not null default now(),
  settings jsonb not null default '{"theme":"dark","notifications":true}'::jsonb
);

create unique index if not exists idx_organizations_name_unique on public.organizations (lower(trim(name)));
create unique index if not exists idx_organizations_slug_unique on public.organizations (lower(trim(slug)));

comment on table public.organizations is 'Organization / tenant — maps to Organization in types.ts';

-- Profile row per auth user (app User + metadata)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  platform_role text not null default 'organization_user'
    check (platform_role in ('platform_admin', 'platform_manager', 'organization_user')),
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'Extends auth.users — maps to User in types.ts';

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id text not null references public.organizations (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'viewer', 'employee')),
  status text not null default 'active' check (status in ('active', 'pending', 'inactive')),
  portal_type text not null default 'employee',
  department text,
  email text,
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz,
  joined_at timestamptz not null default now(),
  constraint organization_members_user_org_unique unique (user_id, organization_id)
);

comment on table public.organization_members is 'Organization membership with invitation support';
comment on column public.organization_members.email is 'Email for pending invitations (before user account exists)';
comment on column public.organization_members.status is 'active = member, pending = invited but not accepted, inactive = removed';

create index if not exists idx_organization_members_user on public.organization_members (user_id);
create index if not exists idx_organization_members_org on public.organization_members (organization_id);
create index if not exists idx_org_members_email on public.organization_members (email);
create index if not exists idx_org_members_status on public.organization_members (status);
create index if not exists idx_org_members_invited_by on public.organization_members (invited_by);

-- Auto-create profile on signup (optional; safe to run twice if function replaced)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, platform_role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'platform_role', 'organization_user')
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper to check if any platform admin exists (RLS-safe for anonymous login check)
create or replace function public.has_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1 from public.profiles where platform_role = 'platform_admin'
  );
$$;

grant execute on function public.has_platform_admin() to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Accounting & banking
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.accounts (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  code text not null,
  name text not null,
  type text not null check (type in ('asset', 'liability', 'equity', 'income', 'expense')),
  subtype text not null default '',
  currency text not null default 'USD',
  balance numeric not null default 0,
  is_active boolean not null default true,
  parent_account_id text references public.accounts (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create index if not exists idx_accounts_org on public.accounts (organization_id);

create table if not exists public.bank_accounts (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  account_id text not null references public.accounts (id) on delete cascade,
  bank_name text not null default '',
  account_number text not null default '',
  account_type text not null check (
    account_type in ('checking', 'savings', 'credit_card', 'line_of_credit', 'cash', 'online_wallet')
  ),
  currency text not null default 'USD',
  balance numeric not null default 0,
  last_synced_at timestamptz,
  is_active boolean not null default true,
  iban text,
  swift_code text,
  routing_number text,
  usage text check (usage is null or usage in ('personal', 'business'))
);

create index if not exists idx_bank_accounts_org on public.bank_accounts (organization_id);

create table if not exists public.categories (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  name text not null,
  type text not null check (type in ('income', 'expense')),
  account_id text not null references public.accounts (id) on delete cascade,
  color text not null default '#888888',
  icon text not null default 'folder',
  patterns jsonb not null default '[]'::jsonb,
  parent_category_id text references public.categories (id) on delete set null
);

create index if not exists idx_categories_org on public.categories (organization_id);

create table if not exists public.transactions (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  bank_account_id text not null references public.bank_accounts (id) on delete cascade,
  date date not null,
  description text not null default '',
  narration text not null default '',
  amount numeric not null,
  currency text not null default 'USD',
  type text not null check (type in ('debit', 'credit')),
  category_id text references public.categories (id) on delete set null,
  department_id text,
  project_id text,
  status text not null check (status in ('pending', 'classified', 'reviewed', 'reconciled')),
  confidence numeric,
  tags jsonb not null default '["business"]'::jsonb,  -- Default to business tag
  attachments jsonb not null default '[]'::jsonb,
  idempotency_key text,
  original_amount numeric,
  original_currency text,
  fx_rate_to_base numeric,
  base_currency text,
  source_import_id text references public.import_history_records (id) on delete set null,
  created_at timestamptz not null default now(),
  classified_at timestamptz,
  classified_by text
);

create index if not exists idx_transactions_org on public.transactions (organization_id);
create index if not exists idx_transactions_bank on public.transactions (bank_account_id);
create index if not exists idx_transactions_date on public.transactions (date);
create index if not exists idx_transactions_idempotency on public.transactions (organization_id, idempotency_key);
create index if not exists idx_transactions_source_import on public.transactions (source_import_id) where source_import_id is not null;
create index if not exists idx_transactions_org_source on public.transactions (organization_id, source_import_id) where source_import_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- Departments, projects, assets, inventory
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.departments (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  name text not null,
  code text not null default '',
  budget numeric,
  head_id uuid references auth.users (id) on delete set null,
  cost_center text not null default '',
  is_active boolean not null default true
);

create index if not exists idx_departments_org on public.departments (organization_id);

create table if not exists public.projects (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  name text not null,
  code text not null default '',
  client_name text not null default '',
  department_id text not null references public.departments (id) on delete cascade,
  status text not null check (
    status in ('quoted', 'active', 'on_hold', 'completed', 'cancelled')
  ),
  start_date date not null,
  end_date date,
  quoted_amount numeric not null default 0,
  actual_cost numeric not null default 0,
  currency text not null default 'USD'
);

create index if not exists idx_projects_org on public.projects (organization_id);

-- Add FKs from transactions to departments/projects after tables exist
alter table public.transactions
  drop constraint if exists transactions_department_id_fkey;
alter table public.transactions
  add constraint transactions_department_id_fkey
    foreign key (department_id) references public.departments (id) on delete set null;

alter table public.transactions
  drop constraint if exists transactions_project_id_fkey;
alter table public.transactions
  add constraint transactions_project_id_fkey
    foreign key (project_id) references public.projects (id) on delete set null;

create table if not exists public.assets (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  name text not null,
  asset_code text not null,
  category text not null check (
    category in ('property', 'equipment', 'vehicle', 'furniture', 'software', 'other')
  ),
  account_id text not null references public.accounts (id) on delete cascade,
  accumulated_depreciation_account_id text not null references public.accounts (id) on delete cascade,
  depreciation_expense_account_id text not null references public.accounts (id) on delete cascade,
  purchase_date date not null,
  purchase_price numeric not null,
  salvage_value numeric not null default 0,
  useful_life_years numeric not null,
  depreciation_method text not null check (
    depreciation_method in ('straight_line', 'declining_balance', 'units_of_production')
  ),
  current_value numeric not null,
  accumulated_depreciation numeric not null default 0,
  status text not null check (status in ('active', 'disposed', 'fully_depreciated')),
  disposal_date date,
  disposal_amount numeric,
  department_id text references public.departments (id) on delete set null,
  location_details text
);

create table if not exists public.depreciation_schedules (
  id text primary key,
  asset_id text not null references public.assets (id) on delete cascade,
  organization_id text not null references public.organizations (id) on delete cascade,
  period text not null,
  opening_value numeric not null,
  depreciation_amount numeric not null,
  closing_value numeric not null,
  status text not null check (status in ('scheduled', 'posted', 'reversed')),
  journal_entry_id text
);

create index if not exists idx_depreciation_schedules_asset on public.depreciation_schedules (asset_id);

create table if not exists public.inventory_items (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  sku text not null,
  name text not null,
  description text,
  category text not null default '',
  unit text not null default 'unit',
  costing_method text not null check (costing_method in ('fifo', 'lifo', 'weighted_average')),
  current_stock numeric not null default 0,
  reorder_level numeric not null default 0,
  reorder_quantity numeric not null default 0,
  average_cost numeric not null default 0,
  last_cost numeric not null default 0,
  selling_price numeric not null default 0,
  asset_account_id text not null references public.accounts (id) on delete cascade,
  cogs_account_id text not null references public.accounts (id) on delete cascade,
  is_active boolean not null default true,
  unique (organization_id, sku)
);

create table if not exists public.inventory_transactions (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  inventory_item_id text not null references public.inventory_items (id) on delete cascade,
  date date not null,
  type text not null check (type in ('purchase', 'sale', 'adjustment', 'transfer')),
  quantity numeric not null,
  unit_cost numeric not null,
  total_amount numeric not null,
  reference_number text,
  notes text,
  department_id text references public.departments (id) on delete set null,
  project_id text references public.projects (id) on delete set null
);

create table if not exists public.overhead_allocations (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  name text not null,
  allocation_base text not null check (
    allocation_base in ('revenue', 'headcount', 'direct_cost', 'equal')
  ),
  account_ids jsonb not null default '[]'::jsonb,
  departments jsonb not null default '[]'::jsonb
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Recurring, budgets, loans, forecasts
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.recurring_transactions (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  description text not null default '',
  amount numeric not null,
  currency text not null default 'USD',
  type text not null check (type in ('debit', 'credit')),
  category_id text references public.categories (id) on delete cascade,
  bank_account_id text not null references public.bank_accounts (id) on delete cascade,
  frequency text not null check (
    frequency in ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')
  ),
  start_date date not null,
  end_date date,
  next_occurrence date not null,
  is_active boolean not null default true,
  department_id text references public.departments (id) on delete set null,
  project_id text references public.projects (id) on delete set null,
  generated_occurrence_count integer,
  total_occurrences_expected integer
);

create table if not exists public.budgets (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  name text not null,
  period text not null check (period in ('monthly', 'quarterly', 'yearly')),
  start_date date not null,
  end_date date not null,
  category_id text references public.categories (id) on delete set null,
  department_id text references public.departments (id) on delete set null,
  project_id text references public.projects (id) on delete set null,
  budgeted_amount numeric not null default 0,
  spent_amount numeric not null default 0,
  currency text not null default 'USD',
  status text not null check (status in ('active', 'exceeded', 'completed')),
  alert_threshold integer not null default 80 check (alert_threshold between 1 and 100),
  scope text not null default 'business' check (scope in ('business', 'personal')),
  rolled_from_id text references public.budgets (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_budgets_org on public.budgets (organization_id);
create index if not exists idx_budgets_period on public.budgets (organization_id, start_date, end_date);
create index if not exists idx_budgets_category on public.budgets (organization_id, category_id);
create index if not exists idx_budgets_dept on public.budgets (organization_id, department_id);


create table if not exists public.loans (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  type text not null check (type in ('to_receive', 'to_pay')),
  party text not null default '',
  amount numeric not null,
  currency text not null default 'USD',
  principal numeric not null,
  interest_rate numeric,
  total_interest numeric,
  amount_paid numeric,
  remaining_balance numeric,
  due_date date not null,
  start_date date,
  status text not null check (
    status in ('active', 'pending', 'overdue', 'partially_paid', 'paid', 'defaulted')
  ),
  description text not null default '',
  installment_amount numeric,
  frequency text check (frequency is null or frequency in ('monthly', 'quarterly', 'annual')),
  next_payment_date date,
  payments_count integer,
  payments_completed integer
);

create table if not exists public.cash_flow_forecasts (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  date date not null,
  forecasted_income numeric not null default 0,
  forecasted_expenses numeric not null default 0,
  net_cash_flow numeric not null default 0,
  opening_balance numeric not null default 0,
  closing_balance numeric not null default 0,
  currency text not null default 'USD',
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 100)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Sessions & notifications
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.active_sessions (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  user_name text not null default '',
  user_email text not null default '',
  organization_id text not null references public.organizations (id) on delete cascade,
  device_type text not null default '',
  browser text not null default '',
  ip_address text not null default '',
  location text not null default '',
  login_time timestamptz not null default now(),
  last_activity timestamptz not null default now(),
  is_current_session boolean not null default false
);

create index if not exists idx_active_sessions_user on public.active_sessions (user_id);

create table if not exists public.notifications (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id text not null references public.organizations (id) on delete cascade,
  type text not null check (type in ('info', 'warning', 'success', 'error')),
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  action_url text,
  action_label text
);

create index if not exists idx_notifications_user on public.notifications (user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Employee portal
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.employee_expenses (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  description text not null default '',
  amount numeric not null,
  currency text not null default 'USD',
  category text not null default '',
  status text not null check (
    status in ('draft', 'submitted', 'approved', 'rejected', 'reimbursed')
  ),
  receipt_url text,
  notes text,
  project_id text references public.projects (id) on delete set null,
  submitted_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz
);

create index if not exists idx_employee_expenses_org on public.employee_expenses (organization_id);
create index if not exists idx_employee_expenses_user on public.employee_expenses (user_id);

create table if not exists public.employee_payslips (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  period text not null,
  issue_date date not null,
  gross numeric not null,
  deductions jsonb not null default '[]'::jsonb,
  net numeric not null,
  currency text not null default 'USD',
  status text not null check (status in ('draft', 'issued', 'paid'))
);

create table if not exists public.timesheet_entries (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  project_id text not null references public.projects (id) on delete cascade,
  project_name text not null default '',
  hours numeric not null,
  description text not null default '',
  billable boolean not null default true,
  status text not null check (status in ('draft', 'submitted', 'approved'))
);

create index if not exists idx_timesheet_entries_user on public.timesheet_entries (user_id);

create table if not exists public.employee_team_members (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  name text not null,
  email text not null,
  role text not null default '',
  department text not null default '',
  avatar text,
  joined_at timestamptz not null default now(),
  status text not null check (status in ('active', 'away', 'offline'))
);

create table if not exists public.company_announcements (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  title text not null,
  content text not null,
  author text not null default '',
  category text not null check (
    category in ('general', 'hr', 'finance', 'project', 'celebration')
  ),
  created_at timestamptz not null default now(),
  is_pinned boolean not null default false
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Import history & optional AI settings (store secrets server-side in production)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.import_history_records (
  id text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  file_name text not null,
  imported_at timestamptz not null default now(),
  transaction_count integer not null default 0,
  status text not null default 'completed',
  account_name text not null default '',
  auto_placed integer not null default 0,
  needs_review integer not null default 0,
  duplicates_found integer not null default 0
);

create table if not exists public.org_ai_settings (
  organization_id text primary key references public.organizations (id) on delete cascade,
  use_custom_key boolean not null default false,
  provider_name text not null default '',
  model_name text not null default '',
  -- Never expose api_key to the browser; use Edge Functions / vault in production
  api_key_encrypted text
);

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS helper + policies (org isolation)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.is_org_member(p_org_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
  ) or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.platform_role in ('platform_admin', 'platform_manager')
  );
$$;

-- Enable RLS on all tenant tables (adjust policies for platform admins as needed)
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.accounts enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.departments enable row level security;
alter table public.projects enable row level security;
alter table public.assets enable row level security;
alter table public.depreciation_schedules enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.overhead_allocations enable row level security;
alter table public.recurring_transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.loans enable row level security;
alter table public.cash_flow_forecasts enable row level security;
alter table public.active_sessions enable row level security;
alter table public.notifications enable row level security;
alter table public.employee_expenses enable row level security;
alter table public.employee_payslips enable row level security;
alter table public.timesheet_entries enable row level security;
alter table public.employee_team_members enable row level security;
alter table public.company_announcements enable row level security;
alter table public.import_history_records enable row level security;
alter table public.org_ai_settings enable row level security;

-- Profiles: own row only
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (id = auth.uid());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (id = auth.uid());

-- Organization members: proper policies for invitation flow
drop policy if exists "organization_members_select_own" on public.organization_members;
drop policy if exists "org_members_select" on public.organization_members;
drop policy if exists "org_members_insert" on public.organization_members;
drop policy if exists "org_members_update" on public.organization_members;
drop policy if exists "org_members_delete" on public.organization_members;

-- Helper function to get user's organizations (avoids circular RLS dependency)
create or replace function public.user_organizations(check_user_id uuid)
returns table(organization_id text, role text, status text)
language sql
stable
security definer
set search_path = public
as $$
  select 
    organization_id,
    role,
    status
  from organization_members
  where user_id = check_user_id;
$$;

grant execute on function public.user_organizations(uuid) to authenticated;

-- SELECT: Users can see their own memberships and other members in their orgs
create policy "org_members_select" on public.organization_members
for select
using (
  user_id = auth.uid()
  or
  organization_id in (
    select organization_id 
    from user_organizations(auth.uid())
  )
);

-- INSERT: Only admins/owners can invite new members
create policy "org_members_insert" on public.organization_members
for insert
with check (
  organization_id in (
    select organization_id 
    from user_organizations(auth.uid())
    where role in ('admin', 'owner')
  )
);

-- UPDATE: Admins can update member details, users can update their own profile
create policy "org_members_update" on public.organization_members
for update
using (
  user_id = auth.uid()
  or
  organization_id in (
    select organization_id 
    from user_organizations(auth.uid())
    where role in ('admin', 'owner')
  )
);

-- DELETE: Only admins/owners can remove members
create policy "org_members_delete" on public.organization_members
for delete
using (
  organization_id in (
    select organization_id 
    from user_organizations(auth.uid())
    where role in ('admin', 'owner')
  )
);

-- Organizations: readable if member
drop policy if exists "organizations_select_member" on public.organizations;
create policy "organizations_select_member" on public.organizations
  for select using (public.is_org_member(id));

-- Generic org-scoped read for authenticated members (repeat pattern)
drop policy if exists "accounts_org_access" on public.accounts;
create policy "accounts_org_access" on public.accounts
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "bank_accounts_org_access" on public.bank_accounts;
create policy "bank_accounts_org_access" on public.bank_accounts
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "categories_org_access" on public.categories;
create policy "categories_org_access" on public.categories
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "transactions_org_access" on public.transactions;
create policy "transactions_org_access" on public.transactions
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "departments_org_access" on public.departments;
create policy "departments_org_access" on public.departments
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "projects_org_access" on public.projects;
create policy "projects_org_access" on public.projects
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "assets_org_access" on public.assets;
create policy "assets_org_access" on public.assets
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "depreciation_schedules_org_access" on public.depreciation_schedules;
create policy "depreciation_schedules_org_access" on public.depreciation_schedules
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "inventory_items_org_access" on public.inventory_items;
create policy "inventory_items_org_access" on public.inventory_items
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "inventory_transactions_org_access" on public.inventory_transactions;
create policy "inventory_transactions_org_access" on public.inventory_transactions
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "overhead_allocations_org_access" on public.overhead_allocations;
create policy "overhead_allocations_org_access" on public.overhead_allocations
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "recurring_transactions_org_access" on public.recurring_transactions;
create policy "recurring_transactions_org_access" on public.recurring_transactions
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "budgets_org_access" on public.budgets;
drop policy if exists "service_role_budgets_all" on public.budgets;
create policy "service_role_budgets_all" on public.budgets
  for all to service_role using (true) with check (true);

drop policy if exists "auth_budgets_select" on public.budgets;
create policy "auth_budgets_select" on public.budgets
  for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists "auth_budgets_insert" on public.budgets;
create policy "auth_budgets_insert" on public.budgets
  for insert to authenticated with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id::text = auth.uid()::text and role in ('owner', 'admin')
    )
  );

drop policy if exists "auth_budgets_update" on public.budgets;
create policy "auth_budgets_update" on public.budgets
  for update to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id::text = auth.uid()::text and role in ('owner', 'admin')
    )
  );

drop policy if exists "auth_budgets_delete" on public.budgets;
create policy "auth_budgets_delete" on public.budgets
  for delete to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id::text = auth.uid()::text and role in ('owner', 'admin')
    )
  );

drop policy if exists "loans_org_access" on public.loans;
create policy "loans_org_access" on public.loans
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "cash_flow_forecasts_org_access" on public.cash_flow_forecasts;
create policy "cash_flow_forecasts_org_access" on public.cash_flow_forecasts
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "active_sessions_org_access" on public.active_sessions;
create policy "active_sessions_org_access" on public.active_sessions
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "notifications_org_access" on public.notifications;
create policy "notifications_org_access" on public.notifications
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "employee_expenses_org_access" on public.employee_expenses;
create policy "employee_expenses_org_access" on public.employee_expenses
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "employee_payslips_org_access" on public.employee_payslips;
create policy "employee_payslips_org_access" on public.employee_payslips
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "timesheet_entries_org_access" on public.timesheet_entries;
create policy "timesheet_entries_org_access" on public.timesheet_entries
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "employee_team_members_org_access" on public.employee_team_members;
create policy "employee_team_members_org_access" on public.employee_team_members
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "company_announcements_org_access" on public.company_announcements;
create policy "company_announcements_org_access" on public.company_announcements
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "import_history_org_access" on public.import_history_records;
create policy "import_history_org_access" on public.import_history_records
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "org_ai_settings_org_access" on public.org_ai_settings;
create policy "org_ai_settings_org_access" on public.org_ai_settings
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

-- Allow inserts into organization_members for service role / invite flows (client often cannot insert — use Edge Function)
-- You may add: insert policy for org owners only, etc.

comment on function public.is_org_member(text) is 'True if auth.uid() is a member of the given organization.';

-- ═══════════════════════════════════════════════════════════════════════════
-- App JSON bundle (Finance OS in-memory snapshot — same shape as localStorage / SQLite API)
-- Used when the Vite app syncs via Supabase client + authenticated user (see VITE_USE_SUPABASE_DATA).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.finance_os_app_bundle (
  id integer primary key check (id = 1),
  schema_version integer not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.finance_os_app_bundle is 'Single-row JSON bundle for client-side dataStore sync (not normalized business tables).';

alter table public.finance_os_app_bundle enable row level security;

drop policy if exists "finance_os_bundle_authenticated_all" on public.finance_os_app_bundle;
create policy "finance_os_bundle_authenticated_all"
  on public.finance_os_app_bundle
  for all
  to authenticated
  using (true)
  with check (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- Budget Planning Triggers & Auto-Compute Functions
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.budgets_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_budgets_updated_at on public.budgets;
create trigger trg_budgets_updated_at
  before update on public.budgets
  for each row
  execute function public.budgets_set_updated_at();

-- Recomputes spent_amount from transactions upon insert, update, or delete
create or replace function public.budget_recompute_spent()
returns trigger language plpgsql security definer as $$
declare
  v_org_id text;
  v_date   date;
  v_cat_id text;
  v_dept_id text;
  v_proj_id text;
begin
  if tg_op = 'DELETE' then
    v_org_id  := old.organization_id;
    v_date    := old.date::date;
    v_cat_id  := old.category_id;
    v_dept_id := old.department_id;
    v_proj_id := old.project_id;
  else
    v_org_id  := new.organization_id;
    v_date    := new.date::date;
    v_cat_id  := new.category_id;
    v_dept_id := new.department_id;
    v_proj_id := new.project_id;
  end if;

  update public.budgets b
  set spent_amount = coalesce((
    select sum(abs(t.amount))
    from public.transactions t
    where t.organization_id = b.organization_id
      and t.type = 'debit'
      and t.date::date >= b.start_date
      and t.date::date <= b.end_date
      and (b.category_id is null or t.category_id = b.category_id)
      and (b.department_id is null or t.department_id = b.department_id or t.project_id in (select p.id from public.projects p where p.department_id = b.department_id))
      and (b.project_id is null or t.project_id = b.project_id)
  ), 0)
  where b.organization_id = v_org_id
    and b.start_date <= v_date
    and b.end_date   >= v_date
    and b.status != 'completed';

  update public.budgets
  set status = case
    when spent_amount >= budgeted_amount then 'exceeded'
    else 'active'
  end
  where organization_id = v_org_id
    and start_date <= v_date
    and end_date   >= v_date
    and status != 'completed';

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_budget_recompute_on_txn on public.transactions;
create trigger trg_budget_recompute_on_txn
  after insert or update or delete on public.transactions
  for each row
  execute function public.budget_recompute_spent();

-- Helper: On-demand recomputation of all budgets for an organization
create or replace function public.budget_recompute_all_for_org(p_org_id text)
returns void language plpgsql security definer as $$
begin
  update public.budgets b
  set spent_amount = coalesce((
    select sum(abs(t.amount))
    from public.transactions t
    where t.organization_id = b.organization_id
      and t.type = 'debit'
      and t.date::date >= b.start_date
      and t.date::date <= b.end_date
      and (b.category_id is null or t.category_id = b.category_id)
      and (b.department_id is null or t.department_id = b.department_id or t.project_id in (select p.id from public.projects p where p.department_id = b.department_id))
      and (b.project_id is null or t.project_id = b.project_id)
  ), 0)
  where b.organization_id = p_org_id
    and b.status != 'completed';

  update public.budgets
  set status = case
    when spent_amount >= budgeted_amount then 'exceeded'
    else 'active'
  end
  where organization_id = p_org_id
    and status != 'completed';
end;
$$;
