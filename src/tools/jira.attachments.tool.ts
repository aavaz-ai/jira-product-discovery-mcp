import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { addJiraAttachment } from '../services/jira.attachments.service.js';
import { formatErrorForMcpTool } from '../utils/error.util.js';
import {
	AddJiraAttachmentArgs,
	type AddJiraAttachmentArgsType,
	AddJiraAttachmentResult,
} from './jira.attachments.types.js';

const DESCRIPTION = `Upload one attachment to a Jira issue or Jira Product Discovery idea.

The server converts UTF-8 or base64 content into Jira's required multipart request. Binary files must use encoding=base64. Uploading the same file twice creates two Jira attachments.`;

async function handleAddJiraAttachment(args: AddJiraAttachmentArgsType) {
	try {
		const result = await addJiraAttachment(args);
		return {
			content: [{ type: 'text' as const, text: JSON.stringify(result) }],
			structuredContent: result,
		};
	} catch (error) {
		return { ...formatErrorForMcpTool(error), isError: true as const };
	}
}

function registerTools(server: McpServer): void {
	server.registerTool(
		'jira_add_attachment',
		{
			title: 'Add Jira Attachment',
			description: DESCRIPTION,
			inputSchema: AddJiraAttachmentArgs,
			outputSchema: AddJiraAttachmentResult,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		handleAddJiraAttachment,
	);
}

export default { registerTools };
