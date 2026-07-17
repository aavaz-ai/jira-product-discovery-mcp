# Jira Product Discovery MCP

A focused Model Context Protocol server for native Jira Product Discovery
Insights and their supporting attachments.

This package exposes exactly three tools:

- `jira_list_jpd_insights` lists native Insights for a human-friendly idea key.
- `jira_create_jpd_insight` creates a native, description-only Insight containing
  a summary, customer quote, and linked source.
- `jira_add_attachment` uploads one UTF-8 or base64-encoded file to an idea.

It does not expose arbitrary GraphQL or generic Jira REST methods.

## Configuration

The server reuses a Jira OAuth 2.0 (3LO) bearer supplied by the host process:

```sh
ATLASSIAN_OAUTH_BEARER=your_access_token
```

If the token can access more than one Atlassian site, also supply the cloud ID
selected by the connection flow:

```sh
ATLASSIAN_CLOUD_ID=your_cloud_id
```

The bearer is sent only to Atlassian. It is never accepted as a tool argument.
API-token authentication is not supported because native JPD Insights use the
Polaris GraphQL API behind the Jira 3LO connection.

## Running

After the package is published:

```sh
npx -y @enterpret/jira-product-discovery-mcp
```

The process communicates over MCP stdio. For local development:

```sh
npm ci
npm test
npm run build
node dist/index.js
```

## Tool inputs

### `jira_list_jpd_insights`

```json
{ "ideaKey": "MDP-2" }
```

The server resolves the selected site, project ID, issue ID, and required ARIs,
then returns a normalized Insight list.

### `jira_create_jpd_insight`

```json
{
  "ideaKey": "MDP-2",
  "description": "Customers need a faster workflow.",
  "quote": "The current workflow takes too long.",
  "sourceUrl": "https://feedback.example.com/records/42",
  "sourceTitle": "Customer interview"
}
```

Creation uses a fixed, allowlisted Polaris mutation. Evidence is stored in a
native JPD Insight as an Atlassian Document Format description with a clickable
source link. It intentionally uses no structured snippet, so it needs no OAuth
client ID and provides no atomic or marker-backed idempotency guarantee.

### `jira_add_attachment`

```json
{
  "issueKey": "MDP-2",
  "filename": "evidence.txt",
  "content": "Supporting evidence",
  "encoding": "utf8",
  "mimeType": "text/plain"
}
```

Use `encoding: "base64"` for binary files. The MCP upload limit is 10 MiB after
decoding. Jira creates a new attachment on every successful call.

## Provider status

Native Insights use Atlassian's private experimental Polaris endpoint and can
change independently of Jira's stable REST API. Responses are strictly checked
and fail closed when their shape changes. Insight update and deletion are not
exposed.

All repository tests use explicit mocked HTTP responses and do not require Jira
credentials.

## License and provenance

ISC licensed. This repository preserves the implementation history derived from
Andi Ashari's ISC-licensed Jira MCP server while presenting a separate product,
package, and public tool contract.
