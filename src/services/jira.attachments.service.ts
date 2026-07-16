import { z } from 'zod';
import {
	AddJiraAttachmentArgs,
	type AddJiraAttachmentArgsType,
	type AddJiraAttachmentResultType,
} from '../tools/jira.attachments.types.js';
import {
	fetchAtlassian,
	type AtlassianCredentials,
} from '../utils/transport.util.js';
import { createApiError, createUnexpectedError } from '../utils/error.util.js';
import { validateCredentials } from './vendor.atlassian.api.service.js';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const BASE64 =
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const JiraAttachmentSchema = z
	.object({
		id: z.string().min(1),
		filename: z.string().min(1),
		mimeType: z.string().min(1),
		size: z.number().int().nonnegative(),
		content: z.url(),
		thumbnail: z.url().optional(),
	})
	.passthrough();

const JiraAttachmentResponseSchema = z.array(JiraAttachmentSchema).min(1);

function decodeContent(args: AddJiraAttachmentArgsType): Buffer {
	if (args.encoding === 'base64' && !BASE64.test(args.content)) {
		throw createApiError('Attachment content is not valid base64.', 400);
	}

	const content = Buffer.from(args.content, args.encoding);
	if (content.byteLength > MAX_ATTACHMENT_BYTES) {
		throw createApiError(
			'Attachment exceeds the Jira MCP upload limit of 10 MiB.',
			400,
		);
	}
	return content;
}

async function upload(
	credentials: AtlassianCredentials,
	args: AddJiraAttachmentArgsType,
): Promise<AddJiraAttachmentResultType> {
	const content = decodeContent(args);
	const form = new FormData();
	form.append(
		'file',
		new Blob([content], { type: args.mimeType }),
		args.filename,
	);

	const response = await fetchAtlassian<unknown>(
		credentials,
		`/rest/api/3/issue/${encodeURIComponent(args.issueKey)}/attachments`,
		{
			method: 'POST',
			headers: { 'X-Atlassian-Token': 'no-check' },
			body: form,
			bodyFormat: 'raw',
			sensitive: true,
		},
	);

	const parsed = JiraAttachmentResponseSchema.safeParse(response.data);
	if (!parsed.success) {
		throw createUnexpectedError(
			'Jira returned an unsupported attachment response.',
		);
	}

	const attachment = parsed.data[0];
	return {
		issueKey: args.issueKey,
		attachment: {
			id: attachment.id,
			filename: attachment.filename,
			mimeType: attachment.mimeType,
			size: attachment.size,
			contentUrl: attachment.content,
			...(attachment.thumbnail
				? { thumbnailUrl: attachment.thumbnail }
				: {}),
		},
	};
}

export async function addJiraAttachment(
	input: unknown,
): Promise<AddJiraAttachmentResultType> {
	const args = AddJiraAttachmentArgs.parse(input);
	return upload(validateCredentials(), args);
}
