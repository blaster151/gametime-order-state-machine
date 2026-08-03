import { z } from 'zod';

/**
 * Light validation of request *shape*, not business rules — legality of a
 * transition is enforced entirely inside the domain model, not here.
 */
export const orderIdParamsSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, 'id is required')
    .regex(/^[A-Za-z0-9._-]+$/, 'id contains invalid characters'),
});

export type OrderIdParams = z.infer<typeof orderIdParamsSchema>;
