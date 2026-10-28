interface UriLocation { scheme: string, authority: string, path: string }

export function isSameOrChild(uri: UriLocation, parent: UriLocation): boolean {
  return uri.scheme === parent.scheme && uri.authority === parent.authority
    && (uri.path === parent.path || uri.path.startsWith(`${parent.path.replace(/\/$/, '')}/`))
}
