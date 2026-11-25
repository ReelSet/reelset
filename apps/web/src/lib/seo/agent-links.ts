const BASE = [
  '</llms.txt>; rel="describedby"; type="text/plain"',
  '</sitemap.xml>; rel="sitemap"; type="application/xml"',
  '</.well-known/api-catalog>; rel="api-catalog"',
  '</mcp>; rel="service-doc"; type="text/html"',
]

const REEL_PAGE = /^\/r\/([^/]+)\/?$/

function markdownAlternate(path: string): string {
  return `<${path}>; rel="alternate"; type="text/markdown"`
}

export function agentLinkHeader(pathname: string): string {
  const links = [...BASE]
  if (pathname === '/') {
    links.push(markdownAlternate('/index.md'))
  } else {
    const param = REEL_PAGE.exec(pathname)?.[1]
    if (param && !param.endsWith('.md')) links.push(markdownAlternate(`/r/${param}.md`))
  }
  return links.join(', ')
}
