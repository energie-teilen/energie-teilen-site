/**
 * client/src/lib/head.ts
 *
 * Per-route document head.
 *
 * The build emits a static HTML file per route with the correct title,
 * description, canonical and structured data, so a crawler or a link preview
 * gets the right answer without executing anything. This module keeps the head
 * correct for the OTHER path: navigation inside the running application, where
 * no new document is fetched.
 *
 * Both sides read shared/routes.ts, so they cannot disagree about what a page
 * is called.
 */

import { absoluteUrl, routeFor, type RouteDefinition } from "../../../shared/routes";

const OG_IMAGE = "/og-image.png";

function setMeta(selector: string, attr: "name" | "property", key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setLink(rel: string, href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/** Apply a route's metadata to the live document. */
export function applyRouteHead(route: RouteDefinition): void {
  document.title = route.title;

  setMeta('meta[name="description"]', "name", "description", route.description);
  setMeta('meta[property="og:title"]', "property", "og:title", route.title);
  setMeta('meta[property="og:description"]', "property", "og:description", route.description);
  setMeta('meta[property="og:url"]', "property", "og:url", absoluteUrl(route.path));
  setMeta('meta[property="og:image"]', "property", "og:image", absoluteUrl(OG_IMAGE));
  setMeta('meta[property="og:type"]', "property", "og:type", route.kind === "landing" ? "website" : "article");
  setMeta('meta[name="twitter:title"]', "name", "twitter:title", route.title);
  setMeta('meta[name="twitter:description"]', "name", "twitter:description", route.description);

  setLink("canonical", absoluteUrl(route.path));
}

/** Apply the head for a path, falling back to the landing route. */
export function applyHeadForPath(path: string): void {
  const route = routeFor(path) ?? routeFor("/");
  if (route) applyRouteHead(route);
}
