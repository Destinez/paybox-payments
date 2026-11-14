import { type Database, eq, fakeSettings, fakeSettlements } from '@paybox/db';
import type { FacilitatorClient } from '@x402/core/server';
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from '@x402/core/types';
import { verifyTypedData } from 'viem';
import { authorizationTypes, nonceKey, signedPayloadSchema, USDC_ADDRESS, X402_NETWORK } from './protocol';
export class FakeFacilitator implements FacilitatorClient {
  constructor(readonly db: Database) {}
  private async controls() {
    const [row] = await this.db.select().from(fakeSettings).where(eq(fakeSettings.id, 'x402_controls'));
    return row?.value ?? {};
  }
  async getSupported(): Promise<SupportedResponse> {
    return {
      kinds: [{ x402Version: 2, scheme: 'exact', network: X402_NETWORK }],
      extensions: [],
      signers: {},
    };
  }
  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    const controls = await this.controls();
    if (controls.verify_fail) return { isValid: false, invalidReason: 'simulated_verification_failure' };
    const parsed = signedPayloadSchema.safeParse(payload.payload);
    if (!parsed.success) return { isValid: false, invalidReason: 'invalid_authorization' };
    const { authorization: a, signature } = parsed.data,
      now = BigInt(Math.floor(Date.now() / 1000));
    if (
      payload.x402Version !== 2 ||
      requirements.network !== X402_NETWORK ||
      requirements.asset.toLowerCase() !== USDC_ADDRESS.toLowerCase() ||
      a.to.toLowerCase() !== requirements.payTo.toLowerCase() ||
      a.value !== requirements.amount ||
      BigInt(a.validBefore) <= now ||
      BigInt(a.validAfter) > now
    )
      return { isValid: false, invalidReason: 'invalid_payment_requirements' };
    const isValid = await verifyTypedData({
      address: a.from as `0x${string}`,
      domain: { name: 'USDC', version: '2', chainId: 84532, verifyingContract: USDC_ADDRESS },
      types: authorizationTypes,
      primaryType: 'TransferWithAuthorization',
      message: {
        from: a.from as `0x${string}`,
        to: a.to as `0x${string}`,
        value: BigInt(a.value),
        validAfter: BigInt(a.validAfter),
        validBefore: BigInt(a.validBefore),
        nonce: a.nonce as `0x${string}`,
      },
      signature: signature as `0x${string}`,
    }).catch(() => false);
    return { isValid, payer: a.from, ...(!isValid ? { invalidReason: 'invalid_signature' } : {}) };
  }
  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const key = nonceKey(payload, requirements),
      controls = await this.controls();
    const delay = Number(controls.settle_delay_ms ?? 0);
    if (delay) await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 10000)));
    if (controls.settle_fail)
      return {
        success: false,
        errorReason: 'simulated_settlement_failure',
        network: X402_NETWORK,
        transaction: '',
      };
    const verified = await this.verify(payload, requirements);
    if (!verified.isValid)
      return { success: false, errorReason: 'invalid_payment', network: X402_NETWORK, transaction: '' };
    const receipt: SettleResponse = {
      success: true,
      payer: verified.payer,
      network: X402_NETWORK,
      transaction: `0x${key}`,
      amount: requirements.amount,
    };
    await this.db
      .insert(fakeSettlements)
      .values({ nonceKey: key, receipt: { ...receipt } })
      .onConflictDoNothing();
    const [stored] = await this.db.select().from(fakeSettlements).where(eq(fakeSettlements.nonceKey, key));
    return stored!.receipt as SettleResponse;
  }
}
