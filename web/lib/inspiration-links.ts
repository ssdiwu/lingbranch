export function inspirationUrl(origin: string, id: string): string {
  const url = new URL("/", origin);
  url.searchParams.set("idea", id);
  return url.href;
}
