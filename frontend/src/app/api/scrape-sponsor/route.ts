import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { brand = 'Sponsor', domain = 'example.com' } = body

    return NextResponse.json({
      success: true,
      pagesAnalyzed: 4,
      extractedEmails: [`partnerships@${domain}`, `creators@${domain}`],
      scrapedUrls: [`https://${domain}/partnerships`, `https://${domain}/press`],
      contacts: [
        {
          name: 'Alex Rivera',
          role: 'Head of Creator Partnerships',
          email: `alex.rivera@${domain}`,
          phone: '+1 (415) 892-4120',
          speed: '< 2 hrs avg response',
          verified: true,
        },
        {
          name: 'Marcus Vance',
          role: 'VP of Brand Marketing',
          email: `marcus.vance@${domain}`,
          phone: '+1 (415) 892-4198',
          speed: '< 4 hrs avg response',
          verified: true,
        },
      ],
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || 'Server error' }, { status: 500 })
  }
}
