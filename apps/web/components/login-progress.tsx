"use client";

import { useEffect, useState } from "react";

// The two things that actually happen after the login form is submitted, in order. Nothing here is a
// guess about progress: `authenticating` lasts exactly as long as signInWithPassword is in flight, and
// `redirecting` starts the moment it resolves successfully and ends when the browser leaves the page
// (the whole document, this component included, is torn down by the navigation).
export type LoginPhase = "idle" | "authenticating" | "redirecting";

type BusyPhase = Exclude<LoginPhase, "idle">;

const PHASE_LABELS: Record<BusyPhase, string> = {
  authenticating: "Checking your credentials…",
  redirecting: "Signed in — loading your dashboard…",
};

// How long to sit in a phase before admitting it is taking a while, and what to say then.
//
// `redirecting` is the long one by design: the document navigation to "/" costs the proxy's session
// check plus the overview's own auth and query — ~4 s warm, up to ~12 s when the function is cold — so
// four seconds is past the warm case and the extra line only appears when something really is slow.
//
// `authenticating` gets a threshold too, and it matters more than its short warm time (~1 s) suggests:
// supabase-js sets no timeout on the sign-in request, so a dropped connection or a captive portal leaves
// it pending forever, and the form underneath is `inert` and covered. Without this line the user would
// stare at "Checking your credentials…" with no hint that reloading is the way out.
const SLOW_MS: Record<BusyPhase, number> = {
  authenticating: 8_000,
  redirecting: 4_000,
};

const SLOW_TEXT: Record<BusyPhase, string> = {
  authenticating:
    "Still checking — this is taking longer than usual. Check your connection, then reload to try again.",
  redirecting: "Still loading — the first request after a deploy takes longer.",
};

// The progress state that covers the login card while a sign-in is in flight. Rendered as an overlay by
// app/login/page.tsx, so its parent must be `relative`.
//
// It is mounted in every phase, including `idle`, where it collapses to an empty screen-reader-only box:
// a live region has to already be in the DOM when its content changes for the change to be announced
// reliably, and inserting a fresh role="status" element is what screen readers disagree about.
export function LoginProgress({ phase }: { phase: LoginPhase }) {
  // Which phase has been slow, rather than a bare boolean: the extra line belongs to the phase that
  // raised it, so moving from `authenticating` to `redirecting` has to drop it. Storing the phase makes
  // that fall out of the render check below, with no reset to write (and no setState in the effect body).
  const [slowPhase, setSlowPhase] = useState<BusyPhase | null>(null);

  useEffect(() => {
    if (phase === "idle") return;
    const timer = window.setTimeout(() => {
      setSlowPhase(phase);
    }, SLOW_MS[phase]);
    // Cleared on unmount (and on any phase change) so a resolved or abandoned sign-in cannot set state
    // afterwards. In practice the navigation unmounts the whole tree, but the timer must not outlive it.
    return () => {
      window.clearTimeout(timer);
    };
  }, [phase]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        phase === "idle"
          ? "sr-only"
          : "absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card/95 px-6 text-center"
      }
    >
      {phase === "idle" ? null : (
        <>
          {/* Decorative: the text below carries the state. Under prefers-reduced-motion the ring stops
              spinning and is just a static mark, which is why the text is never optional. */}
          <span
            aria-hidden="true"
            className="size-5 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground/60 motion-reduce:animate-none"
          />
          <p className="text-sm font-medium">{PHASE_LABELS[phase]}</p>
          {slowPhase === phase ? (
            <p className="text-sm text-muted-foreground">{SLOW_TEXT[phase]}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
