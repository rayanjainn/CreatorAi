import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { generationType, brand = 'Keychron', slotLength = '45s Mid-Roll', payout = '$14,500', cpm = '$42.00', audienceFit = '9.8 / 10' } = body

    if (generationType === 'script') {
      return NextResponse.json({
        success: true,
        data: {
          type: 'script',
          title: `${brand} ${slotLength} High-Retention Integration Script`,
          estimatedDuration: slotLength,
          promoCode: 'CREATORAI15',
          hook: `Before we run the benchmark tests, let us talk about the tool you touch 10,000 times a day: your hardware setup with ${brand}.`,
          retentionTip: 'Keep macro product B-roll cuts under 2.5s per angle to maintain peak 88% viewer retention.',
          sections: [
            {
              time: '00:00 - 00:05',
              stage: 'Hook Intro',
              spokenAudio: `Most creators overlook hardware bottlenecks until renders fail. ${brand} solves this instantly.`,
              visualCue: 'Macro extreme close-up of hardware chassis in 4K 120fps slow-motion',
              onScreenText: `${brand} • Creator Integration`,
            },
            {
              time: '00:05 - 00:25',
              stage: 'Core Feature Demo',
              spokenAudio: `We tested peak performance under heavy LLM compiling loads. The custom thermal engineering keeps system temperatures 14°C cooler.`,
              visualCue: 'Split-screen thermal camera vs render timeline completion bar',
              onScreenText: '14°C Cooler • Zero Throttling',
            },
            {
              time: '00:25 - 00:45',
              stage: 'Call to Action',
              spokenAudio: `Use code CREATORAI15 at checkout to claim 15% off plus free express shipping via the link in the description below.`,
              visualCue: 'On-screen QR code and URL overlay pointing down to description box',
              onScreenText: 'CODE: CREATORAI15 (15% OFF)',
            },
          ],
        },
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        type: 'deck',
        title: `${brand} Sponsorship Proposal Deck`,
        slides: [
          {
            slideTitle: 'Executive Summary',
            subtitle: 'Targeting 350,000+ Verified Tech Decision Makers',
            content: 'Our audience consists of software engineers, AI researchers, and tech creators with $85k+ median income.',
            takeaway: 'Direct alignment with high-value technical buyer persona.',
            keyMetrics: [
              { label: 'Est. Reach', value: '350K+ Views' },
              { label: 'CPM Benchmark', value: cpm },
              { label: 'Audience Fit', value: audienceFit },
            ],
          },
          {
            slideTitle: 'Integration Strategy',
            subtitle: 'Organic 4K Demonstration vs Generic Ad Reads',
            content: 'Cinematic B-roll integration embedded directly into peak retention workflow segments.',
            takeaway: 'Zero retention drop-off during sponsor placement.',
          },
          {
            slideTitle: 'Commercial Structure',
            subtitle: 'Investment & Rights Overview',
            content: `Package includes ${slotLength} placement, description link #1, pinned comment, and 90-day digital ad usage rights for ${payout}.`,
            takeaway: 'Full multi-platform commercial clearance included.',
          },
        ],
      },
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || 'Server error' }, { status: 500 })
  }
}
