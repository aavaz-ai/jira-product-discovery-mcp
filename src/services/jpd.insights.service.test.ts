import { createJpdInsight, listJpdInsights } from './jpd.insights.service.js';
import {
	CREATE_JPD_INSIGHT_DOCUMENT,
	LIST_JPD_INSIGHTS_DOCUMENT,
} from './vendor.polaris.service.js';

const originalFetch = global.fetch;
const originalEnv = {
	ATLASSIAN_OAUTH_BEARER: process.env.ATLASSIAN_OAUTH_BEARER,
	ATLASSIAN_CLOUD_ID: process.env.ATLASSIAN_CLOUD_ID,
};

const site = {
	id: 'cloud-123',
	name: 'Product',
	url: 'https://product.atlassian.net',
};
const idea = {
	id: 'issue-456',
	key: 'IDEA-7',
	fields: { project: { id: 'project-789' } },
};
const createArgs = {
	ideaKey: 'IDEA-7',
	description: 'Customers need a faster workflow.',
	quote: 'The current workflow takes too long.',
	sourceUrl: 'https://feedback.example.com/records/42',
	sourceTitle: 'Customer interview',
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function fetchMock(): jest.MockedFunction<typeof fetch> {
	return global.fetch as jest.MockedFunction<typeof fetch>;
}

function requestBody(index: number): Record<string, any> {
	const body = fetchMock().mock.calls[index][1]?.body;
	if (typeof body !== 'string') throw new Error('Expected JSON request body');
	return JSON.parse(body) as Record<string, any>;
}

function listResponse(insights: unknown[] = []) {
	return { data: { polarisInsights: insights } };
}

function createResponse(
	success = true,
	errors: Array<{ message: string }> | null = null,
	node: { id: string } | null = { id: 'insight-8905233' },
) {
	return { data: { createPolarisInsight: { success, errors, node } } };
}

function quoteData(groupId = 'source-group') {
	return {
		type: 'quotes',
		group: { name: 'Interview', id: groupId },
		context: {
			icon: 'https://feedback.example.com/icon.png',
			url: 'https://feedback.example.com/records/1',
			title: 'Interview record',
		},
		content: [{ type: 'quotesItem', quote: 'A useful quote' }],
		properties: { validation_id: { source: 'polaris' } },
	};
}

function insightWith(data: unknown, id = 'insight-1') {
	return {
		id,
		description: null,
		snippets: [
			{
				id: `snippet-${id}`,
				url: 'https://feedback.example.com/records/1',
				data,
			},
		],
	};
}

function enqueueContext(): void {
	fetchMock()
		.mockResolvedValueOnce(jsonResponse([site]))
		.mockResolvedValueOnce(jsonResponse(idea));
}

describe('JPD Insight service', () => {
	beforeEach(() => {
		process.env.ATLASSIAN_OAUTH_BEARER = 'private-jira-bearer';
		delete process.env.ATLASSIAN_CLOUD_ID;
		global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
	});

	afterAll(() => {
		global.fetch = originalFetch;
		for (const [key, value] of Object.entries(originalEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it('lists normalized Insights with exact ARIs and required headers', async () => {
		enqueueContext();
		fetchMock().mockResolvedValueOnce(
			jsonResponse(
				listResponse([
					{
						id: 'insight-1',
						description: {
							type: 'doc',
							version: 1,
							content: [
								{
									type: 'paragraph',
									content: [
										{
											type: 'text',
											text: 'Validated evidence',
										},
									],
								},
							],
						},
						snippets: [
							{
								id: 'snippet-1',
								url: 'https://feedback.example.com/records/1',
								data: quoteData(),
							},
							{ id: 'legacy', url: '', data: {} },
						],
					},
				]),
			),
		);

		await expect(listJpdInsights({ ideaKey: 'idea-7' })).resolves.toEqual({
			site: {
				cloudId: site.id,
				name: site.name,
				url: site.url,
			},
			idea: {
				key: idea.key,
				issueId: idea.id,
				projectId: idea.fields.project.id,
			},
			insights: [
				{
					id: 'insight-1',
					description: 'Validated evidence',
					snippets: [
						{
							id: 'snippet-1',
							sourceUrl: 'https://feedback.example.com/records/1',
							data: {
								type: 'quotes',
								groupName: 'Interview',
								context: {
									iconUrl:
										'https://feedback.example.com/icon.png',
									sourceUrl:
										'https://feedback.example.com/records/1',
									title: 'Interview record',
								},
								quotes: ['A useful quote'],
							},
						},
						{ id: 'legacy', sourceUrl: null, data: null },
					],
				},
			],
		});

		expect(fetchMock().mock.calls[1][0]).toBe(
			'https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/issue/IDEA-7?fields=project',
		);
		expect(fetchMock().mock.calls[0][1]?.headers).toEqual({
			Authorization: 'Bearer private-jira-bearer',
			Accept: 'application/json',
		});
		expect(requestBody(2)).toEqual({
			operationName: 'ListInsights',
			query: LIST_JPD_INSIGHTS_DOCUMENT,
			variables: {
				project: 'ari:cloud:jira:cloud-123:project/project-789',
				container: 'ari:cloud:jira:cloud-123:issue/issue-456',
			},
		});
		expect(fetchMock().mock.calls[2][1]?.headers).toEqual({
			Authorization: 'Bearer private-jira-bearer',
			'Content-Type': 'application/json',
			'X-ExperimentalApi': 'polaris-v0',
		});
	});

	it('normalizes the live empty-Idea null response to no Insights', async () => {
		enqueueContext();
		fetchMock().mockResolvedValueOnce(
			jsonResponse({ data: { polarisInsights: null } }),
		);

		await expect(
			listJpdInsights({ ideaKey: 'IDEA-7' }),
		).resolves.toMatchObject({
			insights: [],
		});
	});

	it('requires an exact configured cloud when multiple sites are accessible', async () => {
		const otherSite = {
			id: 'cloud-456',
			name: 'Other',
			url: 'https://other.atlassian.net',
		};
		fetchMock().mockResolvedValueOnce(jsonResponse([]));
		await expect(listJpdInsights({ ideaKey: 'IDEA-7' })).rejects.toThrow(
			'no accessible Atlassian sites',
		);

		fetchMock().mockReset();
		fetchMock().mockResolvedValueOnce(jsonResponse([site, otherSite]));
		await expect(listJpdInsights({ ideaKey: 'IDEA-7' })).rejects.toThrow(
			'Set ATLASSIAN_CLOUD_ID',
		);

		fetchMock().mockReset();
		process.env.ATLASSIAN_CLOUD_ID = 'missing-cloud';
		fetchMock().mockResolvedValueOnce(jsonResponse([site, otherSite]));
		await expect(listJpdInsights({ ideaKey: 'IDEA-7' })).rejects.toThrow(
			'does not match a site accessible',
		);

		fetchMock().mockReset();
		process.env.ATLASSIAN_CLOUD_ID = otherSite.id;
		fetchMock()
			.mockResolvedValueOnce(jsonResponse([site, otherSite]))
			.mockResolvedValueOnce(jsonResponse(idea))
			.mockResolvedValueOnce(jsonResponse(listResponse()));

		await expect(
			listJpdInsights({ ideaKey: 'IDEA-7' }),
		).resolves.toMatchObject({
			site: { cloudId: otherSite.id },
		});
		expect(fetchMock().mock.calls[1][0]).toBe(
			'https://api.atlassian.com/ex/jira/cloud-456/rest/api/3/issue/IDEA-7?fields=project',
		);
	});

	it('creates a description-only Insight with plain IDs and linked evidence', async () => {
		enqueueContext();
		fetchMock().mockResolvedValueOnce(jsonResponse(createResponse()));

		await expect(createJpdInsight(createArgs)).resolves.toMatchObject({
			insight: { id: 'insight-8905233' },
			status: 'created',
		});
		const body = requestBody(2);
		expect(body.operationName).toBe('CreateInsight');
		expect(body.query).toBe(CREATE_JPD_INSIGHT_DOCUMENT);
		expect(body.variables.input).toMatchObject({
			cloudID: 'cloud-123',
			projectID: 'project-789',
			issueID: 'issue-456',
			description: {
				version: 1,
				type: 'doc',
				content: [
					{
						type: 'paragraph',
						content: [
							{ type: 'text', text: createArgs.description },
						],
					},
					{
						type: 'blockquote',
						content: [
							{
								type: 'paragraph',
								content: [
									{ type: 'text', text: createArgs.quote },
								],
							},
						],
					},
					{
						type: 'paragraph',
						content: [
							{ type: 'text', text: 'Source: ' },
							{
								type: 'text',
								text: createArgs.sourceTitle,
								marks: [
									{
										type: 'link',
										attrs: { href: createArgs.sourceUrl },
									},
								],
							},
						],
					},
				],
			},
			data: [],
			snippets: [],
		});
	});

	it('requires bearer auth', async () => {
		delete process.env.ATLASSIAN_OAUTH_BEARER;
		await expect(listJpdInsights({ ideaKey: 'IDEA-7' })).rejects.toThrow(
			'ATLASSIAN_OAUTH_BEARER',
		);
		await expect(createJpdInsight(createArgs)).rejects.toThrow(
			'ATLASSIAN_OAUTH_BEARER',
		);
	});

	it.each([
		[
			'top-level GraphQL errors',
			jsonResponse({ data: null, errors: [{ message: 'hidden' }] }),
			'GraphQL errors',
		],
		[
			'missing list node',
			jsonResponse({ data: {} }),
			'list response did not match',
		],
		[
			'malformed insight',
			jsonResponse(listResponse([{ id: 'only-an-id' }])),
			'list response did not match',
		],
		[
			'malformed URL',
			jsonResponse(
				listResponse([
					{
						id: 'i',
						description: null,
						snippets: [{ id: 's', url: 'bad-url', data: null }],
					},
				]),
			),
			'list response did not match',
		],
		[
			'unsupported snippet',
			jsonResponse(listResponse([insightWith({ type: 'card' })])),
			'unsupported snippet type',
		],
		['HTTP 401', jsonResponse({}, 401), 'HTTP 401'],
		['HTTP 403', jsonResponse({}, 403), 'HTTP 403'],
	])(
		'fails closed for list failure: %s',
		async (_name, response, message) => {
			enqueueContext();
			fetchMock().mockResolvedValueOnce(response);
			await expect(
				listJpdInsights({ ideaKey: 'IDEA-7' }),
			).rejects.toThrow(message);
		},
	);

	it('fails closed on Jira schema drift and Polaris network errors', async () => {
		fetchMock()
			.mockResolvedValueOnce(jsonResponse([site]))
			.mockResolvedValueOnce(jsonResponse({ id: 'missing-project' }));
		await expect(listJpdInsights({ ideaKey: 'IDEA-7' })).rejects.toThrow(
			'expected issue and project identifiers',
		);

		fetchMock().mockReset();
		enqueueContext();
		fetchMock().mockRejectedValueOnce(new TypeError('fetch failed'));
		await expect(listJpdInsights({ ideaKey: 'IDEA-7' })).rejects.toThrow(
			'Network error while calling',
		);
	});

	it.each([
		['success false', createResponse(false, [], null), 'unsuccessful'],
		[
			'provider errors',
			createResponse(false, [{ message: 'rejected' }], null),
			'provider errors',
		],
		['missing node', createResponse(true, [], null), 'missing the created'],
		[
			'malformed result',
			{ data: { createPolarisInsight: { success: true } } },
			'create response did not match',
		],
	])('fails closed for create failure: %s', async (_name, body, message) => {
		enqueueContext();
		fetchMock().mockResolvedValueOnce(jsonResponse(body));
		await expect(createJpdInsight(createArgs)).rejects.toThrow(message);
	});
});
