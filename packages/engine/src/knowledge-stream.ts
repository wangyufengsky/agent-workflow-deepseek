/** Decode only the completed portion of the JSON answer string. Never expose raw JSON or reasoning. */
export function partialKnowledgeAnswer(text: string): string {
  const match = /"answer"\s*:\s*"/.exec(text);
  if (match === null) return '';
  const start = match.index + match[0].length;
  let end = start;
  while (end < text.length) {
    const char = text[end];
    if (char === '"') break;
    if (char === '\\') {
      if (end + 1 >= text.length) break;
      if (text[end + 1] === 'u') {
        if (!/^[0-9a-fA-F]{4}$/.test(text.slice(end + 2, end + 6))) break;
        end += 6;
      } else end += 2;
    } else end++;
  }
  try { return (JSON.parse('"' + text.slice(start, end) + '"') as string).slice(0, 8000); }
  catch { return ''; }
}
