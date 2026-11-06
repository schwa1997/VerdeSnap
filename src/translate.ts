// Translates text read from a snap with my local AI: the same model, prompt and reply handling
// as craft's /api/translate, called directly so the site doesn't have to be running.

export type AiConfig = { url: string; model?: string };

const LANGS: Record<string, string> = { zh: "Simplified Chinese", en: "English", es: "Spanish" };

/** The translations in the same order as `texts`, or null if the AI didn't give a usable answer. */
export async function translate({ url, model }: AiConfig, texts: string[], target: string): Promise<string[] | null> {
  const lang = LANGS[target];
  if (!lang) return null;
  if (!texts.length) return [];

  const res = await fetch(`${url.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            `You translate text read from a screenshot (it may have small OCR mistakes; fix them silently). ` +
            `Translate every item of the JSON array the user sends into ${lang}. Keep names, numbers and emoji. ` +
            `If an item is already in ${lang}, return it unchanged. ` +
            `Reply with ONLY a JSON array of strings, same length and order, no explanations.`,
        },
        { role: "user", content: JSON.stringify(texts) },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  }).catch(() => null);

  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
  const reply = data?.choices?.[0]?.message?.content ?? "";

  // The model sometimes wraps the array in ```json fences; take what's between the brackets.
  try {
    const parsed = JSON.parse(reply.slice(reply.indexOf("["), reply.lastIndexOf("]") + 1));
    if (Array.isArray(parsed) && parsed.length === texts.length) return parsed.map(String);
  } catch {}
  // One block and no array back: the whole reply is the translation.
  return texts.length === 1 && reply.trim() ? [reply.trim()] : null;
}
