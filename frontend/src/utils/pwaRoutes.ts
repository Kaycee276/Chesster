const LOCAL_ROUTES = new Set(["/offline-play", "/offline-games"]);

export function offlineRedirect(pathname: string, offline: boolean): string | null {
  return offline && !LOCAL_ROUTES.has(pathname) ? "/offline-games" : null;
}
