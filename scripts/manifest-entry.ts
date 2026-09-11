/**
 * scripts/manifest-entry.ts
 *
 * The single import surface the build scripts bundle and execute.
 * It exists so the generated discovery files are derived from the manifests
 * themselves rather than from a parse of their source text.
 */

export { indexableRoutes, ROUTES, siteOrigin, absoluteUrl, canonicalPathFor, buildSitemap, buildRobots } from "../shared/routes.js";
export { FAQ, faqFor, allFaqEntries } from "../shared/faq.js";
export { API_ENDPOINTS, API_AUTH_DOC, API_GUARANTEES, documentedPaths } from "../shared/api-reference.js";
export {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  MCP_INSTRUCTIONS,
  MCP_TOOLS,
  toolByName,
  toolListPayload,
} from "../shared/mcp.js";
export { contactEmail } from "../shared/legal-entity.js";
