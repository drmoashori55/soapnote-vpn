a// api/soapnote.js

import pkg from 'formidable';
const { IncomingForm } = pkg;

import fs from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }
  try {
    // 1) parse the upload
    const form = new IncomingForm();
    const { files } = await new Promise((resolve, reject) =>
      form.parse(req, (err, fields, files) =>
        err ? reject(err) : resolve({ fields, files })
      )
    );

    if (!files.file) {
      throw new Error('No file field in upload');
    }

    const { filepath, originalFilename, mimetype } = files.file;
    const fileStream = fs.createReadStream(filepath);

    // 2) Whisper transcription
    const whisperForm = new FormData();
    // name must match OpenAI’s API: “file”
    whisperForm.append('file', fileStream, {
      filename: originalFilename,
      contentType: mimetype
    });
    whisperForm.append('model', 'whisper-1');

    const whisperRes = await fetch(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          // NOTE: do NOT set Content-Type here—form-data will do it for you
        },
        body: whisperForm
      }
    );
    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      throw new Error(`Whisper error: ${errText}`);
    }
    const { text: transcript } = await whisperRes.json();

    // 3) Build your prompt
    const prompt = `You are a board-certified family medicine physician and expert medical scribe.  Take the following patient-doctor transcript and produce a comprehensive clinical note with these sections:

1. SUBJECTIVE
   • Summarize the patient’s chief complaint, history of present illness, any social, family, or surgical history mentioned, and allergies (if stated).

2. OBJECTIVE
   • List any reported vital signs.
   • List lab tests or imaging studies mentioned, with their results.

3. ASSESSMENT
   • In paragraph form, state the most likely diagnosis.
   • Provide a brief differential diagnosis (DDx).
   • Explain how you ruled out any life-threatening alternatives.

4. PLAN
   • Numbered list of next steps (medications prescribed, referrals, further tests, lifestyle advice, supplements, etc.).

5. CURRENT MEDICATIONS & SUPPLEMENTS
   • Bullet list of all active prescription, over-the-counter meds, and supplements the patient is taking.

6. CLINICAL ANALYSIS
   • Review the entire interaction and suggest areas that warranted deeper discussion.
   • Highlight any missed potential serious diagnoses.
   • Advise on any medication/supplement interactions or other recommendations.

7. AFTER VISIT SUMMARY (for the patient)
   • Plain-language recap of what the doctor advised.
   • List of diagnoses considered.
   • Any red-flag symptoms or “when to call the doctor” warnings.

8. RESOURCES
   • For every medication or supplement you recommended, include a URL (drugs.com or reputable supplement sites).
   • For any exercise advice given, include URLs linking to example instructions or demonstrations.

----
Transcript:
${transcript}
`.trim();

    // 4) GPT-4 completion
    const chatRes = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
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
