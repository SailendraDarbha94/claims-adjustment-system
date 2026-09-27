import { assignClaimSchema } from "@claims/shared";
import { requireAdmin } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { ok, parseBody, route } from "@/lib/api/handler";
import { buildAdminClaimDetail, getAdminClaimRow } from "@/lib/queries/admin";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/claims/:id/assign — set or clear (null) assigned_to. The claims_log_change trigger writes
 * the 'assigned' event. An assigned_to that is not a profile fails the foreign key (23503), which
 * fromPostgrestError() reports as VALIDATION_ERROR. No push: the brief only asks for pushes on status
 * changes and agent-visible notes.
 */
export const POST = route<Ctx>(async (request, { params }) => {
  // "server": a revoked admin (signed out elsewhere, banned) must not get one more write in, so this
  // handler pays the Auth server round trip that local verification skips (lib/api/auth.ts).
  const { db } = await requireAdmin(request, {
    verification: "server",
  });
  const { id } = await params;
  const body = await parseBody(request, assignClaimSchema);

  const claim = await getAdminClaimRow(db, id);
  if (!claim) throw new ApiError("NOT_FOUND", "Claim not found.");

  const { data: updated, error } = await db
    .from("claims")
    .update({ assigned_to: body.assigned_to })
    .eq("id", claim.id)
    .select("*")
    .single();
  if (error) throw error;

  return ok(await buildAdminClaimDetail(db, updated));
});
