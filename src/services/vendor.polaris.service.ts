import { z } from 'zod';
import { createApiError, createAuthInvalidError } from '../utils/error.util.js';

const POLARIS_ENDPOINT = 'https://api-private.atlassian.com/graphql';

export const LIST_JPD_INSIGHTS_DOCUMENT = `query ListInsights($project: ID!, $container: ID) {
  polarisInsights(project: $project, container: $container) {
    id
    description
    snippets { id url data }
  }
}`;

export const CREATE_JPD_INSIGHT_DOCUMENT = `mutation CreateInsight($input: CreatePolarisInsightInput!) {
  createPolarisInsight(input: $input) {
    success
    errors { message }
    node { id }
  }
}`;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
	| JsonPrimitive
	| JsonValue[]
	| { [key: string]: JsonValue };

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(JsonValueSchema),
		z.record(z.string(), JsonValueSchema),
	]),
);

export interface PolarisListVariables {
	project: string;
	container: string;
}

export const QuoteSnippetDataSchema = z
	.object({
		type: z.literal('quotes'),
		group: z
			.object({
				name: z.string().min(1),
				id: z.string().min(1),
			})
			.strict(),
		context: z
			.object({
				icon: z.url(),
				url: z.url(),
				title: z.string().min(1),
			})
			.strict(),
		content: z
			.array(
				z
					.object({
						type: z.literal('quotesItem'),
						quote: z.string().min(1),
					})
					.strict(),
			)
			.min(1),
		// Polaris adds server-owned validation metadata when the snippet is read
		// back. Keep the known container typed without exposing it downstream.
		properties: z.record(z.string(), JsonValueSchema).optional(),
	})
	.strict();

export interface CreatePolarisInsightInput {
	cloudID: string;
	projectID: string;
	issueID: string;
	description: {
		version: 1;
		type: 'doc';
		content: [
			{ type: 'paragraph'; content: [{ type: 'text'; text: string }] },
			{
				type: 'blockquote';
				content: [
					{
						type: 'paragraph';
						content: [{ type: 'text'; text: string }];
					},
				];
			},
			{
				type: 'paragraph';
				content: [
					{ type: 'text'; text: 'Source: ' },
					{
						type: 'text';
						text: string;
						marks: [{ type: 'link'; attrs: { href: string } }];
					},
				];
			},
		];
	};
	data: [];
	snippets: [];
}

export interface PolarisCreateVariables {
	input: CreatePolarisInsightInput;
}

const PolarisSnippetSchema = z
	.object({
		id: z.string().min(1),
		// Existing JPD Insights can contain an empty legacy URL. The normalized
		// tool response converts that exact legacy value to null.
		url: z.union([z.url(), z.literal('')]).nullable(),
		data: JsonValueSchema.nullable(),
	})
	.strict();

const PolarisInsightSchema = z
	.object({
		id: z.string().min(1),
		description: JsonValueSchema.nullable(),
		snippets: z.array(PolarisSnippetSchema),
	})
	.strict();

const ListResponseDataSchema = z
	.object({
		// Live Polaris returns null without GraphQL errors for a new Idea before
		// its first Insight; normalize that provider empty state to an empty list.
		polarisInsights: z.array(PolarisInsightSchema).nullable(),
	})
	.strict();

export type PolarisInsight = z.infer<typeof PolarisInsightSchema>;

const ProviderErrorSchema = z
	.object({
		message: z.string(),
	})
	.strict();

const CreateResponseDataSchema = z
	.object({
		createPolarisInsight: z
			.object({
				success: z.boolean(),
				errors: z.array(ProviderErrorSchema).nullable(),
				node: z
					.object({ id: z.string().min(1) })
					.strict()
					.nullable(),
			})
			.strict(),
	})
	.strict();

const GraphqlEnvelopeSchema = z
	.object({
		data: z.unknown().optional(),
		errors: z.array(z.unknown()).optional(),
	})
	.strict();

function formatSchemaIssues(error: z.ZodError): string {
	return error.issues
		.slice(0, 5)
		.map((issue) => {
			const path =
				issue.path.length > 0 ? issue.path.join('.') : '<root>';
			return `${path}: ${issue.message}`;
		})
		.join('; ');
}

async function fetchPolarisEnvelope(
	bearer: string,
	operationName: string,
	document: string,
	variables: unknown,
): Promise<unknown> {
	let response: Response;

	try {
		response = await fetch(POLARIS_ENDPOINT, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${bearer}`,
				'Content-Type': 'application/json',
				'X-ExperimentalApi': 'polaris-v0',
			},
			body: JSON.stringify({ operationName, query: document, variables }),
		});
	} catch {
		throw createApiError(
			'Network error while calling the Atlassian Polaris API.',
			502,
		);
	}

	if (!response.ok) {
		if (response.status === 401) {
			throw createAuthInvalidError(
				'Atlassian Polaris rejected the Jira OAuth bearer (HTTP 401).',
			);
		}
		if (response.status === 403) {
			throw createApiError(
				'Atlassian Polaris denied access to JPD Insights (HTTP 403).',
				403,
			);
		}
		throw createApiError(
			`Atlassian Polaris request failed (HTTP ${response.status}).`,
			response.status,
		);
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw createApiError('Atlassian Polaris returned malformed JSON.', 502);
	}

	const envelope = GraphqlEnvelopeSchema.safeParse(payload);
	if (!envelope.success) {
		throw createApiError(
			'Atlassian Polaris response did not match the expected GraphQL envelope.',
			502,
		);
	}
	if (envelope.data.errors && envelope.data.errors.length > 0) {
		throw createApiError(
			'Atlassian Polaris returned one or more GraphQL errors.',
			502,
		);
	}
	if (envelope.data.data === undefined || envelope.data.data === null) {
		throw createApiError(
			'Atlassian Polaris response was missing GraphQL data.',
			502,
		);
	}

	return envelope.data.data;
}

function parseResponse<T>(
	schema: z.ZodType<T>,
	data: unknown,
	operation: 'list' | 'create',
): T {
	const parsed = schema.safeParse(data);
	if (!parsed.success) {
		throw createApiError(
			`Atlassian Polaris ${operation} response did not match the expected schema: ${formatSchemaIssues(parsed.error)}`,
			502,
		);
	}
	return parsed.data;
}

export async function listPolarisInsights(
	bearer: string,
	variables: PolarisListVariables,
): Promise<PolarisInsight[]> {
	const data = await fetchPolarisEnvelope(
		bearer,
		'ListInsights',
		LIST_JPD_INSIGHTS_DOCUMENT,
		variables,
	);
	return (
		parseResponse(ListResponseDataSchema, data, 'list').polarisInsights ??
		[]
	);
}

export async function createPolarisInsight(
	bearer: string,
	variables: PolarisCreateVariables,
): Promise<string> {
	const data = await fetchPolarisEnvelope(
		bearer,
		'CreateInsight',
		CREATE_JPD_INSIGHT_DOCUMENT,
		variables,
	);
	const createResult = parseResponse(
		CreateResponseDataSchema,
		data,
		'create',
	).createPolarisInsight;
	if ((createResult.errors ?? []).length > 0) {
		throw createApiError(
			'Atlassian Polaris rejected the Insight with provider errors.',
			502,
		);
	}
	if (createResult.success !== true) {
		throw createApiError(
			'Atlassian Polaris reported that Insight creation was unsuccessful.',
			502,
		);
	}
	if (!createResult.node?.id) {
		throw createApiError(
			'Atlassian Polaris create response was missing the created Insight ID.',
			502,
		);
	}

	return createResult.node.id;
}
