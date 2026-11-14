export class AppError extends Error {
  constructor(
    public code: string,
    public status: 400 | 401 | 402 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
