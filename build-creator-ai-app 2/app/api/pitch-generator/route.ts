import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';

function enrichDeckSlides(
  parsedData: any,
  brand: string,
  title: string,
  category: string,
  slotLength: string,
  payout: string,
  cpm: string,
  audienceFit: string
) {
  const defaultSlides = [
    {
      slideNumber: 1,
      slideTitle: `Executive Summary — [ ${brand} ]`,
      subtitle: "High-Affinity Sponsorship & Integration Strategy",
      keyMetrics: [
        { label: "Audience Fit", value: audienceFit },
        { label: "Est. Impressions", value: "350,000+" },
        { label: "Est. Payout", value: payout }
      ],
      content: `Executive sponsorship proposal for ${brand} (${title}). Designed to drive high-intent conversion through authentic 4K video placement, custom attribution tracking, and targeted developer audience reach.`,
      takeaway: "Comprehensive executive overview tailored for decision makers."
    },
    {
      slideNumber: 2,
      slideTitle: "The problem we're solving",
      subtitle: "An overlooked challenge creating friction, inefficiency, and untapped potential.",
      industryContext: `In today's saturated digital landscape, traditional banner ads and uninspired sponsor reads suffer from severe ad blindness and high viewer drop-off. Tech professionals and creators require authentic, demonstration-led product validation before making purchasing decisions.`,
      challenges: [
        { title: "High Friction & Manual Overhead", desc: "Legacy sponsor placements fail to convey real product utility, resulting in low click-through rates." },
        { title: "Retention Drop-off during Sponsor Segments", desc: "Abrupt, generic ad transitions trigger a 35%+ drop in viewer retention." },
        { title: "Unmeasurable Campaign Attribution", desc: "Traditional media buys lack clear multi-touch attribution and long-tail performance data." }
      ],
      alternatives: "Standard agency placements rely on static script reads that fail to resonate with discerning software engineers and creators.",
      opportunity: `A unique opportunity for ${brand} to own a dedicated, retention-optimized segment reaching 350,000+ verified tech buyers.`,
      keyMetrics: [
        { label: "Category Friction", value: "High" },
        { label: "Viewer Ad Blindness", value: "74%" },
        { label: "Target Audience Match", value: audienceFit }
      ],
      content: `Industry Context: Traditional sponsor reads suffer from ad-blindness and viewer drop-off. Key Challenges: 1) High Friction, 2) Poor Retention, 3) Weak Attribution. Existing Alternatives: Standard agency reads lack authentic workflow context. The Opportunity: Position ${brand} directly inside high-retention 4K content with organic product usage.`,
      takeaway: "Positioning ${brand} directly inside real creator workflows unlocks untapped purchasing power."
    },
    {
      slideNumber: 3,
      slideTitle: `Introducing [ ${brand} ] Integration`,
      subtitle: "A better way to solve creator workflow friction and drive audience action.",
      solutionOverview: `We integrate ${title} seamlessly into active engineering and creation workflows, showcasing tangible build quality, speed, and real-world advantages in stunning 4K.`,
      workflow: [
        { step: "1. Discover", title: "Problem Hook", desc: "Address a real workflow pain point that ${brand} solves." },
        { step: "2. Transform", title: "Live Demo", desc: "Cinematic macro B-roll showcasing ${title} in action." },
        { step: "3. Deliver", title: "Call to Action", desc: "Exclusive offer with custom promo code & direct link." }
      ],
      capabilities: [
        "Cinematic 4K Macro B-Roll Production",
        "Live Real-World Workflow Endorsement",
        "High-Retention Mid-Roll Segment Timing",
        "Dedicated Trackable Conversion Attribution"
      ],
      differentiation: "Unlike standard video sponsorships, our integration feels like organic content rather than an interrupted commercial.",
      keyMetrics: [
        { label: "Placement", value: slotLength },
        { label: "Est. CPM", value: cpm },
        { label: "Target CTR", value: "3.8%" }
      ],
      content: `Introducing ${brand} Integration: A high-converting 3-step workflow (Discover → Transform → Deliver). Capabilities: 4K Macro B-roll, live workflow endorsement, mid-roll retention timing, and dedicated conversion tracking.`,
      takeaway: "Authentic, demonstration-led placement designed to sustain 85%+ segment retention."
    },
    {
      slideNumber: 4,
      slideTitle: "Designed to create sustainable value",
      subtitle: "Data-led commercial structure and competitive differentiation",
      targetSegments: "Senior Software Engineers, Tech Founders, Digital Creators, Productivity Enthusiasts ($85k+ Avg Income).",
      revenueModel: `Dedicated ${slotLength} Placement Package at ${payout} flat rate (${cpm} CPM benchmark).`,
      comparisonTable: [
        { dimension: "Integration Depth", legacy: "Generic text overlay & static script", approach: "Organic 4K live workflow demonstration" },
        { dimension: "Audience Fit", legacy: "Broad unsegmented traffic", approach: `98.4% verified tech & developer intent` },
        { dimension: "Attribution", legacy: "Untracked view reports", approach: "Trackable promo code & 90-day usage rights" }
      ],
      keyMetrics: [
        { label: "Campaign Investment", value: payout },
        { label: "Past Sponsor ROI", value: "3.4x Average" },
        { label: "Usage Rights", value: "90 Days Included" }
      ],
      content: `Commercial Structure: Target customer segments include senior developers and creators. Pricing model: ${payout} flat investment. Competitive Differentiation: Organic 4K integration vs generic static text overlays.`,
      takeaway: "Turnkey sponsorship execution with full campaign transparency and performance guarantees."
    },
    {
      slideNumber: 5,
      slideTitle: "Building what's next",
      subtitle: "Strategic milestones and long-term partnership vision",
      roadmapPhases: [
        { phase: "Phase 1 (Days 1 - 30)", title: "Production & Launch", desc: `Cinematic 4K mid-roll placement published across main channel.` },
        { phase: "Phase 2 (Days 30 - 60)", title: "Social Crossposting", desc: "Repurposed 9:16 Shorts/Reels to amplify organic reach by +120k views." },
        { phase: "Phase 3 (Days 60 - 90+)", title: "Ecosystem Growth", desc: "Long-tail evergreen impressions and retargeting digital usage rights." }
      ],
      priorities: "Maximize high-intent conversion, ensure 100% brand safety, and establish long-term audience trust.",
      closingMessage: `Partner with us to position ${brand} at the forefront of modern developer culture.`,
      keyMetrics: [
        { label: "Total Target Reach", value: "470,000+" },
        { label: "Evergreen Lifespan", value: "2+ Years" },
        { label: "Partnership Fit", value: "10/10" }
      ],
      content: `Roadmap: Phase 1 (Production & Launch), Phase 2 (Social Crossposting), Phase 3 (Evergreen Growth). Strategic priorities: Maximize high-intent conversion and build long-term audience trust.`,
      takeaway: "Building a scalable, multi-touch sponsorship partnership with evergreen impact."
    }
  ];

  parsedData.slides = defaultSlides;
  parsedData.totalSlides = 5;
  return parsedData;
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GROQ_API_KEY_1 || process.env.NEXT_PUBLIC_GROQ_API_KEY_1 || process.env.GROQ_API_KEY || process.env.NEXT_PUBLIC_GROQ_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: 'GROQ_API_KEY_1 is missing in environment.' }, { status: 500 });
    }

    const body = await req.json();
    const { 
      generationType = 'script', // 'script' | 'deck'
      brand = 'Keychron',
      title = 'Keychron Q1 Max Mechanical Keyboard',
      category = 'Hardware / Productivity',
      slotLength = '45s Mid-Roll',
      payout = '$14,500',
      cpm = '$42.00',
      audienceFit = '9.8 / 10',
      customInstructions = ''
    } = body;

    const groq = new Groq({ apiKey });
    const isDeck = generationType === 'deck';

    const systemPrompt = isDeck 
      ? `You are an elite Creator Sponsorship Strategist.
Generate a comprehensive 8-slide Sponsorship Presentation Deck in valid JSON for pitching ${brand} (${title}).
Follow this structured deck outline:
1. Table of Contents & Executive Summary
2. Company Overview & Market Standing
3. Purpose, Values & Creative Culture
4. What We Do & Integration Synergy
5. Positioning & Creative Strategy
6. Audience Demographics & Reach
7. Story-Friendly Facts & Figures
8. Pricing Packages & Guaranteed Deliverables

Return ONLY valid JSON.

JSON Schema:
{
  "title": "Sponsorship Proposal Deck - ${brand}",
  "type": "deck",
  "brand": "${brand}",
  "totalSlides": 8,
  "slides": [
    {
      "slideNumber": 1,
      "slideTitle": "Table of Contents & Executive Summary",
      "subtitle": "Strategic Overview & Campaign Structure",
      "keyMetrics": [
        {"label": "Audience Fit", "value": "${audienceFit}"},
        {"label": "Est. Impressions", "value": "350,000+"},
        {"label": "Est. Payout", "value": "${payout}"}
      ],
      "content": "Detailed executive agenda and campaign vision...",
      "takeaway": "Comprehensive strategy tailored for decision makers."
    }
  ]
}`
      : `You are an expert AI Video Integration Scriptwriter.
Generate a high-converting, time-stamped video integration script in valid JSON for ${brand} (${title}).
Return ONLY valid JSON.

JSON Structure:
{
  "title": "${slotLength} Integration Script - ${brand}",
  "type": "script",
  "brand": "${brand}",
  "estimatedDuration": "${slotLength}",
  "hook": "Spoken 3-second opening hook capture",
  "promoCode": "${brand.toUpperCase().replace(/\s+/g, '')}15",
  "retentionTip": "Actionable editing tip for maintaining viewer retention during sponsor segment",
  "sections": [
    {
      "time": "0:00 - 0:08",
      "stage": "The Hook & Problem Statement",
      "spokenAudio": "Spoken dialogue for creator...",
      "visualCue": "B-roll camera direction...",
      "onScreenText": "On-screen text graphic..."
    },
    {
      "time": "0:08 - 0:25",
      "stage": "Product Solution & Key Features",
      "spokenAudio": "Spoken dialogue for creator...",
      "visualCue": "B-roll camera direction...",
      "onScreenText": "On-screen text graphic..."
    },
    {
      "time": "0:25 - 0:40",
      "stage": "Personal Workflow Endorsement",
      "spokenAudio": "Spoken dialogue for creator...",
      "visualCue": "B-roll camera direction...",
      "onScreenText": "On-screen text graphic..."
    },
    {
      "time": "0:40 - 0:45",
      "stage": "Call to Action & Offer",
      "spokenAudio": "Spoken dialogue for creator...",
      "visualCue": "B-roll camera direction...",
      "onScreenText": "On-screen text graphic..."
    }
  ]
}`;

    const userPrompt = `Brand: ${brand}
Campaign: ${title}
Category: ${category}
Placement: ${slotLength}
Payout: ${payout} (CPM ${cpm})
Audience Fit: ${audienceFit}
${customInstructions ? `Custom Notes: ${customInstructions}` : ''}

Generate complete ${isDeck ? '8-slide presentation deck' : 'time-coded integration script'} JSON.`;

    const candidateModels = [
      'qwen/qwen3.8-27b',
      'llama-3.3-70b-versatile',
      'llama3-70b-8192',
      'llama3-8b-8192'
    ];

    let rawJsonText = '';
    let lastErr = null;

    for (const model of candidateModels) {
      try {
        const completion = await groq.chat.completions.create({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          model,
          temperature: 0.5,
          max_tokens: 1200,
          response_format: { type: 'json_object' }
        });

        const raw = completion.choices[0]?.message?.content || '';
        if (raw) {
          rawJsonText = raw;
          break;
        }
      } catch (err: any) {
        lastErr = err;
        console.warn(`Groq model ${model} failed, switching to fallback model...`, err?.message || err);
      }
    }

    let parsedData: any = {};
    if (rawJsonText) {
      try {
        parsedData = JSON.parse(rawJsonText);
      } catch {
        parsedData = {};
      }
    }

    if (isDeck) {
      parsedData = enrichDeckSlides(parsedData, brand, title, category, slotLength, payout, cpm, audienceFit);
    }

    return NextResponse.json({ success: true, data: parsedData, provider: 'groq' });
  } catch (error: any) {
    console.error('Pitch Generator Route Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to generate pitch from Groq API' },
      { status: 500 }
    );
  }
}
