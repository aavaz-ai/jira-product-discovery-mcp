import { addJiraAttachment } from './jira.attachments.service.js';

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

const attachmentResponse = [
	{
		id: '10042',
		filename: 'evidence.txt',
		mimeType: 'text/plain',
		size: 18,
		content:
			'https://jira.example.com/secure/attachment/10042/evidence.txt',
		thumbnail:
			'https://jira.example.com/secure/thumbnail/10042/evidence.txt',
	},
];

function fetchMock(): jest.MockedFunction<typeof fetch> {
	return global.fetch as jest.MockedFunction<typeof fetch>;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function uploadRequest(): RequestInit {
	return fetchMock().mock.calls[1][1] as RequestInit;
}

function uploadedFile(): Blob & { name: string } {
	const body = uploadRequest().body;
	expect(body).toBeInstanceOf(FormData);
	const form = body as FormData;
	expect(Array.from(form.keys())).toEqual(['file']);
	const file = form.get('file');
	expect(file).toBeInstanceOf(Blob);
	return file as Blob & { name: string };
}

function enqueueSite(): void {
	fetchMock().mockResolvedValueOnce(jsonResponse([site]));
}

describe('Jira attachment service', () => {
	beforeEach(() => {
		global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
		process.env.ATLASSIAN_OAUTH_BEARER = 'private-jira-bearer';
		process.env.ATLASSIAN_CLOUD_ID = site.id;
	});

	afterAll(() => {
		global.fetch = originalFetch;
		for (const [key, value] of Object.entries(originalEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it('uploads UTF-8 content as OAuth multipart and normalizes the response', async () => {
		const content = 'private attachment café';
		enqueueSite();
		fetchMock().mockResolvedValueOnce(jsonResponse(attachmentResponse));

		await expect(
			addJiraAttachment({
				issueKey: 'mdp-2',
				filename: 'evidence.txt',
				content,
				mimeType: 'text/plain',
			}),
		).resolves.toEqual({
			issueKey: 'MDP-2',
			attachment: {
				id: '10042',
				filename: 'evidence.txt',
				mimeType: 'text/plain',
				size: 18,
				contentUrl:
					'https://jira.example.com/secure/attachment/10042/evidence.txt',
				thumbnailUrl:
					'https://jira.example.com/secure/thumbnail/10042/evidence.txt',
			},
		});

		expect(fetchMock().mock.calls[0][0]).toBe(
			'https://api.atlassian.com/oauth/token/accessible-resources',
		);
		expect(fetchMock().mock.calls[1][0]).toBe(
			'https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/issue/MDP-2/attachments',
		);
		expect(uploadRequest().headers).toMatchObject({
			Authorization: 'Bearer private-jira-bearer',
			Accept: 'application/json',
			'X-Atlassian-Token': 'no-check',
		});
		expect(uploadRequest().headers).not.toHaveProperty('Content-Type');
		const file = uploadedFile();
		expect(file.name).toBe('evidence.txt');
		expect(file.type).toBe('text/plain');
		await expect(file.text()).resolves.toBe(content);
	});

	it('decodes base64 binary content before uploading', async () => {
		const bytes = Uint8Array.from([0, 255, 1, 2, 3]);
		enqueueSite();
		fetchMock().mockResolvedValueOnce(
			jsonResponse([
				{
					...attachmentResponse[0],
					filename: 'evidence.bin',
					mimeType: 'application/octet-stream',
					size: bytes.byteLength,
				},
			]),
		);

		await addJiraAttachment({
			issueKey: 'MDP-2',
			filename: 'evidence.bin',
			content: Buffer.from(bytes).toString('base64'),
			encoding: 'base64',
		});

		const file = uploadedFile();
		expect(file.name).toBe('evidence.bin');
		expect(file.type).toBe('application/octet-stream');
		expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
	});

	it('rejects invalid base64 and oversized content before any request', async () => {
		await expect(
			addJiraAttachment({
				issueKey: 'MDP-2',
				filename: 'bad.bin',
				content: 'not valid base64!',
				encoding: 'base64',
			}),
		).rejects.toThrow('not valid base64');

		await expect(
			addJiraAttachment({
				issueKey: 'MDP-2',
				filename: 'large.txt',
				content: 'x'.repeat(10 * 1024 * 1024 + 1),
			}),
		).rejects.toThrow('10 MiB');
		expect(fetchMock()).not.toHaveBeenCalled();
	});

	it('fails before any request when OAuth bearer auth is missing', async () => {
		delete process.env.ATLASSIAN_OAUTH_BEARER;
		await expect(
			addJiraAttachment({
				issueKey: 'MDP-2',
				filename: 'evidence.txt',
				content: 'evidence',
			}),
		).rejects.toThrow('ATLASSIAN_OAUTH_BEARER');
		expect(fetchMock()).not.toHaveBeenCalled();
	});

	it('fails closed on provider errors, network errors, and schema drift', async () => {
		const args = {
			issueKey: 'MDP-2',
			filename: 'evidence.txt',
			content: 'private provider failure content',
		};

		enqueueSite();
		fetchMock().mockResolvedValueOnce(jsonResponse({}, 403));
		await expect(addJiraAttachment(args)).rejects.toThrow(
			'Atlassian denied permission',
		);

		fetchMock().mockReset();
		enqueueSite();
		fetchMock().mockRejectedValueOnce(new TypeError('fetch failed'));
		await expect(addJiraAttachment(args)).rejects.toThrow(
			'Network error while uploading',
		);

		fetchMock().mockReset();
		enqueueSite();
		fetchMock().mockResolvedValueOnce(jsonResponse({ unexpected: true }));
		await expect(addJiraAttachment(args)).rejects.toThrow(
			'unsupported attachment response',
		);
	});
});
