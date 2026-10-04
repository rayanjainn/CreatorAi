// twinResponseEngine.ts — Frontend-only AI response engine for Aarav AI Twin.
// Replace generateResponse() with Groq SDK in Phase 2.

export interface ConversationTurn {
  role: 'user' | 'twin';
  text: string;
  timestamp: Date;
}

function detectIntent(text: string): string {
  if (/reel idea|short idea|next reel|short.form/i.test(text)) return 'reel_ideas';
  if (/hook|attention|first.second|opening/i.test(text)) return 'hook_generation';
  if (/script|write.*video|story.*video|outline/i.test(text)) return 'script_ideas';
  if (/content.strateg|plan|calendar|schedul/i.test(text)) return 'content_strategy';
  if (/edit.*tip|cut|pacing|b.roll|transition/i.test(text)) return 'editing_tips';
  if (/monetiz|sponsor|brand deal|revenue/i.test(text)) return 'monetization';
  if (/thumbnail|title|seo|clickthrough/i.test(text)) return 'thumbnail_title';
  if (/feedback|review|thoughts on|what do you think/i.test(text)) return 'feedback';
  if (/hello|hi |hey |what.*you|who are you/i.test(text)) return 'greeting';
  return 'general';
}

const banks: Record<string, string[]> = {
  reel_ideas: [
    "Let me explore three creative directions for your next reel. First, a rapid-cut breakdown of your desk setup with a before-chaos, after-system narrative. Second, a raw single-take behind-the-scenes of you editing with your internal monologue voiced over. Third, a bold contrarian take like why I deleted my most viral video to trigger curiosity loops. The third format is trending hardest on Reels right now based on your engagement history.",
    "Here are three short-form concepts tuned to your creative DNA. One: a 45-second speed-run of your AI hardware setup with cinematic sound design. Two: a hot take format where you challenge a popular belief in your niche in the first three words. Three: a time-lapse of a full production day narrated with your internal creative commentary. All three play to your aggressive fast-cut style.",
    "Three reel ideas dialled into your audience profile. First, the 3 tools I removed from my workflow — your viewers love subtraction stories. Second, a side-by-side comparing your editing speed manually versus with AI assistance. Third, a one-minute explainer on a concept you believe is misunderstood in your niche. Start with the explainer — it has the highest save-rate potential for tech audiences."
  ],
  hook_generation: [
    "For a high-performing hook, you want to break a belief, state a consequence, or open a loop. Try this: The editing advice everyone gives you is actually slowing you down. That contradicts a held belief and promises a payoff. Pair it with a jump cut to your most dramatic B-roll shot in the first 2 seconds.",
    "Your strongest hooks historically open with a counter-intuitive claim. Three options for your next video: I stopped using transitions and my watch time went up 18 percent. Or: Most creators are solving the wrong problem. Or the most provocative: The best editing decision I ever made was deleting 40 percent of the footage.",
    "For YouTube specifically, hooks work in two layers: the visual hook and the verbal hook. Your verbal hook should arrive within the first spoken word. A strong verbal hook for your niche: This workflow saved me 12 hours last week. Specificity creates credibility before the audience knows anything else."
  ],
  script_ideas: [
    "For a strong script structure, I recommend the Problem-Proof-System arc. Open by naming a specific pain your audience feels. Then prove you have solved it with a real data point or visual demo. Finally walk through your system step by step. Close with the transformation, not a call to action.",
    "Here is a script framework for your 10 to 14 minute optimal duration. Minutes 0 to 1: pattern-interrupt hook and bold thesis. Minutes 1 to 4: the problem expanded with relatable specificity. Minutes 4 to 9: your proof and system walkthrough. Minutes 9 to 12: the nuance layer. Minutes 12 to 14: transformation moment and natural close.",
    "Script idea for your next long-form: The complete workflow I use from raw footage to published video in under 4 hours. Structure it as a real-time narrated session. That format performs 2.3 times better than tutorial-style for your audience because it feels authentic and paced. Your viewers trust demonstrated competence over explained competence."
  ],
  content_strategy: [
    "Your content DNA points toward a three-tier cadence: one long-form anchor video per week, three short-form derivatives cut from that same footage, and one experimental format per month. This system keeps your production overhead low while tripling your content surface area.",
    "Strategically, your strongest growth lever right now is depth, not frequency. Your analytics show that your 12 to 14 minute videos outperform your 8-minute videos by 34 percent on watch time. My recommendation: commit to one well-produced long-form piece per week and let AI tools handle the derivative short-form content.",
    "For Q4, AI hardware and creative workflow content is in a peak interest cycle. My recommended content pillars: pillar one is AI-assisted creation tools, pillar two is creative process and system design, and pillar three is results and case studies. Weight your calendar 50-30-20 across those pillars."
  ],
  editing_tips: [
    "The single highest-impact editing change you can make right now is cutting 30 percent of your silence. Run your audio through a silence remover first, then review the cut. Most creators lose viewers in the micro-pauses between sentences, not in the long sections.",
    "Three editing patterns lifting retention for tech creators right now. First, kinetic typography over your key data points. Second, audio elevation on your most important sentences. Third, cutting to B-roll at exactly the moment a statistic is stated, not after — the visual confirmation of the claim is the payoff.",
    "For pacing, your style calls for a variable rhythm edit: fast cuts during high-energy claims, single long takes during demonstrations. The mistake most creators make is maintaining a consistent cut pace throughout. Contrast is the tool. When you slow down deliberately, the viewer pays more attention."
  ],
  monetization: [
    "For brand integrations that protect your audience trust, only accept sponsors whose products you have used on camera, integrate them as a natural workflow moment, and place the segment after your highest-value content moment. Your audience has a very high sensitivity to scripted reads.",
    "Your monetization ceiling is limited by your CPM, not your views. Tech and AI hardware content commands CPMs between 18 and 34 dollars, which is 3 to 4 times the platform average. Focus on YouTube longform and optimise for viewer intent keywords in your titles.",
    "Three revenue streams to layer in Q4. First, a digital product like a production workflow template — low overhead, high margin. Second, a community or cohort offering built around your editing methodology. Third, selective brand partnerships where you negotiate usage rights fees, which can triple your per-deal revenue."
  ],
  thumbnail_title: [
    "Your thumbnail should communicate one bold idea in under half a second. The strongest format for your niche is a close-cropped face with a clear emotional state paired with a 2 to 3 word text overlay that makes the viewer feel like they are missing something.",
    "For thumbnail-title synergy, your title should pose the question your thumbnail answers visually. The thumbnail gets the click, the title gets the watch — they serve different jobs. Structure your titles as a consequence plus a mystery.",
    "High-performing titles in your niche follow a consistent pattern: specificity plus stakes. Instead of my editing workflow, try: The exact workflow I use to edit a full YouTube video in 3 hours. The specificity of the number creates credibility and the implication of speed creates desire."
  ],
  feedback: [
    "Based on your creative profile and the patterns I have learned from your 48 longform and 142 shortform pieces, here is my honest read: your strongest asset is your ability to explain complex systems in plain language without losing depth. Your biggest growth opportunity is leaning harder into the personal narrative layer.",
    "My feedback on your current approach: your production quality is at a level where it is no longer the barrier to growth. The next unlock is distribution strategy. Every longform video you publish should have at least 3 derivative short-form pieces extracted within 48 hours while the algorithm is actively distributing it.",
    "Here is what I see in your creative DNA: you are building toward a distinct creative voice in a crowded niche. Your most engaged viewers are not just watching for information — they are watching for your perspective. Let your personality lead more often."
  ],
  greeting: [
    "Hey, I am your Aarav AI Twin — trained on your voice, your creative instincts, and your entire content library. I think in the frameworks you have built and I reference the strategies that have worked for your audience. What are we working on?",
    "I am online and ready. As your digital creative twin, I have internalized your content style, your audience patterns, and your production philosophy. What do you want to create today?",
    "Neural clone online. I carry your creative DNA — your fast-cut instincts, your contrarian hook style, your belief that depth beats frequency. I am not just a generic AI assistant. Ask me anything about your creative work."
  ],
  general: [
    "That is an interesting question for a creator at your stage. The most important thing to keep in mind is that your audience has opted into your perspective, not just your information. Whatever direction you are weighing, run it through that filter first.",
    "I am processing that through your creative framework. Based on what I know about your content history and audience patterns, the answer is nuanced. Trust your instinct on creative decisions and use data to validate or refine.",
    "Let me give you a direct answer calibrated to your situation. You are at a creative inflection point where the decisions you make in the next 90 days will compound significantly. Focus on depth of expertise, consistency of voice, and one or two platform channels rather than spreading thin."
  ]
};

const DIRECT_GROQ_KEY = process.env.NEXT_PUBLIC_GROQ_API_KEY || process.env.GROQ_API_KEY || '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';

export async function generateResponse(
  userText: string,
  history: ConversationTurn[] = []
): Promise<string> {
  // 1. Try local Next.js API route first
  try {
    const res = await fetch('/api/groq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userText, history }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.text && !data.error) {
        return data.text;
      }
    }
  } catch (err) {
    console.warn('Local /api/groq route unavailable, trying direct Groq API...', err);
  }

  // 2. Try direct Groq API call from browser as secondary layer
  if (DIRECT_GROQ_KEY) {
    try {
      const models = ['qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];
      for (const model of models) {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${DIRECT_GROQ_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content: 'You are Aarav AI Twin v3.4 — an expert digital clone, video editor, and content strategist. Directly answer the user question concisely in 2 to 4 spoken sentences. Do NOT use markdown symbols, asterisks, hashtags, or emojis.'
              },
              ...history.slice(-4).map(h => ({
                role: h.role === 'user' ? 'user' : 'assistant',
                content: h.text
              })),
              { role: 'user', content: userText }
            ],
            temperature: 0.7,
            max_tokens: 300
          })
        });

        if (groqRes.ok) {
          const data = await groqRes.json();
          const reply = data.choices?.[0]?.message?.content;
          if (reply) {
            return reply.replace(/[*#_~`]/g, '').replace(/\n+/g, ' ').trim();
          }
        }
      }
    } catch (directErr) {
      console.warn('Direct Groq API call failed:', directErr);
    }
  }

  // 3. Fallback response engine tailored to specific topics
  await new Promise(resolve => setTimeout(resolve, 300));
  
  if (/tiktok|instagram|reels|monetiz|platform|upload/i.test(userText)) {
    return "For monetization right now, Instagram Reels pays higher per brand deal and offers better e-commerce product tags, while TikTok is faster for rapid view volume. I recommend cross-posting your short-form content to both platforms simultaneously to maximize your reach while securing higher-paying brand deals on Instagram.";
  }

  const intent = detectIntent(userText);
  const pool = banks[intent] ?? banks.general;
  const lastTwinTurn = [...history].reverse().find(t => t.role === 'twin');
  const available = pool.filter(r => r !== lastTwinTurn?.text);
  const chosen = available.length > 0 ? available : pool;
  return chosen[Math.floor(Math.random() * chosen.length)];
}

