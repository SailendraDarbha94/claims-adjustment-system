import { createNoteSchema } from "@claims/shared";
import { after } from "next/server";
import { requireAdmin } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { ok, parseBody, route } from "@/lib/api/handler";
import { sendClaimPush, truncateForPush } from "@/lib/push";
import { getAdminClaimRow, toClaimNote } from "@/lib/queries/admin";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/claims/:id/notes — add an internal or agent_visible note. author_id must be the caller
 * (claim_notes_insert_admin); the claim_notes trigger writes the 'note_added' event.
 */
export const POST = route<Ctx>(async (request, { params }) => {
  // "server": a revoked admin (signed out elsewhere, banned) must not get one more write in, so this
  // handler pays the Auth server round trip that local verification skips (lib/api/auth.ts).
  const { user, db } = await requireAdmin(request, {
    verification: "server",
  });
  const { id } = await params;
  const body = await parseBody(request, createNoteSchema);

  // Read the claim first so a missing/hidden claim is a clean NOT_FOUND rather than a foreign-key error.
  const claim = await getAdminClaimRow(db, id);
  if (!claim) throw new ApiError("NOT_FOUND", "Claim not found.");

  const { data, error } = await db
    .from("claim_notes")
    .insert({
      claim_id: claim.id,
      author_id: user.id,
      body: body.body,
      visibility: body.visibility,
    })
    .select("*")
    .single();
  if (error) throw error;

  // Only agent_visible notes push; internal notes are invisible to the agent and must stay that way.
  // Token read with the admin's user-scoped client (admins may SELECT every profile); a failed read is
  // logged and skipped rather than failing a note that is already stored. after() must be called here,
  // during the request; the callback runs once the response is sent, so the push never delays it.
  if (body.visibility === "agent_visible") {
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
      after(() =>
        sendClaimPush({
          agentId: claim.agent_id,
          token: agent?.expo_push_token ?? null,
          title: "New message on your claim",
          body: truncateForPush(body.body),
          claimId: claim.id,
        }),
      );
    }
  }

  return ok(toClaimNote(data), 201);
});
