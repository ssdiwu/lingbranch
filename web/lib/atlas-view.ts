import type { CanvasState, Connection, Idea } from "@/lib/idea-store";
import { markdownText } from '../../shared/markdown.mjs';
import {NODE_SIZE,nodeLayoutBounds,freeNodePosition,READING_ZOOM,MIN_CANVAS_ZOOM} from '../../shared/relationship-layout.mjs';

export type CardSize = { width: number; height: number };
export type ViewportSize = { width: number; height: number };
export type ViewPositions = Record<string, { x: number; y: number }>;
export const defaultCardSize: CardSize = NODE_SIZE;

export function matchesIdea(idea: Idea, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if(!terms.length)return true;
  const body=idea.bodyFormat==='markdown'?markdownText(idea.body).replace(/\s+/g,' ').trim():idea.body;
  const text = [idea.title, body, idea.sourceLabel, idea.sourceUrl, ...idea.tags,
    ...idea.attachments.flatMap(file => [file.name, file.indexedText])].join(" ").toLocaleLowerCase();
  return terms.every(term => text.includes(term));
}
export function filterIdeas(ideas: Idea[], archived: boolean, query: string, tag: string): Idea[] {
  return ideas.filter(idea => idea.archived === archived && (!tag || idea.tags.includes(tag)) && matchesIdea(idea, query));
}
export function viewTagCounts(ideas: Idea[], archived: boolean, query: string): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const idea of ideas) {
    const included = idea.archived === archived && matchesIdea(idea, query);
    for (const tag of new Set(idea.tags)) {
      if (!counts.has(tag)) counts.set(tag, 0);
      if (included) counts.set(tag, counts.get(tag)! + 1);
    }
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
}
export function visibleConnections(connections: Connection[], ideas: Idea[]): Connection[] {
  const ids = new Set(ideas.map(idea => idea.id));
  return connections.filter(link => ids.has(link.fromId) && ids.has(link.toId));
}
export function freeViewPosition(preferred: { x: number; y: number;title?:string }, occupied: { x: number; y: number;title?:string }[], size: CardSize): { x: number; y: number } {
  return freeNodePosition(preferred,occupied);
}
export function applyViewPositions(ideas: Idea[], positions: ViewPositions, size: CardSize): Idea[] {
  // Leave unmodified cards fixed. Resolve local drags against them, including
  // the node hit area; never mutate the persisted ideas.
  const occupied = ideas.filter(idea => !positions[idea.id]).map(idea => ({ x: idea.x, y: idea.y,title:idea.title }));
  return ideas.map(idea => {
    if (!positions[idea.id]) return idea;
    const point = freeViewPosition({...positions[idea.id],title:idea.title}, occupied, size);
    occupied.push({...point,title:idea.title});
    return { ...idea, ...point };
  });
}
export function fitCanvasView(ideas: Idea[], viewport: ViewportSize, size: CardSize,minimumZoom=READING_ZOOM): CanvasState | null {
  if (!ideas.length || viewport.width <= 0 || viewport.height <= 0) return null;
  const bounds=ideas.map(nodeLayoutBounds);
  const minX=Math.min(...bounds.map(b=>b.left)),minY=Math.min(...bounds.map(b=>b.top)),maxX=Math.max(...bounds.map(b=>b.right)),maxY=Math.max(...bounds.map(b=>b.bottom));
  const width = Math.max(1, viewport.width - 64), height = Math.max(1, viewport.height - 168);
  const zoom = Math.max(Math.max(MIN_CANVAS_ZOOM,minimumZoom), Math.min(1, width / (maxX - minX), height / (maxY - minY)));
  return { zoom, panX: viewport.width / 2 - (minX + maxX) / 2 * zoom, panY: 96 + height / 2 - (minY + maxY) / 2 * zoom };
}
