require('dotenv').config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function analyzeImages({ images, systemPrompt, jsonMode = false }) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');

  const parts = [{ text: systemPrompt }];
  
  images.forEach((dataUrl) => {
    const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) throw new Error('Invalid data URL format');
    parts.push({
      inline_data: { mime_type: match[1], data: match[2] }
    });
  });

    const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048, // <--- INCREASE THIS FROM 700
      responseMimeType: jsonMode ? "application/json" : "text/plain"
    }
  };

  // Using gemini-flash-latest which is available on your account
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();
  if (!response.ok) {
    console.error("Gemini Error Details:", data);
    throw new Error(data.error?.message || 'Gemini Vision failed');
  }

  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

module.exports = { analyzeImages };