import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GROQ_API_KEY || process.env.NEXT_PUBLIC_GROQ_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: 'GROQ_API_KEY is missing in environment.' }, { status: 500 });
    }

    const { userText, history = [] } = await req.json();

    if (!userText || typeof userText !== 'string') {
      return NextResponse.json({ error: 'User input is required.' }, { status: 400 });
    }

    const groq = new Groq({ apiKey });

    const systemPrompt = `You are Aarav AI Twin v3.4 — a digital clone, top-tier video editor, and content strategist trained on 48 long-form videos and 142 short-form cuts.
Your persona: Punchy, strategic, conversational, and direct.
Rules:
1. DIRECTLY address the user's specific question or statement. Never give generic boilerplate.
2. Keep responses concise (2 to 4 sentences max) so it can be spoken cleanly via text-to-speech.
3. Do NOT use markdown symbols (no asterisks *, no hashtags #, no emojis, no bullet points). Write in clear plain spoken English.`;

    const candidateModels = ['qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b'];
    let responseText = '';
    let lastErr = null;

    for (const model of candidateModels) {
      try {
        const completion = await groq.chat.completions.create({
          messages: [
            { role: 'system', content: systemPrompt },
            ...history.slice(-4).map((h: { role: string; text: string }) => ({
              role: (h.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
              content: h.text
            })),
            { role: 'user', content: userText }
          ],
          model,
          temperature: 0.7,
          max_tokens: 300,
        });

        const raw = completion.choices[0]?.message?.content || '';
        if (raw) {
          responseText = raw;
          break;
        }
      } catch (err) {
        lastErr = err;
        console.warn(`Groq model ${model} failed, trying next model...`, err);
      }
    }

    if (!responseText) {
      throw lastErr || new Error('All Groq models failed to return a response');
    }

    // Clean any remaining markdown formatting symbols so text-to-speech sounds natural
    const cleanText = responseText.replace(/[*#_~`]/g, '').replace(/\n+/g, ' ').trim();

    return NextResponse.json({ text: cleanText, provider: 'groq' });
  } catch (error: any) {
    console.error('Groq API Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to generate response from Groq API' },
      { status: 500 }
    );
  }
}
