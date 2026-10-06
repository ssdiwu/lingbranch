import type {ZodType} from 'zod';
export type LayoutPosition={id:string;expectedUpdatedAt:string;x:number;y:number};
export type LayoutInput={idempotencyKey:string;positions:LayoutPosition[]};
export type LayoutResult={outcome:'updated'|'unchanged';replayed:boolean;positions:{id:string;x:number;y:number;updatedAt:string}[];previous:LayoutPosition[]};
export const layoutSchema:ZodType<LayoutInput>;
