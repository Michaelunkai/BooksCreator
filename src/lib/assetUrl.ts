const basePath = import.meta.env.BASE_URL || "/";

/** Resolve a public asset below Vite's configured deployment base. */
export function assetUrl(path: string): string {
  const base = basePath.endsWith("/") ? basePath : `${basePath}/`;
  return `${base}${path.replace(/^\/+/u, "")}`;
}

/** Identify assets shipped by this app, including a project-site base path. */
export function isBundledAssetUrl(value: string): boolean {
  const prefix = assetUrl("assets/");
  return value.startsWith(prefix) && !value.includes("..");
}
