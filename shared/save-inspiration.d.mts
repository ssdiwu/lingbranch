import type { Idea, Attachment, BodyFormat } from '../web/lib/idea-store';
export type SaveSession = {id:string|null;version:string;wasNew:boolean;position:{x:number;y:number};creation:unknown;uploads:Map<string,unknown>;indexing:Map<string,{text:string;failed:boolean}>;final:unknown};
export type SaveSnapshot = {title:string;body:string;bodyFormat:BodyFormat;sourceLabel:string;sourceUrl:string;sourceAt:string;tags:string[];indexNote:string;files:File[];drafts:{url:string;file:File}[];unindexed?:number};
export type SaveIO = {
  key:()=>string;hash:(file:File)=>Promise<string>;index:(file:File)=>Promise<string>;
  create:(request:Record<string,unknown>)=>Promise<Idea>;
  upload:(request:{id:string;file:File;sha256:string;indexedText:string;idempotencyKey:string})=>Promise<{attachment:Attachment}>;
  update:(request:{id:string;expectedUpdatedAt:string;idempotencyKey:string;patch:Record<string,unknown>})=>Promise<Idea>;
  read:(id:string)=>Promise<Idea>;
};
export function createSaveSession(id?:string|null,version?:string,position?:{x:number;y:number}):SaveSession;
export function acknowledgeVersion(session:SaveSession,version:string):void;
export function saveInspiration(session:SaveSession,snapshot:SaveSnapshot,io:SaveIO,onStage?:(message:string)=>void):Promise<{item:Idea;wasNew:boolean;unindexed:number}>;
