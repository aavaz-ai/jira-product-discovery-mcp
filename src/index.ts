#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import jiraAttachmentTools from './tools/jira.attachments.tool.js';
import jpdInsightsTools from './tools/jpd.insights.tool.js';
import { PACKAGE_NAME, VERSION } from './utils/constants.util.js';

export function createServer(): McpServer {
	const server = new McpServer({ name: PACKAGE_NAME, version: VERSION });
	jpdInsightsTools.registerTools(server);
	jiraAttachmentTools.registerTools(server);
	return server;
}

export async function startServer(): Promise<McpServer> {
	const server = createServer();
	await server.connect(new StdioServerTransport());
	return server;
}

if (require.main === module) {
	startServer().catch(() => {
		// Keep stdout reserved for MCP JSON-RPC and avoid echoing sensitive errors.
		console.error('Jira Product Discovery MCP failed to start.');
		process.exitCode = 1;
	});
}
