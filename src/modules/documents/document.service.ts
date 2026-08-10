import { withTenantTransaction } from '../../common/db/tenant-context';
import { resolveMemberScope } from '../../scope-cache/scope-resolver';

export class DocumentError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface ActorContext {
  organizationId: string;
  memberId: string;
  userId: string;
}

const ADMIN_ROLES = ['CENTER_OWNER', 'CENTER_ADMIN'];
const VIEW_ROLES = ['BRANCH_ADMIN', 'SUPERVISOR'];

async function assertActiveAssignment(client: any, organizationId: string, specialistId: string, childId: string) {
  const res = await client.query(
    `SELECT 1 FROM specialist_child_assignments
     WHERE organization_id=$1 AND specialist_id=$2 AND child_id=$3 AND status='ACTIVE'`,
    [organizationId, specialistId, childId],
  );
  if (res.rowCount === 0) {
    throw new DocumentError('ACCESS_DENIED', 'Bu uşağa aktiv specialist_child_assignment yoxdur.');
  }
}

export async function uploadDocument(
  actor: ActorContext,
  input: {
    childId: string;
    storageKey: string;
    mimeType?: string;
    sizeBytes?: number;
    ownerType?: string;
    assessorSpecialistId?: string;
    parentVisible?: boolean;
  },
): Promise<{ id: string }> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  const isSpecialist = scope.roleCodes.includes('SPECIALIST');
  const isAdmin = scope.roleCodes.some((r) => ADMIN_ROLES.includes(r));
  const isView = scope.roleCodes.some((r) => VIEW_ROLES.includes(r));
  if (!isSpecialist && !isAdmin && !isView) {
    throw new DocumentError('ACCESS_DENIED', 'Sənəd yükləmək icazəniz yoxdur.');
  }

  return withTenantTransaction(actor.organizationId, async (client) => {
    if (isSpecialist && input.assessorSpecialistId) {
      await assertActiveAssignment(client, actor.organizationId, input.assessorSpecialistId, input.childId);
    }
    // QEYD (Faz 3.8 bənd 18): access_policy.parent_visible ARTIQ authorization
    // üçün İSTİFADƏ OLUNMUR — yalnız informativ metadata kimi saxlanılır.
    // Real valideyn girişi consent+data_share ilə həll olunur (bax consent.service.ts).
    const accessPolicy = { parent_visible: Boolean(input.parentVisible) };

    const res = await client.query(
      `INSERT INTO documents (organization_id, child_id, owner_type, uploader_id, storage_key, mime_type, size_bytes, access_policy)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        actor.organizationId,
        input.childId,
        input.ownerType ?? null,
        actor.userId,
        input.storageKey,
        input.mimeType ?? null,
        input.sizeBytes ?? null,
        JSON.stringify(accessPolicy),
      ],
    );
    return { id: res.rows[0].id };
  });
}

/** Soft-delete — Faz 3.7 bənd 16: DELETE HTTP endpoint yoxdur, yalnız bu servis funksiyası. */
export async function softDeleteDocument(actor: ActorContext, documentId: string): Promise<void> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  const isAdmin = scope.roleCodes.some((r) => ADMIN_ROLES.includes(r));
  if (!isAdmin) {
    throw new DocumentError('ACCESS_DENIED', 'Sənəd silmək icazəniz yoxdur.');
  }
  await withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(
      `UPDATE documents SET status='deleted', deleted_at=now(), updated_at=now()
       WHERE id=$1 AND organization_id=$2 AND status='active' RETURNING id`,
      [documentId, actor.organizationId],
    );
    if (res.rowCount === 0) throw new DocumentError('NOT_FOUND', 'Aktiv sənəd tapılmadı.');
  });
}

/** Görünən (yalnız 'active') sənədlər — silinmiş sənədlər normal nəticələrdən çıxarılır. */
export async function getChildDocuments(actor: ActorContext, childId: string): Promise<any[]> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(
      `SELECT * FROM documents WHERE child_id=$1 AND organization_id=$2 AND status='active' ORDER BY created_at DESC`,
      [childId, actor.organizationId],
    );
    return res.rows;
  });
}

/** Access log-a yazma (VIEW/DOWNLOAD/DENIED). */
export async function logDocumentAccess(
  actor: ActorContext,
  input: { documentId: string; action: 'view' | 'download' | 'denied' },
): Promise<void> {
  await withTenantTransaction(actor.organizationId, async (client) => {
    await client.query(
      `INSERT INTO document_access_logs (organization_id, document_id, accessed_by, action) VALUES ($1,$2,$3,$4)`,
      [actor.organizationId, input.documentId, actor.userId, input.action],
    );
  });
}

/**
 * Parent üçün sənəd görünürlüyü — Faz 3.8 bənd 18: FINAL mexanizm.
 * "access_policy.parent_visible" ARTIQ authorization source of truth DEYİL
 * (yalnız Faz 3.7-dəki köhnə sətirlərdə metadata kimi qala bilər, oxunmur).
 * Access YALNIZ canlı consent (ACTIVE) + entity-level data_share ilə verilir.
 */
export async function getParentVisibleDocuments(
  organizationId: string,
  parentId: string,
  childId: string,
): Promise<any[]> {
  return withTenantTransaction(organizationId, async (client) => {
    const guardianCheck = await client.query(
      `SELECT 1 FROM child_guardians WHERE organization_id=$1 AND parent_id=$2 AND child_id=$3`,
      [organizationId, parentId, childId],
    );
    if (guardianCheck.rowCount === 0) return [];

    // FINAL: yalnız ACTIVE consent + data_shares ilə konkret paylaşılan sənədlər.
    const res = await client.query(
      `SELECT d.* FROM documents d
       JOIN data_shares ds ON ds.entity_type = 'documents' AND ds.entity_id = d.id AND ds.organization_id = d.organization_id
       JOIN consents c ON c.id = ds.consent_id AND c.organization_id = ds.organization_id
       WHERE d.organization_id = $1 AND d.child_id = $2 AND d.status = 'active'
         AND c.status = 'ACTIVE' AND c.to_organization_id = $1
         AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)`,
      [organizationId, childId],
    );
    return res.rows;
  });
}
