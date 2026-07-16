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
import { config } from '../utils/config.util.js';
import {
	createApiError,
	createAuthInvalidError,
	createAuthMissingError,
} from '../utils/error.util.js';
import { getAtlassianCredentials } from '../utils/transport.util.js';
import {
	createPolarisInsight,
	listPolarisInsights,
	QuoteSnippetDataSchema,
	type CreatePolarisInsightInput,
	type JsonValue,
	type PolarisInsight,
} from './vendor.polaris.service.js';

const ACCESSIBLE_RESOURCES_URL =
	'https://api.atlassian.com/oauth/token/accessible-resources';

const AccessibleResourcesSchema = z.array(
	z.object({
		id: z.string().min(1),
		name: z.string().min(1),
		url: z.url(),
	}),
);

type AccessibleResource = z.infer<typeof AccessibleResourcesSchema>[number];

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
	site: AccessibleResource;
	idea: ResolvedIdea;
}

function requireJpdBearer(): string {
	const credentials = getAtlassianCredentials();
	if (!credentials?.oauthBearer) {
		throw createAuthMissingError(
			'Jira Product Discovery Insights require ATLASSIAN_OAUTH_BEARER from the existing Jira 3LO connection; API-token authentication is unsupported.',
		);
	}
	return credentials.oauthBearer;
}

async function fetchJpdJson(
	url: string,
	bearer: string,
	operation: string,
): Promise<unknown> {
	let response: Response;
	try {
		response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${bearer}`,
				Accept: 'application/json',
			},
		});
	} catch {
		throw createApiError(`Network error while ${operation}.`, 502);
	}

	if (!response.ok) {
		if (response.status === 401) {
			throw createAuthInvalidError(
				`Atlassian rejected the Jira OAuth bearer while ${operation}.`,
			);
		}
		throw createApiError(
			`Atlassian request failed while ${operation} (HTTP ${response.status}).`,
			response.status,
		);
	}

	try {
		return await response.json();
	} catch {
		throw createApiError(
			`Atlassian returned malformed JSON while ${operation}.`,
			502,
		);
	}
}

async function resolveIdea(
	bearer: string,
	cloudId: string,
	ideaKey: string,
): Promise<ResolvedIdea> {
	const path = `/rest/api/3/issue/${encodeURIComponent(ideaKey)}?fields=project`;
	const payload = await fetchJpdJson(
		`https://api.atlassian.com/ex/jira/${encodeURIComponent(cloudId)}${path}`,
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

async function resolveJpdSite(bearer: string): Promise<AccessibleResource> {
	const payload = await fetchJpdJson(
		ACCESSIBLE_RESOURCES_URL,
		bearer,
		'resolving accessible Atlassian sites',
	);

	const parsed = AccessibleResourcesSchema.safeParse(payload);
	if (!parsed.success) {
		throw createApiError(
			'Atlassian accessible-resources response did not match the expected schema.',
			502,
		);
	}

	const configuredCloudId = config.get('ATLASSIAN_CLOUD_ID')?.trim();
	if (configuredCloudId) {
		const configuredSite = parsed.data.find(
			(site) => site.id === configuredCloudId,
		);
		if (!configuredSite) {
			throw createAuthInvalidError(
				'ATLASSIAN_CLOUD_ID does not match a site accessible to the OAuth token.',
			);
		}
		return configuredSite;
	}

	if (parsed.data.length === 0) {
		throw createAuthInvalidError(
			'OAuth token has no accessible Atlassian sites. Re-authorize the Jira connection.',
		);
	}
	if (parsed.data.length > 1) {
		throw createApiError(
			'Multiple Atlassian sites are accessible. Set ATLASSIAN_CLOUD_ID.',
			400,
		);
	}

	return parsed.data[0];
}

async function resolveJpdContext(
	bearer: string,
	ideaKey: string,
): Promise<JpdContext> {
	const site = await resolveJpdSite(bearer);
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

function siteIdentity(site: AccessibleResource) {
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
	const context = await resolveJpdContext(requireJpdBearer(), args.ideaKey);
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
	const bearer = requireJpdBearer();
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
