import dotenv from 'dotenv';
dotenv.config();
import Groq from 'groq-sdk';

async function test() {
  const apiKey = process.env.GROQ_API_KEY;
  console.log('Testing GROQ_API_KEY:', apiKey ? `${apiKey.substring(0, 8)}...` : 'undefined');
  if (!apiKey) {
    console.error('No GROQ_API_KEY found in process.env');
    return;
  }
  const groq = new Groq({ apiKey });
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: 'Say hello' }],
  });
  console.log('Response:', response.choices[0].message.content);
}
test().catch(console.error);
