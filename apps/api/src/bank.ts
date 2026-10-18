export interface BankTransferRequest {
  /** Our transaction id; the bank must treat it as an idempotency reference. */
  reference: string;
  amount_cents: number;
  currency: string;
  source_account: { holder_name: string; iban: string };
  correlation_id: string;
}

export type BankResult = { outcome: "CLEARED" } | { outcome: "REJECTED"; reason: string };

/** Port to the external banking provider. Implementations throw when the provider is unavailable. */
export interface BankClient {
  requestTransfer(req: BankTransferRequest): Promise<BankResult>;
}

/** Deterministic stand-in until the real provider contract exists. */
export class SimulatedBank implements BankClient {
  readonly calls: BankTransferRequest[] = [];
  constructor(public mode: "clear" | "reject" | "down" = "clear") {}

  async requestTransfer(req: BankTransferRequest): Promise<BankResult> {
    this.calls.push(req);
    if (this.mode === "down") throw new Error("bank unavailable");
    if (this.mode === "reject") return { outcome: "REJECTED", reason: "simulated rejection" };
    return { outcome: "CLEARED" };
  }
}
