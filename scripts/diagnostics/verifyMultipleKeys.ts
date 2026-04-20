
import { GoogleProvider } from '../src/lib/providers/concrete/google.js';
import { OpenAIProvider } from '../src/lib/providers/concrete/openai.js';
import { env } from '../src/config/env.js';
import logger from '../src/lib/logger.js';

async function verifyGoogle() {
  console.log('\n--- Verifying Google (Gemini) ---');
  if (!env.GOOGLE_API_KEY) {
    console.log('❌ GOOGLE_API_KEY is not set');
    return;
  }
  const provider = new GoogleProvider({
    apiKey: env.GOOGLE_API_KEY,
    model: 'gemini-2.0-flash',
    name: 'Gemini Test'
  });
  try {
    const res = await provider.call({ messages: [{ role: 'user', content: 'Hello' }] });
    console.log('✅ Google API is working!');
    console.log('Response:', res.content.slice(0, 50), '...');
  } catch (err: any) {
    console.log('❌ Google API failed:', err.message);
  }
}

async function verifyOpenAI() {
  console.log('\n--- Verifying OpenAI ---');
  if (!env.OPENAI_API_KEY) {
    console.log('❌ OPENAI_API_KEY is not set');
    return;
  }
  const provider = new OpenAIProvider({
    apiKey: env.OPENAI_API_KEY,
    model: 'gpt-4o',
    name: 'OpenAI Test'
  });
  try {
    const res = await provider.call({ messages: [{ role: 'user', content: 'Hello' }] });
    console.log('✅ OpenAI API is working!');
    console.log('Response:', res.content.slice(0, 50), '...');
  } catch (err: any) {
    console.log('❌ OpenAI API failed:', err.message);
  }
}

async function verifyGroq() {
  console.log('\n--- Verifying Groq ---');
  if (!env.GROQ_API_KEY) {
    console.log('❌ GROQ_API_KEY is not set');
    return;
  }
  const provider = new OpenAIProvider({
    type: 'api',
    apiKey: env.GROQ_API_KEY,
    model: 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1',
    name: 'Groq Test'
  });
  try {
    const res = await provider.call({ messages: [{ role: 'user', content: 'Hello' }] });
    console.log('✅ Groq API is working!');
    console.log('Response:', res.text.slice(0, 50), '...');
  } catch (err: any) {
    console.log('❌ Groq API failed:', err.message);
  }
}

async function verifyMistral() {
  console.log('\n--- Verifying Mistral ---');
  if (!env.MISTRAL_API_KEY) {
    console.log('❌ MISTRAL_API_KEY is not set');
    return;
  }
  const provider = new OpenAIProvider({
    type: 'api',
    apiKey: env.MISTRAL_API_KEY,
    model: 'mistral-large-latest',
    baseUrl: 'https://api.mistral.ai/v1',
    name: 'Mistral Test'
  });
  try {
    const res = await provider.call({ messages: [{ role: 'user', content: 'Hello' }] });
    console.log('✅ Mistral API is working!');
    console.log('Response:', res.text.slice(0, 50), '...');
  } catch (err: any) {
    console.log('❌ Mistral API failed:', err.message);
  }
}

async function verifyAll() {
  console.log('Starting API Key Verification...');
  await verifyGoogle();
  await verifyOpenAI();
  await verifyGroq();
  await verifyMistral();
  console.log('\nVerification Complete.');
}

verifyAll();
