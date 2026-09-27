import {
  AuthApiError,
  AuthRetryableFetchError,
  type User,
} from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";

// Behaviour of requireUser / requireAdmin through their public surface: the bearer client is replaced with
// a fake, everything else (header parsing, the two verification modes, the profile lookup, the error
// mapping) is the real code. auth-js's own key-set cache is therefore never exercised here.

const TOKEN = "header.payload.signature";
const USER_ID = "11111111-1111-1111-1111-111111111111";

const { getClaims, getUser, maybeSingle, createBearerClient } = vi.hoisted(
  () => {
    const getClaims = vi.fn();
    const getUser = vi.fn();
    const maybeSingle = vi.fn();
    const fakeDb = {
      auth: { getClaims, getUser },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      })),
    };
    return {
      getClaims,
      getUser,
      maybeSingle,
      createBearerClient: vi.fn(() => fakeDb),
    };
  },
);

vi.mock("@claims/supabase/bearer", () => ({ createBearerClient }));

// Imported after the mock is declared (vi.mock is hoisted anyway; this keeps the reading order honest).
import { requireAdmin, requireUser } from "@/lib/api/auth";

type Profile = { id: string; role: "admin" | "agent"; full_name: string };

function request(authorization?: string): Request {
  return new Request("https://example.test/api/claims", {
    headers: authorization ? { authorization } : {},
  });
}

function bearer(): Request {
  return request(`Bearer ${TOKEN}`);
}

function claimsFor(sub: unknown, email?: unknown) {
  return {
    data: {
      claims: { sub, email, aud: "authenticated", role: "authenticated" },
      header: { alg: "ES256", kid: "kid-1", typ: "JWT" },
      signature: new Uint8Array(),
    },
    error: null,
  };
}

function profile(role: Profile["role"]): Profile {
  return { id: USER_ID, role, full_name: "Test" };
}

async function apiErrorOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw new Error(`expected an ApiError, got ${String(error)}`);
  }
  throw new Error("expected the promise to reject");
}

beforeEach(() => {
  // Dummy values only: getPublicSupabaseEnv() throws without them, and no request ever leaves the test.
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://dummy.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "dummy-anon-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
  getClaims.mockReset();
  getUser.mockReset();
  maybeSingle.mockReset();
  createBearerClient.mockClear();
  getClaims.mockResolvedValue(claimsFor(USER_ID, "admin@example.test"));
  getUser.mockResolvedValue({
    data: { user: { id: USER_ID, email: "admin@example.test" } as User },
    error: null,
  });
  maybeSingle.mockResolvedValue({ data: profile("agent"), error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("requireUser: the Authorization header", () => {
  it.each([
    ["absent", undefined],
    ["not a bearer scheme", `Basic ${TOKEN}`],
    ["a bare 'Bearer' with no token", "Bearer "],
  ])("rejects a header that is %s with UNAUTHENTICATED", async (_, header) => {
    const error = await apiErrorOf(requireUser(request(header)));

    expect(error.code).toBe("UNAUTHENTICATED");
    expect(error.status).toBe(401);
    expect(createBearerClient).not.toHaveBeenCalled();
    expect(getClaims).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("accepts a lower-case scheme", async () => {
    const auth = await requireUser(request(`bearer ${TOKEN}`));

    expect(auth.user.id).toBe(USER_ID);
  });
});

describe("requireUser: local verification (the default)", () => {
  it("verifies with getClaims(token) and never calls getUser", async () => {
    const auth = await requireUser(bearer());

    expect(getClaims).toHaveBeenCalledTimes(1);
    // No options: the key set comes from auth-js's own per-process cache, not from anything passed in.
    expect(getClaims).toHaveBeenCalledWith(TOKEN);
    expect(getUser).not.toHaveBeenCalled();
    expect(createBearerClient).toHaveBeenCalledWith({
      url: "https://dummy.supabase.test",
      publishableKey: "dummy-anon-key",
      accessToken: TOKEN,
    });
    expect(auth.user).toEqual({ id: USER_ID, email: "admin@example.test" });
    expect(auth.profile).toEqual(profile("agent"));
  });

  it("gives a null email when the token has none", async () => {
    getClaims.mockResolvedValue(claimsFor(USER_ID));

    const auth = await requireUser(bearer());

    expect(auth.user).toEqual({ id: USER_ID, email: null });
  });

  it("maps a token shape that makes getClaims throw to UNAUTHENTICATED, not to an unhandled error", async () => {
    // auth-js rethrows non-AuthErrors from its own decode: an unsupported alg, an alg that does not fit
    // the key, or a header/payload that is base64url but not JSON. The last shape throws in decodeJWT
    // before any kid lookup, so it needs no knowledge of the project's keys at all. route() only logs and
    // 500s a throw that is not an ApiError, so the ApiError here is what keeps it out of the error log.
    getClaims.mockRejectedValue(new Error("Invalid alg claim"));

    const error = await apiErrorOf(requireUser(bearer()));

    expect(error.code).toBe("UNAUTHENTICATED");
    expect(error.status).toBe(401);
    expect(maybeSingle).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("maps a retryable fetch error (JWKS endpoint or Auth server unreachable) to INTERNAL", async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: new AuthRetryableFetchError("fetch failed", 0),
    });

    const error = await apiErrorOf(requireUser(bearer()));

    expect(error.code).toBe("INTERNAL");
    expect(error.status).toBe(500);
  });

  it("maps an invalid or expired token to UNAUTHENTICATED", async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: new AuthApiError("invalid JWT", 401, "bad_jwt"),
    });

    const error = await apiErrorOf(requireUser(bearer()));

    expect(error.code).toBe("UNAUTHENTICATED");
    expect(error.status).toBe(401);
  });

  it("treats a result with neither data nor error as UNAUTHENTICATED", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });

    const error = await apiErrorOf(requireUser(bearer()));

    expect(error.code).toBe("UNAUTHENTICATED");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not a string", 42],
  ])("rejects verified claims whose sub is %s", async (_, sub) => {
    getClaims.mockResolvedValue(claimsFor(sub, "x@example.test"));

    const error = await apiErrorOf(requireUser(bearer()));

    expect(error.code).toBe("UNAUTHENTICATED");
    expect(maybeSingle).not.toHaveBeenCalled();
  });
});

describe("requireUser: server verification", () => {
  it("verifies with getUser(token) and never calls getClaims", async () => {
    const auth = await requireUser(bearer(), { verification: "server" });

    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getUser).toHaveBeenCalledWith(TOKEN);
    expect(getClaims).not.toHaveBeenCalled();
    expect(auth.user).toEqual({ id: USER_ID, email: "admin@example.test" });
  });

  it("maps a retryable fetch error to INTERNAL and any other error to UNAUTHENTICATED", async () => {
    getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthRetryableFetchError("fetch failed", 0),
    });
    const unreachable = await apiErrorOf(
      requireUser(bearer(), { verification: "server" }),
    );
    expect(unreachable.code).toBe("INTERNAL");

    getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthApiError("invalid JWT", 401, "bad_jwt"),
    });
    const invalid = await apiErrorOf(
      requireUser(bearer(), { verification: "server" }),
    );
    expect(invalid.code).toBe("UNAUTHENTICATED");
  });
});

describe("requireUser: the profile row", () => {
  it("answers FORBIDDEN, not UNAUTHENTICATED, when no profile row exists", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    const error = await apiErrorOf(requireUser(bearer()));

    expect(error.code).toBe("FORBIDDEN");
    expect(error.status).toBe(403);
  });

  it("rethrows a profile query error as-is", async () => {
    const dbError = { code: "42P01", message: "relation does not exist" };
    maybeSingle.mockResolvedValue({ data: null, error: dbError });

    await expect(requireUser(bearer())).rejects.toBe(dbError);
  });
});

describe("requireAdmin", () => {
  it("answers FORBIDDEN for a signed-in agent", async () => {
    const error = await apiErrorOf(requireAdmin(bearer()));

    expect(error.code).toBe("FORBIDDEN");
    expect(error.status).toBe(403);
  });

  it("returns the authed request for an admin, verified locally by default", async () => {
    maybeSingle.mockResolvedValue({ data: profile("admin"), error: null });

    const auth = await requireAdmin(bearer());

    expect(auth.profile.role).toBe("admin");
    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("passes the verification option through to requireUser", async () => {
    maybeSingle.mockResolvedValue({ data: profile("admin"), error: null });

    const auth = await requireAdmin(bearer(), { verification: "server" });

    expect(auth.profile.role).toBe("admin");
    expect(getUser).toHaveBeenCalledWith(TOKEN);
    expect(getClaims).not.toHaveBeenCalled();
  });
});
