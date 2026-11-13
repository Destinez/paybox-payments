import { z } from 'zod';
export const moneySchema = z.number().int().positive().max(10_000_000_000);
export const paymentInput = z
  .object({
    amount: moneySchema,
    currency: z.literal('NGN').default('NGN'),
    customer: z.object({ email: z.string().trim().email().max(254) }).strict(),
    reference: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9.=-]+$/)
      .optional(),
    callback_url: z.string().url().max(2048).optional(),
    metadata: z
      .record(z.unknown())
      .default({})
      .refine((value) => JSON.stringify(value).length <= 16384, 'Metadata must be at most 16 KB'),
  })
  .strict();
export const refundInput = z
  .object({
    amount: moneySchema.optional(),
    reason: z.string().trim().min(1).max(160).default('Customer requested refund'),
  })
  .strict();
export const paymentStates = [
  'created',
  'pending',
  'succeeded',
  'failed',
  'abandoned',
  'partially_refunded',
  'refunded',
] as const;
export const listPaymentsInput = z.object({
  status: z.enum(paymentStates).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  q: z.string().max(254).optional(),
  page_token: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
