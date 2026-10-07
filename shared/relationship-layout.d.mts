export type Point = {x:number;y:number};
export const NODE_SIZE: Readonly<{width:number;height:number}>;
export const NODE_ANCHOR: Readonly<Point>;
export const NODE_GAP: Readonly<{x:number;y:number}>;
export const PREVIEW_SIZE: Readonly<{width:number;height:number}>;
export function directNeighborhood(id:string|null, connections:{fromId:string;toId:string}[], visibleIds:string[]):Set<string>;
export function arrangeRelationships<T extends Point & {id:string;tags?:string[]}>(ideas:T[],connections:{fromId:string;toId:string}[],viewport?:{width:number;height:number}):T[];
export function previewPosition(point:Point,transform:{panX:number;panY:number;zoom:number},viewport:{width:number;height:number},detailOpen?:boolean):{left:number;top:number;width:number;height:number};

export function themeZones(ideas:(Point & {id:string;tags?:string[]})[]):{tag:string;count:number;x:number;y:number;rx:number;ry:number}[];

export const READING_ZOOM:number;
export function nodeDisplayGeometry(zoom:number):{scale:number;factor:number;titleWidth:number;fontSize:number;lineHeight:number;titleTop:number;selectedTitleTop:number};
export function nodeVisualBounds(point:Point,transform:{zoom:number;panX:number;panY:number}):{left:number;right:number;top:number;bottom:number};
export function themeLabels<T extends {tag:string;count:number;x:number;y:number;rx:number;ry:number}>(zones:T[],ideas:Point[],transform:{zoom:number;panX:number;panY:number},viewport:{width:number;height:number}):(T & {label:{x:number;y:number}|null})[];
