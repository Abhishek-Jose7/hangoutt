export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'No valid session. Please authenticate.') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Authenticated but lacks permission for this action.') {
    super(message, 'FORBIDDEN', 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'The requested resource does not exist.') {
    super(message, 'NOT_FOUND', 404);
  }
}

export class ValidationError extends AppError {
  public readonly fields?: any;

  constructor(message = 'Validation failed.', fields?: any) {
    super(message, 'VALIDATION_ERROR', 422);
    this.fields = fields;
  }
}

export class DuplicateError extends AppError {
  constructor(message = 'Resource already exists.') {
    super(message, 'DUPLICATE', 409);
  }
}

export class InviteExpiredError extends AppError {
  constructor(message = 'Invite link has expired.') {
    super(message, 'INVITE_EXPIRED', 410);
  }
}

export class InsufficientLocationsError extends AppError {
  constructor(message = 'At least two member locations are required to compute a midpoint.') {
    super(message, 'INSUFFICIENT_LOCATIONS', 400);
  }
}

export class VoteClosedError extends AppError {
  constructor(message = 'Voting has been closed for this session.') {
    super(message, 'VOTE_CLOSED', 400);
  }
}

export class MapsApiError extends AppError {
  constructor(message = 'Ola Maps service failure.') {
    super(message, 'MAPS_API_ERROR', 502);
  }
}

export class GroqTimeoutError extends AppError {
  constructor(message = 'Itinerary generation timed out.') {
    super(message, 'GROQ_TIMEOUT', 504);
  }
}

export class GroqParseError extends AppError {
  constructor(message = 'Itinerary generation returned malformed content.') {
    super(message, 'GROQ_PARSE_ERROR', 502);
  }
}

export class GroqInvalidSchemaError extends AppError {
  constructor(message = 'Generated itinerary did not match required format.') {
    super(message, 'GROQ_INVALID_SCHEMA', 502);
  }
}

export class GroqRateLimitedError extends AppError {
  constructor(message = 'Itinerary generator is busy, rate limits exceeded.') {
    super(message, 'GROQ_RATE_LIMITED', 429);
  }
}

export class GroqUnavailableError extends AppError {
  constructor(message = 'Itinerary engine service is unavailable.') {
    super(message, 'GROQ_UNAVAILABLE', 502);
  }
}

export class GroqMisconfiguredError extends AppError {
  constructor(message = 'Itinerary engine is misconfigured.') {
    super(message, 'GROQ_MISCONFIGURED', 500);
  }
}

export class InternalServerError extends AppError {
  constructor(message = 'An unexpected server error occurred.') {
    super(message, 'INTERNAL_ERROR', 500);
  }
}
