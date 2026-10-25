export type Language = 'en' | 'ar'
export type Theme = 'dark' | 'light'

export interface PermissionUser {
  id: string
  email: string
  full_name: string
  role_id: string
  role_key: string
  language: Language
  theme: Theme
  permissions: string[]
}

export interface PublicConfig {
  companyNameEn: string
  companyNameAr: string
  logoUrl: string | null
  demoMode: boolean
  currency: string
  showDemoCredentials: boolean
}

export interface Paginated<T> {
  data: T[]
  total: number
  page?: number
  pageSize?: number
}

export interface Vehicle {
  id: string
  vehicle_no: string
  plate: string
  make: string
  model: string
  category: string
  year: number | null
  seats: number
  status: string
  registration_expiry: string | null
  insurance_expiry: string | null
  odometer: number
  acquisition_cost: number | null
  acquisition_date: string | null
  assigned_driver_id: string | null
  notes: string | null
  documents: unknown[]
  archived_at: string | null
  created_at: string
  updated_at: string
  driver_name: string | null
  driver_phone: string | null
  trips: number
  revenue: number
  expenses: number
  profit: number
  busy_hours: string | number
  utilization: number
}

export interface VehicleDetail {
  vehicle: Vehicle
  trips: Trip[]
  maintenance: MaintenanceRecord[]
  financial: {
    revenue: number
    expenses: number
    completed_trips: number
    cancelled_trips: number
  }
  expenseBreakdown: { name_en: string; name_ar: string; amount: number }[]
}

export interface Driver {
  id: string
  driver_no: string
  full_name: string
  phone: string | null
  email: string | null
  license_no: string
  license_expiry: string | null
  status: string
  hire_date: string | null
  notes: string | null
  monthly_salary: number | null
  trips: number
  revenue: number
  cancelled: number
  archived_at: string | null
  created_at: string
}

export interface FixedRoute {
  id: string
  route_no: string
  name_en: string
  name_ar: string
  origin: string
  destination: string
  stops: string[]
  operating_days: number[]
  departure_time: string
  duration_minutes: number
  price: number
  default_vehicle_id: string | null
  default_driver_id: string | null
  effective_from: string
  effective_to: string | null
  status: string
  notes: string | null
  vehicle_plate: string | null
  driver_name: string | null
  trips: number
  completed_trips: number
  cancelled_trips: number
  revenue: number
  expenses: number
  profit: number
  schedules: RouteSchedule[]
}

export interface RouteSchedule {
  id: string
  days_of_week: number[]
  departure_time: string
  duration_minutes: number
  effective_from: string
  effective_to: string | null
  status: string
}

export interface Customer {
  id: string
  customer_no: string
  name: string
  type: string
  contact_name: string | null
  phone: string | null
  email: string | null
  tax_id: string | null
  address: string | null
  notes: string | null
  active_contracts: number
  invoiced: number
  collected: number
  outstanding: number
  created_at: string
}

export interface Trip {
  id: string
  trip_no: string
  trip_type: string
  route_id: string | null
  schedule_id: string | null
  occurrence_key: string | null
  customer_id: string | null
  contract_id: string | null
  vehicle_id: string | null
  driver_id: string | null
  origin: string
  destination: string
  stops: string[]
  scheduled_departure: string
  expected_arrival: string | null
  actual_departure: string | null
  actual_arrival: string | null
  distance_km: number | null
  quoted_price: number
  additional_charges: number
  discount: number
  recognized_revenue: number
  status: string
  cancellation_reason: string | null
  notes: string | null
  customer_name: string | null
  vehicle_plate: string | null
  vehicle_make: string | null
  vehicle_model: string | null
  driver_name: string | null
  route_name: string | null
  route_name_ar: string | null
  contract_no: string | null
  contract_title: string | null
  created_at: string
}

export interface TripDetail {
  trip: Trip
  expenses: Expense[]
  invoices: Record<string, unknown>[]
}

export interface Contract {
  id: string
  contract_no: string
  customer_id: string
  title: string
  start_date: string
  end_date: string
  contract_type: string
  contract_value: number
  unit_rate: number | null
  billing_frequency: string
  payment_terms: string | null
  payment_terms_days: number
  grace_days: number
  included_trips: number | null
  included_hours: number | null
  recognition_method: string
  status: string
  document_url: string | null
  notes: string | null
  archived_at: string | null
  customer_name: string
  contact_name: string | null
  customer_phone: string | null
  customer_email?: string | null
  vehicles: ContractVehicle[]
  routes: FixedRoute[]
  recognition_count: number
  recognized: number
  fixed_revenue: number
  variable_revenue: number
  invoiced: number
  collected: number
  outstanding: number
  allocated_costs: number
  profit: number
  days_to_expiry: number
  renewal_due: boolean
}

export interface ContractVehicle {
  id: string
  vehicle_no: string
  plate: string
  make: string
  model: string
  category: string
  year?: number
  status?: string
  allocation_percent: number
}

export interface ContractDetail {
  contract: Contract
  vehicles: ContractVehicle[]
  routes: FixedRoute[]
  recognitions: ContractRecognition[]
  invoices: Invoice[]
  trips: Trip[]
  financials: {
    recognized: number
    fixed_revenue: number
    variable_revenue: number
    invoiced: number
    collected: number
    outstanding: number
    allocated_costs: number
    profit: number
  }
}

export interface ContractRecognition {
  id: string
  contract_id: string
  trip_id: string | null
  period_start: string
  period_end: string
  amount: number
  recognition_type: string
  status: string
  notes: string | null
  created_at: string
}

export interface Invoice {
  id: string
  invoice_no: string
  customer_id: string
  contract_id: string | null
  issue_date: string
  due_date: string
  period_start: string | null
  period_end: string | null
  subtotal: number
  tax: number
  total: number
  amount_paid: number
  status: string
  notes: string | null
  void_reason: string | null
  customer_name: string
  contract_no: string | null
  balance: number
  line_count: number
  payment_count: number
}

export interface InvoiceLine {
  id: string
  invoice_id: string
  trip_id: string | null
  contract_id: string | null
  description: string
  quantity: number
  unit_price: number
  line_total: number
  revenue_category: string
}

export interface Payment {
  id: string | number
  payment_no: string
  invoice_id: string
  amount: number
  payment_date: string
  method: string
  reference: string | null
  idempotency_key?: string
  notes: string | null
  invoice_no: string
  invoice_total: number
  customer_name: string
  created_at: string
}

export interface InvoiceDetail {
  invoice: Invoice & {
    contact_name: string | null
    customer_phone: string | null
    customer_email: string | null
    customer_address: string | null
    customer_tax_id: string | null
    contract_title: string | null
  }
  lines: InvoiceLine[]
  payments: Payment[]
  settings: BusinessSettings
}

export interface Receivable {
  id: string
  name: string
  customer_no: string
  phone: string | null
  open_invoices: number
  invoiced: number
  collected: number
  outstanding: number
  overdue: string | number
}

export interface Expense {
  id: string
  expense_no: string
  expense_date: string
  category_id: string
  description: string
  amount: number
  vendor: string | null
  vehicle_id: string | null
  driver_id: string | null
  trip_id: string | null
  contract_id: string | null
  maintenance_id: string | null
  is_operating: boolean
  status: string
  void_reason: string | null
  notes: string | null
  category_name_en: string
  category_name_ar: string
  category_key: string
  vehicle_plate: string | null
  driver_name: string | null
  contract_no: string | null
  trip_no: string | null
  allocations?: ExpenseAllocation[]
  created_at: string
}

export interface ExpenseAllocation {
  id?: string
  vehicle_id?: string | null
  contract_id?: string | null
  trip_id?: string | null
  allocated_amount: number
  method: string
  percent?: number | null
  notes?: string | null
}

export interface ExpenseCategory {
  id: string
  key: string
  name_en: string
  name_ar: string
  is_operating: boolean
  is_system: boolean
  is_active: boolean
}

export interface MaintenanceRecord {
  id: string
  record_no: string
  vehicle_id: string
  maintenance_type: string
  description: string
  start_date: string
  end_date: string
  cost: number
  vendor: string | null
  odometer: number | null
  status: string
  notes: string | null
  expense_id: string | null
  vehicle_plate: string
  make: string
  model: string
  expense_no: string | null
}

export interface Notification {
  id: string
  user_id: string
  title: string
  message: string
  type: string
  link: string | null
  is_read: boolean
  created_at: string
}

export interface User {
  id: string
  email: string
  full_name: string
  role_id: string
  role_key: string
  role_name_en?: string
  role_name_ar?: string
  is_active: boolean
  language?: Language
  theme?: Theme
  last_login_at: string | null
  created_at: string
}

export interface Role {
  id: string
  key: string
  name_en: string
  name_ar: string
  description: string | null
  is_system: boolean
  created_at: string
}

export interface Permission {
  role_id: string
  key: string
  module: string
  name_en: string
  name_ar: string
}

export interface UsersResponse {
  data: User[]
  roles: Role[]
  permissions: Permission[]
}

export interface BusinessSettings {
  id: number
  company_name_en: string
  company_name_ar: string
  logo_url: string | null
  currency: string
  vat_rate: number
  trip_buffer_minutes: number
  operating_hours_per_day: number
  timezone: string
  demo_mode: boolean
  invoice_terms_days: number
  updated_at: string
}

export interface DashboardData {
  range: { from: string; to: string }
  previousRange: { from: string; to: string }
  hasPrevious: boolean
  currency: string
  demoMode: boolean
  kpis: {
    totalTrips: number
    completedTrips: number
    scheduledTrips: number
    cancelledTrips: number
    missedTrips: number
    totalVehicles: number
    availableVehicles: number
    operatingVehicles: number
    maintenanceVehicles: number
    activeDrivers: number
    activeContracts: number
    expiringContracts: number
    recognizedRevenue: number
    tripRevenue: number
    contractRevenue: number
    invoicesIssued: number
    paymentsCollected: number
    outstandingReceivables: number
    operatingExpenses: number
    netOperatingProfit: number
    netMargin: number
    utilization: number
  }
  previous: {
    recognizedRevenue: number
    tripRevenue: number
    contractRevenue: number
    operatingExpenses: number
    netOperatingProfit: number
    totalTrips: number
    completedTrips: number
  } | null
  charts: {
    dailyTrips: Array<{
      date: string
      route: string
      route_id: string
      trips: number
      completed: number
      revenue: number
    }>
    vehicleFinancials: Array<{
      id: string
      vehicle_no: string
      plate: string
      make: string
      model: string
      status: string
      trips: number
      trip_revenue: number
      fixed_revenue: number
      revenue: number
      expenses: number
      profit: number
      hours: number
    }>
    expenseByVehicleCategory: Array<{
      vehicle_id: string
      category_id: string
      category_key: string
      name_en: string
      name_ar: string
      amount: number
    }>
    contractPerformance: Array<{
      id: string
      contract_no: string
      title: string
      status: string
      start_date: string
      end_date: string
      customer_name: string
      fixed_revenue: number
      variable_revenue: number
      invoiced: number
      collected: number
      outstanding: number
      allocated_costs: number
      recognized: number
      profit: number
    }>
    fixedVsPrivate: Array<{
      trip_type: string
      trips: number
      completed: number
      revenue: number
      expenses: number
    }>
  }
  recentTrips: Trip[]
}

export interface ScheduleData {
  vehicles: Array<{
    id: string
    vehicle_no: string
    plate: string
    make: string
    model: string
    category: string
    seats: number
    status: string
    driver_name: string | null
  }>
  trips: Trip[]
  maintenance: MaintenanceRecord[]
  range: { from: string; to: string }
  bufferMinutes: number
}

export interface ReportsData {
  range: { from: string; to: string }
  generatedAt: string
  vehicles: Array<{
    vehicle_no: string
    plate: string
    make: string
    model: string
    category: string
    status: string
    trips: number
    revenue: number
    expenses: number
    profit: number
    hours: number
  }>
  routes: Array<{
    route_no: string
    name_en: string
    name_ar: string
    origin: string
    destination: string
    price: number
    status: string
    trips: number
    completed: number
    revenue: number
    expenses: number
  }>
  contracts: Array<{
    contract_no: string
    title: string
    contract_type: string
    status: string
    start_date: string
    end_date: string
    contract_value: number
    customer_name: string
    fixed_revenue: number
    variable_revenue: number
    invoiced: number
    collected: number
    outstanding: number
    costs: string | number
    recognized: number
    profit: number
  }>
  customers: Array<{
    name: string
    customer_no: string
    type: string
    invoiced: number
    collected: number
    outstanding: number
    trip_revenue: number
    active_contracts: number
  }>
  drivers: Array<{
    driver_no: string
    full_name: string
    phone: string | null
    license_no: string
    license_expiry: string | null
    status: string
    monthly_salary: number | null
    trips: number
    revenue: number
    compensation: string | number
  }>
  salaryMasked: boolean
  maintenance: MaintenanceRecord[]
  expenseCategories: Array<{
    key: string
    name_en: string
    name_ar: string
    is_operating: boolean
    amount: number
    count: number
  }>
  aging: {
    current: string | number
    days_1_30: string | number
    days_31_60: string | number
    days_60_plus: string | number
  }
  comparison: Array<{ trip_type: string; trips: number; completed: number; revenue: number; expenses: number }>
  monthly: Array<{ month: string; trips: number; completed: number; revenue: number }>
  daily: Array<{ date: string; trips: number; completed: number; revenue: number }>
  receivables: Array<{
    invoice_no: string
    issue_date: string
    due_date: string
    total: number
    amount_paid: number
    balance: number
    status: string
    customer_name: string
    contract_no: string | null
    days_overdue: number
  }>
}

export interface SystemInfo {
  counts: {
    vehicles: number
    drivers: number
    trips: number
    contracts: number
    invoices: number
    payments: number
    expenses: number
  }
  database: string
  timezone: string
  date: string
}

export interface AuditLog {
  id: string
  actor_id: string | null
  actor_name: string | null
  action: string
  entity_type: string
  entity_id: string | null
  before_data: unknown
  after_data: unknown
  ip_address: string | null
  created_at: string
}
