# Releasing

Jira Product Discovery MCP releases are explicit. Pushing to `main` never
publishes an npm package.

## Release model

The `Publish npm package` GitHub Actions workflow must be started manually from
the reviewed `main` revision. It installs from the lockfile, validates the
release candidate, creates one npm tarball, starts that exact tarball through
`npx`, verifies the eight-tool MCP surface, and publishes the same tarball with
npm provenance.

The workflow uses npm Trusted Publishing through GitHub's OIDC token. Do not add
an npm token, Atlassian token, or other credential to the workflow or repository.

## One-time npm bootstrap

`@enterpret/jira-product-discovery-mcp` is currently unpublished. An authorized
`@enterpret` npm owner must create it once using npm's interactive authentication
and required two-factor authentication before Trusted Publishing can be enabled.
This initial publication is a separate, explicitly approved operation.

Before the bootstrap publication:

1. Merge the reviewed release candidate to `main`.
2. Run the validation commands below from that exact revision.
3. Pack once into a directory outside the repository.
4. Inspect and smoke-test that exact tarball.
5. Publish that tarball itself rather than repacking the source directory.

The separately approved bootstrap command is:

```bash
npm publish /absolute/reviewed-artifact-directory/enterpret-jira-product-discovery-mcp-<version>.tgz --access public
```

Never place npm credentials or Atlassian credentials in repository files,
workflow inputs, shell history, fixtures, or logs.

## Configure Trusted Publishing

After the package exists on npm:

1. Create a protected GitHub environment named `npm` with required reviewers.
2. Configure npm Trusted Publishing with:
    - Organization: `aavaz-ai`
    - Repository: `jira-product-discovery-mcp`
    - Workflow filename: `release.yml`
    - Environment: `npm`
    - Allowed action: `npm publish`
3. Confirm GitHub lists `Publish npm package` as an active workflow.

Trusted Publishing requires a GitHub-hosted runner, Node.js 22.14 or newer, and
npm 11.5.1 or newer. The workflow pins npm 11.17.0 and uses GitHub's hosted
`ubuntu-latest` runner.

## Prepare a release

Update `package.json`, `package-lock.json`, and
`src/utils/constants.util.ts` to the same reviewed version. Add the release notes
at the top of `CHANGELOG.md` and replace `Unreleased` with the release date.

Run:

```bash
npm ci
npm run format:check
npm run lint
npm test -- --runInBand
npm audit --omit=dev --audit-level=high
npm pack --dry-run
```

Then create and smoke one review artifact outside the repository:

```bash
npm pack --pack-destination /absolute/reviewed-artifact-directory
node scripts/packed-npx-smoke.mjs /absolute/reviewed-artifact-directory/enterpret-jira-product-discovery-mcp-<version>.tgz
```

The smoke uses a placeholder bearer only to initialize the MCP subprocess and
list its tools. It does not call Jira or Polaris.

## Publish

From GitHub Actions, select `Publish npm package`, choose `main`, and run the
workflow. Required reviewers on the `npm` environment approve the publication.
The workflow publishes the exact tarball it packed and smoke-tested.

Afterward, verify the npm package version, provenance, tarball contents, CLI
executable, and exact eight-tool discovery. Consumers and deployments should pin
the immutable published version rather than `latest`.
