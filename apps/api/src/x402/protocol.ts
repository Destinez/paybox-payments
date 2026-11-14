import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { z } from 'zod';
import { sha256 } from '../crypto';
export const X402_NETWORK = 'eip155:84532' as const;
export const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const routeInput = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
    path: z
      .string()
      .min(1)
      .max(200)
      .regex(/^\/[A-Za-z0-9/_-]*$/),
    upstream_url: z.string().url().max(2048),
    price: z
      .string()
      .regex(/^[1-9]\d{0,10}$/)
      .refine((value) => BigInt(value) <= 10000000000n),
    asset: z.literal(USDC_ADDRESS).default(USDC_ADDRESS),
    network: z.literal(X402_NETWORK).default(X402_NETWORK),
    pay_to: addressSchema,
    description: z.string().trim().min(1).max(160),
    active: z.boolean().default(true),
  })
  .strict();
export const authorizationSchema = z.object({
  from: addressSchema,
  to: addressSchema,
  value: z.string().regex(/^\d+$/),
  validAfter: z.string().regex(/^\d+$/),
  validBefore: z.string().regex(/^\d+$/),
  nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});
export const signedPayloadSchema = z.object({
  authorization: authorizationSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});
export function nonceKey(payload: PaymentPayload, requirements: PaymentRequirements) {
  const { authorization } = signedPayloadSchema.parse(payload.payload);
  return sha256(
    `${requirements.network}:${requirements.asset.toLowerCase()}:${authorization.from.toLowerCase()}:${authorization.nonce.toLowerCase()}`,
  );
}
export const authorizationTypes = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;
