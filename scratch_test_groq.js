const { Groq } = require('groq-sdk');

const apiKey = process.env.GROQ_API_KEY;
const groq = new Groq({ apiKey });

async function testGroq() {
  try {
    console.log('Testing Groq call...');
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: 'Say hello' }],
      model: 'llama-3.3-70b-versatile',
    });
    console.log('Response:', chatCompletion.choices[0].message.content);
  } catch (err) {
    console.error('Groq Error:', err);
  }
}

testGroq();
