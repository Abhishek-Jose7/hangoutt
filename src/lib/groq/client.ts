import 'server-only';
import Groq from 'groq-sdk';

const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
  console.warn('Warning: GROQ_API_KEY is missing from environment variables.');
}

export const groqClient = new Groq({
  apiKey: apiKey || 'placeholder_key',
});
export type GroqClient = typeof groqClient;
