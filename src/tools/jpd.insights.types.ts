import { z } from 'zod';

const HttpsUrl = z
	.string()
	.max(2048)
	.url()
	.refine((value) => new URL(value).protocol === 'https:', {
		message: 'URL must use HTTPS',
	});

const IdeaKey = z
	.string()
	.trim()
	.regex(
		/^[A-Za-z][A-Za-z0-9_]*-\d+$/,
		'ideaKey must be a Jira issue key such as IDEA-123',
	)
	.transform((value) => value.toUpperCase());

export const ListJpdInsightsArgs = z
	.object({
		ideaKey: IdeaKey.describe(
			'Human-friendly Jira Product Discovery idea key.',
		),
	})
	.strict();

export type ListJpdInsightsArgsType = z.infer<typeof ListJpdInsightsArgs>;

export const CreateJpdInsightArgs = z
	.object({
		ideaKey: IdeaKey.describe(
			'Human-friendly Jira Product Discovery idea key.',
		),
		description: z
			.string()
			.trim()
			.min(1)
			.max(10000)
			.describe('Insight description stored as an Atlassian document.'),
		quote: z
			.string()
			.trim()
			.min(1)
			.max(10000)
			.describe(
				'Quoted source content included in the Insight description.',
			),
		sourceUrl: HttpsUrl.describe('HTTPS URL for the source evidence.'),
		sourceTitle: z
			.string()
			.trim()
			.min(1)
			.max(500)
			.describe('Human-friendly source title.'),
	})
	.strict();

export type CreateJpdInsightArgsType = z.infer<typeof CreateJpdInsightArgs>;

const JpdSiteIdentity = z
	.object({
		cloudId: z.string().min(1),
		name: z.string().min(1),
		url: z.url(),
	})
	.strict();

const JpdIdeaIdentity = z
	.object({
		key: z.string().min(1),
		issueId: z.string().min(1),
		projectId: z.string().min(1),
	})
	.strict();

const JpdSnippetContext = z
	.object({
		iconUrl: z.url(),
		sourceUrl: z.url(),
		title: z.string(),
	})
	.strict();

const JpdSnippetData = z
	.object({
		type: z.string().min(1),
		groupName: z.string().optional(),
		context: JpdSnippetContext.optional(),
		quotes: z.array(z.string()).optional(),
	})
	.strict();

const JpdInsight = z
	.object({
		id: z.string().min(1),
		description: z.string().nullable(),
		snippets: z.array(
			z
				.object({
					id: z.string().min(1),
					sourceUrl: z.url().nullable(),
					data: JpdSnippetData.nullable(),
				})
				.strict(),
		),
	})
	.strict();

export const ListJpdInsightsResult = z
	.object({
		site: JpdSiteIdentity,
		idea: JpdIdeaIdentity,
		insights: z.array(JpdInsight),
	})
	.strict();

export type ListJpdInsightsResultType = z.infer<typeof ListJpdInsightsResult>;

export const CreateJpdInsightResult = z
	.object({
		site: JpdSiteIdentity,
		idea: JpdIdeaIdentity,
		insight: z
			.object({
				id: z.string().min(1),
			})
			.strict(),
		status: z.literal('created'),
	})
	.strict();

export type CreateJpdInsightResultType = z.infer<typeof CreateJpdInsightResult>;
