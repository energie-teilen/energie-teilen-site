/**
 * server/mcp-path.ts
 *
 * The MCP endpoint's path, alone in a module.
 *
 * It is needed by the server, by the discovery build and by the test that
 * checks the deployment routes it correctly — and that last one runs in a DOM
 * environment where importing anything that pulls in Express types is not
 * possible. One constant, importable from everywhere, beats the same string
 * written down three times.
 */
export const MCP_PATH = "/mcp";
