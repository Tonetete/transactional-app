import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const IBAN = "GB82WEST12345698765432";

let deposits: unknown[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  deposits = [];
  fetchMock = vi.fn(async (url: string, init: RequestInit & { headers: Record<string, string> }) => {
    if (url.endsWith("/v1/auth/dev-login")) return json(200, { token: "jwt", ...JSON.parse(init.body as string) });
    if (url.endsWith("/v1/deposits") && init.method === "POST") {
      deposits = [{ transaction_id: "txn_1", amount_cents: 5000, currency: "USD", status: "PENDING", created_at: "2026-10-19T10:00:00.000Z" }, ...deposits];
      return json(202, { transaction_id: "txn_1", status: "PENDING", created: true, correlation_id: "c" });
    }
    return json(200, { items: deposits });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("home page (S1, S3)", () => {
  it("logs in, shows the live list, and a new deposit appears in it", async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("No transactions yet.")).toBeInTheDocument();
    expect(screen.getByText("tnt_demo / usr_demo")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Amount"), "50");
    await user.type(screen.getByLabelText("Account holder"), "Jane Doe");
    await user.type(screen.getByLabelText("IBAN"), IBAN);
    await user.click(screen.getByRole("button", { name: "Request deposit" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Deposit txn_1 requested (PENDING)");
    const post = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/v1/deposits") && init.method === "POST")!;
    expect(post[1].headers).toMatchObject({ authorization: "Bearer jwt", "idempotency-key": expect.stringMatching(/^idk_/) });
    expect(JSON.parse(post[1].body)).toMatchObject({ amount_cents: 5000, currency: "USD" });
    await waitFor(() => expect(within(screen.getByRole("list")).getByText("txn_1")).toBeInTheDocument());
  });

  it("restores the stored session and signs out back to the login form", async () => {
    sessionStorage.setItem("acex.session", JSON.stringify({ token: "jwt", tenant_id: "t1", user_id: "u1" }));
    const user = userEvent.setup();
    render(<HomePage />);
    expect(await screen.findByText("t1 / u1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(sessionStorage.getItem("acex.session")).toBeNull();
  });

  it("returns to login when the API rejects the token", async () => {
    sessionStorage.setItem("acex.session", JSON.stringify({ token: "expired", tenant_id: "t1", user_id: "u1" }));
    fetchMock.mockResolvedValue(json(401, { code: "UNAUTHORIZED", message: "no", correlation_id: "c" }));
    render(<HomePage />);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});
