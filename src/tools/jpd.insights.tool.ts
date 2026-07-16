import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
	createJpdInsight,
	listJpdInsights,
} from '../services/jpd.insights.service.js';
import { formatErrorForMcpTool } from '../utils/error.util.js';
import {
	CreateJpdInsightArgs,
	type CreateJpdInsightArgsType,
	CreateJpdInsightResult,
	ListJpdInsightsArgs,
	type ListJpdInsightsArgsType,
	ListJpdInsightsResult,
} from './jpd.insights.types.js';

const LIST_DESCRIPTION = `List native Jira Product Discovery Insights for an idea key.

The server resolves the Jira site, project, issue IDs, and Polaris ARIs. It returns a normalized response and never exposes raw GraphQL or provider envelopes.`;

const CREATE_DESCRIPTION = `Create a native Jira Product Discovery Insight with supporting evidence in its description.

The server builds a fixed ADF description containing the summary, customer quote, and linked source. Creation uses the existing Jira OAuth bearer and does not create a structured snippet.`;

async function toolResult<T>(operation: () => Promise<T>) {
	try {
		const result = await operation();
		return {
			content: [{ type: 'text' as const, text: JSON.stringify(result) }],
			structuredContent: result,
		};
	} catch (error) {
		return { ...formatErrorForMcpTool(error), isError: true as const };
	}
}

function handleListJpdInsights(args: ListJpdInsightsArgsType) {
	return toolResult(() => listJpdInsights(args));
}

function handleCreateJpdInsight(args: CreateJpdInsightArgsType) {
	return toolResult(() => createJpdInsight(args));
}

function registerTools(server: McpServer): void {
	server.registerTool(
		'jira_list_jpd_insights',
		{
			title: 'List Jira Product Discovery Insights',
			description: LIST_DESCRIPTION,
			inputSchema: ListJpdInsightsArgs,
			outputSchema: ListJpdInsightsResult,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		handleListJpdInsights,
	);

	server.registerTool(
		'jira_create_jpd_insight',
		{
			title: 'Create Jira Product Discovery Insight',
			description: CREATE_DESCRIPTION,
			inputSchema: CreateJpdInsightArgs,
			outputSchema: CreateJpdInsightResult,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		handleCreateJpdInsight,
	);
}

export default { registerTools };
