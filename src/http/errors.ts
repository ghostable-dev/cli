export class HttpError extends Error {
	constructor(
		public readonly status: number,
		public readonly body: string,
		message?: string,
	) {
		super(message ?? `HTTP ${status}`);
	}
}
