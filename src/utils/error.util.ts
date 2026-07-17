export enum ErrorType {
	AUTH_MISSING = 'AUTH_MISSING',
	AUTH_INVALID = 'AUTH_INVALID',
	API_ERROR = 'API_ERROR',
	UNEXPECTED_ERROR = 'UNEXPECTED_ERROR',
}

export class McpError extends Error {
	constructor(
		message: string,
		public readonly type: ErrorType,
		public readonly statusCode?: number,
	) {
		super(message);
		this.name = 'McpError';
	}
}

export function createAuthMissingError(
	message = 'ATLASSIAN_OAUTH_BEARER is required.',
): McpError {
	return new McpError(message, ErrorType.AUTH_MISSING);
}

export function createAuthInvalidError(message: string): McpError {
	return new McpError(message, ErrorType.AUTH_INVALID, 401);
}

export function createApiError(message: string, statusCode?: number): McpError {
	return new McpError(message, ErrorType.API_ERROR, statusCode);
}

export function createUnexpectedError(message: string): McpError {
	return new McpError(message, ErrorType.UNEXPECTED_ERROR);
}

export function formatErrorForMcpTool(error: unknown): {
	content: Array<{ type: 'text'; text: string }>;
	metadata: { errorType: ErrorType; statusCode?: number };
} {
	const safeError =
		error instanceof McpError
			? error
			: new McpError(
					'An unexpected error occurred.',
					ErrorType.UNEXPECTED_ERROR,
				);

	return {
		content: [{ type: 'text', text: `Error: ${safeError.message}` }],
		metadata: {
			errorType: safeError.type,
			...(safeError.statusCode === undefined
				? {}
				: { statusCode: safeError.statusCode }),
		},
	};
}
