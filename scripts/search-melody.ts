// One-off research: confirm the chorus hook note sequence (scientific pitch)
// for the WebAudio synth in the UX overlay reference clip.
import ZAI from 'z-ai-web-dev-sdk';

async function main() {
  const zai = await ZAI.create();
  const queries = [
    'Never Gonna Give You Up chorus melody notes letters "never gonna give you up" E E F E A B flat piano letters',
    'rickroll melody beep code notes sequence github "never gonna give you up" pitch',
  ];
  for (const q of queries) {
    try {
      const result = await zai.functions.invoke('web_search', { query: q, num: 6 });
      console.log('=== QUERY:', q);
      for (const item of result ?? []) {
        console.log('---', item.name, '|', item.url);
        console.log((item.snippet ?? '').slice(0, 500));
      }
    } catch (error) {
      console.error('search failed for', q, error instanceof Error ? error.message : error);
    }
  }
}

void main();
