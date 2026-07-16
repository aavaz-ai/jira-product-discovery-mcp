import { z } from 'zod';

const IssueKey = z
	.string()
	.trim()
	.regex(/^[A-Za-z][A-Za-z0-9_]*-\d+$/, 'Use a Jira issue key such as MDP-2.')
	.transform((value) => value.toUpperCase());

const NormalizedIssueKey = z
	.string()
	.regex(/^[A-Z][A-Z0-9_]*-\d+$/, 'Expected a normalized Jira issue key.');

const Filename = z
	.string()
	.trim()
	.min(1)
	.max(255)
	.refine(
		(value) => !/[\\/\0]/.test(value),
		'Filename must not contain path separators or null bytes.',
	);

const MimeType = z
	.string()
	.trim()
	.min(3)
	.max(255)
	.regex(
		/^[^\s/;]+\/[^\s/;]+$/,
		'Use a MIME type such as text/plain or application/pdf.',
	);

export const AddJiraAttachmentArgs = z
	.object({
		issueKey: IssueKey.describe(
			'Jira issue or Jira Product Discovery idea key.',
		),
		filename: Filename.describe('Filename Jira should display.'),
		content: z
			.string()
			.max(14_000_000)
			.describe(
				'Attachment contents. Pass plain text with encoding=utf8 or binary data encoded as base64 with encoding=base64.',
			),
		encoding: z
			.enum(['utf8', 'base64'])
			.default('utf8')
			.describe('How content is encoded. Defaults to utf8.'),
		mimeType: MimeType.default('application/octet-stream').describe(
			'Attachment MIME type. Defaults to application/octet-stream.',
		),
	})
	.strict();

export type AddJiraAttachmentArgsType = z.infer<typeof AddJiraAttachmentArgs>;

export const AddJiraAttachmentResult = z
	.object({
		issueKey: NormalizedIssueKey,
		attachment: z
			.object({
				id: z.string().min(1),
				filename: z.string().min(1),
				mimeType: z.string().min(1),
				size: z.number().int().nonnegative(),
				contentUrl: z.url(),
				thumbnailUrl: z.url().optional(),
			})
			.strict(),
	})
	.strict();

export type AddJiraAttachmentResultType = z.infer<
	typeof AddJiraAttachmentResult
>;
