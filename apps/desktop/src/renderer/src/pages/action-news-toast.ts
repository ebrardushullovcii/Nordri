const NEWS = new Set([
  "Application tracker updated.",
  "Activity resumed.",
  "Activity paused.",
  "Search plan created.",
  "Search plan updated.",
  "Active search plan updated.",
]);
export function isActionNews(message: string | null): boolean {
  return message !== null && NEWS.has(message);
}
