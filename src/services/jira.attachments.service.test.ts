import fs from 'fs';
import { addJiraAttachment } from './jira.attachments.service.js';
import { Logger } from '../utils/logger.util.js';
import * as responseUtil from '../utils/response.util.js';

const originalFetch = global.fetch;
const originalEnv = {
	ATLASSIAN_OAUTH_BEARER: process.env.ATLASSIAN_OAUTH_BEARER,
	ATLASSIAN_CLOUD_ID: process.env.ATLASSIAN_CLOUD_ID,
	ATLASSIAN_SITE_NAME: process.env.ATLASSIAN_SITE_NAME,
	ATLASSIAN_USER_EMAIL: process.env.ATLASSIAN_USER_EMAIL,
	ATLASSIAN_API_TOKEN: process.env.ATLASSIAN_API_TOKEN,
	DEBUG: process.env.DEBUG,
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
		statusText: status === 403 ? 'Forbidden' : 'OK',
		headers: { 'Content-Type': 'application/json' },
	});
}

function request(): RequestInit {
	return fetchMock().mock.calls[0][1] as RequestInit;
}

function uploadedFile(): Blob & { name: string } {
	const body = request().body;
	expect(body).toBeInstanceOf(FormData);
	const form = body as FormData;
	expect(Array.from(form.keys())).toEqual(['file']);
	const file = form.get('file');
	expect(file).toBeInstanceOf(Blob);
	return file as Blob & { name: string };
}

describe('Jira attachment service', () => {
	const saveRawResponse = jest.spyOn(responseUtil, 'saveRawResponse');

	beforeAll(() => {
		global.fetch = jest.fn();
	});

	beforeEach(() => {
		fetchMock().mockReset();
		saveRawResponse.mockClear();
		process.env.ATLASSIAN_OAUTH_BEARER = 'private-jira-bearer';
		process.env.ATLASSIAN_CLOUD_ID = 'cloud-123';
		delete process.env.ATLASSIAN_SITE_NAME;
		delete process.env.ATLASSIAN_USER_EMAIL;
		delete process.env.ATLASSIAN_API_TOKEN;
		process.env.DEBUG = 'true';
	});

	afterAll(() => {
		global.fetch = originalFetch;
		saveRawResponse.mockRestore();
		for (const [key, value] of Object.entries(originalEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it('uploads UTF-8 content as OAuth multipart and normalizes the response', async () => {
		const content = 'private attachment café';
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

		expect(fetchMock()).toHaveBeenCalledTimes(1);
		expect(fetchMock().mock.calls[0][0]).toBe(
			'https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/issue/MDP-2/attachments',
		);
		const options = request();
		expect(options.method).toBe('POST');
		expect(options.headers).toMatchObject({
			Authorization: 'Bearer private-jira-bearer',
			Accept: 'application/json',
			'X-Atlassian-Token': 'no-check',
		});
		expect(options.headers).not.toHaveProperty('Content-Type');
		const file = uploadedFile();
		expect(file.name).toBe('evidence.txt');
		expect(file.type).toBe('text/plain');
		await expect(file.text()).resolves.toBe(content);
		expect(saveRawResponse).not.toHaveBeenCalled();

		const logPath = Logger.getLogFilePath();
		if (fs.existsSync(logPath)) {
			expect(fs.readFileSync(logPath, 'utf8')).not.toContain(content);
		}
	});

	it('decodes base64 binary content before uploading', async () => {
		const bytes = Uint8Array.from([0, 255, 1, 2, 3]);
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
		expect(saveRawResponse).not.toHaveBeenCalled();
	});

	it('rejects invalid base64 and oversized decoded content before fetch', async () => {
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

	it('fails clearly when Atlassian credentials are missing', async () => {
		delete process.env.ATLASSIAN_OAUTH_BEARER;
		delete process.env.ATLASSIAN_SITE_NAME;
		delete process.env.ATLASSIAN_USER_EMAIL;
		delete process.env.ATLASSIAN_API_TOKEN;

		await expect(
			addJiraAttachment({
				issueKey: 'MDP-2',
				filename: 'evidence.txt',
				content: 'evidence',
			}),
		).rejects.toThrow('Authentication credentials are missing');
		expect(fetchMock()).not.toHaveBeenCalled();
	});

	it('fails closed on provider errors, network errors, and schema drift', async () => {
		const args = {
			issueKey: 'MDP-2',
			filename: 'evidence.txt',
			content: 'private provider failure content',
		};
		fetchMock().mockResolvedValueOnce(
			jsonResponse({ errorMessages: ['Attachment forbidden'] }, 403),
		);
		await expect(addJiraAttachment(args)).rejects.toThrow(
			'Insufficient permissions',
		);

		fetchMock().mockReset();
		fetchMock().mockRejectedValueOnce(new TypeError('fetch failed'));
		await expect(addJiraAttachment(args)).rejects.toThrow(
			'Network error connecting to Jira API',
		);

		fetchMock().mockReset();
		fetchMock().mockResolvedValueOnce(jsonResponse({ unexpected: true }));
		await expect(addJiraAttachment(args)).rejects.toThrow(
			'unsupported attachment response',
		);

		const logPath = Logger.getLogFilePath();
		if (fs.existsSync(logPath)) {
			expect(fs.readFileSync(logPath, 'utf8')).not.toContain(
				args.content,
			);
		}
	});
});
