#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';

const tarball = process.argv[2];
if (!tarball) {
	throw new Error('usage: node scripts/packed-npx-smoke.mjs <package.tgz>');
}

const expectedTools = [
	'jira_get',
	'jira_post',
	'jira_put',
	'jira_patch',
	'jira_delete',
	'jira_add_attachment',
	'jira_list_jpd_insights',
	'jira_create_jpd_insight',
];
const transport = new StdioClientTransport({
	command: 'npx',
	args: [
		'--yes',
		'--package',
		`file:${resolve(tarball)}`,
		'jira-product-discovery-mcp',
	],
	env: {
		...process.env,
		ATLASSIAN_OAUTH_BEARER: 'PACKED_ARTIFACT_DISCOVERY_ONLY',
	},
	stderr: 'pipe',
});
const client = new Client({
	name: 'jira-product-discovery-packed-npx-smoke',
	version: '1.0.0',
});

try {
	await client.connect(transport);
	const { tools } = await client.listTools();
	const actualTools = tools.map((tool) => tool.name);
	if (JSON.stringify(actualTools) !== JSON.stringify(expectedTools)) {
		throw new Error(
			`unexpected tool surface: ${JSON.stringify(actualTools)}`,
		);
	}
	process.stdout.write(
		`packed npx smoke passed: ${actualTools.join(', ')}\n`,
	);
} finally {
	await client.close();
}
