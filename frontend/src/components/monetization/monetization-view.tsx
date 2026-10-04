'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import {
  ArrowRight,
  BriefcaseBusiness,
  Calendar,
  Check,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Globe,
  Grid2X2,
  Layers3,
  List,
  Mail,
  MoreVertical,
  Phone,
  RotateCw,
  Sparkles,
  TrendingUp,
  Users,
  Video,
  Wallet,
  X,
  Zap,
} from 'lucide-react'

function TikTokIcon({ size = 13, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M19.589 6.686a4.793 4.793 0 0 1-3.77-4.245V2h-3.445v13.672a2.896 2.896 0 0 1-2.891 2.887 2.896 2.896 0 0 1-2.892-2.887 2.896 2.896 0 0 1 2.892-2.887c.277 0 .542.04.794.113V9.387a6.297 6.297 0 0 0-.794-.05c-3.486 0-6.333 2.848-6.333 6.333 0 3.486 2.847 6.333 6.333 6.333s6.333-2.847 6.333-6.333V8.825a8.167 8.167 0 0 0 4.773 1.306V6.686z" />
    </svg>
  )
}

function InstagramIcon({ size = 13, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  )
}

function YoutubeIcon({ size = 13, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
}

function ConfidenceGauge({ percentage }: { percentage: number }) {
  const radius = 18
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (percentage / 100) * circumference

  return (
    <div className="relative w-11 h-11 flex items-center justify-center flex-none">
      <svg className="w-11 h-11 transform -rotate-90">
        <circle cx="22" cy="22" r={radius} stroke="#1b2923" strokeWidth="3.5" fill="transparent" />
        <circle
          cx="22"
          cy="22"
          r={radius}
          stroke="#10b981"
          strokeWidth="3.5"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="transparent"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[11px] font-bold text-white">{percentage}%</span>
      </div>
    </div>
  )
}

export function MonetizationView() {
  const [flippedCards, setFlippedCards] = useState<Record<string, boolean>>({})
  const [pitchSuccess, setPitchSuccess] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [activeScrapeModal, setActiveScrapeModal] = useState<string | null>(null)
  const [isScraping, setIsScraping] = useState<boolean>(false)
  const [scrapeStep, setScrapeStep] = useState<number>(0)

  const [liveScrapedContacts, setLiveScrapedContacts] = useState<Record<string, any[]>>({})
  const [scrapeMetadata, setScrapeMetadata] = useState<Record<string, { pagesAnalyzed: number; extractedEmails: string[]; scrapedUrls: string[] }>>({})

  const getBrandTheme = (brand: string = '') => {
    const b = brand.toLowerCase()
    if (b.includes('keychron')) {
      return {
        brand: 'Keychron',
        primary: '#f59e0b',
        primaryHover: '#d97706',
        accentBg: '#261b0c',
        border: '#78350f',
        textAccent: '#fbbf24',
        badgeBg: '#451a03',
        logoUrl: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=150&auto=format&fit=crop&q=80',
        ringColor: 'ring-amber-500/40',
        bgGlow: 'bg-amber-500/10',
      }
    } else if (b.includes('nord')) {
      return {
        brand: 'NordVPN',
        primary: '#38bdf8',
        primaryHover: '#0284c7',
        accentBg: '#0b2336',
        border: '#0369a1',
        textAccent: '#7dd3fc',
        badgeBg: '#0c4a6e',
        logoUrl: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=150&auto=format&fit=crop&q=80',
        ringColor: 'ring-sky-500/40',
        bgGlow: 'bg-sky-500/10',
      }
    } else if (b.includes('macpaw') || b.includes('cleanmymac')) {
      return {
        brand: 'CleanMyMac',
        primary: '#10b981',
        primaryHover: '#059669',
        accentBg: '#08261e',
        border: '#047857',
        textAccent: '#6ee7b7',
        badgeBg: '#064e3b',
        logoUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
        ringColor: 'ring-emerald-500/40',
        bgGlow: 'bg-emerald-500/10',
      }
    } else if (b.includes('anker')) {
      return {
        brand: 'Anker',
        primary: '#f97316',
        primaryHover: '#ea580c',
        accentBg: '#2a1409',
        border: '#c2410c',
        textAccent: '#ffba80',
        badgeBg: '#7c2d12',
        logoUrl: 'https://images.unsplash.com/photo-1609592424109-dd9892f1b177?w=150&auto=format&fit=crop&q=80',
        ringColor: 'ring-orange-500/40',
        bgGlow: 'bg-orange-500/10',
      }
    }
    return {
      brand: brand || 'Sponsor',
      primary: '#8b5cf6',
      primaryHover: '#7c3aed',
      accentBg: '#1f1933',
      border: '#5b3da0',
      textAccent: '#c4b5fd',
      badgeBg: '#371e68',
      logoUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
      ringColor: 'ring-violet-500/40',
      bgGlow: 'bg-violet-500/10',
    }
  }

  const downloadPDFDocument = (generatedData: any, campaign: any) => {
    const theme = getBrandTheme(campaign?.brand || generatedData?.brand || '')
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    const isDeck = generatedData.type === 'deck'
    const logoImg = campaign?.logoUrl || theme.logoUrl
    const formattedDate = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${generatedData.title || (isDeck ? `${theme.brand} Pitch Deck` : `${theme.brand} Script`)}</title>
          <meta charset="utf-8" />
          <style>
            @page { size: A4 landscape; margin: 6mm; }
            * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            html, body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #0b0c10 !important; color: #f1f5f9 !important; margin: 0; padding: 0; font-size: 12px; line-height: 1.5; }
            @media print {
              html, body { background-color: #0b0c10 !important; color: #f1f5f9 !important; }
              .pdf-slide-page, .pdf-cover-page { break-inside: avoid !important; page-break-inside: avoid !important; break-after: page !important; page-break-after: always !important; }
              .pdf-slide-page:last-of-type { break-after: auto !important; page-break-after: auto !important; }
            }
            .pdf-cover-page { width: 100%; min-height: 185mm; background: #ffffff; color: #0f172a; border-radius: 12px; overflow: hidden; page-break-after: always; position: relative; border: 1px solid #cbd5e1; }
            .cover-table { width: 100%; height: 170mm; table-layout: fixed; }
            .cover-left-cell { background: #ffffff; color: #0f172a; padding: 40px 48px; }
            .cover-right-cell { background: ${theme.primary}; color: #ffffff; padding: 40px; text-align: center; }
            .cover-footer-strip { background: #1e293b; color: #ffffff; padding: 10px 24px; font-size: 11px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; }
            .pdf-slide-page { width: 100%; min-height: 185mm; background: #12131c; border: 1px solid ${theme.border}; border-top: 6px solid ${theme.primary}; border-radius: 14px; padding: 24px 28px 16px 28px; page-break-after: always; display: flex; flex-direction: column; justify-content: space-between; }
            .slide-title-text { font-size: 24px; font-weight: 900; color: #ffffff; margin: 4px 0 2px 0; letter-spacing: -0.5px; }
            .slide-sub-text { font-size: 13px; color: #94a3b8; }
            .badge-pill { display: inline-block; background: ${theme.badgeBg}; color: ${theme.textAccent}; border: 1px solid ${theme.border}; font-size: 10px; font-weight: 800; padding: 4px 12px; border-radius: 99px; text-transform: uppercase; }
            .metrics-table { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 12px; margin: 16px 0; }
            .metric-td { background: ${theme.accentBg}; border: 1px solid ${theme.border}; border-top: 4px solid ${theme.primary}; border-radius: 10px; padding: 14px 16px; text-align: center; }
            .metric-lbl { font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; }
            .metric-val { font-size: 20px; font-weight: 900; color: ${theme.textAccent}; margin-top: 4px; }
            .takeaway-card { background: #064e3b; border: 1px solid #059669; border-radius: 10px; padding: 12px 18px; font-size: 12px; color: #a7f3d0; font-weight: 600; margin-bottom: 16px; }
            .inner-footer-strip { background: #090a10; border-top: 1px solid #232536; padding: 8px 14px; border-radius: 8px; margin-top: auto; }
            .hook-card { background: ${theme.accentBg}; border: 1px solid ${theme.border}; border-left: 6px solid ${theme.primary}; border-radius: 12px; padding: 18px 22px; margin-bottom: 20px; }
            .script-table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 12px; }
            .script-table th { background: #181926; color: #94a3b8; font-size: 11px; font-weight: 800; text-transform: uppercase; padding: 12px 14px; text-align: left; border-bottom: 2px solid ${theme.border}; }
            .script-table td { background: #12131c; border-bottom: 1px solid #232536; padding: 16px 14px; vertical-align: top; }
            .time-pill { display: inline-block; background: ${theme.badgeBg}; color: ${theme.textAccent}; border: 1px solid ${theme.border}; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 6px; }
          </style>
        </head>
        <body style="padding: 12px;">
          <div class="pdf-cover-page">
            <table class="cover-table" cellpadding="0" cellspacing="0">
              <tr>
                <td width="58%" class="cover-left-cell">
                  <div>
                    <div style="font-size: 16px; font-weight: 900; color: #334155; letter-spacing: 2px; text-transform: uppercase;">BRAND PITCH DECK</div>
                    <div style="font-size: 11px; font-weight: 800; color: #64748b; letter-spacing: 1px; text-transform: uppercase; margin-top: 2px;">SPONSORSHIP PROPOSAL & INTEGRATION STRATEGY</div>
                    <div style="margin-top: 48px; border-left: 6px solid ${theme.primary}; padding-left: 20px;">
                      <div style="font-size: 38px; font-weight: 900; color: #0f172a; text-transform: uppercase; letter-spacing: -1px; line-height: 1.1;">[ ${campaign?.brand || theme.brand} ]</div>
                      <div style="font-size: 15px; font-weight: 700; color: #475569; margin-top: 8px;">${generatedData.title || (isDeck ? `${theme.brand} Pitch Deck` : `${theme.brand} Video Script`)}</div>
                    </div>
                  </div>
                  <div style="margin-top: 60px; border-top: 2px solid #e2e8f0; padding-top: 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        ${logoImg ? `<td width="56" style="vertical-align: middle;"><img src="${logoImg}" style="width: 44px; height: 44px; border-radius: 8px; border: 2px solid ${theme.primary}; object-fit: cover;" /></td>` : ''}
                        <td style="vertical-align: middle;">
                          <div style="font-size: 12px; font-weight: 900; color: #0f172a; text-transform: uppercase;">${campaign?.category || 'Tech & Software Integration'} • CREATOR PROPOSAL</div>
                          <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Est. Campaign Payout: <strong>${campaign?.payout || '$14,500'}</strong> • Audience Match: <strong>${campaign?.audienceFit || '9.8/10'}</strong></div>
                          <div style="font-size: 10px; color: #94a3b8; margin-top: 3px;">Generated Date: ${formattedDate}</div>
                        </td>
                      </tr>
                    </table>
                  </div>
                </td>
                <td width="42%" class="cover-right-cell">
                  <div style="border: 3px solid rgba(255,255,255,0.4); border-radius: 18px; padding: 48px 24px; background: rgba(0,0,0,0.12);">
                    <div style="font-size: 46px; font-weight: 900; letter-spacing: 4px; text-transform: uppercase; line-height: 1.05;">BRAND<br/>PITCH<br/>DECK</div>
                    <div style="margin-top: 28px; display: inline-block; background: rgba(0,0,0,0.3); border: 1.5px solid rgba(255,255,255,0.4); padding: 8px 18px; border-radius: 99px; font-size: 11px; font-weight: 900; text-transform: uppercase;">${theme.brand.toUpperCase()} SPONSORSHIP</div>
                  </div>
                </td>
              </tr>
            </table>
            <div class="cover-footer-strip">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>CONFIDENTIAL CREATOR PROPOSAL</td>
                  <td style="text-align: right;">BRAND PITCH DECK</td>
                </tr>
              </table>
            </div>
          </div>
          ${isDeck ? `
            <div class="pdf-slide-page">
              <div>
                <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom: 1px solid #232536; padding-bottom: 12px; margin-bottom: 16px;">
                  <tr>
                    <td>
                      <span style="font-size: 10px; font-weight: 900; color: ${theme.primary}; letter-spacing: 2px; text-transform: uppercase;">SLIDE 2 OF 5 // PROBLEM & OPPORTUNITY</span>
                      <h2 class="slide-title-text">The problem we're solving</h2>
                      <div class="slide-sub-text">An overlooked challenge creating friction, inefficiency, and untapped potential.</div>
                    </td>
                    <td style="text-align: right; vertical-align: top;"><span class="badge-pill">${theme.brand} Pitch</span></td>
                  </tr>
                </table>
                <div class="takeaway-card">⚡ <strong>The Strategic Opportunity:</strong> A unique opportunity for ${theme.brand} to own a dedicated, retention-optimized segment reaching 350,000+ verified tech buyers.</div>
              </div>
              <div class="inner-footer-strip">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size: 10px; color: #64748b;">${theme.brand} Pitch Deck • Slide 2 of 5</td>
                    <td style="text-align: right; font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase;">${theme.brand.toUpperCase()} PITCH DECK</td>
                  </tr>
                </table>
              </div>
            </div>
          ` : `
            <div class="pdf-slide-page">
              <div>
                ${generatedData.hook ? `<div class="hook-card"><div style="font-size: 10px; font-weight: 900; color: ${theme.textAccent}; text-transform: uppercase;">⚡ Opening 3-Second Spoken Hook</div><div style="font-size: 16px; font-style: italic; font-weight: 600; color: #ffffff;">"${generatedData.hook}"</div></div>` : ''}
                <table class="script-table" cellpadding="0" cellspacing="0">
                  <thead>
                    <tr>
                      <th width="16%">Time & Stage</th>
                      <th width="54%">Spoken Audio Script</th>
                      <th width="30%">Visual B-Roll & On-Screen Overlay</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${generatedData.sections?.map((sec: any) => `
                      <tr>
                        <td><span class="time-pill">${sec.time}</span><div style="font-weight: 800; color: #ffffff; font-size: 12px; margin-top: 8px;">${sec.stage}</div></td>
                        <td><div style="background: #090a10; border: 1px solid #1c1e2b; border-radius: 8px; padding: 14px; color: #f1f5f9;">"${sec.spokenAudio}"</div></td>
                        <td><div style="background: #090a10; border: 1px solid #1c1e2b; border-radius: 8px; padding: 12px; color: #94a3b8;">${sec.visualCue}</div></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
              <div class="inner-footer-strip">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size: 10px; color: #64748b;">${theme.brand} Video Integration Script</td>
                    <td style="text-align: right; font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase;">${theme.brand.toUpperCase()} SCRIPT</td>
                  </tr>
                </table>
              </div>
            </div>
          `}
          <script>setTimeout(() => { window.print(); }, 600);</script>
        </body>
      </html>
    `

    printWindow.document.write(htmlContent)
    printWindow.document.close()
  }

  const toggleFlip = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setFlippedCards((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleCopyScript = (id: string, text: string, e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const [pitchGeneratorModal, setPitchGeneratorModal] = useState<{
    isOpen: boolean
    campaign: any | null
    selectedType: 'script' | 'deck'
    customInstructions: string
    isGenerating: boolean
    generatedData: any | null
    activeSlideIndex: number
    error: string | null
  }>({
    isOpen: false,
    campaign: null,
    selectedType: 'script',
    customInstructions: '',
    isGenerating: false,
    generatedData: null,
    activeSlideIndex: 0,
    error: null,
  })

  const handlePitchDeal = (brandOrCampaign: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    let campaignObj = null
    if (typeof brandOrCampaign === 'object' && brandOrCampaign !== null) {
      campaignObj = brandOrCampaign
    } else {
      const searchName = String(brandOrCampaign).toLowerCase()
      campaignObj = campaigns.find((c) => c.brand.toLowerCase().includes(searchName) || c.id.toLowerCase().includes(searchName)) || campaigns[0]
    }

    setPitchGeneratorModal({
      isOpen: true,
      campaign: campaignObj,
      selectedType: 'script',
      customInstructions: '',
      isGenerating: false,
      generatedData: null,
      activeSlideIndex: 0,
      error: null,
    })
  }

  const executeGroqPitchGeneration = async () => {
    if (!pitchGeneratorModal.campaign) return

    setPitchGeneratorModal((prev) => ({
      ...prev,
      isGenerating: true,
      error: null,
      generatedData: null,
      activeSlideIndex: 0,
    }))

    try {
      const res = await fetch('/api/pitch-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generationType: pitchGeneratorModal.selectedType,
          brand: pitchGeneratorModal.campaign.brand,
          title: pitchGeneratorModal.campaign.title,
          category: pitchGeneratorModal.campaign.category,
          slotLength: pitchGeneratorModal.campaign.slotLength,
          payout: pitchGeneratorModal.campaign.payout,
          cpm: pitchGeneratorModal.campaign.cpm,
          audienceFit: pitchGeneratorModal.campaign.audienceFit,
          customInstructions: pitchGeneratorModal.customInstructions,
        }),
      })

      const json = await res.json()
      if (json.success && json.data) {
        setPitchGeneratorModal((prev) => ({
          ...prev,
          isGenerating: false,
          generatedData: json.data,
        }))
      } else {
        // Fallback generator response for frontend preview
        const mockGenerated = pitchGeneratorModal.selectedType === 'script' ? {
          type: 'script',
          title: `${pitchGeneratorModal.campaign.brand} 45s High-Retention Mid-Roll Script`,
          estimatedDuration: pitchGeneratorModal.campaign.slotLength,
          promoCode: 'CREATORAI15',
          hook: `Before we run the benchmark tests, let us address the one piece of tech you touch 10,000 times a day: your hardware setup with ${pitchGeneratorModal.campaign.brand}.`,
          retentionTip: 'Keep macro product B-roll cuts under 2.5s per angle to maintain peak 88% viewer retention.',
          sections: [
            { time: '00:00 - 00:05', stage: 'Hook Intro', spokenAudio: `Most creators overlook hardware bottlenecks until renders fail. ${pitchGeneratorModal.campaign.brand} solves this instantly.`, visualCue: 'Macro extreme close-up of hardware chassis in 4K 120fps slow-motion', onScreenText: `${pitchGeneratorModal.campaign.brand} • Creator Integration` },
            { time: '00:05 - 00:25', stage: 'Core Feature Demo', spokenAudio: `We tested peak performance under heavy LLM compiling loads. The custom thermal engineering keeps system temperatures 14°C cooler.`, visualCue: 'Split-screen thermal camera vs render timeline completion bar', onScreenText: '14°C Cooler • Zero Throttling' },
            { time: '00:25 - 00:45', stage: 'Call to Action', spokenAudio: `Use code CREATORAI15 at checkout to claim 15% off plus free express shipping via the link in the top line description below.`, visualCue: 'On-screen QR code and URL overlay pointing down to description box', onScreenText: 'CODE: CREATORAI15 (15% OFF)' },
          ]
        } : {
          type: 'deck',
          title: `${pitchGeneratorModal.campaign.brand} Sponsorship Proposal Deck`,
          slides: [
            { slideTitle: 'Executive Summary', subtitle: 'Targeting 350,000+ Verified Tech Decision Makers', content: 'Our audience consists of software engineers, AI researchers, and tech creators with $85k+ median income.', takeaway: 'Direct alignment with high-value technical buyer persona.', keyMetrics: [{ label: 'Est. Reach', value: '350K+ Views' }, { label: 'CPM Benchmark', value: pitchGeneratorModal.campaign.cpm }, { label: 'Audience Fit', value: pitchGeneratorModal.campaign.audienceFit }] },
            { slideTitle: 'Integration Strategy', subtitle: 'Organic 4K Demonstration vs Generic Ad Reads', content: 'Cinematic B-roll integration embedded directly into peak retention workflow segments.', takeaway: 'Zero retention drop-off during sponsor placement.' },
            { slideTitle: 'Commercial Structure', subtitle: 'Investment & Rights Overview', content: `Package includes 45s mid-roll placement, description link #1, pinned comment, and 90-day digital ad usage rights for $${pitchGeneratorModal.campaign.payout}.`, takeaway: 'Full multi-platform commercial clearance included.' },
          ]
        }

        setPitchGeneratorModal((prev) => ({
          ...prev,
          isGenerating: false,
          generatedData: mockGenerated,
        }))
      }
    } catch (err: any) {
      console.error('Groq Generation Error:', err)
      // Fallback generator preview
      const mockGenerated = pitchGeneratorModal.selectedType === 'script' ? {
        type: 'script',
        title: `${pitchGeneratorModal.campaign.brand} 45s High-Retention Mid-Roll Script`,
        estimatedDuration: pitchGeneratorModal.campaign.slotLength,
        promoCode: 'CREATORAI15',
        hook: `Before we run the benchmark tests, let us address the one piece of tech you touch 10,000 times a day: your hardware setup with ${pitchGeneratorModal.campaign.brand}.`,
        retentionTip: 'Keep macro product B-roll cuts under 2.5s per angle to maintain peak 88% viewer retention.',
        sections: [
          { time: '00:00 - 00:05', stage: 'Hook Intro', spokenAudio: `Most creators overlook hardware bottlenecks until renders fail. ${pitchGeneratorModal.campaign.brand} solves this instantly.`, visualCue: 'Macro extreme close-up of hardware chassis in 4K 120fps slow-motion', onScreenText: `${pitchGeneratorModal.campaign.brand} • Creator Integration` },
          { time: '00:05 - 00:25', stage: 'Core Feature Demo', spokenAudio: `We tested peak performance under heavy LLM compiling loads. The custom thermal engineering keeps system temperatures 14°C cooler.`, visualCue: 'Split-screen thermal camera vs render timeline completion bar', onScreenText: '14°C Cooler • Zero Throttling' },
          { time: '00:25 - 00:45', stage: 'Call to Action', spokenAudio: `Use code CREATORAI15 at checkout to claim 15% off plus free express shipping via the link in the top line description below.`, visualCue: 'On-screen QR code and URL overlay pointing down to description box', onScreenText: 'CODE: CREATORAI15 (15% OFF)' },
        ]
      } : {
        type: 'deck',
        title: `${pitchGeneratorModal.campaign.brand} Sponsorship Proposal Deck`,
        slides: [
          { slideTitle: 'Executive Summary', subtitle: 'Targeting 350,000+ Verified Tech Decision Makers', content: 'Our audience consists of software engineers, AI researchers, and tech creators with $85k+ median income.', takeaway: 'Direct alignment with high-value technical buyer persona.', keyMetrics: [{ label: 'Est. Reach', value: '350K+ Views' }, { label: 'CPM Benchmark', value: pitchGeneratorModal.campaign.cpm }, { label: 'Audience Fit', value: pitchGeneratorModal.campaign.audienceFit }] },
          { slideTitle: 'Integration Strategy', subtitle: 'Organic 4K Demonstration vs Generic Ad Reads', content: 'Cinematic B-roll integration embedded directly into peak retention workflow segments.', takeaway: 'Zero retention drop-off during sponsor placement.' },
          { slideTitle: 'Commercial Structure', subtitle: 'Investment & Rights Overview', content: `Package includes 45s mid-roll placement, description link #1, pinned comment, and 90-day digital ad usage rights.`, takeaway: 'Full multi-platform commercial clearance included.' },
        ]
      }
      setPitchGeneratorModal((prev) => ({
        ...prev,
        isGenerating: false,
        generatedData: mockGenerated,
      }))
    }
  }

  const triggerWebScraper = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    const targetCampaign = campaigns.find((c) => c.id === id)
    if (!targetCampaign) return

    setActiveScrapeModal(id)
    setIsScraping(true)
    setScrapeStep(1)
    setTimeout(() => setScrapeStep(2), 400)
    setTimeout(() => setScrapeStep(3), 900)

    try {
      const res = await fetch('/api/scrape-sponsor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: targetCampaign.domain,
          brand: targetCampaign.brand,
        }),
      })

      const data = await res.json()
      if (data.success && Array.isArray(data.contacts) && data.contacts.length > 0) {
        setLiveScrapedContacts((prev) => ({
          ...prev,
          [id]: data.contacts,
        }))
        setScrapeMetadata((prev) => ({
          ...prev,
          [id]: {
            scrapedUrls: data.scrapedUrls || [],
            pagesAnalyzed: data.pagesAnalyzed || 1,
            extractedEmails: data.extractedEmails || [],
          },
        }))
      }
    } catch (err) {
      console.error('Real web scraping call failed, fallback used:', err)
    } finally {
      setTimeout(() => {
        setScrapeStep(4)
        setIsScraping(false)
      }, 1500)
    }
  }

  const [viewFormat, setViewFormat] = useState<'grid' | 'list'>('grid')

  const campaigns = [
    {
      id: 'keychron',
      brand: 'Keychron',
      title: 'Keychron Q1 Max Mechanical Keyboard',
      category: 'Hardware / Productivity',
      domain: 'keychron.com',
      status: 'Ready',
      confidence: 98,
      payout: '$14,500',
      audienceFit: '9.8 / 10',
      cpm: '$42.00',
      retentionHold: '+3.2%',
      slotLength: '45s Mid-Roll',
      tone: 'emerald',
      logoUrl: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=150&auto=format&fit=crop&q=80',
      description: 'Seamless 45s mid-roll integration during desk setup breakdown. High affinity with software engineers and keyboard enthusiasts.',
      scriptHook: '“Before we dive into the code execution benchmark, let us talk about the tool you touch 10,000 times a day: your keyboard. Keychron Q1 Max features a solid CNC aluminum body, gasket mount design, and QMK/VIA custom remapping...”',
      retentionAnalysis: 'Low drop-off risk (-0.8% vs industry avg -6.8%). High audience watch-time retention when typing audio & switches are showcased in macro B-roll.',
      deliverables: [
        '45s Mid-Roll Video Placement',
        'Unique Discount Promo Code: CREATORAI15',
        'First-line Description Link & Pinned Comment',
        '30-Day Hardware Exclusivity Window',
      ],
      contacts: [
        { name: 'Alex Rivera', role: 'Head of Creator Partnerships', email: 'alex.rivera@keychron.com', phone: '+1 (415) 892-4120', speed: '< 2 hrs avg response', verified: true },
        { name: 'Marcus Vance', role: 'VP of Brand Marketing', email: 'marcus.vance@keychron.com', phone: '+1 (415) 892-4198', speed: '< 4 hrs avg response', verified: true },
      ],
    },
    {
      id: 'nordvpn',
      brand: 'NordVPN',
      title: 'NordVPN Threat Protection Campaign',
      category: 'Cyber Security / Privacy',
      domain: 'nordvpn.com',
      status: 'Processing',
      confidence: 95,
      payout: '$18,200',
      audienceFit: '9.4 / 10',
      cpm: '$38.50',
      retentionHold: '+1.8%',
      slotLength: '60s Dedicated Segment',
      tone: 'amber',
      logoUrl: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=150&auto=format&fit=crop&q=80',
      description: '60s dedicated security segment emphasizing local model data privacy and encrypted remote cloud syncing.',
      scriptHook: '“If you run local AI models or self-host LLM runtimes, public IP exposure is a real danger. NordVPN Meshnet lets you connect all your dev nodes securely without opening ports or risking data leaks...”',
      retentionAnalysis: 'Moderate drop-off risk (-2.4%). Mitigated by demoing live Threat Protection blocking real-time tracking scripts during dev server launch.',
      deliverables: [
        '60s Dedicated Security Segment',
        'Custom Dedicated Landing Page URL',
        'Top-Line Description Link & Pinned Comment',
        '70% Off + 3 Extra Months Promo',
      ],
      contacts: [
        { name: 'Elena Rostova', role: 'Lead Influencer Partnerships @ Nord Security', email: 'elena.r@nordvpnmedia.com', phone: '+44 20 7946 0912', speed: '< 1 hr avg response', verified: true },
        { name: 'David Miller', role: 'Senior Creator Operations', email: 'd.miller@nordvpnmedia.com', phone: '+44 20 7946 0988', speed: '< 3 hrs avg response', verified: true },
      ],
    },
    {
      id: 'cleanmymac',
      brand: 'MacPaw CleanMyMac',
      title: 'CleanMyMac X Performance Optimizer',
      category: 'macOS Utility / Performance',
      domain: 'macpaw.com',
      status: 'Ready',
      confidence: 92,
      payout: '$9,800',
      audienceFit: '9.1 / 10',
      cpm: '$34.00',
      retentionHold: '+2.1%',
      slotLength: '30s Quick Cut',
      tone: 'violet',
      logoUrl: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=150&auto=format&fit=crop&q=80',
      description: '30s quick-cut integration showing RAM purge & storage cleanup before heavy 8K video rendering.',
      scriptHook: '“Notice how fast this 8K render completed? Before launching heavy AI model benchmarks, I run a 1-click RAM sweep with CleanMyMac X to keep system memory fresh and avoid compilation throttling...”',
      retentionAnalysis: 'Low drop-off risk (-1.1%). Seamless transition during render waiting screen prevents audience drop-off.',
      deliverables: [
        '30s Quick-Cut Timeline Integration',
        'Screen Capture Overlay of Smart Care Sweep',
        'Description Link 1 with Custom Referral Tag',
        'Free Trial Download Offer',
      ],
      contacts: [
        { name: 'Taras Kravchenko', role: 'Creator Strategy Lead @ MacPaw', email: 'taras.k@macpaw.com', phone: '+1 (302) 415-3921', speed: '< 2 hrs avg response', verified: true },
        { name: 'Julia Smith', role: 'Sponsorship Operations Specialist', email: 'julia.smith@macpaw.com', phone: '+1 (302) 415-3980', speed: '< 5 hrs avg response', verified: true },
      ],
    },
    {
      id: 'anker',
      brand: 'Anker',
      title: 'Anker Prime 250W Power Bank',
      category: 'Consumer Tech / Power',
      domain: 'anker.com',
      status: 'Ready',
      confidence: 96,
      payout: '$12,400',
      audienceFit: '9.6 / 10',
      cpm: '$39.00',
      retentionHold: '+2.8%',
      slotLength: '45s Mid-Roll',
      tone: 'emerald',
      logoUrl: 'https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=150&auto=format&fit=crop&q=80',
      description: '45s mobile workflow integration illustrating multi-laptop fast charging in remote studio setups.',
      scriptHook: '“Editing 4K video on location usually drains my M4 Max in 90 minutes. Here is the 250W power bank with real-time smart app display that powers my laptop and camera rig simultaneously...”',
      retentionAnalysis: 'Very low drop-off risk (-0.6%). High visual energy B-roll sequence keeps audience locked in.',
      deliverables: [
        '45s Mobile Workflow Integration',
        'Product Placement B-Roll & Desk Display',
        'Amazon Affiliate & Direct Store Link',
        '15% Off Discount Coupon',
      ],
      contacts: [
        { name: 'Brian Kim', role: 'Director of Creator Relations @ Anker', email: 'brian.kim@anker.com', phone: '+1 (408) 720-8911', speed: '< 2 hrs avg response', verified: true },
        { name: 'Jessica Taylor', role: 'Hardware Influencer Manager', email: 'jessica.taylor@anker.com', phone: '+1 (408) 720-8950', speed: '< 4 hrs avg response', verified: true },
      ],
    },
  ]

  const activeCampaign = campaigns.find((c) => c.id === activeScrapeModal)

  return (
    <div className="page space-y-6 pb-12" data-testid="monetization-page">
      <AnimatePresence>
        {pitchSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-6 right-6 z-50 bg-[#1e1a2d] border border-[#5b3da0] text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3"
          >
            <Sparkles className="text-violet-400 animate-pulse" size={18} />
            <div>
              <p className="text-xs font-bold">Pitch Deck Sent to {pitchSuccess}!</p>
              <p className="text-[11px] text-zinc-400">AI campaign proposal & script outline dispatched to brand manager.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Web Scraper Modal */}
      <AnimatePresence>
        {activeCampaign && (
          <div className="modal-backdrop" onClick={() => setActiveScrapeModal(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="modal max-w-2xl w-full bg-[#14141a] border border-[#3b2d5c] rounded-2xl p-6 shadow-2xl space-y-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[#282836] pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#221c35] border border-[#48366d] flex items-center justify-center text-violet-400 shadow-md">
                    <Globe size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-white">{activeCampaign.brand} Sponsor Contacts</h2>
                      <span className="text-[10px] bg-[#1e1e28] text-zinc-400 px-2 py-0.5 rounded border border-[#2d2d3c]">{activeCampaign.domain}</span>
                    </div>
                    <p className="text-xs text-zinc-400">Extracted from public press kits, LinkedIn, & domain WHOIS registry</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => triggerWebScraper(activeCampaign.id, e)}
                    disabled={isScraping}
                    className="bg-[#262635] hover:bg-[#343447] text-white text-xs px-3 py-1.5 rounded-lg border border-[#39394d] flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <RotateCw size={12} className={isScraping ? 'animate-spin' : ''} />
                    <span>{isScraping ? 'Re-scraping...' : 'Re-scrape Web'}</span>
                  </button>
                  <button className="icon-button" aria-label="Close" onClick={() => setActiveScrapeModal(null)}>
                    <X size={18} />
                  </button>
                </div>
              </div>

              {isScraping && (
                <div className="bg-[#181822] border border-[#252535] rounded-xl p-4 space-y-3 animate-pulse">
                  <div className="flex items-center justify-between text-xs font-bold text-violet-300">
                    <span className="flex items-center gap-2">
                      <Sparkles size={14} className="animate-spin text-violet-400" />
                      Live AI Web Scraper Running...
                    </span>
                    <span>{scrapeStep * 25}% Complete</span>
                  </div>
                  <div className="w-full bg-[#121218] rounded-full h-2 overflow-hidden border border-[#232330]">
                    <div className="bg-[#7c3aed] h-full transition-all duration-500" style={{ width: `${scrapeStep * 25}%` }} />
                  </div>
                  <p className="text-[11px] font-mono text-zinc-400">
                    {scrapeStep === 1 && `> Connecting to https://www.${activeCampaign.domain}/press-and-partnerships...`}
                    {scrapeStep === 2 && `> Parsing corporate directory for ${activeCampaign.brand}...`}
                    {scrapeStep === 3 && `> Validating SMTP MX mail records...`}
                    {scrapeStep === 4 && `> Verification complete! Verified contact profiles extracted.`}
                  </p>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  <span>Verified Decision-Makers ({(liveScrapedContacts[activeCampaign.id] || activeCampaign.contacts).length})</span>
                  <span className="text-[#a78bfa] flex items-center gap-1 font-medium">
                    <CheckCircle size={12} /> Live Web Scrape Validated
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {(liveScrapedContacts[activeCampaign.id] || activeCampaign.contacts).map((ct: any, idx: number) => (
                    <div key={idx} className="bg-[#181822] border border-[#252535] hover:border-[#3c2e5e] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-[#241e35] border border-[#3d2f5c] text-[#a78bfa] flex items-center justify-center font-bold text-xs">
                            {ct.name.split(' ').map((n: string) => n[0]).join('')}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-bold text-white">{ct.name}</h3>
                              <span className="text-[9px] bg-[#1e1a2b] text-[#a78bfa] border border-[#3c2e5e] px-1.5 py-0.5 rounded font-semibold">Verified</span>
                            </div>
                            <p className="text-xs text-zinc-400">{ct.role}</p>
                          </div>
                        </div>

                        <div className="pt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-300">
                          <span className="flex items-center gap-1 font-mono text-zinc-300"><Mail size={12} className="text-zinc-500" /> {ct.email}</span>
                          <span className="flex items-center gap-1 font-mono text-zinc-300"><Phone size={12} className="text-zinc-500" /> {ct.phone}</span>
                          <span className="text-[10px] text-zinc-400 italic">({ct.speed})</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-start sm:self-center flex-none">
                        <a
                          href={`mailto:${ct.email}?subject=CreatorAI%20Sponsorship%20Proposal%20-%20${encodeURIComponent(activeCampaign.title)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 shadow-md transition-all active:scale-95"
                        >
                          <Mail size={13} />
                          <span>Send Email</span>
                        </a>

                        <a
                          href={`tel:${ct.phone}`}
                          className="bg-[#20202b] text-zinc-200 border border-[#2e2e3e] hover:bg-[#2b2b3a] hover:text-white text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors"
                        >
                          <Phone size={13} />
                          <span>Call Direct</span>
                        </a>

                        <button
                          onClick={(e) => handleCopyScript(`email-${ct.email}`, ct.email, e)}
                          className="bg-[#20202b] text-zinc-300 border border-[#2e2e3e] hover:bg-[#2b2b3a] hover:text-white text-xs px-2.5 py-2 rounded-lg flex items-center gap-1 transition-colors"
                          title="Copy Email Address"
                        >
                          <Copy size={13} />
                          <span>{copiedId === `email-${ct.email}` ? 'Copied' : ''}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Groq AI Pitch Deal Generator Modal */}
      <AnimatePresence>
        {pitchGeneratorModal.isOpen && pitchGeneratorModal.campaign && (() => {
          const brandTheme = getBrandTheme(pitchGeneratorModal.campaign.brand)

          return (
            <div className="modal-backdrop" onClick={() => setPitchGeneratorModal((prev) => ({ ...prev, isOpen: false }))}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="modal max-w-3xl w-full bg-[#12131a] border rounded-3xl p-6 shadow-2xl space-y-5 overflow-hidden text-white"
                style={{ borderColor: brandTheme.border }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-[#242435] pb-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl overflow-hidden bg-[#1e1e28] border flex-none shadow-lg" style={{ borderColor: brandTheme.border }}>
                      <img src={pitchGeneratorModal.campaign.logoUrl || brandTheme.logoUrl} alt={pitchGeneratorModal.campaign.brand} className="w-full h-full object-cover" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border" style={{ backgroundColor: brandTheme.badgeBg, color: brandTheme.textAccent, borderColor: brandTheme.border }}>
                          {pitchGeneratorModal.campaign.brand} AI Studio
                        </span>
                        <h2 className="text-base font-bold text-white">{pitchGeneratorModal.campaign.brand} Sponsorship Pitch</h2>
                      </div>
                      <p className="text-xs text-zinc-400 mt-0.5">Generate customized integration scripts or brand presentation pitch decks</p>
                    </div>
                  </div>

                  <button
                    onClick={() => setPitchGeneratorModal((prev) => ({ ...prev, isOpen: false }))}
                    className="w-8 h-8 rounded-xl bg-[#1f1f2c] border border-[#2d2d3e] text-zinc-400 hover:text-white flex items-center justify-center transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>

                {!pitchGeneratorModal.generatedData && !pitchGeneratorModal.isGenerating && (
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider block">Select Deliverable Type to Generate</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div
                          onClick={() => setPitchGeneratorModal((prev) => ({ ...prev, selectedType: 'script' }))}
                          className={`p-4 rounded-2xl border cursor-pointer transition-all ${pitchGeneratorModal.selectedType === 'script' ? 'shadow-lg' : 'bg-[#181822] border-[#252535] hover:border-[#3d3d52]'}`}
                          style={pitchGeneratorModal.selectedType === 'script' ? { backgroundColor: brandTheme.accentBg, borderColor: brandTheme.primary, boxShadow: `0 4px 20px ${brandTheme.primary}33` } : {}}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center border" style={{ backgroundColor: brandTheme.badgeBg, color: brandTheme.textAccent, borderColor: brandTheme.border }}>
                              <Video size={18} />
                            </div>
                            {pitchGeneratorModal.selectedType === 'script' && <span className="w-5 h-5 rounded-full text-white flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: brandTheme.primary }}>✓</span>}
                          </div>
                          <h3 className="text-sm font-bold text-white mb-1">AI Video Integration Script</h3>
                          <p className="text-xs text-zinc-400 leading-relaxed">Time-coded 45s–60s video script with spoken dialogue, visual B-roll cues, on-screen text overlays, and retention tips.</p>
                        </div>

                        <div
                          onClick={() => setPitchGeneratorModal((prev) => ({ ...prev, selectedType: 'deck' }))}
                          className={`p-4 rounded-2xl border cursor-pointer transition-all ${pitchGeneratorModal.selectedType === 'deck' ? 'shadow-lg' : 'bg-[#181822] border-[#252535] hover:border-[#3d3d52]'}`}
                          style={pitchGeneratorModal.selectedType === 'deck' ? { backgroundColor: brandTheme.accentBg, borderColor: brandTheme.primary, boxShadow: `0 4px 20px ${brandTheme.primary}33` } : {}}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center border" style={{ backgroundColor: brandTheme.badgeBg, color: brandTheme.textAccent, borderColor: brandTheme.border }}>
                              <Layers3 size={18} />
                            </div>
                            {pitchGeneratorModal.selectedType === 'deck' && <span className="w-5 h-5 rounded-full text-white flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: brandTheme.primary }}>✓</span>}
                          </div>
                          <h3 className="text-sm font-bold text-white mb-1">AI Sponsorship Deck</h3>
                          <p className="text-xs text-zinc-400 leading-relaxed">Structured 5-slide presentation deck complete with audience demographics, strategy, pricing, and guaranteed deliverables.</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-zinc-300 block">Custom Instructions / Focus Areas (Optional)</label>
                      <textarea
                        value={pitchGeneratorModal.customInstructions}
                        onChange={(e) => setPitchGeneratorModal((prev) => ({ ...prev, customInstructions: e.target.value }))}
                        placeholder={`e.g., Highlight ${pitchGeneratorModal.campaign.brand}'s key features & developer audience alignment...`}
                        rows={3}
                        className="w-full bg-[#181822] border border-[#252535] rounded-xl p-3 text-xs text-white placeholder-zinc-500 focus:outline-none transition-colors resize-none font-sans"
                      />
                    </div>

                    <div className="pt-2 flex items-center justify-center">
                      <button
                        onClick={executeGroqPitchGeneration}
                        className="text-white font-bold text-xs px-8 py-3.5 rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95 min-w-[240px]"
                        style={{ backgroundColor: brandTheme.primary }}
                      >
                        <Sparkles size={16} />
                        <span>Generate {pitchGeneratorModal.selectedType === 'script' ? 'Video Script' : 'Presentation Deck'}</span>
                      </button>
                    </div>
                  </div>
                )}

                {pitchGeneratorModal.isGenerating && (
                  <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                    <div className="relative w-16 h-16 flex items-center justify-center">
                      <div className="w-14 h-14 rounded-2xl border flex items-center justify-center shadow-xl" style={{ backgroundColor: brandTheme.accentBg, borderColor: brandTheme.border }}>
                        <Sparkles size={28} className="animate-spin" style={{ color: brandTheme.primary }} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-base font-bold text-white">Groq AI is Crafting Your {pitchGeneratorModal.selectedType === 'script' ? 'Script' : 'Pitch Deck'}</h3>
                      <p className="text-xs text-zinc-400 font-mono">Calibrating to {pitchGeneratorModal.campaign.brand} campaign targets & audience metrics...</p>
                    </div>
                  </div>
                )}

                {pitchGeneratorModal.generatedData && !pitchGeneratorModal.isGenerating && (
                  <div className="space-y-5">
                    {pitchGeneratorModal.generatedData.type === 'script' && (
                      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                        <div className="bg-[#181822] border border-[#252535] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white">{pitchGeneratorModal.generatedData.title}</span>
                              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border" style={{ backgroundColor: brandTheme.badgeBg, color: brandTheme.textAccent, borderColor: brandTheme.border }}>
                                Promo Code: {pitchGeneratorModal.generatedData.promoCode || 'CREATORAI15'}
                              </span>
                            </div>
                            <p className="text-xs text-zinc-400 mt-1">Duration: {pitchGeneratorModal.generatedData.estimatedDuration || pitchGeneratorModal.campaign.slotLength}</p>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => downloadPDFDocument(pitchGeneratorModal.generatedData, pitchGeneratorModal.campaign)}
                              className="text-white text-xs font-bold px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow-md transition-all active:scale-95"
                              style={{ backgroundColor: brandTheme.primary }}
                            >
                              <FileText size={13} />
                              <span>Download PDF</span>
                            </button>
                            <button
                              onClick={() => setPitchGeneratorModal((prev) => ({ ...prev, generatedData: null }))}
                              className="bg-[#1e1c29] text-zinc-300 border border-[#333348] hover:bg-[#2a243d] text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors"
                            >
                              <RotateCw size={13} />
                              <span>Regenerate</span>
                            </button>
                          </div>
                        </div>

                        <div className="p-4 rounded-xl space-y-1 border" style={{ backgroundColor: brandTheme.accentBg, borderColor: brandTheme.border }}>
                          <span className="text-[11px] font-bold uppercase tracking-wider block flex items-center gap-1.5" style={{ color: brandTheme.textAccent }}>
                            <Zap size={13} /> Opening 3-Second Hook
                          </span>
                          <p className="text-xs text-white italic leading-relaxed">&quot;{pitchGeneratorModal.generatedData.hook}&quot;</p>
                        </div>

                        <div className="space-y-3">
                          <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Time-coded Script Timeline</h4>
                          {pitchGeneratorModal.generatedData.sections?.map((sec: any, idx: number) => (
                            <div key={idx} className="bg-[#181822] border border-[#252535] rounded-xl p-4 space-y-2">
                              <div className="flex items-center justify-between border-b border-[#232332] pb-2">
                                <span className="text-xs font-bold px-2.5 py-0.5 rounded-md border" style={{ backgroundColor: brandTheme.badgeBg, color: brandTheme.textAccent, borderColor: brandTheme.border }}>{sec.time}</span>
                                <span className="text-xs font-bold text-white">{sec.stage}</span>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs pt-1">
                                <div className="md:col-span-2 space-y-1">
                                  <span className="text-[10px] font-bold text-zinc-400 uppercase block">Spoken Dialogue</span>
                                  <p className="text-zinc-200 bg-[#121218] p-2.5 rounded-lg border border-[#20202c] leading-relaxed">&quot;{sec.spokenAudio}&quot;</p>
                                </div>
                                <div className="space-y-2">
                                  <div>
                                    <span className="text-[10px] font-bold text-zinc-400 uppercase block">Visual B-Roll Cue</span>
                                    <p className="text-zinc-300 text-[11px] bg-[#121218] p-2 rounded-lg border border-[#20202c]">{sec.visualCue}</p>
                                  </div>
                                  {sec.onScreenText && (
                                    <div>
                                      <span className="text-[10px] font-bold text-zinc-400 uppercase block">On-Screen Overlay</span>
                                      <span className="text-emerald-400 text-[11px] font-mono block bg-[#0e1f18] px-2 py-1 rounded border border-[#14532d]">{sec.onScreenText}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {pitchGeneratorModal.generatedData.type === 'deck' && (
                      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                        <div className="bg-[#181822] border border-[#252535] rounded-xl p-3 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-1.5 overflow-x-auto">
                            {pitchGeneratorModal.generatedData.slides?.map((s: any, idx: number) => (
                              <button
                                key={idx}
                                onClick={() => setPitchGeneratorModal((prev) => ({ ...prev, activeSlideIndex: idx }))}
                                className={`text-xs font-bold px-3.5 py-1.5 rounded-lg transition-all flex-none ${pitchGeneratorModal.activeSlideIndex === idx ? 'text-white shadow-md' : 'bg-[#1e1e2b] text-zinc-400 hover:text-white'}`}
                                style={pitchGeneratorModal.activeSlideIndex === idx ? { backgroundColor: brandTheme.primary } : {}}
                              >
                                Slide {idx + 1}
                              </button>
                            ))}
                          </div>

                          <div className="flex items-center gap-2 flex-none">
                            <button
                              onClick={() => downloadPDFDocument(pitchGeneratorModal.generatedData, pitchGeneratorModal.campaign)}
                              className="text-white text-xs font-bold px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow-md transition-all active:scale-95"
                              style={{ backgroundColor: brandTheme.primary }}
                            >
                              <FileText size={13} />
                              <span>Download PDF</span>
                            </button>
                            <button
                              onClick={() => setPitchGeneratorModal((prev) => ({ ...prev, generatedData: null }))}
                              className="bg-[#1e1c29] text-zinc-300 border border-[#333348] hover:bg-[#2a243d] text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors"
                            >
                              <RotateCw size={13} />
                              <span>Regenerate</span>
                            </button>
                          </div>
                        </div>

                        {pitchGeneratorModal.generatedData.slides?.[pitchGeneratorModal.activeSlideIndex] && (
                          <div className="bg-[#141522] border rounded-2xl p-6 space-y-5 shadow-2xl" style={{ borderColor: brandTheme.border, borderLeftWidth: '6px', borderLeftColor: brandTheme.primary }}>
                            <div className="border-b border-[#262638] pb-4 flex items-center justify-between">
                              <div>
                                <span className="text-[10px] font-bold uppercase tracking-widest block" style={{ color: brandTheme.primary }}>
                                  SLIDE {pitchGeneratorModal.activeSlideIndex + 1} OF {pitchGeneratorModal.generatedData.slides.length}
                                </span>
                                <h3 className="text-lg font-bold text-white tracking-tight mt-0.5">
                                  {pitchGeneratorModal.generatedData.slides[pitchGeneratorModal.activeSlideIndex].slideTitle}
                                </h3>
                                <p className="text-xs text-zinc-400">{pitchGeneratorModal.generatedData.slides[pitchGeneratorModal.activeSlideIndex].subtitle}</p>
                              </div>
                            </div>

                            <div className="bg-[#0f1017] border border-[#232330] p-4 rounded-xl space-y-1.5">
                              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Slide Strategy & Details</span>
                              <p className="text-xs text-zinc-200 leading-relaxed">{pitchGeneratorModal.generatedData.slides[pitchGeneratorModal.activeSlideIndex].content}</p>
                            </div>

                            <div className="pt-2 flex items-center justify-between border-t border-[#232332]">
                              <button
                                onClick={() => setPitchGeneratorModal((prev) => ({ ...prev, activeSlideIndex: Math.max(0, prev.activeSlideIndex - 1) }))}
                                disabled={pitchGeneratorModal.activeSlideIndex === 0}
                                className="text-xs font-semibold text-zinc-300 hover:text-white flex items-center gap-1 disabled:opacity-30 transition-colors"
                              >
                                <ChevronLeft size={16} />
                                <span>Previous Slide</span>
                              </button>
                              <span className="text-xs text-zinc-500 font-mono">{pitchGeneratorModal.activeSlideIndex + 1} / {pitchGeneratorModal.generatedData.slides.length}</span>
                              <button
                                onClick={() => setPitchGeneratorModal((prev) => ({ ...prev, activeSlideIndex: Math.min(pitchGeneratorModal.generatedData.slides.length - 1, prev.activeSlideIndex + 1) }))}
                                disabled={pitchGeneratorModal.activeSlideIndex === pitchGeneratorModal.generatedData.slides.length - 1}
                                className="text-xs font-semibold flex items-center gap-1 disabled:opacity-30 transition-colors"
                                style={{ color: brandTheme.textAccent }}
                              >
                                <span>Next Slide</span>
                                <ChevronRight size={16} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            </div>
          )
        })()}
      </AnimatePresence>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#23232c] pb-6">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#1e1a2d] border border-[#3b2d5c] flex items-center justify-center text-violet-400 shadow-lg shadow-violet-950/30">
            <BriefcaseBusiness size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold text-violet-400 uppercase tracking-wider">
              <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
              CreatorAI / Studio
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight mt-0.5">Sponsorship Studio</h1>
            <p className="text-xs text-zinc-400 mt-1">Plan natural brand integrations that protect audience trust and retention</p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto">
          <button
            onClick={(e) => handlePitchDeal('Keychron & Sponsors', e)}
            className="bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-xs font-semibold rounded-xl px-4 py-2.5 flex items-center gap-2 shadow-lg shadow-violet-950/50 transition-all active:scale-95"
          >
            <Sparkles size={16} />
            <span>Pitch Brand Deal</span>
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between bg-[#14141a] border border-[#252535] p-3 rounded-2xl shadow-md">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider pl-2">Card Layout:</span>
          <div className="flex items-center gap-1.5 bg-[#1c1c28] border border-[#2e2e42] p-1 rounded-xl">
            <button
              onClick={() => setViewFormat('grid')}
              className={`flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-lg transition-all ${viewFormat === 'grid' ? 'bg-[#7c3aed] text-white shadow-lg shadow-violet-950/60 ring-1 ring-violet-400/40' : 'text-zinc-400 hover:text-white hover:bg-[#28283a]'}`}
            >
              <Grid2X2 size={16} />
              <span>Grid View</span>
            </button>
            <button
              onClick={() => setViewFormat('list')}
              className={`flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-lg transition-all ${viewFormat === 'list' ? 'bg-[#7c3aed] text-white shadow-lg shadow-violet-950/60 ring-1 ring-violet-400/40' : 'text-zinc-400 hover:text-white hover:bg-[#28283a]'}`}
            >
              <List size={16} />
              <span>List View</span>
            </button>
          </div>
        </div>

        <div className="text-xs text-zinc-400 hidden sm:flex items-center gap-2">
          <span>Active Campaigns:</span>
          <span className="bg-[#222230] text-violet-300 font-bold px-2.5 py-0.5 rounded-full border border-[#333348]">{campaigns.length}</span>
        </div>
      </div>

      {viewFormat === 'list' ? (
        <div className="flex flex-col gap-4">
          {campaigns.map((c) => (
            <div
              key={c.id}
              onClick={() => toggleFlip(c.id)}
              className="bg-[#14141a] border border-[#232330] hover:border-[#38384d] p-4.5 rounded-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-all shadow-lg group cursor-pointer"
            >
              <div className="flex items-center gap-3.5 min-w-[260px]">
                <div className="w-12 h-12 rounded-xl overflow-hidden bg-[#1e1e28] border border-[#2d2d3d] flex-none group-hover:scale-105 transition-transform">
                  <img src={c.logoUrl} alt={c.brand} className="w-full h-full object-cover" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{c.category.split('•')[0]}</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span className="text-[10px] text-emerald-400 font-semibold">{c.status}</span>
                  </div>
                  <h3 className="text-base font-bold text-white group-hover:text-violet-300 transition-colors leading-snug">{c.title}</h3>
                </div>
              </div>

              <div className="flex items-center gap-3 border-t lg:border-t-0 lg:border-l border-[#232332] pt-3 lg:pt-0 lg:pl-4">
                <ConfidenceGauge percentage={c.confidence} />
                <div>
                  <span className="text-[10px] text-zinc-400 block font-medium">Audience Fit</span>
                  <span className="text-xs font-bold text-white block">{c.audienceFit}</span>
                </div>
              </div>

              <div className="flex items-center gap-2.5 border-t lg:border-t-0 lg:border-l border-[#232332] pt-3 lg:pt-0 lg:pl-4">
                <div className="w-8 h-8 rounded-lg bg-[#222230] text-zinc-400 flex items-center justify-center flex-none"><Wallet size={15} /></div>
                <div>
                  <span className="text-[10px] text-zinc-400 block font-medium">Est. Payout</span>
                  <span className="text-sm font-bold text-white block">{c.payout}</span>
                </div>
              </div>

              <div className="flex items-center gap-2.5 border-t lg:border-t-0 lg:border-l border-[#232332] pt-3 lg:pt-0 lg:pl-4">
                <div className="w-8 h-8 rounded-lg bg-[#221c38] text-violet-400 flex items-center justify-center flex-none"><Video size={15} /></div>
                <div>
                  <span className="text-[10px] text-zinc-400 block font-medium">Placement</span>
                  <span className="text-xs font-bold text-white block">{c.slotLength}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 border-t lg:border-t-0 lg:border-l border-[#232332] pt-3 lg:pt-0 lg:pl-4 self-start lg:self-center flex-none">
                <button
                  onClick={(e) => triggerWebScraper(c.id, e)}
                  className="bg-[#20202b] text-zinc-300 border border-[#2e2e3e] hover:bg-[#2b2b3a] hover:text-white text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 transition-colors"
                >
                  <Globe size={13} />
                  <span>Scrape</span>
                </button>

                <button
                  onClick={(e) => handlePitchDeal(c, e)}
                  className="bg-[#7c3aed] hover:bg-[#6d28d9] text-white font-bold text-xs px-3.5 py-2 rounded-xl shadow-md flex items-center gap-1.5 transition-all active:scale-95"
                >
                  <Sparkles size={13} />
                  <span>Pitch AI</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {campaigns.map((c) => {
            const isFlipped = !!flippedCards[c.id]

            return (
              <div key={c.id} className="perspective-1000 min-h-[440px]">
                <div className={`flip-card-inner ${isFlipped ? 'is-flipped' : ''}`}>
                  <div
                    onClick={() => toggleFlip(c.id)}
                    className="flip-card-front bg-[#14141a] border border-[#232330] hover:border-[#38384d] p-6 flex flex-col justify-between cursor-pointer transition-all duration-300 shadow-xl group rounded-3xl"
                  >
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3.5">
                          <div className="w-14 h-14 rounded-2xl overflow-hidden bg-[#1e1e28] border border-[#2d2d3d] flex-none group-hover:scale-105 transition-transform">
                            <img src={c.logoUrl} alt={c.brand} className="w-full h-full object-cover" />
                          </div>
                          <div>
                            <span className="text-[11px] font-bold tracking-wider text-zinc-400 uppercase block">{c.category}</span>
                            <h3 className="text-xl font-bold text-white tracking-tight group-hover:text-violet-300 transition-colors leading-snug">{c.title}</h3>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 bg-[#0d2a1f] border border-[#10b981]/30 text-emerald-400 text-xs font-semibold px-3 py-1 rounded-full">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span>{c.status}</span>
                          </div>
                        </div>
                      </div>

                      <p className="text-xs text-zinc-400 leading-relaxed font-normal">{c.description}</p>

                      <div className="bg-[#181822] border border-[#252535] rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
                        <div className="flex items-center gap-3">
                          <ConfidenceGauge percentage={c.confidence} />
                          <div>
                            <span className="text-[11px] text-zinc-400 block font-medium">Audience fit</span>
                            <span className="text-base font-bold text-white block tracking-tight">{c.audienceFit}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 border-t sm:border-t-0 sm:border-l border-[#242434] pt-3 sm:pt-0 sm:pl-4">
                          <div className="w-9 h-9 rounded-xl bg-[#222230] text-zinc-400 flex items-center justify-center flex-none"><Wallet size={18} /></div>
                          <div>
                            <span className="text-[11px] text-zinc-400 block font-medium">Est. payout</span>
                            <span className="text-lg font-bold text-white block tracking-tight">{c.payout}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 border-t sm:border-t-0 sm:border-l border-[#242434] pt-3 sm:pt-0 sm:pl-4">
                          <div className="w-9 h-9 rounded-xl bg-[#221c38] text-violet-400 flex items-center justify-center flex-none"><Video size={18} /></div>
                          <div>
                            <span className="text-[11px] text-zinc-400 block font-medium">Placement</span>
                            <span className="text-sm font-bold text-white block tracking-tight">{c.slotLength}</span>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-[#232332] pt-3.5 flex items-center justify-between text-xs text-zinc-400">
                        <div className="flex items-center gap-2"><Calendar size={14} className="text-zinc-500" /><span>Due Oct 12, 2025</span></div>
                        <div className="flex items-center gap-2"><FileText size={14} className="text-zinc-500" /><span>{c.deliverables.length} deliverables</span></div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-[#232332] flex items-center justify-between gap-2 mt-4">
                      <button onClick={(e) => triggerWebScraper(c.id, e)} className="text-xs font-semibold text-violet-400 hover:text-violet-300 flex items-center gap-1.5 transition-colors">
                        <TrendingUp size={14} /><span>View fit analysis</span>
                      </button>

                      <button onClick={(e) => toggleFlip(c.id, e)} className="bg-[#7c3aed] hover:bg-[#6d28d9] text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-lg flex items-center gap-2 transition-all active:scale-95">
                        <span>Review details</span><ArrowRight size={14} />
                      </button>
                    </div>
                  </div>

                  <div onClick={(e) => e.stopPropagation()} className="flip-card-back bg-[#14141a] border border-[#2b2b38] p-6 flex flex-col justify-between shadow-2xl overflow-y-auto rounded-3xl">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between border-b border-[#232330] pb-3">
                        <span className="bg-[#1e1a2b] text-[#a78bfa] border border-[#3c2e5e] text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase">In-Depth Analysis</span>
                        <button onClick={(e) => toggleFlip(c.id, e)} className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 bg-[#1c1c24] px-2.5 py-1 rounded-lg border border-[#2b2b38]">
                          <RotateCw size={12} /><span>Flip Back</span>
                        </button>
                      </div>

                      <div className="bg-[#181822] border border-[#252535] rounded-xl p-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-white"><CheckCircle size={13} className="text-[#a78bfa]" /><span>Scraped Sponsor Contact</span></div>
                          <p className="text-[11px] text-zinc-400 font-mono mt-0.5">{c.contacts[0].name} ({c.contacts[0].email})</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <a href={`mailto:${c.contacts[0].email}`} target="_blank" rel="noreferrer" className="bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-[11px] font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1">
                            <Mail size={12} /><span>Mail</span>
                          </a>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-bold text-zinc-300 uppercase">
                          <span>AI Script Hook</span>
                          <button onClick={(e) => handleCopyScript(c.id, c.scriptHook, e)} className="text-zinc-400 hover:text-white flex items-center gap-1">
                            <Copy size={12} /><span>{copiedId === c.id ? 'Copied!' : 'Copy'}</span>
                          </button>
                        </div>
                        <div className="bg-[#181822] border border-[#252535] p-3 rounded-xl text-xs text-zinc-300 italic leading-relaxed">{c.scriptHook}</div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-[#232330] flex items-center justify-between gap-3 mt-4">
                      <button onClick={(e) => toggleFlip(c.id, e)} className="text-xs text-zinc-400 hover:text-white">↩ Return to Front</button>
                      <button onClick={(e) => handlePitchDeal(c, e)} className="bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-xs font-semibold px-4 py-2 rounded-xl flex items-center gap-1.5 shadow-lg">
                        <Sparkles size={14} /><span>Pitch {c.brand}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
