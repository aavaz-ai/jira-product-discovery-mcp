import { z } from 'zod';
import {
	createApiError,
	createAuthInvalidError,
	createAuthMissingError,
} from '../utils/error.util.js';

const ACCESSIBLE_RESOURCES_URL =
	'https://api.atlassian.com/oauth/token/accessible-resources';

const AccessibleResourcesSchema = z.array(
	z.object({
		id: z.string().min(1),
		name: z.string().min(1),
		url: z.url(),
	}),
);

export type AtlassianSite = z.infer<typeof AccessibleResourcesSchema>[number];

export function requireOAuthBearer(): string {
	const bearer = process.env.ATLASSIAN_OAUTH_BEARER?.trim();
	if (!bearer) {
		throw createAuthMissingError(
			'Jira Product Discovery requires ATLASSIAN_OAUTH_BEARER from a Jira 3LO connection.',
		);
	}
	return bearer;
}

export async function fetchAtlassianJson(
	url: string,
	bearer: string,
	operation: string,
	init: RequestInit = {},
): Promise<unknown> {
	let response: Response;
	try {
		response = await fetch(url, {
			...init,
			headers: {
				Authorization: `Bearer ${bearer}`,
				Accept: 'application/json',
				...init.headers,
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
		if (response.status === 403) {
			throw createApiError(
				`Atlassian denied permission while ${operation} (HTTP 403).`,
				403,
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

export async function resolveAtlassianSite(
	bearer: string,
): Promise<AtlassianSite> {
	const payload = await fetchAtlassianJson(
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

	const configuredCloudId = process.env.ATLASSIAN_CLOUD_ID?.trim();
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

export function jiraApiUrl(cloudId: string, path: string): string {
	return `https://api.atlassian.com/ex/jira/${encodeURIComponent(cloudId)}${path}`;
}
