import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import jiraAttachmentTools from './jira.attachments.tool.js';
import { AddJiraAttachmentArgs } from './jira.attachments.types.js';

async function connect() {
	const server = new McpServer({ name: 'test-server', version: '1.0.0' });
	const client = new Client({ name: 'test-client', version: '1.0.0' });
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	jiraAttachmentTools.registerTools(server);
	await Promise.all([
		server.connect(serverTransport),
		client.connect(clientTransport),
	]);
	return {
		client,
		close: () => Promise.all([client.close(), server.close()]),
	};
}

describe('Jira attachment MCP tool', () => {
	it('publishes the strict write schema and non-idempotent annotations', async () => {
		const { client, close } = await connect();
		try {
			const { tools } = await client.listTools();
			expect(tools).toHaveLength(1);
			const [tool] = tools;
			expect(tool.name).toBe('jira_add_attachment');
			expect(tool.annotations).toMatchObject({
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: true,
			});
			expect(tool.inputSchema).toMatchObject({
				type: 'object',
				required: ['issueKey', 'filename', 'content'],
				additionalProperties: false,
				properties: {
					encoding: { default: 'utf8' },
					mimeType: { default: 'application/octet-stream' },
				},
			});
			expect(tool.outputSchema).toMatchObject({ type: 'object' });
		} finally {
			await close();
		}
	});

	it('applies defaults and rejects unsafe or unrelated arguments', () => {
		expect(
			AddJiraAttachmentArgs.parse({
				issueKey: 'mdp-2',
				filename: 'evidence.txt',
				content: 'supporting evidence',
			}),
		).toEqual({
			issueKey: 'MDP-2',
			filename: 'evidence.txt',
			content: 'supporting evidence',
			encoding: 'utf8',
			mimeType: 'application/octet-stream',
		});
		for (const invalid of [
			{ filename: '../secret.txt' },
			{ filename: 'folder/file.txt' },
			{ encoding: 'hex' },
			{ mimeType: 'not-a-mime-type' },
			{ token: 'caller-token' },
			{ path: '/tmp/local-file' },
		]) {
			expect(
				AddJiraAttachmentArgs.safeParse({
					issueKey: 'MDP-2',
					filename: 'evidence.txt',
					content: 'supporting evidence',
					...invalid,
				}).success,
			).toBe(false);
		}
	});

	it('returns an MCP error when credentials are missing', async () => {
		const originalEnv = {
			ATLASSIAN_OAUTH_BEARER: process.env.ATLASSIAN_OAUTH_BEARER,
			ATLASSIAN_SITE_NAME: process.env.ATLASSIAN_SITE_NAME,
			ATLASSIAN_USER_EMAIL: process.env.ATLASSIAN_USER_EMAIL,
			ATLASSIAN_API_TOKEN: process.env.ATLASSIAN_API_TOKEN,
		};
		delete process.env.ATLASSIAN_OAUTH_BEARER;
		delete process.env.ATLASSIAN_SITE_NAME;
		delete process.env.ATLASSIAN_USER_EMAIL;
		delete process.env.ATLASSIAN_API_TOKEN;
		const { client, close } = await connect();
		try {
			const result = await client.callTool({
				name: 'jira_add_attachment',
				arguments: {
					issueKey: 'MDP-2',
					filename: 'evidence.txt',
					content: 'supporting evidence',
				},
			});
			expect(result.isError).toBe(true);
			expect(result.content).toEqual([
				expect.objectContaining({
					text: expect.stringContaining(
						'Authentication credentials are missing',
					),
				}),
			]);
		} finally {
			await close();
			for (const [key, value] of Object.entries(originalEnv)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});
});
