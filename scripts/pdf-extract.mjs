import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const chunks = []; let size = 0;
for await (const chunk of process.stdin) { size += chunk.length; if (size > 10485760) throw new Error('upload_too_large'); chunks.push(chunk); }
const loading = getDocument({ data: new Uint8Array(Buffer.concat(chunks)), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, disableAutoFetch: true, disableStream: true, useWorkerFetch: false, verbosity: 0 });
const document = await loading.promise;
try {
  if (document.numPages > 100) throw new Error('page_limit');
  let text = '';
  for (let pageNumber = 1; pageNumber <= document.numPages && text.length < 32768; pageNumber++) {
    const page = await document.getPage(pageNumber); const content = await page.getTextContent();
    text += content.items.map(item => 'str' in item ? item.str : '').join(' ') + '\n'; page.cleanup();
  }
  process.stdout.write(JSON.stringify({ text: text.slice(0, 32768), truncated: text.length >= 32768 }));
} finally { await loading.destroy(); }
