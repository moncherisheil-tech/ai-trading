#!/usr/bin/env node
/**
 * Zero-Touch Gemini API verification script.
 * Loads GEMINI_API_KEY from .env, calls gemini-2.5-flash with a simple JSON schema,
 * prints success or the exact error for diagnostics.
 */

const path = require('path');
const fs = require('fs');

// Load .env from project root (same directory as this script)
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('Missing .env file at:', envPath);
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  });
}

loadEnv();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey || apiKey.includes('TODO')) {
  console.error('Invalid or missing GEMINI_API_KEY in .env');
  process.exit(1);
}

const { GoogleGenerativeAI } = require('@google/generative-ai');

function extractJsonFromText(text) {
  const trimmed = (text || '').trim();
  let str = trimmed;
  if (str.startsWith('```')) {
    str = str.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```\s*$/s, '').trim();
  }
  const start = str.indexOf('{');
  const end = str.lastIndexOf('}') + 1;
  if (start >= 0 && end > start) return str.slice(start, end);
  const match = str.match(/\{[\s\S]*\}/);
  return match ? match[0] : str;
}

async function main() {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL_PRIMARY || 'gemini-3-flash-preview',
      systemInstruction: 'Reply with valid JSON only. No markdown, no explanation. Example: { "status": "ok" }',
    });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: 'Respond with a single JSON object containing exactly: { "status": "ok" }' }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 256,
      },
    });
    const text = result.response.text();
    if (text) {
      const jsonStr = extractJsonFromText(text);
      const parsed = JSON.parse(jsonStr);
      console.log('✅ API IS WORKING PERFECTLY!');
      console.log('Response:', parsed);
    } else {
      console.error('❌ Empty response from API');
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Gemini API Error:');
    console.error(err);
    process.exit(1);
  }
}

main();
