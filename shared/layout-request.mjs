import {z} from 'zod';

const coordinate=z.number().finite().min(-1_000_000).max(1_000_000);
export const layoutSchema=z.object({
  idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
  positions:z.array(z.object({id:z.string().uuid(),expectedUpdatedAt:z.string().datetime(),x:coordinate,y:coordinate}).strict())
    .min(1).max(1000).refine(items=>new Set(items.map(item=>item.id)).size===items.length,'同一灵感只能出现一次'),
}).strict();
