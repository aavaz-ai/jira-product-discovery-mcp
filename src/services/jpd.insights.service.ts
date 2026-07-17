import { z } from 'zod';
import {
	CreateJpdInsightArgs,
	type CreateJpdInsightArgsType,
	CreateJpdInsightResult,
	type CreateJpdInsightResultType,
	ListJpdInsightsArgs,
	type ListJpdInsightsArgsType,
	ListJpdInsightsResult,
	type ListJpdInsightsResultType,
} from '../tools/jpd.insights.types.js';
import { createApiError } from '../utils/error.util.js';
import {
	fetchAtlassianJson,
	jiraApiUrl,
	requireOAuthBearer,
	resolveAtlassianSite,
	type AtlassianSite,
} from './atlassian.oauth.service.js';
import {
	createPolarisInsight,
	listPolarisInsights,
	QuoteSnippetDataSchema,
	type CreatePolarisInsightInput,
	type JsonValue,
	type PolarisInsight,
} from './vendor.polaris.service.js';

const JiraIdeaSchema = z.object({
	id: z.string().min(1),
	key: z.string().min(1),
	fields: z.object({
		project: z.object({
			id: z.string().min(1),
		}),
	}),
});

interface ResolvedIdea {
	key: string;
	issueId: string;
	projectId: string;
}

interface JpdContext {
	bearer: string;
	site: AtlassianSite;
	idea: ResolvedIdea;
}

async function resolveIdea(
	bearer: string,
	cloudId: string,
	ideaKey: string,
): Promise<ResolvedIdea> {
	const path = `/rest/api/3/issue/${encodeURIComponent(ideaKey)}?fields=project`;
	const payload = await fetchAtlassianJson(
		jiraApiUrl(cloudId, path),
		bearer,
		'resolving the Jira idea',
	);

	const parsed = JiraIdeaSchema.safeParse(payload);
	if (!parsed.success) {
		throw createApiError(
			'Jira idea response did not contain the expected issue and project identifiers.',
			502,
		);
	}

	return {
		key: parsed.data.key,
		issueId: parsed.data.id,
		projectId: parsed.data.fields.project.id,
	};
}

async function resolveJpdContext(
	bearer: string,
	ideaKey: string,
): Promise<JpdContext> {
	const site = await resolveAtlassianSite(bearer);
	const idea = await resolveIdea(bearer, site.id, ideaKey);
	return { bearer, site, idea };
}

async function listForContext(context: JpdContext): Promise<PolarisInsight[]> {
	return listPolarisInsights(context.bearer, {
		project: `ari:cloud:jira:${context.site.id}:project/${context.idea.projectId}`,
		container: `ari:cloud:jira:${context.site.id}:issue/${context.idea.issueId}`,
	});
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectAdfText(value: JsonValue): string[] {
	if (Array.isArray(value)) return value.flatMap(collectAdfText);
	if (!isJsonObject(value)) return [];
	if (value.type === 'text' && typeof value.text === 'string') {
		return [value.text];
	}
	return Object.values(value).flatMap(collectAdfText);
}

function descriptionText(description: JsonValue | null): string | null {
	if (description === null || typeof description === 'string')
		return description;
	if (
		!isJsonObject(description) ||
		description.type !== 'doc' ||
		description.version !== 1 ||
		!Array.isArray(description.content)
	) {
		throw createApiError(
			'Atlassian Polaris returned an unsupported Insight description shape.',
			502,
		);
	}
	return collectAdfText(description.content).join('');
}

function normalizeSnippetData(data: JsonValue | null) {
	if (data === null) {
		return null;
	}
	if (isJsonObject(data) && Object.keys(data).length === 0) {
		return null;
	}
	if (!isJsonObject(data) || typeof data.type !== 'string') {
		throw createApiError(
			'Atlassian Polaris returned malformed snippet data.',
			502,
		);
	}

	if (data.type === 'quotes') {
		const quotes = QuoteSnippetDataSchema.safeParse(data);
		if (!quotes.success) {
			throw createApiError(
				'Atlassian Polaris returned a quote snippet that did not match the expected schema.',
				502,
			);
		}
		return {
			type: quotes.data.type,
			groupName: quotes.data.group.name,
			context: {
				iconUrl: quotes.data.context.icon,
				sourceUrl: quotes.data.context.url,
				title: quotes.data.context.title,
			},
			quotes: quotes.data.content.map((item) => item.quote),
		};
	}

	throw createApiError(
		`Atlassian Polaris returned unsupported snippet type: ${data.type}.`,
		502,
	);
}

function normalizeInsights(insights: PolarisInsight[]) {
	return insights.map((insight) => ({
		id: insight.id,
		description: descriptionText(insight.description),
		snippets: insight.snippets.map((snippet) => ({
			id: snippet.id,
			sourceUrl: snippet.url || null,
			data: normalizeSnippetData(snippet.data),
		})),
	}));
}

function siteIdentity(site: AtlassianSite) {
	return { cloudId: site.id, name: site.name, url: site.url };
}

function createInput(
	args: CreateJpdInsightArgsType,
	context: JpdContext,
): CreatePolarisInsightInput {
	return {
		cloudID: context.site.id,
		projectID: context.idea.projectId,
		issueID: context.idea.issueId,
		description: {
			version: 1,
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [{ type: 'text', text: args.description }],
				},
				{
					type: 'blockquote',
					content: [
						{
							type: 'paragraph',
							content: [{ type: 'text', text: args.quote }],
						},
					],
				},
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'Source: ' },
						{
							type: 'text',
							text: args.sourceTitle,
							marks: [
								{
									type: 'link',
									attrs: { href: args.sourceUrl },
								},
							],
						},
					],
				},
			],
		},
		data: [],
		snippets: [],
	};
}

export async function listJpdInsights(
	input: ListJpdInsightsArgsType,
): Promise<ListJpdInsightsResultType> {
	const args = ListJpdInsightsArgs.parse(input);
	const context = await resolveJpdContext(requireOAuthBearer(), args.ideaKey);
	const insights = await listForContext(context);

	return ListJpdInsightsResult.parse({
		site: siteIdentity(context.site),
		idea: context.idea,
		insights: normalizeInsights(insights),
	});
}

export async function createJpdInsight(
	input: CreateJpdInsightArgsType,
): Promise<CreateJpdInsightResultType> {
	const args = CreateJpdInsightArgs.parse(input);
	const bearer = requireOAuthBearer();
	const context = await resolveJpdContext(bearer, args.ideaKey);
	const insightId = await createPolarisInsight(context.bearer, {
		input: createInput(args, context),
	});

	return CreateJpdInsightResult.parse({
		site: siteIdentity(context.site),
		idea: context.idea,
		insight: { id: insightId },
		status: 'created',
	});
}
