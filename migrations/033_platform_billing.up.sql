-- 033_platform_billing
--
-- Sahə mənbəyi: Faz 3.1 Final Technical Freeze, bölmə 10 (Platform Billing vs
-- Center Finance) — cədvəl ADLARI orada verilib, AMMA konkret sütun siyahısı
-- verilməyib (yalnız "PLATFORM BILLING (yalnız PLATFORM_ADMIN, tenant RLS-ə
-- tabe deyil): subscription_plans, organization_subscriptions,
-- subscription_invoices, subscription_payments" adları qeyd olunub).
--
-- QEYD (SPEC GAP): dəqiq sütun siyahısı, plan lifecycle state machine,
-- "yalnız bir aktiv subscription" qaydası və subscription_payments üçün
-- allocation/refund modeli HEÇ BİR sənəddə konkretləşdirilməyib. Bu fazda
-- YALNIZ minimal, strukturca təhlükəsiz schema yaradılır — əlavə biznes
-- qaydası UYDURULMUR. Yeganə konkret istinad Faz 0-2/Faz 3-dəki (split-dən
-- ƏVVƏLKİ) "subscriptions(id, organization_id, plan, seats_limit,
-- started_at, expires_at, status)" sətridir — bu, "organization_subscriptions"
-- üçün minimal sahə seçimində istinad kimi istifadə olunub (uydurma deyil,
-- mövcud mətndən).
--
-- KRİTİK: bu cədvəllər "platform_billing" AYRICA SCHEMA-dadır, "public"
-- (tenant) schema-sında DEYİL. Tenant RLS pattern-i BURAYA TƏTBİQ OLUNMUR
-- (Faz 3.1 FINAL qərarı) — çünki PLATFORM_ADMIN bütün organization-ların
-- billing məlumatını görməlidir, "app.current_org" tək-tenant konsepti
-- burada mənasızdır. İzolyasiya YALNIZ application-layer-də (rol yoxlaması)
-- təmin olunur (bax bənd 9, FINAL REPORT-da sənədləşdirilib).

CREATE SCHEMA IF NOT EXISTS platform_billing;

GRANT USAGE ON SCHEMA platform_billing TO cdos_app;
GRANT USAGE, CREATE ON SCHEMA platform_billing TO cdos_migrator;

CREATE TABLE platform_billing.subscription_plans (
  id          UUID NOT NULL DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  price       NUMERIC(12,2),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (price IS NULL OR price >= 0)
);

CREATE TABLE platform_billing.organization_subscriptions (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  plan_id         UUID NOT NULL REFERENCES platform_billing.subscription_plans(id) ON DELETE RESTRICT,
  seats_limit     INTEGER,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX idx_org_subscriptions_org ON platform_billing.organization_subscriptions(organization_id);
CREATE INDEX idx_org_subscriptions_plan ON platform_billing.organization_subscriptions(plan_id);

CREATE TABLE platform_billing.subscription_invoices (
  id                            UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id               UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  organization_subscription_id  UUID NOT NULL REFERENCES platform_billing.organization_subscriptions(id) ON DELETE RESTRICT,
  amount                        NUMERIC(12,2) NOT NULL,
  status                        TEXT NOT NULL DEFAULT 'issued',
  issued_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date                      DATE,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (amount >= 0)
);
CREATE INDEX idx_sub_invoices_org ON platform_billing.subscription_invoices(organization_id);
CREATE INDEX idx_sub_invoices_subscription ON platform_billing.subscription_invoices(organization_subscription_id);

CREATE TRIGGER trg_sub_invoices_no_delete
  BEFORE DELETE ON platform_billing.subscription_invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_no_physical_delete();

CREATE TABLE platform_billing.subscription_payments (
  id                      UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  subscription_invoice_id UUID REFERENCES platform_billing.subscription_invoices(id) ON DELETE RESTRICT,
  amount                  NUMERIC(12,2) NOT NULL,
  method                  TEXT,
  paid_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CHECK (amount > 0)
);
CREATE INDEX idx_sub_payments_org ON platform_billing.subscription_payments(organization_id);
CREATE INDEX idx_sub_payments_invoice ON platform_billing.subscription_payments(subscription_invoice_id);

CREATE TRIGGER trg_sub_payments_no_delete
  BEFORE DELETE ON platform_billing.subscription_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_no_physical_delete();

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform_billing TO cdos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE cdos_migrator IN SCHEMA platform_billing
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cdos_app;
