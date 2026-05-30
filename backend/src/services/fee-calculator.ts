import db from '../db/connection';

/**
 * Computes the connector fee for a charge based on the connector's stored
 * fee_config: { fixed: <minor units>, percentage: <decimal percent> }.
 *
 * Example: { fixed: 30, percentage: 2.9 } on a 1000-cent charge ->
 *   fee = 30 + round(1000 * 0.029) = 30 + 29 = 59 cents.
 *
 * If no fee_config is set, returns 0 (no recorded fee). All math stays in
 * integer minor units.
 */
export function computeFee(amount: number, feeConfig: any): number {
  if (!feeConfig || amount <= 0) return 0;
  const fixed = Number(feeConfig.fixed) || 0;
  const percentage = Number(feeConfig.percentage) || 0;
  if (fixed < 0 || percentage < 0) return 0;
  const variable = Math.round((amount * percentage) / 100);
  const total = fixed + variable;
  // Cap the fee at the charge amount itself.
  return total > amount ? amount : total;
}

/** Loads the connector's fee_config (already parsed) or returns null. */
export async function loadFeeConfig(connectorAccountId: string | null | undefined): Promise<any | null> {
  if (!connectorAccountId) return null;
  const account = await db('provider_accounts').where({ id: connectorAccountId }).first();
  if (!account?.fee_config) return null;
  try {
    return JSON.parse(account.fee_config);
  } catch {
    return null;
  }
}

/** Convenience: computes the fee for a connector by id. */
export async function computeFeeForConnector(amount: number, connectorAccountId: string | null | undefined): Promise<number> {
  const cfg = await loadFeeConfig(connectorAccountId);
  return computeFee(amount, cfg);
}
