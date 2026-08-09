# CDOS — Child Development OS (Backend)

Çoxmərkəzli uşaq inkişafı və reabilitasiya idarəetmə platforması — backend.

## Status: Faz 3.2 (Core + Identity + Tenant + Specialist Assignment)

Bu commit yalnız **001–010 migration-ları** və onların tələb etdiyi minimal
DB infrastrukturu + auth/scope-cache/assignment servis səviyyəsini əhatə edir.
`children`, `assessments`, `plans`, `sessions` (klinik), `reports`, `documents`,
`finance`, `consents`, `ai`, `notifications`, `audit_logs` — **011+ fazların işidir**.

Əsas mənbə sənədləri: Faz 0–2 (Arxitektura), Faz 3 (Audit/Blueprint), **Faz 3.1 (Final Technical Freeze — məcburi əsas)**.

## Quraşdırma

```bash
npm install
cp .env.example .env   # dəyərləri doldurun
```

### DB rolları (bir dəfəlik, superuser tələb edir)

```bash
psql "postgresql://postgres@host:5432/postgres" -f scripts/bootstrap-db-roles.sql
```

Yaradır: `cdos_migrator` (BYPASSRLS, yalnız migration/seed üçün) və
`cdos_app` (RLS-ə tabedir, backend YALNIZ bununla qoşulur).

### Migration-lar

```bash
npm run migrate:status
npm run migrate:up
npm run migrate:down   # son migrationu geri qaytarır
```

### Test / build / lint

```bash
npm test         # real Postgres tələb edir (DATABASE_MIGRATOR_URL / DATABASE_APP_URL)
npm run typecheck
npm run build
npm run lint
```

## Arxitektura qısaca

- **Tenant isolation:** hər tenant cədvəlində `organization_id` + Postgres RLS
  (`CREATE TABLE` ilə EYNİ migration daxilində aktivləşdirilir, `FORCE ROW LEVEL SECURITY`)
  + composite FK-lər (`(organization_id, id)` UNIQUE, `(organization_id, xxx_id)` FK) —
  cross-tenant əlaqə DB səviyyəsində mümkün deyil.
- **JWT:** minimal payload — `{ user_id, active_organization_id, session_id, iat, exp }`.
  Rol/filial/icazə heç vaxt JWT-də saxlanmır — server-side, hər sorğuda həll olunur.
- **Branch scope:** `organization_members.scope_type` (`ALL_BRANCHES` / `SELECTED_BRANCHES` /
  `NO_BRANCH`), default `NO_BRANCH` — **fail-closed**.
- **Scope cache:** `src/scope-cache` — Redis mövcud olmadıqda in-memory fallback,
  TTL 5 dəq, rol/filial dəyişəndə dərhal invalidasiya.
- **Specialist assignment:** `specialist_child_assignments`, partial unique index
  (`WHERE status='ACTIVE'`), authority: CENTER_ADMIN/BRANCH_ADMIN/SUPERVISOR yarada bilər,
  yalnız CENTER_ADMIN/BRANCH_ADMIN bitirə bilər.
- **Login "toyuq-yumurta" problemi:** dar əhatəli `find_user_org_memberships()`
  SECURITY DEFINER funksiyası ilə həll olunub (bax `migrations/006_*`).

## Bilinən məhdudiyyətlər (bu faz üçün)

- `children` cədvəli yoxdur — `specialist_child_assignments.child_id` hələ FK-siz
  sütundur, composite FK gələcək `children` migration-ında əlavə olunacaq.
- Redis adapter implementasiya edilməyib (yalnız in-memory fallback + interfeys).
- HTTP controller-lər (NestJS) yazılmayıb — servis səviyyəsi hazırdır, API qatı 011+ ilə birlikdə gələcək.
- Audit log cədvəli yoxdur — `TOKEN_REUSE` kimi hadisələr hələlik strukturlu console.warn kimi qeyd olunur.

Ətraflı: bax son FINAL REPORT (chat tarixçəsi).
