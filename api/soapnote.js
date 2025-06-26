import { IncomingForm } from 'formidable';
import fs from 'fs';
import fetch from 'node-fetch';

export const config = { api: { bodyParser: false } };

export default async (req, res) => {
  // parse the uploaded file
  const form = new IncomingForm();
  const data = await new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => err ? reject(err) : resolve(files));
  });
  const file = fs.createReadStream(data.file.filepath);

  // 1) Whisper transcription
  let tResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: (() => {
      let f = new FormData();
      f.append('file', file);
      f.append('model', 'whisper-1');
      return f;
    })()
  });
  if (!tResp.ok) return res.status(500).send(await tResp.text());
  let { text: transcript } = await tResp.json();

  // 2) Build the prompt
  let prompt = `
You are a board certified family medicine physician.
Convert this transcript into a properly formatted SOAP note:
Subjective, Objective, Assessment, Plan.
List tests, medications, referrals,
then add a brief clinical analysis,
a broad differential diagnosis, and next steps.

${transcript}
`.trim();

  // 3) GPT-4 completion
  let cResp = await fetch('https://api.openai.com/v1/chat/completions', {
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
  if (!cResp.ok) return res.status(500).send(await cResp.text());
  let { choices } = await cResp.json();

  res.status(200).send(choices[0].message.content);
};
