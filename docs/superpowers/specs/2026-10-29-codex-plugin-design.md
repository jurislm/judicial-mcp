# Codex plugin support

Terry approved this design and authorized implementation, verification and publication. Provide portable root plugin.json/mcp.json, a Codex compatibility overlay and .mcp.json, and repo marketplace registration for installation from jurislm/judicial-mcp. Keep all 10 tools and describe 3 public tools separately; preserve existing source behavior. Public OpenAI directory submission is out of scope.

The npm command must launch a prebuilt Bun bundle, not import dependencies from a transient bunx node_modules tree. Build from locked dependencies before npm packing; verify an extracted tarball starts and lists 10 tools in a clean directory without node_modules. Plugin wiring may invoke published npm CLI through Bun; lack of the package itself is an installation error, but missing runtime dependencies must no longer break initialization. stdout remains JSON-RPC only. No hooks, embedded secrets or manual mcp_servers registration.

Root manifest uses Agent Plugins 1.0.0 schema and extensions.com.openai interface. The legacy overlay supports current Codex clients. Versions follow package.json via release-please, with release-PR validation updated only for the two additional manifest version fields. Marketplace uses documented relative plugin path or Git URL source. Document Bun prerequisite, local Docker Firecrawl setup and environment forwarding; do not install Docker or recreate prior manual MCP config.

Verify schema/manifest identity/wiring, version sync, release changes, actual CLI marketplace discovery/install in an isolated Codex home, packed stdio startup and public tool calls. Do not confuse a local marketplace with the universal OpenAI directory. Keep user global config unchanged until they choose installation.
