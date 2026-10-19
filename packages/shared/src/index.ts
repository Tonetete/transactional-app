export const TRANSACTION_STATUSES = ["PENDING", "PROCESSING", "SETTLED", "FAILED"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];
export * from "./deposit.js";
export * from "./contract.js";
