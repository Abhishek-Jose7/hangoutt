import { ApiResponse } from '../utils/apiResponse';

export type ActionResponse<T> = Promise<ApiResponse<T>>;
