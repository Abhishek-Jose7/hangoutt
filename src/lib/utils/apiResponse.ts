import { NextResponse } from 'next/server';
import { AppError } from '../errors';

export interface SuccessResponse<T> {
  success: true;
  data: T;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    fields?: any;
  };
}

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

export const apiResponse = {
  // Direct helpers for Server Actions
  success<T>(data: T): SuccessResponse<T> {
    return {
      success: true,
      data,
    };
  },

  error(err: unknown): ErrorResponse {
    if (err instanceof AppError) {
      return {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          ...( (err as any).fields ? { fields: (err as any).fields } : {} ),
        },
      };
    }

    const message = err instanceof Error ? err.message : 'An unexpected server error occurred.';
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message,
      },
    };
  },

  // HTTP Route Handler Response wrappers
  toNextSuccess<T>(data: T, status = 200): NextResponse<SuccessResponse<T>> {
    return NextResponse.json(this.success(data), { status });
  },

  toNextError(err: unknown): NextResponse<ErrorResponse> {
    const formatted = this.error(err);
    let status = 500;
    
    if (err instanceof AppError) {
      status = err.statusCode;
    }

    return NextResponse.json(formatted, { status });
  },
};
