export const pagePaths = {
  planning: '/planner',
  recepten: '/recipes',
  boodschappen: '/shopping',
  huisgenoten: '/household',
  beheer: '/admin',
} as const
export type Page = keyof typeof pagePaths
export const adminSections = ['transfer', 'publications', 'terms', 'categories', 'accounts', 'emails', 'groups'] as const
export function recipeIdFromPath(path: string): string | undefined {
  const match = /^\/recipes\/([^/]+)\/?$/.exec(path)
  if (!match) return undefined
  try { return decodeURIComponent(match[1]) } catch { return undefined }
}
export function recipePath(id: string) {
  return '/recipes/' + encodeURIComponent(id)
}
export function pageFromPath(path: string): Page {
  if (recipeIdFromPath(path)) return 'recepten'
  return (Object.entries(pagePaths).find(([, route]) => path === route || (route === '/admin' && path.startsWith(route + '/')))?.[0] as Page) ?? 'planning'
}
export function isAppPath(path: string) {
  return !!recipeIdFromPath(path) || path === '/' || Object.values(pagePaths).some(route => path === route || path === route + '/') ||
    adminSections.some(section => path === '/admin/' + section || path === '/admin/' + section + '/')
}
