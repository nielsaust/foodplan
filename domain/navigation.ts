export const pagePaths = {
  planning: '/planner',
  recepten: '/recipes',
  boodschappen: '/shopping',
  huisgenoten: '/household',
  beheer: '/admin',
} as const
export type Page = keyof typeof pagePaths
export const adminSections = ['transfer', 'publications', 'terms', 'accounts', 'emails', 'groups'] as const
export function pageFromPath(path: string): Page {
  return (Object.entries(pagePaths).find(([, route]) => path === route || (route === '/admin' && path.startsWith(route + '/')))?.[0] as Page) ?? 'planning'
}
export function isAppPath(path: string) {
  return path === '/' || Object.values(pagePaths).some(route => path === route || path === route + '/') ||
    adminSections.some(section => path === '/admin/' + section || path === '/admin/' + section + '/')
}
