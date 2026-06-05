/**
 * Privacy-Aware Logging Utility
 * Ensures that sensitive metrics like API keys, tokens, coordinates (lat/lng),
 * individual budgets, and individual vote choices are never printed to stdout.
 */

type LogLevel = 'info' | 'warn' | 'error';

interface LogPayload {
  event: string;
  level: LogLevel;
  timestamp: string;
  meta?: Record<string, any>;
}

// Recursively sanitize metadata to remove private variables
function sanitizeMeta(obj: any): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeMeta);
  }

  const sanitized: Record<string, any> = {};
  const sensitiveKeys = [
    'password', 'token', 'key', 'apiKey', 'secret',
    'lat', 'lng', 'latitude', 'longitude', 'coordinates',
    'budget', 'maxBudget', 'amount', 'planId', 'voteChoice', 'prompt'
  ];

  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = sensitiveKeys.some(s => key.toLowerCase().includes(s));
    
    if (isSensitive) {
      sanitized[key] = '[REDACTED_SENSITIVE_DATA]';
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeMeta(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

function writeLog(level: LogLevel, event: string, meta?: Record<string, any>) {
  const payload: LogPayload = {
    event,
    level,
    timestamp: new Date().toISOString(),
    meta: meta ? sanitizeMeta(meta) : undefined,
  };

  const output = JSON.stringify(payload);
  
  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  info(event: string, meta?: Record<string, any>) {
    writeLog('info', event, meta);
  },
  
  warn(event: string, meta?: Record<string, any>) {
    writeLog('warn', event, meta);
  },
  
  error(event: string, err: any, meta?: Record<string, any>) {
    const errorMeta = {
      ...meta,
      message: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : undefined,
      stack: process.env.NODE_ENV !== 'production' && err instanceof Error ? err.stack : undefined,
    };
    writeLog('error', event, errorMeta);
  },

  apiCall(endpoint: string, latencyMs: number, statusCode: number) {
    writeLog('info', `Ola Maps API Call: ${endpoint}`, {
      latencyMs,
      statusCode,
    });
  },
};
