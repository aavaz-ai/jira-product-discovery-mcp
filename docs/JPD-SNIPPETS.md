# Jira Product Discovery snippets

Jira Product Discovery Insights can carry evidence in two ways:

- An Atlassian Document Format (ADF) description.
- One or more structured snippets associated with a source application.

Both representations create native JPD Insights. A snippet is an optional
structured source representation, not a requirement for creating an Insight.

## Description-only Insights

A description-only Insight stores its content in ADF and uses no snippets:

```text
data: []
snippets: []
```

ADF can represent headings, paragraphs, formatted text, customer quotes, lists,
line breaks, Unicode, and clickable links. This is sufficient when a product
manager needs readable supporting evidence attached to an Idea.

## Structured snippets

A structured snippet stores source information separately from the Insight
description. The current quote-snippet shape can provide a source icon, linked
source title, source URL, and one or more quotes.

| Capability                                       | Description only     | Structured snippet |
| ------------------------------------------------ | -------------------- | ------------------ |
| Native JPD Insight                               | Yes                  | Yes                |
| Formatted evidence and clickable links           | Yes                  | Yes                |
| Standard source card with icon, title, and quote | No                   | Yes                |
| Machine-readable source and quote fields         | No                   | Yes                |
| Provider/app attribution                         | No                   | Yes                |
| Provider-driven unfurl or refresh lifecycle      | No                   | Potentially        |
| Hidden provider-owned metadata                   | No reliable location | Yes                |

In a live comparison, both representations rendered the same rich ADF content.
The visible addition from the structured snippet was the standard source card.

## OAuth client ID

An `oauthClientId` on a snippet identifies the provider application associated
with that snippet. It is snippet-level attribution metadata, not the bearer token
that authenticates a Polaris request.

Description-only Insight creation does not require an OAuth client ID. If this
server supports snippet creation in the future, the client ID must remain
server-owned: do not hardcode it or accept it as an MCP tool argument.

## When snippets are useful

Consider structured snippet support when at least one of these is an explicit
product requirement:

1. Product managers need the standard source card rather than evidence rendered
   as description content.
2. Wisdom or another integration must consume the quote, source URL, and source
   title as separate machine-readable fields.
3. Enterpret must refresh or synchronize an Insight when its underlying feedback
   record changes.
4. Customers need explicit provider attribution inside JPD.
5. One Insight must carry multiple structured quotes or evidence groups with
   source-specific behavior.

Description-only content remains the simpler choice when the goal is to attach a
feedback theme, readable supporting evidence, and a source link to an Idea.

UI polish, hypothetical future use, or idempotency alone are not sufficient
reasons to add snippet support. A snippet-backed marker can protect retries after
a completed create is readable, but Polaris still provides no atomic protection
against concurrent first use.

## Adding snippet support

If the product needs snippets later:

- Use a fixed, typed, allowlisted snippet schema; never expose arbitrary GraphQL
  or raw Polaris input.
- Keep the OAuth client ID server-owned and out of tool inputs and results.
- Confirm the source-card or machine-readable behavior creates user value across
  supported Jira tenants.
- Reassess logging, privacy, validation, retry behavior, and deployment wiring.
- Add focused mocked tests for the accepted provider response shapes.

Listing an Insight that already contains snippets is read compatibility. It does
not imply that this server creates, updates, refreshes, or deletes snippets.

## References

- [Atlassian JPD reference application](https://github.com/Jira-Product-Discovery-Integrations/polaris-forge-ref-app)
- [Atlassian GraphQL API lifecycle](https://developer.atlassian.com/platform/atlassian-graphql-api/graphql/)
