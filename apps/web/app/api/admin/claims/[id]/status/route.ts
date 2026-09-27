import { canTransition, changeStatusSchema } from "@claims/shared";
import { after } from "next/server";
import { STATUS_LABELS } from "@/components/status-badge";
import { requireAdmin } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { ok, parseBody, route } from "@/lib/api/handler";
import { sendClaimPush, truncateForPush } from "@/lib/push";
import { buildAdminClaimDetail, getAdminClaimRow } from "@/lib/queries/admin";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/claims/:id/status — an admin transition, with an optional message to the agent
 * (docs/PLAN.md §3 "Handler logic worth spelling out"). The transition table is checked here first;
 * claims_guard_update re-checks it in the DB and its CL001 maps to INVALID_TRANSITION too.
 */
export const POST = route<Ctx>(async (request, { params }) => {
  // "server": a revoked admin (signed out elsewhere, banned) must not get one more write in, so this
  // handler pays the Auth server round trip that local verification skips (lib/api/auth.ts).
  const { user, db } = await requireAdmin(request, {
    verification: "server",
  });
  const { id } = await params;
  const body = await parseBody(request, changeStatusSchema);

  const claim = await getAdminClaimRow(db, id);
  if (!claim) throw new ApiError("NOT_FOUND", "Claim not found.");
  if (!canTransition(claim.status, body.status, "admin")) {
    throw new ApiError(
      "INVALID_TRANSITION",
      `A claim in status "${claim.status}" cannot be moved to "${body.status}".`,
    );
  }

  // The status update and the note are two statements, not one transaction (decision d). Status goes
  // first because it is the one that matters; a failed note insert leaves the status changed and returns
  // an error, and the admin can add the note again.
  const { data: updated, error } = await db
    .from("claims")
    .update({ status: body.status })
    .eq("id", claim.id)
    .select("*")
    .single();
  if (error) throw error;

  // Exactly one push per admin action, even when a message was given: the message rides along in the
  // body. The push is queued here, before the optional note insert, so the agent hears about a transition
  // that has already happened even if the insert below throws. after() must be called during the request;
  // Next runs the callback once the response is sent — also when the handler throws — so the body is
  // composed inside the callback, when `storedMessage` says whether the note made it.
  // The token is read with the admin's user-scoped client (admins may SELECT every profile); a failed
  // read is logged and skipped rather than failing a status change that already happened.
  let storedMessage: string | undefined;
  const { data: agent, error: tokenError } = await db
    .from("profiles")
    .select("expo_push_token")
    .eq("id", claim.agent_id)
    .maybeSingle();
  if (tokenError) {
    console.error("push: could not read agent token", {
      claimId: claim.id,
      error: tokenError,
    });
  } else {
    const headline = `"${claim.title}" is now ${STATUS_LABELS[body.status]}.`;
    after(() =>
      sendClaimPush({
        agentId: claim.agent_id,
        token: agent?.expo_push_token ?? null,
        title: "Claim status updated",
        body: storedMessage
          ? `${headline} ${truncateForPush(storedMessage)}`
          : headline,
        claimId: claim.id,
      }),
    );
  }

  if (body.message) {
    // Stored as an agent_visible note so the normal visibility policy governs it (decision d); the
    // claim_notes trigger logs the note_added event.
    const { error: noteError } = await db.from("claim_notes").insert({
      claim_id: claim.id,
      author_id: user.id,
      body: body.message,
      visibility: "agent_visible",
    });
    if (noteError) throw noteError;
    storedMessage = body.message;
  }

  return ok(await buildAdminClaimDetail(db, updated));
});
