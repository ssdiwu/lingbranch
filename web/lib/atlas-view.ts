import type { CanvasState, Connection, Idea } from "@/lib/idea-store";

export type CardSize = { width: number; height: number };
export type ViewportSize = { width: number; height: number };
export type ViewPositions = Record<string, { x: number; y: number }>;
export const defaultCardSize: CardSize = { width: 300, height: 420 };

export function matchesIdea(idea: Idea, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = [idea.title, idea.body, idea.sourceLabel, idea.sourceUrl, ...idea.tags,
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
export function compactIdeas(ideas: Idea[], viewport: ViewportSize, size: CardSize): Idea[] {
  if (!ideas.length) return [];
  const width = size.width + 24, height = size.height + 28;
  const ratio = Math.max(1, viewport.width - 64) / Math.max(1, viewport.height - 168);
  const columns = Math.max(1, Math.min(ideas.length, Math.ceil(Math.sqrt(ideas.length * ratio * height / width))));
  return ideas.map((idea, index) => ({ ...idea, x: index % columns * width, y: Math.floor(index / columns) * height }));
}
export function freeViewPosition(preferred: { x: number; y: number }, occupied: { x: number; y: number }[], size: CardSize): { x: number; y: number } {
  const width = size.width + 24, height = size.height + 28;
  const x = Math.max(-900_000, Math.min(900_000, preferred.x)), y = Math.max(-900_000, Math.min(900_000, preferred.y));
  for (let index = 0; index <= occupied.length * 9 + 4; index++) {
    const point = { x: x + index % 4 * width, y: y + Math.floor(index / 4) * height };
    if (!occupied.some(other => Math.abs(point.x - other.x) < width && Math.abs(point.y - other.y) < height)) return point;
  }
  throw new Error("当前视图附近没有空位，请换一个位置。");
}
export function applyViewPositions(ideas: Idea[], positions: ViewPositions, size: CardSize): Idea[] {
  // Leave unmodified cards fixed. Resolve local drags against them, including
  // changed card measurements after resize; never mutate the persisted ideas.
  const occupied = ideas.filter(idea => !positions[idea.id]).map(idea => ({ x: idea.x, y: idea.y }));
  return ideas.map(idea => {
    if (!positions[idea.id]) return idea;
    const point = freeViewPosition(positions[idea.id], occupied, size);
    occupied.push(point);
    return { ...idea, ...point };
  });
}
export function fitCanvasView(ideas: Idea[], viewport: ViewportSize, size: CardSize): CanvasState | null {
  if (!ideas.length || viewport.width <= 0 || viewport.height <= 0) return null;
  const minX = Math.min(...ideas.map(idea => idea.x)), minY = Math.min(...ideas.map(idea => idea.y));
  const maxX = Math.max(...ideas.map(idea => idea.x + size.width)), maxY = Math.max(...ideas.map(idea => idea.y + size.height));
  const width = Math.max(1, viewport.width - 64), height = Math.max(1, viewport.height - 168);
  const zoom = Math.max(.05, Math.min(1, width / (maxX - minX), height / (maxY - minY)));
  return { zoom, panX: viewport.width / 2 - (minX + maxX) / 2 * zoom, panY: 96 + height / 2 - (minY + maxY) / 2 * zoom };
}
