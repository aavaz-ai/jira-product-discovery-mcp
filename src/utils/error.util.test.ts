import {
	ErrorType,
	McpError,
	createApiError,
	formatErrorForMcpTool,
} from './error.util.js';

describe('error utility', () => {
	it('formats known errors without provider or credential details', () => {
		const error = createApiError('Atlassian request failed.', 502);
		expect(formatErrorForMcpTool(error)).toEqual({
			content: [
				{ type: 'text', text: 'Error: Atlassian request failed.' },
			],
			metadata: { errorType: ErrorType.API_ERROR, statusCode: 502 },
		});
	});

	it('redacts unexpected error messages', () => {
		const secret = 'private-bearer-value';
		const result = formatErrorForMcpTool(new Error(secret));
		expect(JSON.stringify(result)).not.toContain(secret);
		expect(result.metadata.errorType).toBe(ErrorType.UNEXPECTED_ERROR);
	});

	it('preserves typed MCP error identity', () => {
		const error = new McpError(
			'Expected failure',
			ErrorType.AUTH_INVALID,
			401,
		);
		expect(error.name).toBe('McpError');
		expect(error.statusCode).toBe(401);
	});
});
