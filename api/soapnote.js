// api/soapnote.js
import { IncomingForm } from 'formidable';
import fs from 'fs';
import fetch from 'node-fetch';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }
  try {
    // ----- your existing code here -----
    const form = new IncomingForm();
    const { files } = await new Promise((resolve, reject) =>
      form.parse(req, (err, fields, files) => err ? reject(err) : resolve({ fields, files }))
    );

    const filePath = files.file.filepath;
    const fileStream = fs.createReadStream(filePath);

    // Whisper
    const tResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: (() => {
        const fd = new FormData();
        fd.append('file', fileStream);
        fd.append('model', 'whisper-1');
        return fd;
      })()
    });
    if (!tResp.ok) throw new Error(`Whisper failed: ${await tResp.text()}`);
    const { text: transcript } = await tResp.json();

    // GPT-4
    const prompt = `You are a board certified family medicine physician…
${transcript}`;
    const cResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0
      })
    });
    if (!cResp.ok) throw new Error(`Chat failed: ${await cResp.text()}`);
    const { choices } = await cResp.json();

    return res.status(200).send(choices[0].message.content);

  } catch (err) {
    console.error(err);
    // send the raw error message back so you can see it in the browser
    return res.status(500).send(`Error in /api/soapnote: ${err.message}`);
  }
}
