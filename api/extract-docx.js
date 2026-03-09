const mammoth = require('mammoth');

const ALLOWED_ORIGIN = 'https://verrixai.com';
const MIN_TEXT_LENGTH = 200; // Below this = likely image-heavy doc

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { base64 } = req.body || {};
  if (!base64 || typeof base64 !== 'string') {
    return res.status(400).json({ error: 'No document data provided.' });
  }

  // Reject payloads over 10MB
  if (base64.length > 13_000_000) {
    return res.status(400).json({ error: 'Document too large. Please use a smaller file.' });
  }

  try {
    const buffer = Buffer.from(base64, 'base64');
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value?.trim() || '';

    if (text.length < MIN_TEXT_LENGTH) {
      // Image-heavy or empty document
      return res.status(200).json({
        text: '',
        imageHeavy: true,
        message: 'This document appears to contain mostly images and very little text. For best results, please export it as a PDF — VerrixAI can read images and diagrams inside PDFs.'
      });
    }

    return res.status(200).json({ text, imageHeavy: false });
  } catch (err) {
    console.error('DOCX extraction error:', err);
    return res.status(500).json({ error: 'Could not read this DOCX file. It may be corrupted or password-protected.' });
  }
};
