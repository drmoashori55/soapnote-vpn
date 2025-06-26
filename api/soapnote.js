// api/soapnote.js

import pkg from 'formidable';
const { IncomingForm } = pkg;
import fs from 'fs';
import fetch from 'node-fetch';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }
  try {
    // 1) parse the multipart form to get the uploaded file
    const form = new IncomingForm();
    const { files } = await new Promise((resolve, reject) =>
      form.parse(req, (err, fields, files) =>
        err ? reject(err) : resolve({ fields, files })
      )
    );

    if (!files.file) {
      throw new Error('No file field in upload');
    }

    const filePath = files.file.filepath;
    const fileStream = fs.createReadStream(filePath);

    // 2) Whisper transcription
    const whisperForm = new FormData();
    whisperForm.append('file', fileStream);
    whisperForm.append('model', 'whisper-1');

    const whisperRes = await fetch(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: whisperForm,
      }
    );
    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      throw new Error(`Whisper error: ${errText}`);
    }
    const { text: transcript } = await whisperRes.json();

    // 3) Build your prompt
    const prompt = `
You are a board-certified family medicine physician.
Convert this transcript into a properly formatted SOAP note with:
- Subjective  
- Objective  
- Assessment  
- Plan  

Also list tests, medications, referrals.
Then provide a brief clinical analysis, a broad differential diagnosis, and next steps.

${transcript}
`.trim();

    // 4) GPT-4 completion
    const chatRes = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
        }),
      }
    );
    if (!chatRes.ok) {
      const errText = await chatRes.text();
      throw new Error(`Chat error: ${errText}`);
    }
    const { choices } = await chatRes.json();
    return res.status(200).send(choices[0].message.content);

  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .send(`Error in /api/soapnote: ${err.message}`);
  }
}
