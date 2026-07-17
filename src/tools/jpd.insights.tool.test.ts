import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServer } from '../index.js';
import jpdInsightsTools from './jpd.insights.tool.js';
import {
	CreateJpdInsightArgs,
	ListJpdInsightsArgs,
} from './jpd.insights.types.js';

async function connect(registerAttachment = true) {
	const server = registerAttachment
		? createServer()
		: new McpServer({ name: 'test-server', version: '1.0.0' });
	const client = new Client({ name: 'test-client', version: '1.0.0' });
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	if (!registerAttachment) jpdInsightsTools.registerTools(server);
	await Promise.all([
		server.connect(serverTransport),
		client.connect(clientTransport),
	]);
	return {
		client,
		close: () => Promise.all([client.close(), server.close()]),
	};
}

describe('JPD Insight MCP tools', () => {
	it('publishes exactly three typed product tools with separate permissions', async () => {
		const { client, close } = await connect();
		try {
			const { tools } = await client.listTools();
			expect(tools.map(({ name }) => name)).toEqual([
				'jira_list_jpd_insights',
				'jira_create_jpd_insight',
				'jira_add_attachment',
			]);
			const list = tools.find(
				({ name }) => name === 'jira_list_jpd_insights',
			);
			const create = tools.find(
				({ name }) => name === 'jira_create_jpd_insight',
			);
			expect(list?.annotations).toMatchObject({
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
			});
			expect(create?.annotations).toMatchObject({
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
			});
			expect(create?.inputSchema).toMatchObject({
				type: 'object',
				required: [
					'ideaKey',
					'description',
					'quote',
					'sourceUrl',
					'sourceTitle',
				],
				additionalProperties: false,
			});
			expect(list?.outputSchema).toMatchObject({ type: 'object' });
			expect(create?.outputSchema).toMatchObject({ type: 'object' });
		} finally {
			await close();
		}
	});

	it('returns the intended MCP error when bearer auth is missing', async () => {
		const originalBearer = process.env.ATLASSIAN_OAUTH_BEARER;
		delete process.env.ATLASSIAN_OAUTH_BEARER;
		const { client, close } = await connect(false);
		try {
			const result = await client.callTool({
				name: 'jira_list_jpd_insights',
				arguments: { ideaKey: 'MDP-2' },
			});
			expect(result.isError).toBe(true);
			expect(result.content).toEqual([
				expect.objectContaining({
					text: expect.stringContaining('ATLASSIAN_OAUTH_BEARER'),
				}),
			]);
		} finally {
			await close();
			if (originalBearer === undefined) {
				delete process.env.ATLASSIAN_OAUTH_BEARER;
			} else {
				process.env.ATLASSIAN_OAUTH_BEARER = originalBearer;
			}
		}
	});

	it('rejects arbitrary provider inputs and non-HTTPS creation URLs', () => {
		expect(ListJpdInsightsArgs.parse({ ideaKey: 'idea-123' })).toEqual({
			ideaKey: 'IDEA-123',
		});
		expect(
			ListJpdInsightsArgs.safeParse({
				ideaKey: 'IDEA-123',
				query: 'query Arbitrary { viewer { id } }',
			}).success,
		).toBe(false);

		const valid = {
			ideaKey: 'IDEA-123',
			description: 'Evidence summary',
			quote: 'A customer quote',
			sourceUrl: 'https://feedback.example.com/records/1',
			sourceTitle: 'Interview',
		};
		expect(CreateJpdInsightArgs.safeParse(valid).success).toBe(true);
		for (const forbidden of [
			{ query: 'mutation Arbitrary { deleteEverything }' },
			{ variables: { unsafe: true } },
			{ token: 'caller-token' },
			{ oauthClientId: 'caller-client-id' },
			{ sourceIconUrl: 'https://feedback.example.com/icon.png' },
			{ idempotencyKey: 'caller-key' },
			{ cloudID: 'cloud-123' },
			{ projectID: 'project-123' },
			{ issueID: 'issue-123' },
			{ ari: 'ari:cloud:jira:cloud:issue/1' },
			{ site: 'https://product.atlassian.net' },
		]) {
			expect(
				CreateJpdInsightArgs.safeParse({ ...valid, ...forbidden })
					.success,
			).toBe(false);
		}
		expect(
			CreateJpdInsightArgs.safeParse({
				...valid,
				sourceUrl: 'http://feedback.example.com/records/1',
			}).success,
		).toBe(false);
	});
});
