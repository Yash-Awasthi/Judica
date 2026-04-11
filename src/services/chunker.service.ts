export function chunkText(text: string, chunkSize: number = 512, overlap: number = 64): string[] {
  if (!text || text.trim().length === 0) return [];

  // Split by paragraphs first
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const chunks: string[] = [];

  let buffer = "";

  for (const para of paragraphs) {
    if (buffer.length + para.length + 1 <= chunkSize) {
      buffer += (buffer ? "\n\n" : "") + para;
    } else {
      if (buffer) chunks.push(buffer.trim());

      if (para.length <= chunkSize) {
        buffer = para;
      } else {
        // Split long paragraph by sentences
        const sentences = para.match(/[^.!?]+[.!?]+\s*/g) || [para];
        buffer = "";

        for (const sentence of sentences) {
          if (buffer.length + sentence.length <= chunkSize) {
            buffer += sentence;
          } else {
            if (buffer) chunks.push(buffer.trim());

            if (sentence.length > chunkSize) {
              // Hard split with overlap
              for (let i = 0; i < sentence.length; i += chunkSize - overlap) {
                chunks.push(sentence.slice(i, i + chunkSize).trim());
              }
              buffer = "";
            } else {
              buffer = sentence;
            }
          }
        }
      }
    }
  }

  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}
