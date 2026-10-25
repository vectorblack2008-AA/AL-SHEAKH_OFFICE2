-- Al-Sheikh Office — PostgreSQL schema
-- The same schema is compatible with Supabase/PostgreSQL (PGlite is used for local persistence).

CREATE TABLE IF NOT EXISTS app_meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permissions (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  module text NOT NULL,
  name_en text NOT NULL,
  name_ar text NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id text NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id text NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  role_id text NOT NULL REFERENCES roles(id),
  is_active boolean NOT NULL DEFAULT true,
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en','ar')),
  theme text NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark','light')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id text NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  effect text NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow','deny')),
  PRIMARY KEY (user_id, permission_id)
);

CREATE TABLE IF NOT EXISTS business_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  company_name_en text NOT NULL DEFAULT 'Al-Sheikh Office',
  company_name_ar text NOT NULL DEFAULT 'مكتب الشيخ',
  logo_url text,
  currency text NOT NULL DEFAULT 'EGP',
  vat_rate numeric(6,2) NOT NULL DEFAULT 14 CHECK (vat_rate >= 0 AND vat_rate <= 100),
  trip_buffer_minutes integer NOT NULL DEFAULT 30 CHECK (trip_buffer_minutes >= 0),
  operating_hours_per_day numeric(5,2) NOT NULL DEFAULT 12,
  timezone text NOT NULL DEFAULT 'Africa/Cairo',
  demo_mode boolean NOT NULL DEFAULT false,
  invoice_terms_days integer NOT NULL DEFAULT 30,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS drivers (
  id text PRIMARY KEY,
  driver_no text NOT NULL UNIQUE,
  full_name text NOT NULL,
  phone text,
  email text,
  license_no text NOT NULL UNIQUE,
  license_expiry date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_leave','inactive')),
  monthly_salary numeric(16,2) CHECK (monthly_salary >= 0),
  hire_date date,
  notes text,
  archived_at timestamptz,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id text PRIMARY KEY,
  vehicle_no text NOT NULL UNIQUE,
  plate text NOT NULL UNIQUE,
  make text NOT NULL,
  model text NOT NULL,
  category text NOT NULL DEFAULT 'van',
  year integer,
  seats integer NOT NULL CHECK (seats > 0),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','scheduled','on_trip','under_maintenance','inactive')),
  registration_expiry date,
  insurance_expiry date,
  odometer numeric(12,1) NOT NULL DEFAULT 0,
  acquisition_cost numeric(16,2) CHECK (acquisition_cost >= 0),
  acquisition_date date,
  assigned_driver_id text REFERENCES drivers(id) ON DELETE SET NULL,
  notes text,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  archived_at timestamptz,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS routes (
  id text PRIMARY KEY,
  route_no text NOT NULL UNIQUE,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  origin text NOT NULL,
  destination text NOT NULL,
  stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  operating_days jsonb NOT NULL DEFAULT '[0,1,2,3,4]'::jsonb,
  departure_time text NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
  price numeric(16,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  default_vehicle_id text REFERENCES vehicles(id) ON DELETE SET NULL,
  default_driver_id text REFERENCES drivers(id) ON DELETE SET NULL,
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  notes text,
  archived_at timestamptz,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS route_schedules (
  id text PRIMARY KEY,
  route_id text NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  days_of_week jsonb NOT NULL,
  departure_time text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id text PRIMARY KEY,
  customer_no text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'company' CHECK (type IN ('company','institution','individual')),
  contact_name text,
  phone text,
  email text,
  tax_id text,
  address text,
  notes text,
  archived_at timestamptz,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contracts (
  id text PRIMARY KEY,
  contract_no text NOT NULL UNIQUE,
  customer_id text NOT NULL REFERENCES customers(id),
  title text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  contract_type text NOT NULL CHECK (contract_type IN ('monthly','annual','per_trip','per_km','hybrid')),
  contract_value numeric(16,2) NOT NULL DEFAULT 0 CHECK (contract_value >= 0),
  unit_rate numeric(16,2) CHECK (unit_rate >= 0),
  billing_frequency text NOT NULL DEFAULT 'monthly' CHECK (billing_frequency IN ('monthly','annual','per_trip','per_km')),
  payment_terms text,
  payment_terms_days integer NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
  grace_days integer NOT NULL DEFAULT 0 CHECK (grace_days >= 0),
  included_trips integer,
  included_hours numeric(10,2),
  recognition_method text NOT NULL DEFAULT 'straight_line' CHECK (recognition_method IN ('straight_line','service_period','per_trip','usage')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','expired','archived')),
  document_url text,
  notes text,
  archived_at timestamptz,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS contract_vehicles (
  contract_id text NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  vehicle_id text NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  allocation_percent numeric(6,2) NOT NULL DEFAULT 100 CHECK (allocation_percent >= 0 AND allocation_percent <= 100),
  PRIMARY KEY (contract_id, vehicle_id)
);

CREATE TABLE IF NOT EXISTS contract_routes (
  contract_id text NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  route_id text NOT NULL REFERENCES routes(id) ON DELETE RESTRICT,
  PRIMARY KEY (contract_id, route_id)
);

CREATE TABLE IF NOT EXISTS trips (
  id text PRIMARY KEY,
  trip_no text NOT NULL UNIQUE,
  trip_type text NOT NULL CHECK (trip_type IN ('fixed','private')),
  route_id text REFERENCES routes(id) ON DELETE SET NULL,
  schedule_id text REFERENCES route_schedules(id) ON DELETE SET NULL,
  occurrence_key text UNIQUE,
  customer_id text REFERENCES customers(id) ON DELETE SET NULL,
  contract_id text REFERENCES contracts(id) ON DELETE SET NULL,
  vehicle_id text REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_id text REFERENCES drivers(id) ON DELETE SET NULL,
  origin text NOT NULL,
  destination text NOT NULL,
  stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  scheduled_departure timestamp NOT NULL,
  expected_arrival timestamp,
  actual_departure timestamp,
  actual_arrival timestamp,
  distance_km numeric(10,2) CHECK (distance_km >= 0),
  quoted_price numeric(16,2) NOT NULL DEFAULT 0 CHECK (quoted_price >= 0),
  additional_charges numeric(16,2) NOT NULL DEFAULT 0 CHECK (additional_charges >= 0),
  discount numeric(16,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  recognized_revenue numeric(16,2) NOT NULL DEFAULT 0 CHECK (recognized_revenue >= 0),
  status text NOT NULL DEFAULT 'new_request' CHECK (status IN ('new_request','pending_confirmation','confirmed','scheduled','in_progress','completed','cancelled','missed')),
  cancellation_reason text,
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS revenue_recognitions (
  id text PRIMARY KEY,
  contract_id text NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  trip_id text REFERENCES trips(id) ON DELETE SET NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  amount numeric(16,2) NOT NULL CHECK (amount >= 0),
  recognition_type text NOT NULL DEFAULT 'fixed' CHECK (recognition_type IN ('fixed','variable','adjustment')),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, period_start, period_end, recognition_type)
);

CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY,
  invoice_no text NOT NULL UNIQUE,
  customer_id text NOT NULL REFERENCES customers(id),
  contract_id text REFERENCES contracts(id) ON DELETE SET NULL,
  issue_date date NOT NULL,
  due_date date NOT NULL,
  period_start date,
  period_end date,
  subtotal numeric(16,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax numeric(16,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total numeric(16,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  amount_paid numeric(16,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','partial','paid','overdue','void')),
  notes text,
  void_reason text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_invoice_period
  ON invoices(contract_id, period_start, period_end)
  WHERE contract_id IS NOT NULL AND period_start IS NOT NULL AND period_end IS NOT NULL AND status <> 'void';

CREATE TABLE IF NOT EXISTS invoice_lines (
  id text PRIMARY KEY,
  invoice_id text NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  trip_id text REFERENCES trips(id) ON DELETE SET NULL,
  contract_id text REFERENCES contracts(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric(12,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(16,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  line_total numeric(16,2) NOT NULL DEFAULT 0 CHECK (line_total >= 0),
  revenue_category text NOT NULL DEFAULT 'service',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_line_trip
  ON invoice_lines(trip_id)
  WHERE trip_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  payment_no text NOT NULL UNIQUE,
  invoice_id text NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount numeric(16,2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL,
  method text NOT NULL DEFAULT 'bank_transfer' CHECK (method IN ('cash','bank_transfer','card','cheque')),
  reference text,
  idempotency_key text UNIQUE,
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS maintenance_records (
  id text PRIMARY KEY,
  record_no text NOT NULL UNIQUE,
  vehicle_id text NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  maintenance_type text NOT NULL,
  description text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  cost numeric(16,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  vendor text,
  odometer numeric(12,1),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  is_operating boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
  id text PRIMARY KEY,
  expense_no text NOT NULL UNIQUE,
  expense_date date NOT NULL,
  category_id text NOT NULL REFERENCES expense_categories(id),
  description text NOT NULL,
  amount numeric(16,2) NOT NULL CHECK (amount > 0),
  vendor text,
  vehicle_id text REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_id text REFERENCES drivers(id) ON DELETE SET NULL,
  trip_id text REFERENCES trips(id) ON DELETE SET NULL,
  contract_id text REFERENCES contracts(id) ON DELETE SET NULL,
  maintenance_id text UNIQUE REFERENCES maintenance_records(id) ON DELETE SET NULL,
  is_operating boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  void_reason text,
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE maintenance_records
  ADD COLUMN IF NOT EXISTS expense_id text REFERENCES expenses(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS expense_allocations (
  id text PRIMARY KEY,
  expense_id text NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  vehicle_id text REFERENCES vehicles(id) ON DELETE SET NULL,
  contract_id text REFERENCES contracts(id) ON DELETE SET NULL,
  trip_id text REFERENCES trips(id) ON DELETE SET NULL,
  allocated_amount numeric(16,2) NOT NULL CHECK (allocated_amount >= 0),
  method text NOT NULL DEFAULT 'manual' CHECK (method IN ('mileage','hours','trip_count','fixed','manual')),
  percent numeric(6,2) CHECK (percent >= 0 AND percent <= 100),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (vehicle_id IS NOT NULL OR contract_id IS NOT NULL OR trip_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'info' CHECK (type IN ('info','success','warning','danger')),
  link text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  actor_name text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS vehicle_seq START 1;
CREATE SEQUENCE IF NOT EXISTS driver_seq START 1;
CREATE SEQUENCE IF NOT EXISTS route_seq START 1;
CREATE SEQUENCE IF NOT EXISTS trip_seq START 1;
CREATE SEQUENCE IF NOT EXISTS customer_seq START 1;
CREATE SEQUENCE IF NOT EXISTS contract_seq START 1;
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1;
CREATE SEQUENCE IF NOT EXISTS payment_seq START 1;
CREATE SEQUENCE IF NOT EXISTS expense_seq START 1;
CREATE SEQUENCE IF NOT EXISTS maintenance_seq START 1;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','business_settings','drivers','vehicles','routes','route_schedules','customers','contracts','trips','invoices','payments','maintenance_records','expenses']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_trips_departure ON trips (scheduled_departure);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle ON trips (vehicle_id, scheduled_departure);
CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips (driver_id, scheduled_departure);
CREATE INDEX IF NOT EXISTS idx_trips_route ON trips (route_id, scheduled_departure);
CREATE INDEX IF NOT EXISTS idx_trips_contract ON trips (contract_id, scheduled_departure);
CREATE INDEX IF NOT EXISTS idx_trips_customer ON trips (customer_id, scheduled_departure);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips (status, scheduled_departure);
CREATE INDEX IF NOT EXISTS idx_trips_type ON trips (trip_type, scheduled_departure);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_vehicle ON expenses (vehicle_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_contract ON expenses (contract_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_trip ON expenses (trip_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices (customer_id, issue_date);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (status, due_date);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments (invoice_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_vehicle ON maintenance_records (vehicle_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance_records (status);
CREATE INDEX IF NOT EXISTS idx_contracts_customer ON contracts (customer_id, status);
CREATE INDEX IF NOT EXISTS idx_contracts_dates ON contracts (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recognitions_period ON revenue_recognitions (period_start, period_end, status);
CREATE INDEX IF NOT EXISTS idx_routes_status ON routes (status);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles (status);
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers (status);
