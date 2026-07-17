# Jira Product Discovery MCP

An MCP server for Jira Cloud and Jira Product Discovery. It exposes the existing
generic Jira REST tools together with typed native JPD Insight and attachment
operations.

Package: `@enterpret/jira-product-discovery-mcp`

## Tool surface

The server exposes exactly eight tools:

| Tool                      | Purpose                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `jira_get`                | Read from a Jira REST endpoint.                                      |
| `jira_post`               | Create through a Jira REST endpoint.                                 |
| `jira_put`                | Replace through a Jira REST endpoint.                                |
| `jira_patch`              | Partially update through a Jira REST endpoint.                       |
| `jira_delete`             | Delete through a Jira REST endpoint.                                 |
| `jira_add_attachment`     | Upload one UTF-8 or base64 attachment to an issue or JPD idea.       |
| `jira_list_jpd_insights`  | List native JPD Insights for an idea key.                            |
| `jira_create_jpd_insight` | Create a native JPD Insight with linked evidence in its description. |

The generic tools preserve compatibility with Jira REST API v3. Callers provide
only the REST path, query parameters, and request body; authentication remains
server-owned.

## Authentication

### OAuth bearer mode

Enterpret Agent uses Nango to refresh the Jira 3LO connection and injects the
short-lived access token into the MCP subprocess:

```bash
ATLASSIAN_OAUTH_BEARER=<access-token> \
  npx -y @enterpret/jira-product-discovery-mcp@0.2.0
```

Native JPD Insight tools require this mode. They do not accept tokens, Atlassian
IDs, GraphQL, or OAuth client IDs as tool arguments.

Set `ATLASSIAN_CLOUD_ID` when the bearer can access more than one Atlassian
site. The server verifies the configured cloud ID against Atlassian's accessible
resources and otherwise fails closed on ambiguous multi-site connections.

### Jira API token mode

The generic Jira REST tools and attachment tool also support Jira API-token
authentication:

```bash
ATLASSIAN_SITE_NAME=your-instance
ATLASSIAN_USER_EMAIL=you@example.com
ATLASSIAN_API_TOKEN=<api-token>
```

This mode does not support native JPD Insights.

## MCP configuration

The default transport is stdio:

```json
{
	"mcpServers": {
		"jira-product-discovery": {
			"command": "npx",
			"args": ["-y", "@enterpret/jira-product-discovery-mcp@0.2.0"],
			"env": {
				"ATLASSIAN_OAUTH_BEARER": "<access-token>"
			}
		}
	}
}
```

Supply secrets through the subprocess environment, never through MCP tool
arguments or command-line flags.

## Native JPD Insights

`jira_list_jpd_insights` accepts a human-friendly idea key such as `MDP-2`.
The server resolves the selected Atlassian cloud, project ID, and issue ID, then
constructs the fixed Polaris ARIs internally.

`jira_create_jpd_insight` accepts:

- `ideaKey`
- `description`
- `quote`
- `sourceUrl` (HTTPS)
- `sourceTitle`

It creates a native JPD Insight with an Atlassian Document Format description
containing the summary, quote, and linked source. It does not create a structured
source snippet and does not require `ATLASSIAN_OAUTH_CLIENT_ID`.

Creation is intentionally marked non-idempotent. Retrying a create after an
ambiguous provider response can create a duplicate Insight.

Native Insights currently use Atlassian's experimental Polaris GraphQL surface.
The server exposes only fixed, typed list and create operations; arbitrary
GraphQL and raw Polaris input are not available.

See [JPD snippet representations](docs/JPD-SNIPPETS.md) for the difference
between description-only Insights and structured source snippets.

## Attachments

`jira_add_attachment` accepts an issue or idea key, filename, content, optional
encoding (`utf8` or `base64`), and optional MIME type. The server builds Jira's
multipart request and limits decoded files to 10 MiB. Repeated calls create
separate Jira attachments.

## Data handling

Generic Jira REST calls retain the inherited raw-response diagnostics under
`/tmp/mcp/jira-product-discovery-mcp/`. These files can contain Jira request and
response payloads and should be handled accordingly. Attachment uploads are
marked sensitive, so attachment bytes and returned content URLs are excluded
from debug and raw-response output.

Large generic Jira responses are truncated for the MCP caller and include the
corresponding raw-response path. Jira pagination, field selection, and the
generic tools' `jq` filter can be used to request a smaller result.

## Development

Requires Node.js 18 or newer.

```bash
npm ci
npm run format:check
npm run lint
npm run build
npm test -- --runInBand
npm pack --dry-run
```

Tests use mocked provider responses for JPD and attachment operations. Do not
use production Atlassian credentials for local test runs.

## Releasing

Publishing is manual and never runs on a push to `main`. The release workflow
validates the candidate, packs once, smoke-tests that exact tarball through
`npx`, and publishes the same artifact with npm Trusted Publishing provenance.

See the [release runbook](https://github.com/aavaz-ai/jira-product-discovery-mcp/blob/main/RELEASING.md)
for the one-time npm bootstrap, Trusted Publishing configuration, release gates,
and post-publication verification.

## License and ancestry

ISC licensed. This repository retains the generic Jira foundation and history
from Andi Ashari's Jira MCP project and adds Enterpret's Jira Product Discovery
integration. See [LICENSE](LICENSE).
