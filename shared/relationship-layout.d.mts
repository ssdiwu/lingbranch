export type Point = {x:number;y:number};
export const NODE_SIZE: Readonly<{width:number;height:number}>;
export const NODE_ANCHOR: Readonly<Point>;
export const NODE_GAP: Readonly<{x:number;y:number}>;
export const PREVIEW_SIZE: Readonly<{width:number;height:number}>;
export function directNeighborhood(id:string|null, connections:{fromId:string;toId:string}[], visibleIds:string[]):Set<string>;
export function arrangeRelationships<T extends Point & {id:string}>(ideas:T[],connections:{fromId:string;toId:string}[],viewport?:{width:number;height:number}):T[];
export function previewPosition(point:Point,transform:{panX:number;panY:number;zoom:number},viewport:{width:number;height:number},detailOpen?:boolean):{left:number;top:number;width:number;height:number};
