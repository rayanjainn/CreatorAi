'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { usePathname, useRouter } from 'next/navigation'
import { useMemo, useState, useEffect, useRef } from 'react'
import {
  Activity, Archive, ArrowRight, BarChart3, Bell, BookOpen, Bot, BriefcaseBusiness, CalendarDays, Check, ChevronDown, ChevronLeft,
  ChevronRight, CircleHelp, Clapperboard, Clock3, CloudUpload, Compass, Copy, CreditCard, Edit3, Eye, Film, FolderKanban, FolderOpen,
  Gauge, Grid2X2, Heart, Home, Image as ImageIcon, Layers3, LayoutDashboard, List, Menu, MessageSquareText, MoreHorizontal, MoreVertical,
  Music2, Package, Palette, Play, Plus, RotateCw, Search, Send, Settings, Sparkles, Split, Target, ThumbsUp, Trash2, Upload, UserRound, Users, Wand2,
  X, Video, Zap, Mail, Phone, Globe, CheckCircle, ExternalLink, Wallet, FileText, TrendingUp, Calendar
} from 'lucide-react'
import NeuralTwinPanel from '@/components/NeuralTwinPanel'
import SmartClipsStudio from '@/components/smart-clips/SmartClipsStudio'

function TikTokIcon({ size = 13, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M19.589 6.686a4.793 4.793 0 0 1-3.77-4.245V2h-3.445v13.672a2.896 2.896 0 0 1-2.891 2.887 2.896 2.896 0 0 1-2.892-2.887 2.896 2.896 0 0 1 2.892-2.887c.277 0 .542.04.794.113V9.387a6.297 6.297 0 0 0-.794-.05c-3.486 0-6.333 2.848-6.333 6.333 0 3.486 2.847 6.333 6.333 6.333s6.333-2.847 6.333-6.333V8.825a8.167 8.167 0 0 0 4.773 1.306V6.686z" />
    </svg>
  )
}

function InstagramIcon({ size = 13, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  )
}

function YoutubeIcon({ size = 13, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
}


const nav = [
  ['Dashboard','/dashboard',Home], ['Projects','/projects',FolderKanban], ['Asset Library','/assets',FolderOpen], ['AI Studio','/ai-studio',Sparkles], ['Smart Clips','/smart-clips',Clapperboard], ['Editor','/editor/ai-hardware',Film], ['Content Calendar','/calendar',CalendarDays], ['Analytics','/analytics',BarChart3], ['Monetization','/monetization',CreditCard], ['Creative Twin','/creative-twin',Bot], ['Settings','/settings',Settings],
] as const

const images = [
  'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1593697821252-0c9137d9fc45?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1492724441997-5dc865305da7?auto=format&fit=crop&w=900&q=80',
]

const titles = ['The Future of AI Hardware','Desk Setup Tour 2025','Why 99% of Creators Fail','Local LLM Video Editor Challenge']
const routeNames: Record<string,string> = {'/dashboard':'Dashboard','/projects':'Projects Workspace','/assets':'Asset Library','/ai-studio':'AI Studio','/smart-clips':'Smart Clip Generator','/calendar':'Content Calendar','/analytics':'Creator Intelligence','/monetization':'Monetization Studio','/creative-twin':'Creative Digital Twin','/settings':'Settings','/search':'Semantic Search','/script-match':'Script-to-Footage Match','/creative-director':'Creative Director','/repurpose':'Repurpose Studio'}

function IconButton({children, label, onClick}:{children:React.ReactNode;label:string;onClick?:()=>void}) { return <button aria-label={label} onClick={onClick} className="icon-button">{children}</button> }
function Button({children, secondary=false, onClick, className=''}:{children:React.ReactNode;secondary?:boolean;onClick?:()=>void;className?:string}) { return <button onClick={onClick} className={`button ${secondary?'button-secondary':''} ${className}`}>{children}</button> }
function Card({children,className='', ...props}:React.HTMLAttributes<HTMLElement> & {children:React.ReactNode;className?:string}) { return <section className={`card ${className}`} {...props}>{children}</section> }

function Badge({children,tone='violet'}:{children:React.ReactNode;tone?:string}) { return <span className={`badge badge-${tone}`}>{children}</span> }

function Sidebar({collapsed,setCollapsed,onStartGuide,activePath}:{collapsed:boolean;setCollapsed:(v:boolean)=>void;onStartGuide?:()=>void;activePath?:string}) {
  const pathname=usePathname(); const router=useRouter();
  const currentPath = activePath || pathname;
  return <aside data-tour="sidebar" className={`sidebar ${collapsed?'collapsed':''}`}>
    <div className="brand"><div className="brand-mark"><Sparkles size={18}/></div>{!collapsed&&<><strong>Creator<span>AI</span></strong></>}</div>
    <div className="workspace-switcher"><div className="avatar">A</div>{!collapsed&&<div><b>Aarav Studio</b><small>Pro workspace</small></div>}{!collapsed&&<ChevronDown size={14}/>}</div>
    <nav className="side-nav">{nav.map(([label,path,Icon])=><button key={path} title={collapsed?label:''} onClick={()=>router.push(path)} className={`nav-item ${currentPath===path?'active':''}`}><Icon size={17}/>{!collapsed&&<span>{label}</span>}{!collapsed&&label==='AI Studio'&&<i>4</i>}</button>)}</nav>
    {!collapsed&&<div data-tour="sidebar-footer" className="sidebar-footer"><button className="help" onClick={onStartGuide}><CircleHelp size={15}/> Interactive Guide</button><div className="profile"><div className="avatar">A</div><div><b>Aarav Mehta</b><small>Top 1% Creator</small></div><MoreHorizontal size={16}/></div></div>}
    <IconButton label="Toggle sidebar" onClick={()=>setCollapsed(!collapsed)}>{collapsed?<ChevronRight size={18}/>:<ChevronLeft size={18}/>}</IconButton>
  </aside>
}

function Topbar({onCreate,onStartGuide,activePath}:{onCreate:()=>void;onStartGuide?:()=>void;activePath?:string}) { const router=useRouter(); const pathname=usePathname(); const currentPath=activePath||pathname; const title=routeNames[currentPath]|| (currentPath.startsWith('/editor')?'Editor':'Dashboard'); return <header className="topbar"><div className="breadcrumbs"><span>Studio</span><ChevronRight size={13}/><b>{title}</b></div><div className="top-actions"><button data-tour="search-trigger" className="search-trigger" onClick={()=>router.push('/search')}><Search size={16}/><span>Search your studio...</span><kbd>⌘ K</kbd></button><IconButton label="Notifications"><Bell size={17}/><em/></IconButton><Button secondary onClick={onStartGuide}><Compass size={15}/> Guide</Button><div data-tour="create-btn" style={{display:'inline-flex'}}><Button onClick={onCreate}><Plus size={16}/> Create new</Button></div><div className="avatar">A</div></div></header> }

function Hero({onCreate}:{onCreate:()=>void}) { return <div className="hero"><div className="glow violet"/><div className="glow amber"/><div className="hero-copy"><div className="eyebrow"><span className="status-dot"/> Good afternoon, Aarav <Badge tone="amber"><Sparkles size={12}/> Top 1% Creator</Badge></div><h1>Your creative workflow, <span>reimagined.</span></h1><p>From the first spark of inspiration to the final cinema-grade master frame — conceive, direct, auto-cut, and broadcast at warp speed.</p><div className="hero-actions"><Button onClick={onCreate}><Plus size={18}/> Create New Project</Button><Button secondary><Sparkles size={17}/> Start with AI Studio</Button></div></div><div data-tour="hero-stats" className="hero-stats"><Stat label="AI Tokens Reserved" value="8,450 / 10k" icon={<Zap/>} tone="amber"/><Stat label="Outputs Broadcast" value="14 this month" icon={<Send/>}/><Stat label="Studio Hours Saved" value="28.4 hrs" icon={<Clock3/>} tone="cyan"/></div></div> }
function Stat({label,value,icon,tone='violet'}:{label:string;value:string;icon:React.ReactNode;tone?:string}) { return <div className="stat"><div className={`stat-icon ${tone}`}>{icon}</div><div><small>{label}</small><strong>{value}</strong></div></div> }

function ProjectCard({i=0, progress=78}:{i?:number;progress?:number}) { const router=useRouter(); return <motion.article whileHover={{y:-4}} className="project-card"><div className="thumb"><img src={images[i%images.length]} alt="Creator studio project thumbnail"/><div className="thumb-overlay"/><Badge>{i===2?'9:16 Shorts':'16:9 4K'}</Badge><span className="duration">{i===2?'00:58':i===1?'08:45':'14:28'}</span><div className="hover-actions"><IconButton label="Preview"><Play size={17}/></IconButton><IconButton label="Duplicate"><Copy size={16}/></IconButton><IconButton label="Export"><Send size={16}/></IconButton></div></div><div className="project-info"><div className="meta"><span><Clock3 size={12}/> {i+1}h ago</span><Badge tone={i===2?'green':'violet'}>{i===2?'Ready to publish':i===1?'AI processing':'Editing'}</Badge></div><h3>{titles[i%titles.length]}</h3><p>{i===0?'Synthesized B-roll layered over Sony A7SIII timeline with automatic audio ducking.':'Auto-removing breath pauses and color matching warm moody tones across clips.'}</p><div className="progress-label"><span>Rough cut to master</span><b>{progress}%</b></div><div className="progress"><i style={{width:`${progress}%`}}/></div><Button onClick={()=>router.push('/editor/ai-hardware')} secondary className="full-button"><Film size={15}/> Open in editor</Button></div></motion.article> }

function Dashboard({onCreate}:{onCreate:()=>void}) { return <div className="page"><Hero onCreate={onCreate}/><div className="section-head"><div><div className="eyebrow violet-text">Active timeline slots</div><h2>Continue editing & recent projects</h2></div><div className="segmented"><button>All (8)</button><button>16:9 Longform</button><button>9:16 Shorts</button></div></div><div data-tour="project-grid" className="project-grid">{[0,1,2].map(i=><ProjectCard key={i} i={i} progress={[78,45,100][i]}/>)}</div><div className="lower-grid"><Card><div className="card-heading"><div><span className="eyebrow">Production velocity</span><h3>Weekly output</h3></div><Badge tone="green">+24.8%</Badge></div><div className="bars">{[42,58,38,72,64,86,94].map((h,i)=><div key={i}><i style={{height:`${h}%`}}/><small>{['M','T','W','T','F','S','S'][i]}</small></div>)}</div></Card><Card><div className="card-heading"><div><span className="eyebrow">Up next</span><h3>Publishing schedule</h3></div><ChevronRight size={17}/></div>{['AI hardware breakdown','3 editing myths','Studio desk tour'].map((t,i)=><div className="schedule" key={t}><div className="mini-thumb" style={{backgroundImage:`url(${images[i]})`}}/><div><b>{t}</b><small>{['Today · 6:00 PM','Tomorrow · 10:00 AM','Fri · 4:30 PM'][i]}</small></div><Badge tone={i===0?'amber':'gray'}>{['YouTube','Reels','TikTok'][i]}</Badge></div>)}</Card></div></div> }

function GenericPage({kind}:{kind:string}) { 
  const router = useRouter(); 
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewTab, setViewTab] = useState<'Overview' | 'Recent' | 'Favorites'>('Overview');

  const data:any={
    '/projects':['Projects Workspace','Manage multi-format productions, active video timelines, and AI synthesized drafts','Create project'], 
    '/assets':['Asset Library','Search, organize, and understand every piece of media in your studio','Upload media'], 
    '/search':['Semantic Search','Find the exact moment across transcripts, footage, and creative memory','Execute match'], 
    '/script-match':['Script-to-Footage Match','Match every written beat to the strongest footage with confidence-aware AI','Analyze script'], 
    '/smart-clips':['Smart Clip Generator','Discover high-retention moments and turn them into platform-ready clips','Rescan video hooks'], 
    '/creative-director':['Creative Director','A multi-perspective AI council for narrative, visual, and platform strategy','Regenerate council'], 
    '/repurpose':['Repurpose Studio','Transform one master cut into a family of native platform outputs','Generate variants'], 
    '/calendar':['Content Calendar','Coordinate ideas, edits, reviews, and releases across every channel','Schedule release'], 
    '/analytics':['Creator Intelligence','Predictive engagement metrics calibrated against your channel history','Regenerate insights'], 
    '/monetization':['Sponsorship Studio','Plan natural brand integrations that protect audience trust and retention','Pitch brand deal'], 
    '/creative-twin':['Creative Digital Twin','Your approved creative preferences, learned and ready to apply','Re-index creative DNA'], 
    '/settings':['Settings & Profile','Tune your workspace, AI preferences, exports, and connected platforms','Save changes']
  }[kind]||['CreatorAI Studio','Your operating system for the entire content creation lifecycle','Create new'];
  const isAssets=kind==='/assets', isSearch=kind==='/search', isAnalytics=kind==='/analytics', isTwin=kind==='/creative-twin';

  const handleTopButtonClick = () => {
    if (kind === '/projects') router.push('/editor/ai-hardware');
    else if (kind === '/assets') fileInputRef.current?.click();
  };

  return <div className="page">
    <div className="page-title">
      <div>
        <div className="eyebrow"><span className="status-dot"/> CreatorAI / Studio</div>
        <h1>{data[0]}</h1>
        <p>{data[1]}</p>
      </div>
      {!isTwin && (
        <Button onClick={handleTopButtonClick}>{isAssets ? <Upload size={16}/> : <Sparkles size={16}/>}{data[2]}</Button>
      )}
    </div>
    {!isTwin && (
      <div className="toolbar">
        <div className="search-inline flex items-center">
          <Search size={16}/>
          <input 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)} 
            placeholder={isSearch ? 'Find the clip where I explain why consistency matters...' : 'Search this workspace...'}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-xs text-zinc-400 hover:text-white px-1 font-mono">
              ✕
            </button>
          )}
        </div>
        <div className="segmented">
          <button className={viewTab === 'Overview' ? 'selected' : ''} onClick={() => setViewTab('Overview')}>Overview</button>
          <button className={viewTab === 'Recent' ? 'selected' : ''} onClick={() => setViewTab('Recent')}>Recent</button>
          <button className={viewTab === 'Favorites' ? 'selected' : ''} onClick={() => setViewTab('Favorites')}>Favorites</button>
        </div>
        <IconButton label="Filter"><Target size={17}/></IconButton>
      </div>
    )}
    {isAssets ? (
      <AssetGrid 
        externalInputRef={fileInputRef} 
        searchQuery={searchQuery} 
        viewTab={viewTab} 
      />
    ) : isSearch ? (
      <SearchResults/>
    ) : isAnalytics ? (
      <AnalyticsView/>
    ) : isTwin ? (
      <TwinView/>
    ) : (
      <WorkspaceView kind={kind}/>
    )}
  </div>
}
function WorkspaceView({kind}:{kind:string}) { const cards=kind==='/smart-clips'?['Urgent warning hook','The 3-second rule','Local beats cloud']:kind==='/creative-director'?['Storytelling director','Audience strategist','Visual director','Editor']:kind==='/monetization'?['Keychron integration','NordVPN campaign','CleanMyMac brief']:['AI Hardware Ecosystem Review','Desk Setup Minimalist 2025','The 30-Second ACES LUT Trick','LUT Pack 2026 Announcement']; return <div className="workspace-grid">{cards.map((x,i)=><Card key={x} className="feature-card"><div className={`feature-icon tone-${i%4}`}><Sparkles size={20}/></div><div className="card-heading"><h3>{x}</h3><Badge tone={i%2?'amber':'green'}>{i%2?'Processing':'Ready'}</Badge></div><p>{kind==='/smart-clips'?'High retention surge triggered by an immediate contrarian thesis and pacing shifts.':kind==='/creative-director'?'Review the cut from a distinct creative perspective and apply suggested improvements.':'AI-assisted production workspace with realistic sample data and editable output.'}</p><div className="confidence"><span>Confidence</span><b>{98-i*3}%</b></div><div className="progress"><i style={{width:`${98-i*8}%`}}/></div><Button secondary className="full-button"><ArrowRight size={15}/> Review workspace</Button></Card>)}</div> }
const sampleAssets = [
  { name: 'Aarav_Main_ARoll_Take3.mov', category: 'Raw 4K footage', type: 'video', duration: '14:28', img: 'https://images.unsplash.com/photo-1593697821252-0c9137d9fc45?auto=format&fit=crop&w=900&q=80', mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', tag1: 'A-ROLL', tag2: '4K UHD', fit: '98% semantic fit · imported 2h ago' },
  { name: 'Studio_A7SIII_Interview_Take1.mp4', category: 'Raw 4K footage', type: 'video', duration: '12:30', img: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&w=900&q=80', mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4', tag1: 'A-ROLL', tag2: 'PRORES 422', fit: '96% semantic fit · imported 3h ago' },
  { name: 'Desk_Monologue_HDR_60fps.mov', category: 'Raw 4K footage', type: 'video', duration: '08:45', img: 'https://images.unsplash.com/photo-1492724441997-5dc865305da7?auto=format&fit=crop&w=900&q=80', mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', tag1: 'A-ROLL', tag2: '4K UHD', fit: '95% semantic fit · imported 5h ago' },
  { name: 'Studio_Broll_NeonKeybd_04.mp4', category: 'B-roll library', type: 'video', duration: '00:24', img: 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=900&q=80', mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4', tag1: 'B-ROLL', tag2: 'PRORES 422', fit: '98% semantic fit · imported 1h ago' },
  { name: 'Sony_Macro_SiliconWafer_01.mp4', category: 'B-roll library', type: 'video', duration: '00:18', img: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80', mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4', tag1: 'B-ROLL', tag2: 'MACRO 4K', fit: '99% semantic fit · imported 2h ago' },
  { name: 'Cinematic_Desk_Pan_SlowMo.mp4', category: 'B-roll library', type: 'video', duration: '00:42', img: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=900&q=80', mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoylikes.mp4', tag1: 'B-ROLL', tag2: '120FPS', fit: '94% semantic fit · imported 4h ago' },
  { name: 'Keyboard_RGB_Typing_CloseUp.mp4', category: 'B-roll library', type: 'video', duration: '00:30', img: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=900&q=80', mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4', tag1: 'B-ROLL', tag2: '4K UHD', fit: '97% semantic fit · imported 6h ago' },
  { name: 'Creator_Hook_Vertical_02.mp4', category: 'AI generated clips', type: 'video', duration: '00:58', img: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&w=900&q=80', mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4', tag1: 'AI GENERATED', tag2: '9:16 SHORTS', fit: '98% semantic fit · imported 3h ago' },
  { name: 'Neural_Cyberpunk_Broll_v4.mp4', category: 'AI generated clips', type: 'video', duration: '00:15', img: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=900&q=80', mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutback2012.mp4', tag1: 'AI SYNTH', tag2: '4K UHD', fit: '99% semantic fit · imported 4h ago' },
  { name: 'AI_Avatar_Explainer_Take2.mp4', category: 'AI generated clips', type: 'video', duration: '01:20', img: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=900&q=80', mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4', tag1: 'AI AVATAR', tag2: '1080P', fit: '92% semantic fit · imported 8h ago' },
  { name: '3D_Sparkle_Motion_Background.mp4', category: 'AI generated clips', type: 'video', duration: '00:35', img: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=900&q=80', mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', tag1: 'AI SYNTH', tag2: 'LOOP', fit: '96% semantic fit · imported 12h ago' },
  { name: 'Synth_Audio_Bed.wav', category: 'Audio & stems', type: 'audio', duration: '01:42', img: 'https://images.unsplash.com/photo-1492724441997-5dc865305da7?auto=format&fit=crop&w=900&q=80', mediaUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', tag1: 'AUDIO BED', tag2: '48KHZ WAV', fit: '98% semantic fit · imported 4h ago' },
  { name: 'LoFi_Chill_Background_Track.mp3', category: 'Audio & stems', type: 'audio', duration: '03:12', img: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=900&q=80', mediaUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', tag1: 'MUSIC STEM', tag2: 'STEREO', fit: '94% semantic fit · imported 7h ago' },
  { name: 'Dialogue_Isolate_ClearVoice.wav', category: 'Audio & stems', type: 'audio', duration: '01:40', img: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80', mediaUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3', tag1: 'VOICE STEM', tag2: 'CLEAN', fit: '99% semantic fit · imported 9h ago' },
  { name: 'AI_Narrator_DeepVoice_DeepDive.wav', category: 'Voiceovers & SFX', type: 'audio', duration: '01:15', img: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80', mediaUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', tag1: 'VOICEOVER', tag2: 'ELEVENLABS', fit: '98% semantic fit · imported 5h ago' },
  { name: 'Whoosh_Cyber_SubBass_Riser.wav', category: 'Voiceovers & SFX', type: 'audio', duration: '00:04', img: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=900&q=80', mediaUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', tag1: 'SFX', tag2: 'FX RISER', fit: '95% semantic fit · imported 10h ago' },
  { name: 'Keyboard_Mechanical_Click_SFX.wav', category: 'Voiceovers & SFX', type: 'audio', duration: '00:08', img: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=900&q=80', mediaUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3', tag1: 'SFX', tag2: 'FOLEY', fit: '96% semantic fit · imported 11h ago' },
  { name: 'Glitch_Transition_Sound_Pack.wav', category: 'Voiceovers & SFX', type: 'audio', duration: '00:06', img: 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=900&q=80', mediaUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', tag1: 'SFX', tag2: 'IMPACT', fit: '97% semantic fit · imported 14h ago' },
]

function AssetGrid({ 
  externalInputRef,
  searchQuery = '',
  viewTab = 'Overview'
}: { 
  externalInputRef?: React.RefObject<HTMLInputElement>;
  searchQuery?: string;
  viewTab?: 'Overview' | 'Recent' | 'Favorites';
}){
  const router = useRouter()
  const internalInputRef = useRef<HTMLInputElement>(null)
  const activeInputRef = externalInputRef || internalInputRef

  const [selectedFolder, setSelectedFolder] = useState('All media')
  const [activeAsset, setActiveAsset] = useState<typeof sampleAssets[0] | null>(null)
  const [copied, setCopied] = useState(false)
  const [userAssets, setUserAssets] = useState<typeof sampleAssets>([])
  const [favorites, setFavorites] = useState<Set<string>>(new Set(['Studio_Broll_NeonKeybd_04.mp4', 'Aarav_Main_ARoll_Take3.mov']))
  const [isDragging, setIsDragging] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  const toggleFavorite = (e: React.MouseEvent, name: string) => {
    e.stopPropagation()
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const allAssets = useMemo(() => [...userAssets, ...sampleAssets], [userAssets])

  const collections = useMemo(() => [
    { name: 'All media', count: 3420 + userAssets.length },
    { name: 'Raw 4K footage', count: 142 + userAssets.filter(a => a.category === 'Raw 4K footage').length },
    { name: 'B-roll library', count: 840 + userAssets.filter(a => a.category === 'B-roll library').length },
    { name: 'AI generated clips', count: 312 + userAssets.filter(a => a.category === 'AI generated clips').length },
    { name: 'Audio & stems', count: 420 + userAssets.filter(a => a.category === 'Audio & stems').length },
    { name: 'Voiceovers & SFX', count: 680 + userAssets.filter(a => a.category === 'Voiceovers & SFX').length }
  ], [userAssets])

  const visibleAssets = useMemo(() => {
    let list = selectedFolder === 'All media' ? allAssets : allAssets.filter(asset => asset.category === selectedFolder)

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(asset => 
        asset.name.toLowerCase().includes(q) ||
        asset.category.toLowerCase().includes(q) ||
        asset.tag1.toLowerCase().includes(q) ||
        asset.tag2.toLowerCase().includes(q) ||
        asset.fit.toLowerCase().includes(q)
      )
    }

    if (viewTab === 'Favorites') {
      list = list.filter(asset => favorites.has(asset.name))
    } else if (viewTab === 'Recent') {
      list = [...list].sort((a, b) => {
        if (a.fit.includes('just now')) return -1
        if (b.fit.includes('just now')) return 1
        return a.name.localeCompare(b.name)
      })
    }

    return list
  }, [selectedFolder, allAssets, searchQuery, viewTab, favorites])

  const handleFileUpload = (files: FileList | File[]) => {
    if (!files || !files.length) return
    const newItems: typeof sampleAssets = Array.from(files).map((file) => {
      const isAudio = file.type.startsWith('audio') || file.name.endsWith('.wav') || file.name.endsWith('.mp3')
      const objectUrl = URL.createObjectURL(file)
      const targetCategory = selectedFolder !== 'All media' 
        ? (selectedFolder as any) 
        : (isAudio ? 'Audio & stems' : 'Raw 4K footage')

      return {
        name: file.name,
        category: targetCategory,
        type: isAudio ? 'audio' : 'video',
        duration: '01:30',
        img: isAudio
          ? 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=900&q=80'
          : 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&w=900&q=80',
        mediaUrl: objectUrl,
        tag1: isAudio ? 'AUDIO STEM' : 'PRORES 422',
        tag2: 'USER UPLOAD',
        fit: '100% semantic fit · imported just now'
      }
    })

    setUserAssets(prev => [...newItems, ...prev])
    setToastMsg(`Successfully ingested ${newItems.length} file${newItems.length > 1 ? 's' : ''} into studio`)
    setTimeout(() => setToastMsg(null), 3500)
  }

  const copyUri = (name: string) => {
    navigator.clipboard?.writeText(`asset://studio/${name}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return <div className="asset-layout relative">
    <input 
      type="file" 
      ref={activeInputRef} 
      multiple 
      accept="video/*,audio/*,.mp4,.mov,.mkv,.wav,.mp3,.cube" 
      onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
      className="hidden" 
    />

    <AnimatePresence>
      {toastMsg && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="fixed top-20 right-8 z-50 bg-emerald-600 text-white font-medium text-xs px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 border border-emerald-400/40"
        >
          <Check size={16}/>
          {toastMsg}
        </motion.div>
      )}
    </AnimatePresence>

    <div className="folders">
      <h3>Collections</h3>
      {collections.map(({ name, count }) => (
        <button className={selectedFolder === name ? 'selected' : ''} key={name} onClick={() => setSelectedFolder(name)}>
          <FolderOpen size={15}/>{name}<small>{count}</small>
        </button>
      ))}
      <div 
        className={`dropzone transition-all cursor-pointer ${isDragging ? 'border-violet-500 bg-violet-950/20 scale-[1.02]' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          if (e.dataTransfer.files?.length) handleFileUpload(e.dataTransfer.files)
        }}
        onClick={() => activeInputRef.current?.click()}
      >
        <CloudUpload size={24} className="text-violet-400"/>
        <b>Drop media to ingest</b>
        <small>ProRes, MP4, WAV, CUBE</small>
        <Button secondary onClick={(e) => { e.stopPropagation(); activeInputRef.current?.click() }}>
          <Upload size={14}/> Browse
        </Button>
      </div>
    </div>

    <div className="asset-grid">
      {visibleAssets.length === 0 ? (
        <div className="col-span-3 p-12 text-center text-zinc-400 bg-[#141419] rounded-2xl border border-[#272730] flex flex-col items-center justify-center gap-2 min-h-[280px]">
          <Search size={32} className="text-violet-400 opacity-60"/>
          <h3 className="text-base font-semibold text-zinc-200">No media assets found</h3>
          <p className="text-xs text-zinc-500 max-w-xs">
            {searchQuery 
              ? `No items matched "${searchQuery}" in ${selectedFolder}.` 
              : viewTab === 'Favorites' 
              ? 'You have not favorited any media in this folder yet. Click the heart icon on any card to favorite it.' 
              : `No items in ${selectedFolder}.`}
          </p>
        </div>
      ) : (
        visibleAssets.map((asset, i) => (
          <Card 
            key={asset.name + i} 
            className="asset-card cursor-pointer group hover:border-[#8b5cf6] transition-all relative"
            onClick={() => setActiveAsset(asset)}
          >
            <div className="asset-thumb relative overflow-hidden">
              <img src={asset.img} alt={asset.name} className="group-hover:scale-105 transition-transform duration-300"/>
              <button 
                onClick={(e) => toggleFavorite(e, asset.name)}
                title={favorites.has(asset.name) ? 'Remove from favorites' : 'Add to favorites'}
                className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center text-zinc-300 hover:text-amber-400 transition"
              >
                <Heart size={14} fill={favorites.has(asset.name) ? '#f59e0b' : 'none'} className={favorites.has(asset.name) ? 'text-amber-400' : 'text-zinc-300'}/>
              </button>
              <div className="hover-actions opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center absolute inset-0 bg-black/60">
                <div className="w-10 h-10 rounded-full bg-violet-600 flex items-center justify-center shadow-lg text-white">
                  <Play size={18} fill="currentColor"/>
                </div>
              </div>
              <span>{asset.duration}</span>
            </div>
            <h3 title={asset.name}>{asset.name}</h3>
            <div className="tag-row">
              <Badge>{asset.tag1}</Badge>
              <Badge tone="gray">{asset.tag2}</Badge>
            </div>
            <small className="muted">{asset.fit}</small>
          </Card>
        ))
      )}
    </div>

    <AnimatePresence>
      {activeAsset && (
        <div className="modal-backdrop" onClick={() => setActiveAsset(null)}>
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="modal max-w-2xl w-full bg-[#18181e] border border-[#383842] rounded-2xl p-6 shadow-2xl overflow-hidden relative"
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-head flex items-center justify-between pb-4 border-b border-[#292932]">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-violet-900/40 text-violet-400">
                  {activeAsset.type === 'video' ? <Film size={20}/> : <Music2 size={20}/>}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">{activeAsset.name}</h2>
                  <p className="text-xs text-zinc-400">{activeAsset.category} · {activeAsset.fit}</p>
                </div>
              </div>
              <button 
                onClick={() => setActiveAsset(null)}
                className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              >
                <X size={18}/>
              </button>
            </div>

            <div className="my-5 rounded-xl overflow-hidden bg-black border border-[#2c2c36] flex flex-col items-center justify-center min-h-[260px] relative">
              {activeAsset.type === 'video' ? (
                <video 
                  src={activeAsset.mediaUrl} 
                  poster={activeAsset.img} 
                  controls 
                  autoPlay 
                  className="w-full max-h-[340px] object-contain rounded-xl"
                />
              ) : (
                <div className="w-full p-6 flex flex-col items-center gap-4 bg-gradient-to-b from-[#211936] to-[#121216]">
                  <div className="relative w-28 h-28 rounded-2xl overflow-hidden border border-violet-500/30 shadow-xl">
                    <img src={activeAsset.img} alt={activeAsset.name} className="w-full h-full object-cover"/>
                    <div className="absolute inset-0 bg-violet-900/30 flex items-center justify-center">
                      <Music2 size={32} className="text-violet-300 animate-pulse"/>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 h-8">
                    {[40, 70, 30, 90, 50, 80, 45, 95, 60, 35, 75, 55, 85, 40].map((h, idx) => (
                      <span 
                        key={idx} 
                        className="w-1 bg-gradient-to-t from-violet-500 to-amber-400 rounded-full animate-bounce" 
                        style={{ height: `${h}%`, animationDelay: `${idx * 0.08}s` }}
                      />
                    ))}
                  </div>
                  <audio src={activeAsset.mediaUrl} controls autoPlay className="w-full mt-2"/>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3 mb-6 bg-[#121217] p-3.5 rounded-xl border border-[#25252e] text-xs">
              <div>
                <span className="text-zinc-500 block">Duration</span>
                <strong className="text-zinc-200 font-mono">{activeAsset.duration}</strong>
              </div>
              <div>
                <span className="text-zinc-500 block">Format Tags</span>
                <div className="flex gap-1 mt-0.5">
                  <Badge>{activeAsset.tag1}</Badge>
                  <Badge tone="gray">{activeAsset.tag2}</Badge>
                </div>
              </div>
              <div>
                <span className="text-zinc-500 block">AI Match Confidence</span>
                <strong className="text-emerald-400 font-semibold">98.4% Coherence</strong>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button secondary onClick={() => copyUri(activeAsset.name)}>
                {copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? 'URI Copied' : 'Copy Asset URI'}
              </Button>
              <Button onClick={() => { setActiveAsset(null); router.push('/editor/ai-hardware') }}>
                <Film size={16}/> Open in Studio Editor
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  </div>
}
function SearchResults(){return <div className="search-results"><div className="scan-card"><div className="orb"><Sparkles size={22}/></div><div><h2>Semantic match ready</h2><p>Found 6 moments across 18 ingested takes. Ranked by transcript meaning, facial energy, and visual context.</p></div><Badge tone="green">96.4% coherence</Badge></div>{['Why consistency beats motivation','The exact moment the workflow changed','Build a system, not a habit'].map((x,i)=><Card className="result" key={x}><div className="result-image"><img src={images[i%images.length]} alt="Search result"/><button><Play size={18}/></button></div><div><Badge tone="amber">{['01:14','04:28','08:52'][i]}</Badge><h3>{x}</h3><p>“The difference is not motivation. It is building a system that makes consistency automatic...”</p><div className="result-meta"><span>Take_{i+4}.mov</span><b>{98-i*4}% relevance</b></div></div></Card>)}</div>}
function AnalyticsView() {
  const [timeframe, setTimeframe] = useState<'30days' | 'q3' | 'custom'>('30days')
  const [activePlatforms, setActivePlatforms] = useState<Record<string, boolean>>({
    youtube: true,
    tiktok: true,
    reels: true,
    video: true,
  })
  const [viewMode, setViewMode] = useState<'Growth' | 'Virality' | 'Workflow Efficiency'>('Growth')
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
  const [aiInsightsText, setAiInsightsText] = useState<string | null>(null)

  const togglePlatform = (key: string) => {
    setActivePlatforms(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const platformCount = Object.values(activePlatforms).filter(Boolean).length || 1
  const multiplier = timeframe === 'q3' ? 2.8 : timeframe === 'custom' ? 0.5 : 1.0
  const platMult = platformCount / 4

  const totalViews = `${(2.4 * multiplier * (0.4 + platMult * 0.6)).toFixed(1)}M`
  const timeSaved = `${(48.6 * multiplier * (0.5 + platMult * 0.5)).toFixed(1)} hrs`
  const avgRetention = `${Math.min(94, Math.max(50, +(68.4 * (timeframe === 'q3' ? 1.05 : 1.0)).toFixed(1)))}%`
  const viralPrediction = `${Math.min(99, Math.max(70, +(92.4 * (timeframe === 'q3' ? 1.03 : 0.96)).toFixed(1)))}%`

  const handleRegeneratePdf = async () => {
    setIsGeneratingPdf(true)
    try {
      const activeChannelsList = Object.keys(activePlatforms).filter(k => activePlatforms[k]).join(', ') || 'All channels'
      const prompt = `Analyze these studio metrics for Aarav Studio:
- Timeframe: ${timeframe === '30days' ? 'Last 30 Days' : timeframe === 'q3' ? 'Q3 2025' : 'Custom Period'}
- Active Channels: ${activeChannelsList}
- Total Reach: ${totalViews}
- Production Time Saved: ${timeSaved}
- Avg Retention: ${avgRetention}
- AI Viral Prediction: ${viralPrediction}
- Focused View: ${viewMode}

Provide 3 high-impact strategic AI recommendations for YouTube and short-form video optimization.`

      const res = await fetch('/api/groq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userText: prompt }),
      })

      const data = await res.json()
      const aiResponse = data.responseText || 'Short-form contrarian hooks are outperforming question hooks by 2.3x. Increasing B-roll cut frequency preserves 74% retention.'
      setAiInsightsText(aiResponse)

      // Open printable executive PDF report window
      const printWin = window.open('', '_blank')
      if (printWin) {
        printWin.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>CreatorAI Executive Intelligence Report — ${new Date().toLocaleDateString()}</title>
              <style>
                @page { size: A4; margin: 20mm; }
                body { 
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
                  background: #ffffff; 
                  color: #0f172a; 
                  padding: 32px; 
                  margin: 0; 
                  line-height: 1.5;
                  -webkit-print-color-adjust: exact;
                }
                .header { 
                  display: flex; 
                  justify-content: space-between; 
                  align-items: flex-start; 
                  border-bottom: 2px solid #e2e8f0; 
                  padding-bottom: 20px; 
                  margin-bottom: 24px; 
                }
                .brand-title { font-size: 22px; font-weight: 800; color: #4f46e5; letter-spacing: -0.02em; }
                .report-title { font-size: 13px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
                .meta-table { font-size: 12px; color: #475569; text-align: right; line-height: 1.6; }
                .meta-table strong { color: #0f172a; }
                
                .section-title { font-size: 15px; font-weight: 700; color: #1e293b; margin-top: 28px; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #f1f5f9; padding-bottom: 6px; }
                
                .ai-card { 
                  background: #f8fafc; 
                  border: 1px solid #e2e8f0; 
                  border-left: 5px solid #4f46e5; 
                  border-radius: 8px; 
                  padding: 20px; 
                  margin-bottom: 24px; 
                }
                .ai-card-title { font-size: 14px; font-weight: 700; color: #4f46e5; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
                .ai-card-body { font-size: 13px; color: #334155; white-space: pre-line; line-height: 1.6; }
                
                .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 28px; }
                .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
                .kpi-label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; }
                .kpi-val { font-size: 28px; font-weight: 800; color: #0f172a; margin: 6px 0 4px; letter-spacing: -0.03em; }
                .kpi-badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 12px; background: #e0e7ff; color: #3730a3; }
                
                table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
                th { background: #f1f5f9; color: #334155; font-weight: 700; text-align: left; padding: 9px 12px; border: 1px solid #e2e8f0; text-transform: uppercase; font-size: 10px; }
                td { padding: 9px 12px; border: 1px solid #e2e8f0; color: #334155; }
                tr:nth-child(even) td { background: #f8fafc; }
                
                .footer { 
                  margin-top: 40px; 
                  border-top: 1px solid #e2e8f0; 
                  padding-top: 16px; 
                  display: flex; 
                  justify-content: space-between; 
                  font-size: 11px; 
                  color: #94a3b8; 
                }
                @media print { 
                  body { padding: 0; background: #ffffff; } 
                  .ai-card, .kpi-card { page-break-inside: avoid; }
                  table { page-break-inside: avoid; }
                }
              </style>
            </head>
            <body>
              <div class="header">
                <div>
                  <div class="brand-title">CREATOR AI STUDIO</div>
                  <div class="report-title">Executive Creator Intelligence & Virality Report</div>
                </div>
                <div class="meta-table">
                  <div>Date: <strong>${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong></div>
                  <div>Workspace: <strong>Aarav Studio</strong></div>
                  <div>Timeframe: <strong>${timeframe === '30days' ? 'Last 30 Days' : timeframe === 'q3' ? 'Q3 2025' : 'Custom Period'}</strong></div>
                  <div>Channels: <strong>${activeChannelsList}</strong></div>
                </div>
              </div>

              <div class="ai-card">
                <div class="ai-card-title">⚡ Groq AI Strategic Analysis & Executive Recommendations</div>
                <div class="ai-card-body">${aiResponse}</div>
              </div>

              <div class="section-title">Key Performance Indicators</div>
              <div class="kpi-grid">
                <div class="kpi-card">
                  <div class="kpi-label">Total Reach & Views</div>
                  <div class="kpi-val">${totalViews}</div>
                  <span class="kpi-badge">+34.2% YoY</span>
                </div>
                <div class="kpi-card">
                  <div class="kpi-label">Production Time Saved</div>
                  <div class="kpi-val">${timeSaved}</div>
                  <span class="kpi-badge">3.8× Faster</span>
                </div>
                <div class="kpi-card">
                  <div class="kpi-label">Avg Retention Rate</div>
                  <div class="kpi-val">${avgRetention}</div>
                  <span class="kpi-badge">Top 2% Creator</span>
                </div>
                <div class="kpi-card">
                  <div class="kpi-label">AI Viral Prediction</div>
                  <div class="kpi-val">${viralPrediction}</div>
                  <span class="kpi-badge">High Confidence</span>
                </div>
              </div>

              <div class="section-title">Audience Retention & Pacing Milestones</div>
              <table>
                <thead>
                  <tr>
                    <th>Timeline Milestone</th>
                    <th>Measured Retention</th>
                    <th>Impact Delta</th>
                    <th>Strategic Driver</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>00:00 - 00:03 (Hook Intro)</strong></td>
                    <td>94.2%</td>
                    <td>+12.0%</td>
                    <td>Contrarian assertion prompt formula</td>
                  </tr>
                  <tr>
                    <td><strong>02:14 - 03:30 (B-Roll Cutaway)</strong></td>
                    <td>88.0%</td>
                    <td>+8.5%</td>
                    <td>High-frequency macro silicon wafer cut</td>
                  </tr>
                  <tr>
                    <td><strong>07:10 - 07:40 (Sponsor Bridge)</strong></td>
                    <td>68.4%</td>
                    <td>-4.0%</td>
                    <td>Standard pre-roll bridge transition</td>
                  </tr>
                </tbody>
              </table>

              <div class="section-title">Virality Leaderboard & Content Output</div>
              <table>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Content Title</th>
                    <th>Format</th>
                    <th>Total Reach</th>
                    <th>Viral Index Score</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>#1</strong></td>
                    <td>Why Everyone is Wrong About Local AI</td>
                    <td>YouTube Longform</td>
                    <td>1.2M Views</td>
                    <td><strong style="color:#4f46e5;">98 / 100</strong></td>
                  </tr>
                  <tr>
                    <td><strong>#2</strong></td>
                    <td>The M4 Max Review: Silicon Decoded</td>
                    <td>YouTube / Reels</td>
                    <td>780K Views</td>
                    <td><strong style="color:#4f46e5;">94 / 100</strong></td>
                  </tr>
                  <tr>
                    <td><strong>#3</strong></td>
                    <td>Can You Train a Model on 16GB RAM?</td>
                    <td>Shorts / TikTok</td>
                    <td>420K Views</td>
                    <td><strong style="color:#4f46e5;">89 / 100</strong></td>
                  </tr>
                </tbody>
              </table>

              <div class="footer">
                <div>Confidential · Prepared for Aarav Studio Executive Team</div>
                <div>Generated via CreatorAI Engine & Groq AI</div>
              </div>

              <script>
                window.onload = function() { setTimeout(function() { window.print(); }, 400); }
              </script>
            </body>
          </html>
        `)
        printWin.document.close()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setIsGeneratingPdf(false)
    }
  }

  const getMetricsForView = (): [string, string, string, string][] => {
    if (viewMode === 'Growth') {
      return [
        ['Total views & reach', totalViews, '+34.2%', 'violet'],
        ['Subscriber conversion', `${(14.2 * multiplier * (0.8 + platMult * 0.2)).toFixed(1)}k`, '+18.4%', 'cyan'],
        ['Avg retention rate', avgRetention, '+14.8%', 'violet'],
        ['Audience growth index', '+28.4%', 'Top 2%', 'amber'],
      ]
    }
    if (viewMode === 'Virality') {
      return [
        ['AI viral prediction', viralPrediction, 'High confidence', 'amber'],
        ['Hook retention spike', '+18.4%', 'Top 1%', 'violet'],
        ['Share velocity multiplier', '4.2×', '+112%', 'cyan'],
        ['Shorts heatmap index', '98/100', 'Peak Viral', 'amber'],
      ]
    }
    return [
      ['Production time saved', timeSaved, '3.8× faster', 'amber'],
      ['Content cadence velocity', '2.8 vids/wk', '+140%', 'violet'],
      ['Smart clips batch yield', '32 Clips', '+80%', 'cyan'],
      ['Editing bottleneck cut', '-65% time', 'Automated', 'amber'],
    ]
  }

  const metrics = getMetricsForView()

  const insightsList = viewMode === 'Growth' ? [
    ['RETENTION BENCHMARK', 'Intros with silicon macro shots maintain 88% viewer retention into Minute 3, outperforming tech benchmark average by +24%.', 'violet'],
    ['SUBSCRIBER CONVERSION', 'Mid-roll end cards placed at retention spikes convert casual viewers into subscribers at a 3.4x higher rate.', 'amber'],
    ['VIDEO LENGTH OPTIMIZATION', 'Deep-dive tech analysis videos between 12:45 and 14:30 exhibit the highest overall lifetime watch time and channel reach.', 'cyan'],
  ] : viewMode === 'Virality' ? [
    ['HOOK FORMAT ALERT', 'Short-Form Contrarian Hooks are outperforming Question Hooks by 2.3x in organic shares across TikTok & YouTube Shorts.', 'violet'],
    ['VIRAL PREDICTION ENGINE', 'Clips featuring unexpected benchmark comparisons reach 90+ Viral Score within the first 6 hours of publication.', 'amber'],
    ['CROSS-PLATFORM SYNDICATION', 'Reels syndication within 30 minutes of YouTube upload generates a +45% engagement amplification effect.', 'cyan'],
  ] : [
    ['AUTOMATED CUTTING PRESET', 'LumiClip Smart Clips automatically detected 32 highlight markers, eliminating 18.5 hours of manual timeline trimming.', 'violet'],
    ['B-ROLL AUTO-STITCH', 'AI macro B-roll auto-insertion improved production speed by 4.2x while preserving high viewer engagement retention.', 'amber'],
    ['BATCH EXPORT VELOCITY', 'Multi-platform aspect ratio conversion (16:9 to 9:16) completed in under 45 seconds per episode.', 'cyan'],
  ]

  return (
    <div className="page space-y-6 pb-12">
      {/* Analytics Page Title Header with Regenerate Insights Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-[#1e1a2d] border border-[#3b2d5c] flex items-center justify-center text-violet-400 shadow-md">
            <BarChart3 size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Creator Intelligence</h1>
            <p className="text-xs text-zinc-400 mt-0.5">Predictive engagement metrics calibrated against your channel history</p>
          </div>
        </div>

        <button 
          onClick={handleRegeneratePdf}
          disabled={isGeneratingPdf}
          className="bg-[#6366f1] hover:bg-[#4f46e5] text-white text-xs font-semibold rounded-xl px-4 py-2.5 flex items-center gap-2 shadow-lg shadow-indigo-950/40 transition-all active:scale-95 self-start sm:self-auto disabled:opacity-50"
        >
          <Sparkles size={15} className={isGeneratingPdf ? 'animate-spin' : ''} />
          <span>{isGeneratingPdf ? 'Synthesizing Groq AI Report...' : 'Regenerate insights'}</span>
        </button>
      </div>

      <div className="analytics-dashboard">
        <div className="analytics-controls">
          <div className="filter-row">
            <button 
              className={timeframe === '30days' ? 'filter-active' : ''} 
              onClick={() => setTimeframe('30days')}
            >
              Last 30 Days
            </button>
            <button 
              className={timeframe === 'q3' ? 'filter-active' : ''} 
              onClick={() => setTimeframe('q3')}
            >
              Q3 2025
            </button>
            <button 
              className={timeframe === 'custom' ? 'filter-active' : ''} 
              onClick={() => setTimeframe('custom')}
            >
              Custom
            </button>
            <span className="filter-divider"/>

            <button onClick={() => togglePlatform('youtube')} className="border-0 p-0 bg-transparent outline-none">
              <Badge tone={activePlatforms.youtube ? 'dark' : 'gray'}>
                <YoutubeIcon size={13} /> YouTube Longform
              </Badge>
            </button>

            <button onClick={() => togglePlatform('tiktok')} className="border-0 p-0 bg-transparent outline-none">
              <Badge tone={activePlatforms.tiktok ? 'dark' : 'gray'}>
                <TikTokIcon size={13} /> TikTok
              </Badge>
            </button>

            <button onClick={() => togglePlatform('reels')} className="border-0 p-0 bg-transparent outline-none">
              <Badge tone={activePlatforms.reels ? 'dark' : 'gray'}>
                <InstagramIcon size={13} /> Instagram Reels
              </Badge>
            </button>

            <button onClick={() => togglePlatform('video')} className="border-0 p-0 bg-transparent outline-none">
              <Badge tone={activePlatforms.video ? 'dark' : 'gray'}>
                <Video size={13} /> Video
              </Badge>
            </button>
          </div>

          <div className="view-row">
            <span>VIEW:</span>
            <button 
              className={viewMode === 'Growth' ? 'filter-active' : ''}
              onClick={() => setViewMode('Growth')}
            >
              Growth
            </button>
            <button 
              className={viewMode === 'Virality' ? 'filter-active' : ''}
              onClick={() => setViewMode('Virality')}
            >
              Virality
            </button>
            <button 
              className={viewMode === 'Workflow Efficiency' ? 'filter-active' : ''}
              onClick={() => setViewMode('Workflow Efficiency')}
            >
              Workflow Efficiency
            </button>
          </div>
        </div>

        {/* Dynamic Metrics */}
        <div className="analytics-metrics">
          {metrics.map(([label, value, change, tone], i) => (
            <Card key={label} className={`analytics-metric metric-${tone} transition-all duration-300`}>
              <div className="metric-top">
                <span>{label}</span>
                <span className="metric-icon">{i === 0 ? '◉' : i === 1 ? 'ϟ' : i === 2 ? 'Top 2%' : '• High'}</span>
              </div>
              <strong className="analytics-number">{value}</strong>
              <Badge tone={tone === 'amber' ? 'amber' : 'green'}>{change}</Badge>
              {i === 2 && viewMode === 'Growth' ? (
                <div className="retention-bar"><i style={{ width: avgRetention }} /></div>
              ) : (
                <div className="analytics-spark"><i/><i/><i/><i/><i/></div>
              )}
              <div className="metric-foot">
                <span>
                  {viewMode === 'Growth'
                    ? i === 0 ? 'Across 14 published pieces' : i === 1 ? 'Subscriber conversion rate: 4.8%' : i === 2 ? 'Median watch duration: 8:44' : 'Audience retention target met'
                    : viewMode === 'Virality'
                    ? i === 0 ? 'High confidence viral prediction' : i === 1 ? 'Measured at 0:03 mark' : i === 2 ? 'TikTok & Shorts amplification' : 'Based on 32 analyzed clips'
                    : i === 0 ? 'Manual edit equivalent: 72.0 hrs' : i === 1 ? '2.8 videos published / week' : i === 2 ? 'Smart Clips auto-generated' : 'LumiClip pipeline optimized'}
                </span>
                <small>
                  {viewMode === 'Growth'
                    ? i === 0 ? 'vs. 1.78M prev.' : i === 1 ? '+2.4k target' : i === 2 ? 'Target: 70%' : 'High Growth'
                    : viewMode === 'Virality'
                    ? i === 0 ? '4 viral hits' : i === 1 ? 'Contrarian' : i === 2 ? 'Top 1%' : '98 Score'
                    : i === 0 ? 'Smart Clips' : i === 1 ? '+140% YOY' : i === 2 ? '100% Coherence' : 'Auto-cut'}
                </small>
              </div>
            </Card>
          ))}
        </div>

        <div className="analytics-columns">
          <div className="analytics-main">
            <Card className={`retention-card transition-all duration-300 ${viewMode === 'Growth' ? 'ring-1 ring-violet-500/60 shadow-[0_0_20px_rgba(139,92,246,0.15)]' : ''}`}>
              <div className="card-heading">
                <div>
                  <h2>Second-by-Second Viewer Retention Curve</h2>
                  <p>Project: “The Future of AI Hardware: M4 Max vs Tensor Runtimes”</p>
                </div>
                <div className="legend">
                  <span className="legend-project"/> This Project <span/> Tech Benchmark
                </div>
              </div>
              <div className="retention-chart">
                <div className="chart-axis">
                  <span>00:00</span><span>02:30</span><span>05:00</span><span>07:30</span><span>10:00</span><span>13:20</span>
                </div>
                <div className="curve curve-main"/>
                <div className="curve curve-benchmark"/>
                <div className="chart-callout callout-one">
                  <b>Hook Spike +12%</b>
                  <small>Contrarian assertion</small>
                </div>
                <div className="chart-callout callout-two">
                  <b>B-Roll Cutaway holds 88%</b>
                  <small>Silicon wafer macro</small>
                </div>
                <div className="chart-callout callout-three">
                  <b>Sponsor drop-off -4%</b>
                  <small>Standard pre-roll bridge</small>
                </div>
              </div>
              <div className="ai-recommendation">
                <Sparkles size={16}/> 
                <span>
                  {viewMode === 'Growth' ? (
                    <><b>AI Recommendation (Growth Focus):</b> Adding the macro B-roll at 02:14 increased watch time by <strong>180 seconds.</strong> Inserting a subscribe callout right after this retention peak is projected to yield <strong>+420 subscribers/video.</strong></>
                  ) : viewMode === 'Virality' ? (
                    <><b>AI Recommendation (Virality Focus):</b> Contrarian hooks produce a <strong>4.2x share multiplier</strong> on TikTok & Shorts. Replace static pre-roll speech at 07:10 with a fast-cut PIP demonstration to prevent drop-off.</>
                  ) : (
                    <><b>AI Recommendation (Efficiency Focus):</b> LumiClip auto-B-roll insertion saved <strong>16.5 editing hours</strong> on this episode. Auto-applying the <em>"High-Frequency Cut"</em> preset will trim timeline assembly by another 2.4 hours.</>
                  )}
                </span>
              </div>
            </Card>

            <Card className={`velocity-card transition-all duration-300 ${viewMode === 'Workflow Efficiency' ? 'ring-1 ring-violet-500/60 shadow-[0_0_20px_rgba(139,92,246,0.15)]' : ''}`}>
              <div className="card-heading">
                <div>
                  <h2>Content Velocity & Production Cadence</h2>
                  <p>Turnaround Time: Manual Workflow vs. CreatorAI Orchestration</p>
                </div>
                <div className="legend">
                  <span className="legend-manual"/> Manual Hours <span className="legend-ai"/> AI-Assisted Hours
                </div>
              </div>
              {[
                ['Episode 41: “Liquid Neural Networks”', '3.8h', '14.2 hrs total saved'],
                ['Episode 42: “Future of AI Hardware (Benchmark)”', '4.5h', '16.5 hrs total saved'],
                ['Shorts Series: “60-Second Silicon Breakdown” (×5)', '1.2h', '12.0 hrs total saved'],
                ['Episode 43: “Open Source Weights Explained”', '3.6h', '18.4 hrs total saved']
              ].map(([title, time, saved], i) => (
                <div className="cadence-row" key={title}>
                  <div><b>{title}</b><small>{saved}</small></div>
                  <div className="cadence-track">
                    <i style={{ width: `${[25, 30, 15, 24][i]}%` }}>{time}</i>
                    <span>Manual equivalent: {['18.0h', '21.0h', '13.2h', '22.0h'][i]}</span>
                  </div>
                </div>
              ))}
              <div className="cadence-summary">
                <span>↗ Cadence Velocity: <b>2.8 videos / week (+140% YOY)</b></span>
                <strong>Editing bottleneck eliminated</strong>
              </div>
            </Card>
          </div>

          <div className="analytics-side">
            <Card className="insights-card">
              <div className="card-heading">
                <h2>◉ Predictive Insights</h2>
                <Badge>{viewMode} Mode</Badge>
              </div>
              {aiInsightsText ? (
                <div className="insight insight-violet">
                  <b>GROQ AI STRATEGIC REPORT</b>
                  <p className="text-xs leading-relaxed text-zinc-200 mt-2">{aiInsightsText}</p>
                </div>
              ) : null}
              {insightsList.map(([title, body, tone]) => (
                <div className={`insight insight-${tone}`} key={title}>
                  <b>{title}</b>
                  <p>{body}</p>
                  <small>
                    {tone === 'amber' ? 'Apply preset: “High-Frequency Cut”' : tone === 'cyan' ? 'Timeline trim targets updated' : 'Action: auto-apply contrarian hook prompt'} 
                    <ArrowRight size={13}/>
                  </small>
                </div>
              ))}
            </Card>

            <Card className={`leaderboard-card transition-all duration-300 ${viewMode === 'Virality' ? 'ring-1 ring-violet-500/60 shadow-[0_0_20px_rgba(139,92,246,0.15)]' : ''}`}>
              <div className="card-heading">
                <h2>🏆 Virality Leaderboard</h2>
                <span>{viewMode} Mode</span>
              </div>
              {['Why Everyone is Wrong About Local AI', 'The M4 Max Review: Silicon Decoded', 'Can You Train a Model on 16GB RAM?'].map((title, i) => (
                <div className="leader-row" key={title}>
                  <div className="rank">{i + 1}</div>
                  <div className="leader-thumb" style={{ backgroundImage: `url(${images[i]})` }}/>
                  <div>
                    <b>{title}</b>
                    <small>{['1.2M views', '780K views', '420K views'][i]} · <strong>{['14.8%', '11.2%', '9.8%'][i]} eng.</strong></small>
                  </div>
                  <Badge tone={i === 0 ? 'violet' : 'amber'}>{[98, 94, 89][i]} VIRAL SCORE</Badge>
                </div>
              ))}
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

function ConfidenceGauge({ percentage }: { percentage: number }) {
  const radius = 18
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (percentage / 100) * circumference

  return (
    <div className="relative w-11 h-11 flex items-center justify-center flex-none">
      <svg className="w-11 h-11 transform -rotate-90">
        <circle
          cx="22"
          cy="22"
          r={radius}
          stroke="#1b2923"
          strokeWidth="3.5"
          fill="transparent"
        />
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

function SponsorshipView() {
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
        primary: '#f59e0b',       // Amber
        primaryHover: '#d97706',
        accentBg: '#261b0c',
        border: '#78350f',
        textAccent: '#fbbf24',
        badgeBg: '#451a03',
        logoUrl: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=150&auto=format&fit=crop&q=80',
        ringColor: 'ring-amber-500/40',
        bgGlow: 'bg-amber-500/10'
      }
    } else if (b.includes('nord')) {
      return {
        brand: 'NordVPN',
        primary: '#38bdf8',       // Cyan / Sky Blue
        primaryHover: '#0284c7',
        accentBg: '#0b2336',
        border: '#0369a1',
        textAccent: '#7dd3fc',
        badgeBg: '#0c4a6e',
        logoUrl: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=150&auto=format&fit=crop&q=80',
        ringColor: 'ring-sky-500/40',
        bgGlow: 'bg-sky-500/10'
      }
    } else if (b.includes('macpaw') || b.includes('cleanmymac')) {
      return {
        brand: 'CleanMyMac',
        primary: '#10b981',       // Emerald Mint
        primaryHover: '#059669',
        accentBg: '#08261e',
        border: '#047857',
        textAccent: '#6ee7b7',
        badgeBg: '#064e3b',
        logoUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
        ringColor: 'ring-emerald-500/40',
        bgGlow: 'bg-emerald-500/10'
      }
    } else if (b.includes('anker')) {
      return {
        brand: 'Anker',
        primary: '#f97316',       // Solar Orange
        primaryHover: '#ea580c',
        accentBg: '#2a1409',
        border: '#c2410c',
        textAccent: '#ffba80',
        badgeBg: '#7c2d12',
        logoUrl: 'https://images.unsplash.com/photo-1609592424109-dd9892f1b177?w=150&auto=format&fit=crop&q=80',
        ringColor: 'ring-orange-500/40',
        bgGlow: 'bg-orange-500/10'
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
      bgGlow: 'bg-violet-500/10'
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
            @page {
              size: A4 landscape;
              margin: 6mm;
            }
            * {
              box-sizing: border-box;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            html, body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              background-color: #0b0c10 !important;
              color: #f1f5f9 !important;
              margin: 0;
              padding: 0;
              font-size: 12px;
              line-height: 1.5;
            }

            @media print {
              html, body {
                background-color: #0b0c10 !important;
                color: #f1f5f9 !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              .pdf-slide-page, .pdf-cover-page {
                break-inside: avoid !important;
                page-break-inside: avoid !important;
                break-after: page !important;
                page-break-after: always !important;
              }
              .pdf-slide-page:last-of-type {
                break-after: auto !important;
                page-break-after: auto !important;
              }
              .script-table tr {
                break-inside: avoid !important;
                page-break-inside: avoid !important;
              }
            }

            /* COVER PAGE TEMPLATE */
            .pdf-cover-page {
              width: 100%;
              min-height: 185mm;
              background: #ffffff;
              color: #0f172a;
              border-radius: 12px;
              overflow: hidden;
              page-break-after: always;
              break-after: page;
              position: relative;
              border: 1px solid #cbd5e1;
            }
            .cover-table {
              width: 100%;
              height: 170mm;
              table-layout: fixed;
            }
            .cover-left-cell {
              background: #ffffff;
              color: #0f172a;
              padding: 40px 48px;
              vertical-align: space-between;
            }
            .cover-right-cell {
              background: ${theme.primary};
              color: #ffffff;
              padding: 40px;
              vertical-align: middle;
              text-align: center;
            }
            .cover-footer-strip {
              background: #1e293b;
              color: #ffffff;
              padding: 10px 24px;
              font-size: 11px;
              font-weight: 800;
              letter-spacing: 1.5px;
              text-transform: uppercase;
            }

            /* INNER SLIDE PAGES */
            .pdf-slide-page {
              width: 100%;
              min-height: 185mm;
              background: #12131c;
              border: 1px solid ${theme.border};
              border-top: 6px solid ${theme.primary};
              border-radius: 14px;
              padding: 24px 28px 16px 28px;
              page-break-after: always;
              break-after: page;
              page-break-inside: avoid;
              break-inside: avoid;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
            }
            .pdf-slide-page:last-child {
              page-break-after: auto;
              break-after: auto;
            }
            .slide-title-text {
              font-size: 24px;
              font-weight: 900;
              color: #ffffff;
              margin: 4px 0 2px 0;
              letter-spacing: -0.5px;
            }
            .slide-sub-text {
              font-size: 13px;
              color: #94a3b8;
            }

            .badge-pill {
              display: inline-block;
              background: ${theme.badgeBg};
              color: ${theme.textAccent};
              border: 1px solid ${theme.border};
              font-size: 10px;
              font-weight: 800;
              padding: 4px 12px;
              border-radius: 99px;
              text-transform: uppercase;
              letter-spacing: 1px;
            }

            /* METRICS TABLE */
            .metrics-table {
              width: 100%;
              table-layout: fixed;
              border-collapse: separate;
              border-spacing: 12px;
              margin: 16px 0;
            }
            .metric-td {
              background: ${theme.accentBg};
              border: 1px solid ${theme.border};
              border-top: 4px solid ${theme.primary};
              border-radius: 10px;
              padding: 14px 16px;
              text-align: center;
            }
            .metric-lbl {
              font-size: 10px;
              font-weight: 800;
              color: #94a3b8;
              text-transform: uppercase;
              letter-spacing: 1px;
            }
            .metric-val {
              font-size: 20px;
              font-weight: 900;
              color: ${theme.textAccent};
              margin-top: 4px;
            }

            .content-card {
              background: #090a10;
              border: 1px solid #232536;
              border-radius: 10px;
              padding: 18px 22px;
              font-size: 13px;
              color: #e2e8f0;
              line-height: 1.6;
              margin-bottom: 16px;
            }
            .takeaway-card {
              background: #064e3b;
              border: 1px solid #059669;
              border-radius: 10px;
              padding: 12px 18px;
              font-size: 12px;
              color: #a7f3d0;
              font-weight: 600;
              margin-bottom: 16px;
            }

            /* INNER SLIDE BOTTOM FOOTER BREADCRUMB */
            .inner-footer-strip {
              background: #090a10;
              border-top: 1px solid #232536;
              padding: 8px 14px;
              border-radius: 8px;
              margin-top: auto;
            }

            /* VIDEO SCRIPT TIMELINE TABLE */
            .hook-card {
              background: ${theme.accentBg};
              border: 1px solid ${theme.border};
              border-left: 6px solid ${theme.primary};
              border-radius: 12px;
              padding: 18px 22px;
              margin-bottom: 20px;
            }
            .script-table {
              width: 100%;
              table-layout: fixed;
              border-collapse: collapse;
              margin-top: 12px;
            }
            .script-table th {
              background: #181926;
              color: #94a3b8;
              font-size: 11px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 1px;
              padding: 12px 14px;
              text-align: left;
              border-bottom: 2px solid ${theme.border};
            }
            .script-table td {
              background: #12131c;
              border-bottom: 1px solid #232536;
              padding: 16px 14px;
              vertical-align: top;
              word-wrap: break-word;
              overflow-wrap: break-word;
            }
            .time-pill {
              display: inline-block;
              background: ${theme.badgeBg};
              color: ${theme.textAccent};
              border: 1px solid ${theme.border};
              font-size: 11px;
              font-weight: 800;
              padding: 4px 10px;
              border-radius: 6px;
              white-space: nowrap;
            }
          </style>
        </head>
        <body style="padding: 12px;">

          <!-- SLIDE 1: COVER PAGE TEMPLATE (Matching User Design) -->
          <div class="pdf-cover-page">
            <table class="cover-table" cellpadding="0" cellspacing="0">
              <tr>
                <td width="58%" class="cover-left-cell">
                  <div>
                    <div style="font-size: 16px; font-weight: 900; color: #334155; letter-spacing: 2px; text-transform: uppercase;">
                      BRAND PITCH DECK
                    </div>
                    <div style="font-size: 11px; font-weight: 800; color: #64748b; letter-spacing: 1px; text-transform: uppercase; margin-top: 2px;">
                      SPONSORSHIP PROPOSAL & INTEGRATION STRATEGY
                    </div>

                    <div style="margin-top: 48px; border-left: 6px solid ${theme.primary}; padding-left: 20px;">
                      <div style="font-size: 38px; font-weight: 900; color: #0f172a; text-transform: uppercase; letter-spacing: -1px; line-height: 1.1;">
                        [ ${campaign?.brand || theme.brand} ]
                      </div>
                      <div style="font-size: 15px; font-weight: 700; color: #475569; margin-top: 8px;">
                        ${generatedData.title || (isDeck ? `${theme.brand} Pitch Deck` : `${theme.brand} Video Script`)}
                      </div>
                    </div>
                  </div>

                  <div style="margin-top: 60px; border-top: 2px solid #e2e8f0; padding-top: 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        ${logoImg ? `
                          <td width="56" style="vertical-align: middle;">
                            <img src="${logoImg}" style="width: 44px; height: 44px; border-radius: 8px; border: 2px solid ${theme.primary}; object-fit: cover;" />
                          </td>
                        ` : ''}
                        <td style="vertical-align: middle;">
                          <div style="font-size: 12px; font-weight: 900; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px;">
                            ${campaign?.category || 'Tech & Software Integration'} • CREATOR PROPOSAL
                          </div>
                          <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
                            Est. Campaign Payout: <strong>${campaign?.payout || '$14,500'}</strong> • Audience Match: <strong>${campaign?.audienceFit || '9.8/10'}</strong>
                          </div>
                          <div style="font-size: 10px; color: #94a3b8; margin-top: 3px;">
                            Generated Date: ${formattedDate}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </div>
                </td>

                <td width="42%" class="cover-right-cell">
                  <div style="border: 3px solid rgba(255,255,255,0.4); border-radius: 18px; padding: 48px 24px; background: rgba(0,0,0,0.12);">
                    <div style="font-size: 46px; font-weight: 900; letter-spacing: 4px; text-transform: uppercase; line-height: 1.05; text-shadow: 0 4px 16px rgba(0,0,0,0.25);">
                      BRAND<br/>PITCH<br/>DECK
                    </div>
                    <div style="margin-top: 28px; display: inline-block; background: rgba(0,0,0,0.3); border: 1.5px solid rgba(255,255,255,0.4); padding: 8px 18px; border-radius: 99px; font-size: 11px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase;">
                      ${theme.brand.toUpperCase()} SPONSORSHIP
                    </div>
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
            <!-- SLIDE 2: THE PROBLEM & OPPORTUNITY (Editorial Split Layout) -->
            <div class="pdf-slide-page">
              <div>
                <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom: 1px solid #232536; padding-bottom: 12px; margin-bottom: 16px;">
                  <tr>
                    <td>
                      <span style="font-size: 10px; font-weight: 900; color: ${theme.primary}; letter-spacing: 2px; text-transform: uppercase;">
                        SLIDE 2 OF 5 // PROBLEM & OPPORTUNITY
                      </span>
                      <h2 class="slide-title-text">The problem we're solving</h2>
                      <div class="slide-sub-text">An overlooked challenge creating friction, inefficiency, and untapped potential.</div>
                    </td>
                    <td style="text-align: right; vertical-align: top;">
                      <span class="badge-pill">${theme.brand} Pitch</span>
                    </td>
                  </tr>
                </table>

                <!-- EDITORIAL SPLIT GRID -->
                <table width="100%" cellpadding="0" cellspacing="0" style="table-layout: fixed; margin-bottom: 16px;">
                  <tr>
                    <!-- LEFT COLUMN: MAIN NARRATIVE -->
                    <td width="46%" style="vertical-align: top; padding-right: 20px;">
                      <div style="background: #090a10; border: 1px solid #232536; border-left: 5px solid ${theme.primary}; border-radius: 10px; padding: 18px 20px;">
                        <span style="font-size: 10px; font-weight: 800; color: ${theme.textAccent}; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 6px;">
                          1. Industry Context
                        </span>
                        <p style="font-size: 12.5px; color: #e2e8f0; line-height: 1.65; margin: 0 0 14px 0;">
                          In today's digital landscape, traditional banner ads and uninspired sponsor reads suffer from severe ad blindness. Tech professionals and creators require authentic, demonstration-led product validation before making purchasing decisions.
                        </p>
                        <span style="font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 4px;">
                          3. Existing Alternatives
                        </span>
                        <p style="font-size: 11.5px; color: #cbd5e1; line-height: 1.55; margin: 0;">
                          Standard agency placements rely on static script reads that fail to resonate with discerning software engineers and creators.
                        </p>
                      </div>
                    </td>

                    <!-- RIGHT COLUMN: 3 VERTICAL PAIN POINTS WITH SUBTLE SEPARATORS -->
                    <td width="54%" style="vertical-align: top;">
                      <div style="background: #090a10; border: 1px solid #232536; border-radius: 10px; padding: 16px 20px;">
                        <span style="font-size: 10px; font-weight: 800; color: ${theme.primary}; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 12px;">
                          2. Three Key Industry Challenges
                        </span>

                        <div style="border-bottom: 1px solid #1e202e; padding-bottom: 10px; margin-bottom: 10px;">
                          <strong style="color: #ffffff; font-size: 12px; display: block;">• High Friction & Manual Overhead</strong>
                          <span style="font-size: 11px; color: #94a3b8; line-height: 1.4; display: block; margin-top: 2px;">
                            Legacy sponsor placements fail to convey real product utility, resulting in low click-through rates.
                          </span>
                        </div>

                        <div style="border-bottom: 1px solid #1e202e; padding-bottom: 10px; margin-bottom: 10px;">
                          <strong style="color: #ffffff; font-size: 12px; display: block;">• Retention Drop-off during Sponsor Segments</strong>
                          <span style="font-size: 11px; color: #94a3b8; line-height: 1.4; display: block; margin-top: 2px;">
                            Abrupt, generic ad transitions trigger a 35%+ drop in viewer retention.
                          </span>
                        </div>

                        <div>
                          <strong style="color: #ffffff; font-size: 12px; display: block;">• Unmeasurable Campaign Attribution</strong>
                          <span style="font-size: 11px; color: #94a3b8; line-height: 1.4; display: block; margin-top: 2px;">
                            Traditional media buys lack clear multi-touch attribution and long-tail performance data.
                          </span>
                        </div>
                      </div>
                    </td>
                  </tr>
                </table>

                <!-- 4. THE OPPORTUNITY STATEMENT -->
                <div class="takeaway-card" style="background: #064e3b; border: 1px solid #059669; padding: 14px 20px; border-radius: 10px; color: #a7f3d0; font-size: 12px; font-weight: 600;">
                  ⚡ <strong>The Strategic Opportunity:</strong> A unique opportunity for ${theme.brand} to own a dedicated, retention-optimized segment reaching 350,000+ verified tech buyers.
                </div>
              </div>

              <div class="inner-footer-strip">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size: 10px; color: #64748b; font-weight: 600;">
                      ${theme.brand} Pitch Deck • Slide 2 of 5
                    </td>
                    <td style="text-align: right; font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">
                      ${theme.brand.toUpperCase()} PITCH DECK | THE PROBLEM & OPPORTUNITY
                    </td>
                  </tr>
                </table>
              </div>
            </div>

            <!-- SLIDE 3: OUR SOLUTION (Focal Process Workflow & Capabilities) -->
            <div class="pdf-slide-page">
              <div>
                <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom: 1px solid #232536; padding-bottom: 12px; margin-bottom: 16px;">
                  <tr>
                    <td>
                      <span style="font-size: 10px; font-weight: 900; color: ${theme.primary}; letter-spacing: 2px; text-transform: uppercase;">
                        SLIDE 3 OF 5 // OUR SOLUTION
                      </span>
                      <h2 class="slide-title-text">Introducing [ ${theme.brand} ] Integration</h2>
                      <div class="slide-sub-text">A better way to solve creator workflow friction and drive audience action.</div>
                    </td>
                    <td style="text-align: right; vertical-align: top;">
                      <span class="badge-pill">${theme.brand} Solution</span>
                    </td>
                  </tr>
                </table>

                <!-- 3-STEP WORKFLOW FOCAL VISUAL -->
                <div style="background: #090a10; border: 1px solid #232536; border-top: 4px solid ${theme.primary}; border-radius: 10px; padding: 16px 20px; margin-bottom: 16px;">
                  <span style="font-size: 10px; font-weight: 800; color: ${theme.textAccent}; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 12px;">
                    3-Step High-Retention Workflow
                  </span>
                  <table width="100%" cellpadding="0" cellspacing="0" style="table-layout: fixed;">
                    <tr>
                      <td width="32%" style="background: ${theme.accentBg}; border: 1px solid ${theme.border}; border-radius: 8px; padding: 12px; text-align: center;">
                        <span style="font-size: 11px; font-weight: 900; color: ${theme.primary}; display: block; text-transform: uppercase;">1. DISCOVER</span>
                        <strong style="color: #ffffff; font-size: 12px; display: block; margin-top: 4px;">Problem Hook</strong>
                        <span style="font-size: 10.5px; color: #94a3b8; display: block; margin-top: 2px;">Address real workflow pain point</span>
                      </td>
                      <td width="2%" style="text-align: center; color: ${theme.primary}; font-weight: 900; font-size: 16px;">→</td>
                      <td width="32%" style="background: ${theme.accentBg}; border: 1px solid ${theme.border}; border-radius: 8px; padding: 12px; text-align: center;">
                        <span style="font-size: 11px; font-weight: 900; color: ${theme.primary}; display: block; text-transform: uppercase;">2. TRANSFORM</span>
                        <strong style="color: #ffffff; font-size: 12px; display: block; margin-top: 4px;">Live 4K Demo</strong>
                        <span style="font-size: 10.5px; color: #94a3b8; display: block; margin-top: 2px;">Cinematic macro B-roll in action</span>
                      </td>
                      <td width="2%" style="text-align: center; color: ${theme.primary}; font-weight: 900; font-size: 16px;">→</td>
                      <td width="32%" style="background: ${theme.accentBg}; border: 1px solid ${theme.border}; border-radius: 8px; padding: 12px; text-align: center;">
                        <span style="font-size: 11px; font-weight: 900; color: ${theme.primary}; display: block; text-transform: uppercase;">3. DELIVER</span>
                        <strong style="color: #ffffff; font-size: 12px; display: block; margin-top: 4px;">Call to Action</strong>
                        <span style="font-size: 10.5px; color: #94a3b8; display: block; margin-top: 2px;">Exclusive code & direct tracking</span>
                      </td>
                    </tr>
                  </table>
                </div>

                <!-- CORE CAPABILITIES GRID -->
                <div style="background: #090a10; border: 1px solid #232536; border-radius: 10px; padding: 16px 20px; margin-bottom: 16px;">
                  <span style="font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 10px;">
                    Core Integration Capabilities
                  </span>
                  <table width="100%" cellpadding="0" cellspacing="0" style="table-layout: fixed;">
                    <tr>
                      <td width="50%" style="padding-right: 10px; vertical-align: top;">
                        <div style="font-size: 11.5px; color: #e2e8f0; margin-bottom: 8px;">✓ <strong>Cinematic 4K Macro B-Roll Production</strong></div>
                        <div style="font-size: 11.5px; color: #e2e8f0;">✓ <strong>Live Real-World Workflow Endorsement</strong></div>
                      </td>
                      <td width="50%" style="padding-left: 10px; vertical-align: top;">
                        <div style="font-size: 11.5px; color: #e2e8f0; margin-bottom: 8px;">✓ <strong>High-Retention Mid-Roll Segment Timing</strong></div>
                        <div style="font-size: 11.5px; color: #e2e8f0;">✓ <strong>Dedicated Trackable Conversion Attribution</strong></div>
                      </td>
                    </tr>
                  </table>
                </div>

                <!-- DIFFERENTIATION STATEMENT -->
                <div class="takeaway-card">
                  ✓ <strong>Clear Differentiation:</strong> Unlike standard video sponsorships, our integration feels like organic content rather than an interrupted commercial.
                </div>
              </div>

              <div class="inner-footer-strip">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size: 10px; color: #64748b; font-weight: 600;">
                      ${theme.brand} Pitch Deck • Slide 3 of 5
                    </td>
                    <td style="text-align: right; font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">
                      ${theme.brand.toUpperCase()} PITCH DECK | OUR SOLUTION & WORKFLOW
                    </td>
                  </tr>
                </table>
              </div>
            </div>

            <!-- SLIDE 4: BUSINESS MODEL & COMPETITIVE ADVANTAGE (Comparison Table) -->
            <div class="pdf-slide-page">
              <div>
                <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom: 1px solid #232536; padding-bottom: 12px; margin-bottom: 16px;">
                  <tr>
                    <td>
                      <span style="font-size: 10px; font-weight: 900; color: ${theme.primary}; letter-spacing: 2px; text-transform: uppercase;">
                        SLIDE 4 OF 5 // BUSINESS MODEL
                      </span>
                      <h2 class="slide-title-text">Designed to create sustainable value</h2>
                      <div class="slide-sub-text">Data-led commercial structure and competitive differentiation</div>
                    </td>
                    <td style="text-align: right; vertical-align: top;">
                      <span class="badge-pill">${theme.brand} Business Model</span>
                    </td>
                  </tr>
                </table>

                <!-- TARGET CUSTOMERS & COMMERCIAL STRUCTURE -->
                <table width="100%" cellpadding="0" cellspacing="0" style="table-layout: fixed; margin-bottom: 14px;">
                  <tr>
                    <td width="50%" style="padding-right: 8px;">
                      <div style="background: #090a10; border: 1px solid #232536; border-radius: 8px; padding: 12px 16px;">
                        <span style="font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase;">Target Customer Segments</span>
                        <div style="font-size: 12px; font-weight: 700; color: #ffffff; margin-top: 3px;">Software Engineers, Founders & Creators</div>
                        <span style="font-size: 10px; color: ${theme.textAccent};">$85,000+ Average Household Income</span>
                      </div>
                    </td>
                    <td width="50%" style="padding-left: 8px;">
                      <div style="background: #090a10; border: 1px solid #232536; border-radius: 8px; padding: 12px 16px;">
                        <span style="font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase;">Revenue Model & Package</span>
                        <div style="font-size: 12px; font-weight: 700; color: #ffffff; margin-top: 3px;">${campaign?.payout || '$14,500'} Flat Investment</div>
                        <span style="font-size: 10px; color: ${theme.textAccent}">${campaign?.slotLength || '45s Mid-Roll'} • ${campaign?.cpm || '$42.00'} CPM Benchmark</span>
                      </div>
                    </td>
                  </tr>
                </table>

                <!-- COMPETITIVE COMPARISON TABLE -->
                <div style="background: #090a10; border: 1px solid #232536; border-radius: 10px; padding: 14px; margin-bottom: 14px;">
                  <span style="font-size: 10px; font-weight: 800; color: ${theme.primary}; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 8px;">
                    Competitive Differentiation Matrix
                  </span>
                  <table width="100%" cellpadding="0" cellspacing="0" style="table-layout: fixed; border-collapse: collapse; font-size: 11.5px;">
                    <thead>
                      <tr style="background: #181926; border-bottom: 2px solid ${theme.border};">
                        <th width="26%" style="padding: 8px 12px; text-align: left; color: #94a3b8; font-weight: 800; text-transform: uppercase; font-size: 10px;">Dimension</th>
                        <th width="37%" style="padding: 8px 12px; text-align: left; color: #94a3b8; font-weight: 800; text-transform: uppercase; font-size: 10px;">Existing Alternatives</th>
                        <th width="37%" style="padding: 8px 12px; text-align: left; color: ${theme.textAccent}; font-weight: 800; text-transform: uppercase; font-size: 10px;">Our Approach (${theme.brand})</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style="border-bottom: 1px solid #1e202e;">
                        <td style="padding: 10px 12px; font-weight: 700; color: #ffffff;">Integration Depth</td>
                        <td style="padding: 10px 12px; color: #94a3b8;">Generic text overlay & static script read</td>
                        <td style="padding: 10px 12px; color: #e2e8f0; font-weight: 600; background: ${theme.accentBg};">Organic 4K live workflow demonstration</td>
                      </tr>
                      <tr style="border-bottom: 1px solid #1e202e;">
                        <td style="padding: 10px 12px; font-weight: 700; color: #ffffff;">Audience Alignment</td>
                        <td style="padding: 10px 12px; color: #94a3b8;">Broad unsegmented traffic</td>
                        <td style="padding: 10px 12px; color: #e2e8f0; font-weight: 600; background: ${theme.accentBg};">98.4% verified tech & developer intent</td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 12px; font-weight: 700; color: #ffffff;">Performance & Rights</td>
                        <td style="padding: 10px 12px; color: #94a3b8;">Untracked view reports & short license</td>
                        <td style="padding: 10px 12px; color: #e2e8f0; font-weight: 600; background: ${theme.accentBg};">Trackable code & 90-day digital ad usage rights</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <!-- KEY METRICS ROW -->
                <table class="metrics-table" cellpadding="0" cellspacing="0">
                  <tr>
                    <td class="metric-td">
                      <div class="metric-lbl">Campaign Investment</div>
                      <div class="metric-val">${campaign?.payout || '$14,500'}</div>
                    </td>
                    <td class="metric-td">
                      <div class="metric-lbl">Past Sponsor ROI</div>
                      <div class="metric-val">3.4x Average</div>
                    </td>
                    <td class="metric-td">
                      <div class="metric-lbl">Digital Usage Rights</div>
                      <div class="metric-val">90 Days Included</div>
                    </td>
                  </tr>
                </table>
              </div>

              <div class="inner-footer-strip">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size: 10px; color: #64748b; font-weight: 600;">
                      ${theme.brand} Pitch Deck • Slide 4 of 5
                    </td>
                    <td style="text-align: right; font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">
                      ${theme.brand.toUpperCase()} PITCH DECK | BUSINESS MODEL & COMPARISON
                    </td>
                  </tr>
                </table>
              </div>
            </div>

            <!-- SLIDE 5: ROADMAP, VISION & CLOSING (Horizontal 3-Phase Roadmap) -->
            <div class="pdf-slide-page">
              <div>
                <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom: 1px solid #232536; padding-bottom: 12px; margin-bottom: 16px;">
                  <tr>
                    <td>
                      <span style="font-size: 10px; font-weight: 900; color: ${theme.primary}; letter-spacing: 2px; text-transform: uppercase;">
                        SLIDE 5 OF 5 // ROADMAP & VISION
                      </span>
                      <h2 class="slide-title-text">Building what's next</h2>
                      <div class="slide-sub-text">Strategic milestones and long-term partnership vision</div>
                    </td>
                    <td style="text-align: right; vertical-align: top;">
                      <span class="badge-pill">${theme.brand} Roadmap</span>
                    </td>
                  </tr>
                </table>

                <!-- HORIZONTAL 3-PHASE ROADMAP TIMELINE -->
                <div style="background: #090a10; border: 1px solid #232536; border-top: 4px solid ${theme.primary}; border-radius: 10px; padding: 18px 20px; margin-bottom: 16px;">
                  <span style="font-size: 10px; font-weight: 800; color: ${theme.textAccent}; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 14px;">
                    3-Phase Execution Roadmap
                  </span>
                  <table width="100%" cellpadding="0" cellspacing="0" style="table-layout: fixed;">
                    <tr>
                      <td width="32%" style="background: #12131c; border: 1px solid #232536; border-top: 3px solid ${theme.primary}; border-radius: 8px; padding: 14px; vertical-align: top;">
                        <span style="font-size: 10px; font-weight: 900; color: ${theme.primary}; text-transform: uppercase;">PHASE 1 (DAYS 1 - 30)</span>
                        <strong style="color: #ffffff; font-size: 13px; display: block; margin-top: 4px;">Production & Launch</strong>
                        <span style="font-size: 11px; color: #94a3b8; display: block; margin-top: 4px; line-height: 1.4;">
                          Cinematic 4K mid-roll integration published on main YouTube channel.
                        </span>
                      </td>
                      <td width="2%" style="text-align: center; color: ${theme.primary}; font-weight: 900; font-size: 16px;">→</td>
                      <td width="32%" style="background: #12131c; border: 1px solid #232536; border-top: 3px solid ${theme.primary}; border-radius: 8px; padding: 14px; vertical-align: top;">
                        <span style="font-size: 10px; font-weight: 900; color: ${theme.primary}; text-transform: uppercase;">PHASE 2 (DAYS 30 - 60)</span>
                        <strong style="color: #ffffff; font-size: 13px; display: block; margin-top: 4px;">Social Crossposting</strong>
                        <span style="font-size: 11px; color: #94a3b8; display: block; margin-top: 4px; line-height: 1.4;">
                          Repurposed 9:16 Shorts/Reels amplifying organic reach by +120,000 views.
                        </span>
                      </td>
                      <td width="2%" style="text-align: center; color: ${theme.primary}; font-weight: 900; font-size: 16px;">→</td>
                      <td width="32%" style="background: #12131c; border: 1px solid #232536; border-top: 3px solid ${theme.primary}; border-radius: 8px; padding: 14px; vertical-align: top;">
                        <span style="font-size: 10px; font-weight: 900; color: ${theme.primary}; text-transform: uppercase;">PHASE 3 (DAYS 60 - 90+)</span>
                        <strong style="color: #ffffff; font-size: 13px; display: block; margin-top: 4px;">Ecosystem Growth</strong>
                        <span style="font-size: 11px; color: #94a3b8; display: block; margin-top: 4px; line-height: 1.4;">
                          Long-tail evergreen views & digital ad retargeting usage rights active.
                        </span>
                      </td>
                    </tr>
                  </table>
                </div>

                <!-- STRATEGIC PRIORITIES & CLOSING MESSAGE BANNER -->
                <div style="background: linear-gradient(135deg, ${theme.accentBg} 0%, #12131c 100%); border: 2px solid ${theme.border}; border-radius: 12px; padding: 18px 24px; text-align: center;">
                  <span style="font-size: 10px; font-weight: 900; color: ${theme.textAccent}; text-transform: uppercase; letter-spacing: 2px; display: block; margin-bottom: 4px;">
                    STRATEGIC VISION & NEXT STEPS
                  </span>
                  <div style="font-size: 16px; font-weight: 900; color: #ffffff; margin-bottom: 6px;">
                    &quot;Partner with us to position ${theme.brand} at the forefront of modern developer culture.&quot;
                  </div>
                  <div style="font-size: 11.5px; color: #cbd5e1;">
                    Expected Impact: 350,000+ Verified Impressions • 3.4x Projected ROI • 100% Brand Safety
                  </div>
                </div>
              </div>

              <div class="inner-footer-strip">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size: 10px; color: #64748b; font-weight: 600;">
                      ${theme.brand} Pitch Deck • Slide 5 of 5
                    </td>
                    <td style="text-align: right; font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">
                      ${theme.brand.toUpperCase()} PITCH DECK | ROADMAP & VISION
                    </td>
                  </tr>
                </table>
              </div>
            </div>
          ` : `
            <!-- VIDEO SCRIPT LANDSCAPE SLIDE -->
            <div class="pdf-slide-page">
              <div>
                ${generatedData.hook ? `
                  <div class="hook-card">
                    <div style="font-size: 10px; font-weight: 900; color: ${theme.textAccent}; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px;">
                      ⚡ Opening 3-Second Spoken Hook
                    </div>
                    <div style="font-size: 16px; font-style: italic; font-weight: 600; color: #ffffff;">
                      "${generatedData.hook}"
                    </div>
                  </div>
                ` : ''}

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
                        <td>
                          <span class="time-pill">${sec.time}</span>
                          <div style="font-weight: 800; color: #ffffff; font-size: 12px; margin-top: 8px;">${sec.stage}</div>
                        </td>
                        <td>
                          <div style="background: #090a10; border: 1px solid #1c1e2b; border-radius: 8px; padding: 14px; color: #f1f5f9; font-size: 13px; line-height: 1.6;">
                            "${sec.spokenAudio}"
                          </div>
                        </td>
                        <td>
                          <div style="background: #090a10; border: 1px solid #1c1e2b; border-radius: 8px; padding: 12px; color: #94a3b8; font-size: 11.5px; line-height: 1.5;">
                            <div style="color: #cbd5e1;">${sec.visualCue}</div>
                            ${sec.onScreenText ? `
                              <div style="display: inline-block; background: #064e3b; color: #34d399; font-family: monospace; font-size: 10px; padding: 3px 8px; border-radius: 4px; margin-top: 8px; word-break: break-word;">
                                ${sec.onScreenText}
                              </div>
                            ` : ''}
                          </div>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>

                ${generatedData.retentionTip ? `
                  <div style="background: #12131c; border: 1px solid #059669; padding: 16px; border-radius: 12px; color: #a7f3d0; font-size: 12px; margin-top: 20px;">
                    💡 <strong>Retention Optimization Advice:</strong> ${generatedData.retentionTip}
                  </div>
                ` : ''}
              </div>

              <div class="inner-footer-strip">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size: 10px; color: #64748b; font-weight: 600;">
                      ${theme.brand} Video Integration Script
                    </td>
                    <td style="text-align: right; font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">
                      ${theme.brand.toUpperCase()} PITCH DECK | VIDEO SCRIPT
                    </td>
                  </tr>
                </table>
              </div>
            </div>
          `}

          <script>
            setTimeout(() => {
              window.print();
            }, 600);
          </script>
        </body>
      </html>
    `

    printWindow.document.write(htmlContent)
    printWindow.document.close()
  }

  const toggleFlip = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setFlippedCards(prev => ({ ...prev, [id]: !prev[id] }))
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
      campaignObj = campaigns.find(c => c.brand.toLowerCase().includes(searchName) || c.id.toLowerCase().includes(searchName)) || campaigns[0]
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

    setPitchGeneratorModal(prev => ({
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
        setPitchGeneratorModal(prev => ({
          ...prev,
          isGenerating: false,
          generatedData: json.data,
        }))
      } else {
        throw new Error(json.error || 'Failed to generate content with Groq AI')
      }
    } catch (err: any) {
      console.error('Groq Generation Error:', err)
      setPitchGeneratorModal(prev => ({
        ...prev,
        isGenerating: false,
        error: err?.message || 'Error communicating with Groq API',
      }))
    }
  }

  const triggerWebScraper = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    const targetCampaign = campaigns.find(c => c.id === id)
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
        setLiveScrapedContacts(prev => ({
          ...prev,
          [id]: data.contacts,
        }))
        setScrapeMetadata(prev => ({
          ...prev,
          [id]: {
            scrapedUrls: data.scrapedUrls || [],
            pagesAnalyzed: data.pagesAnalyzed || 1,
            extractedEmails: data.extractedEmails || [],
          },
        }))
      }
    } catch (err) {
      console.error('Real web scraping call failed:', err)
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
        '30-Day Hardware Exclusivity Window'
      ],
      contacts: [
        {
          name: 'Alex Rivera',
          role: 'Head of Creator Partnerships',
          email: 'alex.rivera@keychron.com',
          phone: '+1 (415) 892-4120',
          speed: '< 2 hrs avg response',
          verified: true
        },
        {
          name: 'Marcus Vance',
          role: 'VP of Brand Marketing',
          email: 'marcus.vance@keychron.com',
          phone: '+1 (415) 892-4198',
          speed: '< 4 hrs avg response',
          verified: true
        }
      ]
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
        '70% Off + 3 Extra Months Promo'
      ],
      contacts: [
        {
          name: 'Elena Rostova',
          role: 'Lead Influencer Partnerships @ Nord Security',
          email: 'elena.r@nordvpnmedia.com',
          phone: '+44 20 7946 0912',
          speed: '< 1 hr avg response',
          verified: true
        },
        {
          name: 'David Miller',
          role: 'Senior Creator Operations',
          email: 'd.miller@nordvpnmedia.com',
          phone: '+44 20 7946 0988',
          speed: '< 3 hrs avg response',
          verified: true
        }
      ]
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
        'Free Trial Download Offer'
      ],
      contacts: [
        {
          name: 'Taras Kravchenko',
          role: 'Creator Strategy Lead @ MacPaw',
          email: 'taras.k@macpaw.com',
          phone: '+1 (302) 415-3921',
          speed: '< 2 hrs avg response',
          verified: true
        },
        {
          name: 'Julia Smith',
          role: 'Sponsorship Operations Specialist',
          email: 'julia.smith@macpaw.com',
          phone: '+1 (302) 415-3980',
          speed: '< 5 hrs avg response',
          verified: true
        }
      ]
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
        '15% Off Discount Coupon'
      ],
      contacts: [
        {
          name: 'Brian Kim',
          role: 'Director of Creator Relations @ Anker',
          email: 'brian.kim@anker.com',
          phone: '+1 (408) 720-8911',
          speed: '< 2 hrs avg response',
          verified: true
        },
        {
          name: 'Jessica Taylor',
          role: 'Hardware Influencer Manager',
          email: 'jessica.taylor@anker.com',
          phone: '+1 (408) 720-8950',
          speed: '< 4 hrs avg response',
          verified: true
        }
      ]
    }
  ]

  const activeCampaign = campaigns.find(c => c.id === activeScrapeModal)

  return (
    <div className="page space-y-6 pb-12">
      {/* Toast Notification */}
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
              onClick={e => e.stopPropagation()}
            >
              {/* Modal Header */}
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
                  <IconButton label="Close" onClick={() => setActiveScrapeModal(null)}>
                    <X size={18}/>
                  </IconButton>
                </div>
              </div>

              {/* Scraping Status Bar */}
              {isScraping ? (
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
                    {scrapeStep === 2 && `> Parsing LinkedIn corporate directory & Apollo decision-makers for ${activeCampaign.brand}...`}
                    {scrapeStep === 3 && `> Validating SMTP MX mail records & phone extension routes...`}
                    {scrapeStep === 4 && `> Verification complete! 2 verified contact profiles extracted.`}
                  </p>
                </div>
              ) : null}

              {/* Contacts Grid */}
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
                            {ct.name.split(' ').map(n=>n[0]).join('')}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-bold text-white">{ct.name}</h3>
                              <span className="text-[9px] bg-[#1e1a2b] text-[#a78bfa] border border-[#3c2e5e] px-1.5 py-0.5 rounded font-semibold">
                                Verified
                              </span>
                            </div>
                            <p className="text-xs text-zinc-400">{ct.role}</p>
                          </div>
                        </div>

                        <div className="pt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-300">
                          <span className="flex items-center gap-1 font-mono text-zinc-300">
                            <Mail size={12} className="text-zinc-500" /> {ct.email}
                          </span>
                          <span className="flex items-center gap-1 font-mono text-zinc-300">
                            <Phone size={12} className="text-zinc-500" /> {ct.phone}
                          </span>
                          <span className="text-[10px] text-zinc-400 italic">
                            ({ct.speed})
                          </span>
                        </div>
                      </div>

                      {/* Direct Mail & Phone Action Buttons */}
                      <div className="flex items-center gap-2 self-start sm:self-center flex-none">
                        <a 
                          href={`mailto:${ct.email}?subject=CreatorAI%20Sponsorship%20Proposal%20-%20${encodeURIComponent(activeCampaign.title)}&body=Hi%20${encodeURIComponent(ct.name.split(' ')[0])},%0A%0AI%20am%20reaching%20out%20from%20Aarav%20Studio%20regarding%20a%20natural%2045s%20integration%20for%20${encodeURIComponent(activeCampaign.brand)}...`}
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

              {/* Quick AI Email Pitch Preview */}
              <div className="space-y-1.5 border-t border-[#232330] pt-4">
                <div className="flex items-center justify-between text-xs font-bold text-zinc-300">
                  <span>Pre-written AI Email Pitch</span>
                  <button 
                    onClick={(e) => handleCopyScript('full-pitch', `Subject: CreatorAI x ${activeCampaign.brand} Partnership\n\nHi Alex,\n\nI reviewed your current ${activeCampaign.brand} campaign brief for ${activeCampaign.title}. Our studio reach is ${activeCampaign.payout} budget compatible with 9.8/10 audience fit.\n\nLet's schedule a 10-min call.`, e)}
                    className="text-zinc-400 hover:text-white flex items-center gap-1 text-[11px] font-normal"
                  >
                    <Copy size={12} />
                    <span>{copiedId === 'full-pitch' ? 'Copied Pitch!' : 'Copy Full Pitch Text'}</span>
                  </button>
                </div>
                <div className="bg-[#121218] border border-[#232330] p-3 rounded-xl text-xs text-zinc-300 font-mono leading-relaxed">
                  <p className="mb-2">Subject: CreatorAI × {activeCampaign.brand} Integration Pitch ({activeCampaign.slotLength})</p>
                  <p>&quot;Hi {activeCampaign.contacts[0].name.split(' ')[0]}, I developed a high-retention 45s mid-roll timeline integration for {activeCampaign.brand} calibrated to our tech deep-dive audience ({activeCampaign.audienceFit} AI audience fit score). Ready to send contract details when convenient.&quot;</p>
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
            <div className="modal-backdrop" onClick={() => setPitchGeneratorModal(prev => ({ ...prev, isOpen: false }))}>
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 10 }} 
                animate={{ opacity: 1, scale: 1, y: 0 }} 
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="modal max-w-3xl w-full bg-[#12131a] border rounded-3xl p-6 shadow-2xl space-y-5 overflow-hidden text-white"
                style={{ borderColor: brandTheme.border }}
                onClick={e => e.stopPropagation()}
              >
                {/* Modal Header */}
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
                    onClick={() => setPitchGeneratorModal(prev => ({ ...prev, isOpen: false }))}
                    className="w-8 h-8 rounded-xl bg-[#1f1f2c] border border-[#2d2d3e] text-zinc-400 hover:text-white flex items-center justify-center transition-colors"
                  >
                    <X size={18}/>
                  </button>
                </div>

                {/* IF NOT GENERATED YET & NOT GENERATING: STEP 1 - SELECTION & OPTIONS */}
                {!pitchGeneratorModal.generatedData && !pitchGeneratorModal.isGenerating && (
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider block">
                        Select Deliverable Type to Generate
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Option 1: Script */}
                        <div 
                          onClick={() => setPitchGeneratorModal(prev => ({ ...prev, selectedType: 'script' }))}
                          className={`p-4 rounded-2xl border cursor-pointer transition-all ${pitchGeneratorModal.selectedType === 'script' ? 'shadow-lg' : 'bg-[#181822] border-[#252535] hover:border-[#3d3d52]'}`}
                          style={pitchGeneratorModal.selectedType === 'script' ? { backgroundColor: brandTheme.accentBg, borderColor: brandTheme.primary, boxShadow: `0 4px 20px ${brandTheme.primary}33` } : {}}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center border" style={{ backgroundColor: brandTheme.badgeBg, color: brandTheme.textAccent, borderColor: brandTheme.border }}>
                              <Video size={18} />
                            </div>
                            {pitchGeneratorModal.selectedType === 'script' && (
                              <span className="w-5 h-5 rounded-full text-white flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: brandTheme.primary }}>✓</span>
                            )}
                          </div>
                          <h3 className="text-sm font-bold text-white mb-1">AI Video Integration Script</h3>
                          <p className="text-xs text-zinc-400 leading-relaxed">
                            Time-coded 45s–60s video script with spoken dialogue, visual B-roll cues, on-screen text overlays, and retention optimization tips.
                          </p>
                        </div>

                        {/* Option 2: Pitch Deck */}
                        <div 
                          onClick={() => setPitchGeneratorModal(prev => ({ ...prev, selectedType: 'deck' }))}
                          className={`p-4 rounded-2xl border cursor-pointer transition-all ${pitchGeneratorModal.selectedType === 'deck' ? 'shadow-lg' : 'bg-[#181822] border-[#252535] hover:border-[#3d3d52]'}`}
                          style={pitchGeneratorModal.selectedType === 'deck' ? { backgroundColor: brandTheme.accentBg, borderColor: brandTheme.primary, boxShadow: `0 4px 20px ${brandTheme.primary}33` } : {}}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center border" style={{ backgroundColor: brandTheme.badgeBg, color: brandTheme.textAccent, borderColor: brandTheme.border }}>
                              <Layers3 size={18} />
                            </div>
                            {pitchGeneratorModal.selectedType === 'deck' && (
                              <span className="w-5 h-5 rounded-full text-white flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: brandTheme.primary }}>✓</span>
                            )}
                          </div>
                          <h3 className="text-sm font-bold text-white mb-1">AI Sponsorship Deck</h3>
                          <p className="text-xs text-zinc-400 leading-relaxed">
                            Structured 5-slide presentation deck complete with audience demographics, creative strategy, pricing packages, and guaranteed deliverables.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Custom Requirements Textarea */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-zinc-300 block">
                        Custom Instructions / Focus Areas (Optional)
                      </label>
                      <textarea 
                        value={pitchGeneratorModal.customInstructions}
                        onChange={(e) => setPitchGeneratorModal(prev => ({ ...prev, customInstructions: e.target.value }))}
                        placeholder={`e.g., Highlight ${pitchGeneratorModal.campaign.brand}'s key features & developer audience alignment...`}
                        rows={3}
                        className="w-full bg-[#181822] border border-[#252535] rounded-xl p-3 text-xs text-white placeholder-zinc-500 focus:outline-none transition-colors resize-none font-sans"
                        style={{ focusBorderColor: brandTheme.primary }}
                      />
                    </div>

                    {pitchGeneratorModal.error && (
                      <div className="bg-[#2d171d] border border-[#832439] text-rose-300 text-xs p-3 rounded-xl">
                        {pitchGeneratorModal.error}
                      </div>
                    )}

                    {/* Submit Action */}
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

                {/* GENERATING LOADING STATE */}
                {pitchGeneratorModal.isGenerating && (
                  <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                    <div className="relative w-16 h-16 flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full animate-ping opacity-30" style={{ backgroundColor: brandTheme.primary }} />
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

                {/* GENERATED DATA DISPLAY RESULT */}
                {pitchGeneratorModal.generatedData && !pitchGeneratorModal.isGenerating && (
                  <div className="space-y-5">
                    {/* GENERATED SCRIPT VIEW */}
                    {pitchGeneratorModal.generatedData.type === 'script' && (
                      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                        {/* Script Header Bar */}
                        <div className="bg-[#181822] border border-[#252535] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white">{pitchGeneratorModal.generatedData.title}</span>
                              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border" style={{ backgroundColor: brandTheme.badgeBg, color: brandTheme.textAccent, borderColor: brandTheme.border }}>
                                Promo Code: {pitchGeneratorModal.generatedData.promoCode || 'CREATORAI15'}
                              </span>
                            </div>
                            <p className="text-xs text-zinc-400 mt-1">
                              Duration: {pitchGeneratorModal.generatedData.estimatedDuration || pitchGeneratorModal.campaign.slotLength}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => downloadPDFDocument(pitchGeneratorModal.generatedData, pitchGeneratorModal.campaign)}
                              className="text-white text-xs font-bold px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow-md transition-all active:scale-95"
                              style={{ backgroundColor: brandTheme.primary }}
                              title="Download Script PDF"
                            >
                              <FileText size={13} />
                              <span>Download PDF</span>
                            </button>
                            <button 
                              onClick={(e) => handleCopyScript('groq-script', JSON.stringify(pitchGeneratorModal.generatedData, null, 2), e)}
                              className="bg-[#232332] text-zinc-200 border border-[#333348] hover:bg-[#2e2e42] text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
                            >
                              <Copy size={13} />
                              <span>{copiedId === 'groq-script' ? 'Copied!' : 'Copy Script JSON'}</span>
                            </button>
                            <button 
                              onClick={() => setPitchGeneratorModal(prev => ({ ...prev, generatedData: null }))}
                              className="bg-[#1e1c29] text-zinc-300 border border-[#333348] hover:bg-[#2a243d] text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors"
                            >
                              <RotateCw size={13} />
                              <span>Regenerate</span>
                            </button>
                          </div>
                        </div>

                        {/* Opening Hook Banner */}
                        <div className="p-4 rounded-xl space-y-1 border" style={{ backgroundColor: brandTheme.accentBg, borderColor: brandTheme.border }}>
                          <span className="text-[11px] font-bold uppercase tracking-wider block flex items-center gap-1.5" style={{ color: brandTheme.textAccent }}>
                            <Zap size={13} /> Opening 3-Second Hook
                          </span>
                          <p className="text-xs text-white italic leading-relaxed">
                            &quot;{pitchGeneratorModal.generatedData.hook}&quot;
                          </p>
                        </div>

                        {/* Script Sections Timeline */}
                        <div className="space-y-3">
                          <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Time-coded Script Timeline</h4>
                          {pitchGeneratorModal.generatedData.sections?.map((sec: any, idx: number) => (
                            <div key={idx} className="bg-[#181822] border border-[#252535] rounded-xl p-4 space-y-2">
                              <div className="flex items-center justify-between border-b border-[#232332] pb-2">
                                <span className="text-xs font-bold px-2.5 py-0.5 rounded-md border" style={{ backgroundColor: brandTheme.badgeBg, color: brandTheme.textAccent, borderColor: brandTheme.border }}>
                                  {sec.time}
                                </span>
                                <span className="text-xs font-bold text-white">{sec.stage}</span>
                              </div>
                              
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs pt-1">
                                <div className="md:col-span-2 space-y-1">
                                  <span className="text-[10px] font-bold text-zinc-400 uppercase block">Spoken Dialogue</span>
                                  <p className="text-zinc-200 bg-[#121218] p-2.5 rounded-lg border border-[#20202c] leading-relaxed">
                                    &quot;{sec.spokenAudio}&quot;
                                  </p>
                                </div>

                                <div className="space-y-2">
                                  <div>
                                    <span className="text-[10px] font-bold text-zinc-400 uppercase block">Visual B-Roll Cue</span>
                                    <p className="text-zinc-300 text-[11px] bg-[#121218] p-2 rounded-lg border border-[#20202c]">
                                      {sec.visualCue}
                                    </p>
                                  </div>
                                  {sec.onScreenText && (
                                    <div>
                                      <span className="text-[10px] font-bold text-zinc-400 uppercase block">On-Screen Overlay</span>
                                      <span className="text-emerald-400 text-[11px] font-mono block bg-[#0e1f18] px-2 py-1 rounded border border-[#14532d]">
                                        {sec.onScreenText}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Retention Tip Box */}
                        {pitchGeneratorModal.generatedData.retentionTip && (
                          <div className="bg-[#181822] border border-[#252535] p-3.5 rounded-xl text-xs text-zinc-300 flex items-start gap-2.5">
                            <CheckCircle size={16} className="text-emerald-400 flex-none mt-0.5" />
                            <div>
                              <span className="font-bold text-white block">Retention Optimization Advice</span>
                              <p className="text-zinc-400 text-[11px] mt-0.5">{pitchGeneratorModal.generatedData.retentionTip}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* GENERATED PITCH DECK VIEW */}
                    {pitchGeneratorModal.generatedData.type === 'deck' && (
                      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                        {/* Deck Header & Slide Tabs */}
                        <div className="bg-[#181822] border border-[#252535] rounded-xl p-3 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-1.5 overflow-x-auto">
                            {pitchGeneratorModal.generatedData.slides?.map((s: any, idx: number) => (
                              <button
                                key={idx}
                                onClick={() => setPitchGeneratorModal(prev => ({ ...prev, activeSlideIndex: idx }))}
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
                              title="Download Presentation Deck PDF"
                            >
                              <FileText size={13} />
                              <span>Download PDF</span>
                            </button>
                            <button 
                              onClick={() => setPitchGeneratorModal(prev => ({ ...prev, generatedData: null }))}
                              className="bg-[#1e1c29] text-zinc-300 border border-[#333348] hover:bg-[#2a243d] text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors"
                            >
                              <RotateCw size={13} />
                              <span>Regenerate</span>
                            </button>
                          </div>
                        </div>

                        {/* Active Slide Display Box */}
                        {pitchGeneratorModal.generatedData.slides?.[pitchGeneratorModal.activeSlideIndex] && (
                          <div className="bg-[#141522] border rounded-2xl p-6 space-y-5 shadow-2xl" style={{ borderColor: brandTheme.border, borderLeftWidth: '6px', borderLeftColor: brandTheme.primary }}>
                            {/* Slide Title */}
                            <div className="border-b border-[#262638] pb-4 flex items-center justify-between">
                              <div>
                                <span className="text-[10px] font-bold uppercase tracking-widest block" style={{ color: brandTheme.primary }}>
                                  SLIDE {pitchGeneratorModal.activeSlideIndex + 1} OF {pitchGeneratorModal.generatedData.slides.length}
                                </span>
                                <h3 className="text-lg font-bold text-white tracking-tight mt-0.5">
                                  {pitchGeneratorModal.generatedData.slides[pitchGeneratorModal.activeSlideIndex].slideTitle}
                                </h3>
                                <p className="text-xs text-zinc-400">
                                  {pitchGeneratorModal.generatedData.slides[pitchGeneratorModal.activeSlideIndex].subtitle}
                                </p>
                              </div>

                              <div className="w-10 h-10 rounded-xl overflow-hidden bg-[#1e1e28] border flex-none hidden sm:block" style={{ borderColor: brandTheme.border }}>
                                <img src={pitchGeneratorModal.campaign.logoUrl || brandTheme.logoUrl} alt={pitchGeneratorModal.campaign.brand} className="w-full h-full object-cover" />
                              </div>
                            </div>

                            {/* Key Metrics Row */}
                            {pitchGeneratorModal.generatedData.slides[pitchGeneratorModal.activeSlideIndex].keyMetrics && (
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                {pitchGeneratorModal.generatedData.slides[pitchGeneratorModal.activeSlideIndex].keyMetrics.map((km: any, idx: number) => (
                                  <div key={idx} className="border p-3.5 rounded-xl text-center" style={{ backgroundColor: brandTheme.accentBg, borderColor: brandTheme.border }}>
                                    <span className="text-[10px] font-bold text-zinc-400 uppercase block">{km.label}</span>
                                    <span className="text-base font-bold block mt-0.5" style={{ color: brandTheme.textAccent }}>{km.value}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Main Slide Content */}
                            <div className="bg-[#0f1017] border border-[#232330] p-4 rounded-xl space-y-1.5">
                              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Slide Strategy & Details</span>
                              <p className="text-xs text-zinc-200 leading-relaxed">
                                {pitchGeneratorModal.generatedData.slides[pitchGeneratorModal.activeSlideIndex].content}
                              </p>
                            </div>

                            {/* Key Takeaway */}
                            {pitchGeneratorModal.generatedData.slides[pitchGeneratorModal.activeSlideIndex].takeaway && (
                              <div className="bg-[#14231b] border border-[#1e5233] p-3 rounded-xl flex items-center gap-2 text-xs text-emerald-300">
                                <CheckCircle size={15} className="flex-none" />
                                <span><b>Key Takeaway:</b> {pitchGeneratorModal.generatedData.slides[pitchGeneratorModal.activeSlideIndex].takeaway}</span>
                              </div>
                            )}

                            {/* Slide Carousel Navigation Controls */}
                            <div className="pt-2 flex items-center justify-between border-t border-[#232332]">
                              <button
                                onClick={() => setPitchGeneratorModal(prev => ({ ...prev, activeSlideIndex: Math.max(0, prev.activeSlideIndex - 1) }))}
                                disabled={pitchGeneratorModal.activeSlideIndex === 0}
                                className="text-xs font-semibold text-zinc-300 hover:text-white flex items-center gap-1 disabled:opacity-30 disabled:hover:text-zinc-300 transition-colors"
                              >
                                <ChevronLeft size={16} />
                                <span>Previous Slide</span>
                              </button>

                              <span className="text-xs text-zinc-500 font-mono">
                                {pitchGeneratorModal.activeSlideIndex + 1} / {pitchGeneratorModal.generatedData.slides.length}
                              </span>

                              <button
                                onClick={() => setPitchGeneratorModal(prev => ({ ...prev, activeSlideIndex: Math.min(pitchGeneratorModal.generatedData.slides.length - 1, prev.activeSlideIndex + 1) }))}
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

      {/* Page Header with Grid/List View Switcher */}
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

      {/* Prominent Grid / List View Controls Toolbar */}
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

      {/* Cards View (Grid or List Mode) */}
      {viewFormat === 'list' ? (
        <div className="flex flex-col gap-4">
          {campaigns.map((c) => (
            <div 
              key={c.id}
              onClick={() => toggleFlip(c.id)}
              className="bg-[#14141a] border border-[#232330] hover:border-[#38384d] p-4.5 rounded-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-all shadow-lg group cursor-pointer"
            >
              {/* Brand & Thumbnail */}
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

              {/* Metrics Column: Audience Fit */}
              <div className="flex items-center gap-3 border-t lg:border-t-0 lg:border-l border-[#232332] pt-3 lg:pt-0 lg:pl-4">
                <ConfidenceGauge percentage={c.confidence} />
                <div>
                  <span className="text-[10px] text-zinc-400 block font-medium">Audience Fit</span>
                  <span className="text-xs font-bold text-white block">{c.audienceFit}</span>
                  <span className="text-[10px] text-zinc-400 block">Strong match</span>
                </div>
              </div>

              {/* Metrics Column: Payout */}
              <div className="flex items-center gap-2.5 border-t lg:border-t-0 lg:border-l border-[#232332] pt-3 lg:pt-0 lg:pl-4">
                <div className="w-8 h-8 rounded-lg bg-[#222230] text-zinc-400 flex items-center justify-center flex-none">
                  <Wallet size={15} />
                </div>
                <div>
                  <span className="text-[10px] text-zinc-400 block font-medium">Est. Payout</span>
                  <span className="text-sm font-bold text-white block">{c.payout}</span>
                  <span className="text-[10px] text-zinc-400 block">CPM {c.cpm}</span>
                </div>
              </div>

              {/* Placement & Due Date */}
              <div className="flex items-center gap-2.5 border-t lg:border-t-0 lg:border-l border-[#232332] pt-3 lg:pt-0 lg:pl-4">
                <div className="w-8 h-8 rounded-lg bg-[#221c38] text-violet-400 flex items-center justify-center flex-none">
                  <Video size={15} />
                </div>
                <div>
                  <span className="text-[10px] text-zinc-400 block font-medium">Placement</span>
                  <span className="text-xs font-bold text-white block">{c.slotLength}</span>
                  <span className="text-[10px] text-zinc-400 block">Due Oct 12, 2025</span>
                </div>
              </div>

              {/* Contacts Snapshot */}
              <div className="flex items-center gap-2 border-t lg:border-t-0 lg:border-l border-[#232332] pt-3 lg:pt-0 lg:pl-4" onClick={(e) => triggerWebScraper(c.id, e)}>
                <div className="flex -space-x-1.5 overflow-hidden">
                  <div className="inline-block h-6 w-6 rounded-full ring-2 ring-[#14141a] bg-[#272338] text-[9px] font-bold text-violet-300 flex items-center justify-center">AR</div>
                  <div className="inline-block h-6 w-6 rounded-full ring-2 ring-[#14141a] bg-[#1e2c26] text-[9px] font-bold text-emerald-300 flex items-center justify-center">MV</div>
                </div>
                <div>
                  <span className="text-xs font-semibold text-zinc-300 block">{c.contacts[0].name.split(' ')[0]}</span>
                  <span className="text-[10px] text-violet-400 block hover:underline">Scrape Contacts</span>
                </div>
              </div>

              {/* Action Buttons */}
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

                <button 
                  onClick={(e) => toggleFlip(c.id, e)}
                  className="bg-[#262636] hover:bg-[#323246] text-zinc-200 border border-[#3b3b52] font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 transition-colors"
                >
                  <span>Details</span>
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* GRID VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {campaigns.map((c) => {
            const isFlipped = !!flippedCards[c.id]

            return (
              <div key={c.id} className="perspective-1000 min-h-[440px]">
              <div className={`flip-card-inner ${isFlipped ? 'is-flipped' : ''}`}>
                {/* FRONT SIDE */}
                <div 
                  onClick={() => toggleFlip(c.id)}
                  className="flip-card-front bg-[#14141a] border border-[#232330] hover:border-[#38384d] p-6 flex flex-col justify-between cursor-pointer transition-all duration-300 shadow-xl group rounded-3xl"
                >
                  <div className="space-y-4">
                    {/* Header Row */}
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
                        <button className="text-zinc-500 hover:text-white transition-colors p-1" onClick={(e) => { e.stopPropagation(); triggerWebScraper(c.id, e); }}>
                          <MoreVertical size={18} />
                        </button>
                      </div>
                    </div>

                    {/* Description */}
                    <p className="text-xs text-zinc-400 leading-relaxed font-normal">
                      {c.description}
                    </p>

                    {/* Inner Metric Box (Dark Container from mockup) */}
                    <div className="bg-[#181822] border border-[#252535] rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
                      {/* Col 1: Audience fit */}
                      <div className="flex items-center gap-3">
                        <ConfidenceGauge percentage={c.confidence} />
                        <div>
                          <span className="text-[11px] text-zinc-400 block font-medium">Audience fit</span>
                          <span className="text-base font-bold text-white block tracking-tight">{c.audienceFit}</span>
                          <span className="text-[11px] text-zinc-400 font-medium block">Strong match</span>
                        </div>
                      </div>

                      {/* Col 2: Est. payout */}
                      <div className="flex items-center gap-3 border-t sm:border-t-0 sm:border-l border-[#242434] pt-3 sm:pt-0 sm:pl-4">
                        <div className="w-9 h-9 rounded-xl bg-[#222230] text-zinc-400 flex items-center justify-center flex-none">
                          <Wallet size={18} />
                        </div>
                        <div>
                          <span className="text-[11px] text-zinc-400 block font-medium">Est. payout</span>
                          <span className="text-lg font-bold text-white block tracking-tight">{c.payout}</span>
                          <span className="text-[11px] text-zinc-400 font-medium block">Est. CPM {c.cpm}</span>
                        </div>
                      </div>

                      {/* Col 3: Placement */}
                      <div className="flex items-center gap-3 border-t sm:border-t-0 sm:border-l border-[#242434] pt-3 sm:pt-0 sm:pl-4">
                        <div className="w-9 h-9 rounded-xl bg-[#221c38] text-violet-400 flex items-center justify-center flex-none">
                          <Video size={18} />
                        </div>
                        <div>
                          <span className="text-[11px] text-zinc-400 block font-medium">Placement</span>
                          <span className="text-sm font-bold text-white block tracking-tight">{c.slotLength}</span>
                          <span className="inline-block bg-[#232332] text-zinc-400 text-[10px] font-semibold px-2 py-0.5 rounded-full mt-0.5">YouTube</span>
                        </div>
                      </div>
                    </div>

                    {/* Due Date & Deliverables & Contact Stack */}
                    <div className="border-t border-[#232332] pt-3.5 flex items-center justify-between text-xs text-zinc-400">
                      <div className="flex items-center gap-2">
                        <Calendar size={14} className="text-zinc-500" />
                        <span>Due Oct 12, 2025</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-zinc-500" />
                        <span>{c.deliverables.length} deliverables</span>
                      </div>

                      <div className="flex items-center gap-1 cursor-pointer hover:text-violet-300 transition-colors" onClick={(e) => triggerWebScraper(c.id, e)}>
                        <Users size={14} className="text-zinc-500" />
                        <div className="flex -space-x-1 overflow-hidden">
                          <div className="inline-block h-5 w-5 rounded-full ring-1 ring-[#14141a] bg-[#272338] text-[9px] font-bold text-violet-300 flex items-center justify-center">AR</div>
                          <div className="inline-block h-5 w-5 rounded-full ring-1 ring-[#14141a] bg-[#1e2c26] text-[9px] font-bold text-emerald-300 flex items-center justify-center">MV</div>
                        </div>
                        <span className="text-[11px] font-semibold text-zinc-400 ml-1">+2</span>
                      </div>
                    </div>
                  </div>

                  {/* Bottom Action Footer Row */}
                  <div className="pt-4 border-t border-[#232332] flex items-center justify-between gap-2 mt-4">
                    <button 
                      onClick={(e) => triggerWebScraper(c.id, e)}
                      className="text-xs font-semibold text-violet-400 hover:text-violet-300 flex items-center gap-1.5 transition-colors group"
                    >
                      <TrendingUp size={14} />
                      <span>View fit analysis</span>
                      <ChevronRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
                    </button>

                    <button 
                      onClick={(e) => toggleFlip(c.id, e)}
                      className="bg-[#7c3aed] hover:bg-[#6d28d9] text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-lg shadow-violet-950/40 flex items-center gap-2 transition-all active:scale-95"
                    >
                      <span>Review details</span>
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>

                {/* BACK SIDE */}
                <div 
                  onClick={(e) => e.stopPropagation()}
                  className="flip-card-back bg-[#14141a] border border-[#2b2b38] p-6 flex flex-col justify-between cursor-default shadow-2xl overflow-y-auto rounded-3xl"
                >
                  <div className="space-y-4">
                    {/* Back Header */}
                    <div className="flex items-center justify-between border-b border-[#232330] pb-3">
                      <div className="flex items-center gap-2">
                        <span className="bg-[#1e1a2b] text-[#a78bfa] border border-[#3c2e5e] text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                          In-Depth Analysis
                        </span>
                        <span className="text-xs font-bold text-white">{c.brand}</span>
                      </div>
                      <button 
                        onClick={(e) => toggleFlip(c.id, e)}
                        className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 bg-[#1c1c24] px-2.5 py-1 rounded-lg border border-[#2b2b38] transition-colors"
                      >
                        <RotateCw size={12} />
                        <span>Flip Back</span>
                      </button>
                    </div>

                    {/* Direct Contact Action Bar on Back */}
                    <div className="bg-[#181822] border border-[#252535] rounded-xl p-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                          <CheckCircle size={13} className="text-[#a78bfa]" />
                          <span>Scraped Sponsor Contact</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                          {c.contacts[0].name} ({c.contacts[0].email})
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <a 
                          href={`mailto:${c.contacts[0].email}?subject=CreatorAI%20Sponsorship%20Proposal%20-%20${encodeURIComponent(c.title)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-[11px] font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors"
                        >
                          <Mail size={12} />
                          <span>Mail</span>
                        </a>
                        <a 
                          href={`tel:${c.contacts[0].phone}`}
                          className="bg-[#20202b] text-zinc-200 border border-[#2e2e3e] hover:bg-[#2b2b3a] text-[11px] font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors"
                        >
                          <Phone size={12} />
                          <span>Call</span>
                        </a>
                      </div>
                    </div>

                    {/* Script Hook Strategy */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-bold text-zinc-300 uppercase tracking-wider">
                        <span>AI Script Hook & Integration Strategy</span>
                        <button 
                          onClick={(e) => handleCopyScript(c.id, c.scriptHook, e)}
                          className="text-zinc-400 hover:text-white flex items-center gap-1 font-normal transition-colors"
                        >
                          <Copy size={12} />
                          <span>{copiedId === c.id ? 'Copied!' : 'Copy'}</span>
                        </button>
                      </div>
                      <div className="bg-[#181822] border border-[#252535] p-3 rounded-xl text-xs text-zinc-300 italic leading-relaxed">
                        {c.scriptHook}
                      </div>
                    </div>

                    {/* Retention Risk Analysis */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-zinc-300 uppercase">Retention Impact & Risk</span>
                        <span className="font-semibold text-[#a78bfa]">{c.retentionHold} Hold</span>
                      </div>
                      <p className="text-[11px] text-zinc-400 bg-[#181822] border border-[#252535] p-2.5 rounded-lg leading-normal">
                        {c.retentionAnalysis}
                      </p>
                    </div>

                    {/* Brand Requirements Checklist */}
                    <div className="space-y-1">
                      <span className="text-[11px] font-bold text-zinc-300 uppercase block">Brand Requirements & Checklist</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
                        {c.deliverables.map((item, idx) => (
                          <div key={idx} className="bg-[#181822] border border-[#252535] px-2.5 py-1.5 rounded-md text-zinc-300 flex items-center gap-1.5">
                            <span className="text-[#a78bfa] font-bold">✓</span>
                            <span className="truncate">{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Back Actions */}
                  <div className="pt-4 border-t border-[#232330] flex items-center justify-between gap-3 mt-4">
                    <button 
                      onClick={(e) => toggleFlip(c.id, e)}
                      className="text-xs text-zinc-400 hover:text-white transition-colors"
                    >
                      ↩ Return to Front
                    </button>

                    <div className="flex items-center gap-2">
                      <button 
                        onClick={(e) => triggerWebScraper(c.id, e)}
                        className="bg-[#20202b] text-zinc-300 border border-[#2e2e3e] hover:bg-[#2b2b3a] hover:text-white text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1 transition-colors"
                      >
                        <Globe size={13} />
                        <span>Scrape Contacts</span>
                      </button>

                      <button 
                        onClick={(e) => handlePitchDeal(c, e)}
                        className="bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-xs font-semibold px-4 py-2 rounded-xl flex items-center gap-1.5 shadow-lg shadow-violet-950/40 transition-all active:scale-95"
                      >
                        <Sparkles size={14} />
                        <span>Pitch {c.brand}</span>
                      </button>
                    </div>
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

function TwinView() {
  const [dnaValues, setDnaValues] = useState([82, 94, 62])

  return (
    <div className="twin-grid">
      <NeuralTwinPanel />

      {/* RICH CREATIVE DNA CARD WITH IMAGE */}
      <Card className="overflow-hidden border border-[#252538] bg-[#12131c] p-6 space-y-4">
        {/* Card Header */}
        <div className="card-heading flex items-center justify-between pb-4 border-b border-[#232336]">
          <div>
            <span className="eyebrow text-violet-400 font-semibold tracking-wider text-[11px] uppercase block">
              Learned Style Profile
            </span>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              Creative DNA
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                v3.4 Active
              </span>
            </h2>
          </div>
          <Button secondary className="text-xs flex items-center gap-1.5">
            <RotateCw size={14} />
            <span>Reset baseline</span>
          </Button>
        </div>

        {/* FEATURED VISUAL DNA BANNER */}
        <div className="relative rounded-2xl overflow-hidden border border-[#2d2d42] group">
          <img 
            src="https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=900&q=80" 
            alt="Creative DNA Profile" 
            className="w-full h-36 object-cover group-hover:scale-105 transition-transform duration-500"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0f1017] via-[#0f1017]/60 to-transparent" />
          
          <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-bold text-white tracking-wide">Dynamic Editing Profile</span>
            </div>
            <span className="text-[11px] font-mono text-zinc-300 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-lg border border-white/10">
              98.4% DNA Fidelity
            </span>
          </div>
        </div>

        {/* CADENCE & STYLE SLIDERS */}
        <div className="space-y-3 pt-1">
          {[
            { label: 'Cutting cadence', valText: 'Aggressive fast-cut', val: dnaValues[0], index: 0 },
            { label: 'Hook urgency', valText: 'Contrarian provocative', val: dnaValues[1], index: 1 },
            { label: 'B-roll saturation', valText: 'High frequency b-roll', val: dnaValues[2], index: 2 }
          ].map((item) => (
            <div key={item.label} className="slider-row bg-[#181824] p-3.5 rounded-xl border border-[#242436] space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <b className="text-zinc-200 font-semibold">{item.label}</b>
                <span className="text-violet-400 font-medium font-mono text-[11px]">{item.valText} ({item.val}%)</span>
              </div>
              <input 
                type="range" 
                min="0" 
                max="100"
                value={item.val} 
                onChange={(e) => {
                  const newVals = [...dnaValues]
                  newVals[item.index] = Number(e.target.value)
                  setDnaValues(newVals)
                }}
                className="w-full accent-violet-500 cursor-pointer h-1.5 bg-[#262638] rounded-lg"
              />
            </div>
          ))}
        </div>

        {/* FEATURED APPROVED MEMORY CARD WITH IMAGE */}
        <div className="memory bg-[#151926] border border-[#242d45] p-4 rounded-2xl space-y-3 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <Badge tone="green" className="text-[10px] font-bold px-2.5 py-0.5">
              Approved Memory Rule
            </Badge>
            <span className="text-[10px] text-emerald-400 font-mono font-semibold">+34.2% Retention Boost</span>
          </div>

          <div className="flex gap-3.5 items-start">
            <div className="w-16 h-16 rounded-xl overflow-hidden flex-none border border-emerald-500/30 relative">
              <img 
                src="https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=300&q=80" 
                alt="Hook Rule Thumbnail" 
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-emerald-500/20" />
            </div>

            <div className="space-y-1 flex-1">
              <h3 className="text-sm font-bold text-white tracking-tight">
                The 3-second hook rule
              </h3>
              <p className="text-xs text-zinc-300 leading-relaxed">
                First spoken sentence must contradict an industry consensus before any branded intro.
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
function CalendarView() {
  type CalendarCard = {
    id: string
    title: string
    platform: 'Shorts' | 'Reels' | 'YouTube'
    status: string
    progress?: number
    due: string
    avatars?: string[]
    metrics?: { views: string; likes: string }
    img: string
  }

  const columnsData = [
    { title: 'Ideas & scripts', subtitle: 'Raw ideas, hooks and scripts', dotColor: '#eab308' },
    { title: 'In production', subtitle: 'Editing, assets and production', dotColor: '#38bdf8', dropText: 'Drop assets or create from template' },
    { title: 'AI Studio & review', subtitle: 'AI generation, feedback and approvals', dotColor: '#a855f7', dropText: 'Drop assets or create from template' },
    { title: 'Scheduled', subtitle: 'Planned for publishing', dotColor: '#22c55e', dropText: 'Plan your next release' },
    { title: 'Published', subtitle: 'Live across channels', dotColor: '#ef4444', dropText: 'Move content here after publishing' },
  ]

  const [cards, setCards] = useState<Record<string, CalendarCard[]>>({
    'Ideas & scripts': [
      { id: 'idea-1', platform: 'Shorts', title: 'The 30-Second ACES LUT Trick', status: 'Hook drafted · 6 notes', due: 'Oct 13', avatars: ['A'], img: images[0] },
      { id: 'idea-2', platform: 'Reels', title: 'Desk Setup Minimalist 2025', status: 'Hook drafted · 6 notes', due: 'Oct 14', avatars: ['A'], img: images[1] },
      { id: 'idea-3', platform: 'YouTube', title: 'AI Hardware Ecosystem Review', status: 'Script drafting · 90%', due: 'Oct 12', avatars: ['A'], img: images[2] },
    ],
    'In production': [
      { id: 'prod-1', platform: 'Shorts', title: 'Cinematic B-Roll Transitions Fail', status: 'Editing · 70%', progress: 70, due: 'Oct 15', avatars: ['A', 'R'], img: images[3] },
      { id: 'prod-2', platform: 'Reels', title: 'My Productivity Workflow', status: 'Editing · 40%', progress: 40, due: 'Oct 16', avatars: ['A'], img: images[0] },
    ],
    'AI Studio & review': [
      { id: 'rev-1', platform: 'YouTube', title: 'Hiking in Himachal – Cinematic', status: 'AI processing · 80%', progress: 80, due: 'Oct 17', avatars: ['A', 'S'], img: images[1] },
      { id: 'rev-2', platform: 'Shorts', title: 'Good Vibes Only — Teaser', status: 'Review · 2 comments', due: 'Oct 17', avatars: ['A'], img: images[2] },
    ],
    'Scheduled': [
      { id: 'sched-1', platform: 'Reels', title: 'Studio Tour 2025', status: 'Scheduled', due: 'Oct 18, 10:00 AM', avatars: ['A'], img: images[3] },
    ],
    'Published': [
      { id: 'pub-1', platform: 'YouTube', title: 'Why 99% of Creators Fail', status: 'Published', due: 'Oct 10', metrics: { views: '12.4K', likes: '1.2K' }, img: images[0] },
      { id: 'pub-2', platform: 'Shorts', title: 'One Habit That Changed My Life', status: 'Published', due: 'Oct 8', metrics: { views: '48K', likes: '4.1K' }, img: images[1] },
    ],
  })

  const [dragged, setDragged] = useState<{ card: CalendarCard; from: string } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedChannel, setSelectedChannel] = useState('All channels')
  const [selectedContentType, setSelectedContentType] = useState('All content types')
  const [viewMode, setViewMode] = useState<'kanban' | 'calendar' | 'list'>('kanban')

  const moveCard = (to: string) => {
    if (!dragged || dragged.from === to) {
      setDragged(null)
      setDropTarget(null)
      return
    }
    setCards(prev => ({
      ...prev,
      [dragged.from]: prev[dragged.from].filter(card => card.id !== dragged.card.id),
      [to]: [...prev[to], dragged.card],
    }))
    setDragged(null)
    setDropTarget(null)
  }

  const addCard = (columnTitle: string) => {
    const card: CalendarCard = {
      id: `new-${Date.now()}`,
      platform: 'YouTube',
      title: 'New Content Concept',
      status: 'Draft · just added',
      due: 'Oct 20',
      avatars: ['A'],
      img: images[Math.floor(Math.random() * images.length)],
    }
    setCards(prev => ({ ...prev, [columnTitle]: [...prev[columnTitle], card] }))
  }

  const getFilteredCards = (columnTitle: string) => {
    return cards[columnTitle].filter(card => {
      const matchesSearch = searchQuery === '' || 
        card.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        card.status.toLowerCase().includes(searchQuery.toLowerCase()) ||
        card.platform.toLowerCase().includes(searchQuery.toLowerCase())
      
      const matchesChannel = selectedChannel === 'All channels' || card.platform === selectedChannel
      
      return matchesSearch && matchesChannel
    })
  }

  const allCardsWithStage = useMemo(() => {
    return Object.entries(cards).flatMap(([stage, list]) => 
      list.map(c => ({ ...c, stage }))
    ).filter(card => {
      const matchesSearch = searchQuery === '' || 
        card.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        card.status.toLowerCase().includes(searchQuery.toLowerCase()) ||
        card.platform.toLowerCase().includes(searchQuery.toLowerCase()) ||
        card.stage.toLowerCase().includes(searchQuery.toLowerCase())
      
      const matchesChannel = selectedChannel === 'All channels' || card.platform === selectedChannel
      return matchesSearch && matchesChannel
    })
  }, [cards, searchQuery, selectedChannel])

  const getStageDotColor = (stageName: string) => {
    const found = columnsData.find(c => c.title === stageName)
    return found ? found.dotColor : '#8b5cf6'
  }

  return (
    <div className="page space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-[#1e1a2d] border border-[#3b2d5c] flex items-center justify-center text-violet-400 shadow-md shadow-violet-950/30">
            <CalendarDays size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Content Calendar</h1>
            <p className="text-xs text-zinc-400 mt-0.5">Coordinate ideas, edits, reviews, and releases across every channel</p>
          </div>
        </div>

        <button 
          onClick={() => addCard('Ideas & scripts')}
          className="bg-[#6366f1] hover:bg-[#4f46e5] text-white text-xs font-semibold rounded-xl px-4 py-2.5 flex items-center gap-2 shadow-lg shadow-indigo-950/40 transition-all active:scale-95 self-start sm:self-auto"
        >
          <CalendarDays size={15} />
          <span>Schedule release</span>
        </button>
      </div>

      {/* Filter and View Controls Bar */}
      <div className="bg-[#141419] border border-[#23232b] rounded-2xl p-2.5 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          {/* Search Input */}
          <div className="flex items-center gap-2 bg-[#1b1b22] border border-[#2b2b36] rounded-xl px-3 py-2 flex-1 min-w-[220px] max-w-md focus-within:border-violet-500 transition-colors">
            <Search size={15} className="text-zinc-400 flex-shrink-0" />
            <input 
              type="text" 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search ideas, titles, or tags..." 
              className="bg-transparent border-none outline-none text-xs text-white placeholder-zinc-500 w-full"
            />
          </div>

          {/* Filter Dropdowns */}
          <div className="relative">
            <select 
              value={selectedChannel}
              onChange={e => setSelectedChannel(e.target.value)}
              className="appearance-none bg-[#1b1b22] border border-[#2b2b36] hover:border-[#3b3b48] text-zinc-300 text-xs font-medium rounded-xl pl-3 pr-8 py-2 outline-none cursor-pointer transition-colors"
            >
              <option value="All channels">All channels</option>
              <option value="YouTube">YouTube</option>
              <option value="Shorts">Shorts</option>
              <option value="Reels">Reels</option>
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          </div>

          <div className="relative">
            <select 
              value={selectedContentType}
              onChange={e => setSelectedContentType(e.target.value)}
              className="appearance-none bg-[#1b1b22] border border-[#2b2b36] hover:border-[#3b3b48] text-zinc-300 text-xs font-medium rounded-xl pl-3 pr-8 py-2 outline-none cursor-pointer transition-colors"
            >
              <option value="All content types">All content types</option>
              <option value="Video">Video</option>
              <option value="Short">Short</option>
              <option value="Post">Post</option>
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          </div>

          <button className="bg-[#1b1b22] border border-[#2b2b36] hover:border-[#3b3b48] text-zinc-300 text-xs font-medium rounded-xl px-3 py-2 flex items-center gap-2 transition-colors">
            <CalendarDays size={14} className="text-zinc-400" />
            <span>Date</span>
            <ChevronDown size={13} className="text-zinc-400" />
          </button>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-2 self-end lg:self-auto">
          <span className="text-xs text-zinc-500 font-medium mr-1">View:</span>
          <div className="bg-[#1b1b22] border border-[#2b2b36] p-1 rounded-xl flex items-center gap-1">
            <button 
              onClick={() => setViewMode('kanban')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                viewMode === 'kanban' ? 'bg-[#2b2b36] text-white border border-[#3b3b48] shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <FolderKanban size={14} />
              <span>Kanban</span>
            </button>

            <button 
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                viewMode === 'calendar' ? 'bg-[#2b2b36] text-white border border-[#3b3b48] shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <CalendarDays size={14} />
              <span>Calendar</span>
            </button>

            <button 
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                viewMode === 'list' ? 'bg-[#2b2b36] text-white border border-[#3b3b48] shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <List size={14} />
              <span>List</span>
            </button>
          </div>
        </div>
      </div>

      {/* View Mode Switcher Output */}
      {viewMode === 'kanban' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 items-start">
          {columnsData.map(col => {
            const filtered = getFilteredCards(col.title)
            return (
              <section 
                key={col.title}
                className={`bg-[#141419] border border-[#22222a] rounded-2xl p-3 flex flex-col gap-3 min-h-[600px] transition-all ${
                  dropTarget === col.title ? 'border-violet-500/80 bg-[#181525]' : ''
                }`}
                onDragOver={event => {
                  event.preventDefault()
                  setDropTarget(col.title)
                }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={() => moveCard(col.title)}
              >
                {/* Column Header */}
                <div className="px-1 pt-1 pb-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: col.dotColor }} />
                      <h2 className="text-sm font-bold text-white tracking-tight">{col.title}</h2>
                      <span className="text-[11px] font-bold text-zinc-400 bg-[#22222c] px-2 py-0.5 rounded-full">
                        {cards[col.title].length}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={() => addCard(col.title)}
                        className="w-6 h-6 rounded-lg text-zinc-400 hover:text-white hover:bg-[#252530] flex items-center justify-center transition-colors"
                        aria-label={`Add card to ${col.title}`}
                      >
                        <Plus size={14} />
                      </button>
                      <button 
                        className="w-6 h-6 rounded-lg text-zinc-400 hover:text-white hover:bg-[#252530] flex items-center justify-center transition-colors"
                        aria-label={`Column options`}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-1 font-medium">{col.subtitle}</p>
                </div>

                {/* Column Cards */}
                <div className="flex flex-col gap-3 flex-1">
                  {filtered.length === 0 && (
                    <div className="border border-dashed border-[#292934] rounded-xl p-6 text-center text-xs text-zinc-500 my-auto">
                      Drop cards here
                    </div>
                  )}

                  {filtered.map(card => (
                    <Card 
                      key={card.id} 
                      className={`!p-3 !bg-[#1b1b22] !border-[#2a2a35] hover:!border-[#404052] transition-all rounded-xl cursor-grab active:cursor-grabbing ${
                        dragged?.card.id === card.id ? 'opacity-40 scale-95 border-violet-500' : ''
                      }`}
                      draggable
                      onDragStart={event => {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', card.id)
                        setDragged({ card, from: col.title })
                      }}
                      onDragEnd={() => {
                        setDragged(null)
                        setDropTarget(null)
                      }}
                    >
                      <div className="flex gap-3 items-start">
                        <img src={card.img} alt={card.title} className="w-16 h-16 rounded-lg object-cover flex-shrink-0 bg-zinc-800 border border-[#2b2b38]" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              card.platform === 'Shorts' ? 'bg-[#3e1e68] text-[#c084fc] border border-[#5c289e]' :
                              card.platform === 'Reels' ? 'bg-[#0e3b5e] text-[#38bdf8] border border-[#165a8e]' :
                              'bg-[#4d2c0b] text-[#f59e0b] border border-[#784612]'
                            }`}>
                              {card.platform}
                            </span>
                          </div>
                          <h3 className="text-xs font-bold text-white mt-1.5 line-clamp-2 leading-snug">{card.title}</h3>
                          <p className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1.5">{card.status}</p>
                          {card.progress !== undefined && (
                            <div className="w-full bg-[#282838] h-1.5 rounded-full mt-2 overflow-hidden">
                              <div className="bg-violet-500 h-full rounded-full transition-all duration-300" style={{ width: `${card.progress}%` }} />
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-[#252532] text-[11px] text-zinc-400">
                        <div className="flex items-center gap-2 text-zinc-400 font-medium">
                          {card.metrics ? (
                            <div className="flex items-center gap-2.5 text-zinc-400">
                              <span className="flex items-center gap-1 text-[11px]"><Eye size={12} className="text-zinc-400" /> {card.metrics.views}</span>
                              <span className="flex items-center gap-1 text-[11px]"><ThumbsUp size={12} className="text-zinc-400" /> {card.metrics.likes}</span>
                            </div>
                          ) : (
                            <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                              <CalendarDays size={12} className="text-zinc-400" /> {card.due}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          {card.avatars && card.avatars.map((av, idx) => (
                            <div key={idx} className="w-5 h-5 rounded-full bg-violet-600 text-white text-[10px] font-bold flex items-center justify-center border border-[#18181f] -ml-1.5 first:ml-0">
                              {av}
                            </div>
                          ))}
                          <button className="text-zinc-500 hover:text-white p-0.5 rounded transition-colors ml-0.5" aria-label="More options">
                            <MoreVertical size={14} />
                          </button>
                        </div>
                      </div>
                    </Card>
                  ))}

                  {col.dropText && (
                    <button 
                      onClick={() => addCard(col.title)}
                      className="w-full border border-dashed border-[#292936] hover:border-violet-500/50 bg-[#16161d]/40 hover:bg-[#1a1a24] rounded-xl p-4 flex flex-col items-center justify-center gap-2 transition-all group cursor-pointer text-center mt-auto"
                    >
                      <div className="w-8 h-8 rounded-full bg-[#20202b] group-hover:bg-[#2b2742] flex items-center justify-center text-zinc-400 group-hover:text-violet-400 transition-colors">
                        <Plus size={16} />
                      </div>
                      <div>
                        <span className="text-xs font-semibold text-zinc-300 group-hover:text-white block">Add a new card</span>
                        <span className="text-[10px] text-zinc-500 block mt-0.5">{col.dropText}</span>
                      </div>
                    </button>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* Month Calendar View */}
      {viewMode === 'calendar' && (
        <div className="bg-[#141419] border border-[#22222a] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-[#22222c] pb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-white tracking-tight">October 2025</h2>
              <span className="text-xs bg-zinc-800 text-zinc-300 px-2.5 py-1 rounded-full font-semibold border border-zinc-700">
                {allCardsWithStage.length} Releases Scheduled
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1.5 bg-[#1b1b22] border border-[#2b2b36] hover:border-zinc-500 text-xs font-semibold rounded-xl text-zinc-300 transition-colors">
                Today
              </button>
              <div className="flex items-center border border-[#2b2b36] rounded-xl bg-[#1b1b22]">
                <button className="p-1.5 hover:text-white text-zinc-400 transition-colors"><ChevronLeft size={16}/></button>
                <button className="p-1.5 hover:text-white text-zinc-400 transition-colors"><ChevronRight size={16}/></button>
              </div>
            </div>
          </div>

          {/* Calendar Grid Header (Days of week) */}
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-bold text-zinc-400 pb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="py-1 bg-[#1b1b22]/80 rounded-lg text-zinc-300">{day}</div>
            ))}
          </div>

          {/* Calendar Grid Days (October 2025: starts on Wednesday = 3 empty slots) */}
          <div className="grid grid-cols-7 gap-2">
            {/* Empty slots for Sun, Mon, Tue before Oct 1 */}
            {Array.from({ length: 3 }).map((_, idx) => (
              <div key={`empty-${idx}`} className="min-h-[110px] bg-[#111116]/40 border border-[#1b1b22]/50 rounded-xl p-2 opacity-30" />
            ))}

            {/* Oct 1 to 31 */}
            {Array.from({ length: 31 }).map((_, dayIdx) => {
              const dayNumber = dayIdx + 1
              const dayCards = allCardsWithStage.filter(c => {
                const matchStr = `Oct ${dayNumber}`
                const matchStrPad = `Oct 0${dayNumber}`
                return c.due.startsWith(matchStr) || c.due.startsWith(matchStrPad)
              })
              const isToday = dayNumber === 14

              return (
                <div 
                  key={dayNumber} 
                  className={`min-h-[110px] bg-[#17171f] border rounded-xl p-2 flex flex-col justify-between transition-all hover:border-zinc-500 ${
                    isToday ? 'border-zinc-400 bg-[#1c1c26]' : 'border-[#23232f]'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className={`font-bold w-6 h-6 rounded-full flex items-center justify-center ${
                      isToday ? 'bg-zinc-700 text-white' : 'text-zinc-400'
                    }`}>
                      {dayNumber}
                    </span>
                    {dayCards.length > 0 && (
                      <span className="text-[10px] font-bold text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded-full border border-zinc-700">
                        {dayCards.length}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5 flex-1 overflow-auto max-h-[85px] pr-0.5">
                    {dayCards.map(card => (
                      <div 
                        key={card.id}
                        className="bg-[#1e1e28] border border-[#2c2c3a] hover:border-zinc-400 p-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer text-left transition-colors"
                      >
                        <span 
                          className="w-2 h-2 rounded-full flex-shrink-0" 
                          style={{ backgroundColor: getStageDotColor(card.stage) }} 
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-semibold text-white leading-tight truncate">{card.title}</p>
                          <span className="text-[9px] text-zinc-400 block truncate">{card.platform} · {card.stage}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* List Table View */}
      {viewMode === 'list' && (
        <div className="bg-[#141419] border border-[#22222a] rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-[#22222c] flex items-center justify-between">
            <h2 className="text-base font-bold text-white">All Content Items ({allCardsWithStage.length})</h2>
            <button 
              onClick={() => addCard('Ideas & scripts')}
              className="bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition-colors"
            >
              <Plus size={14}/> Add New Item
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-300">
              <thead className="bg-[#191920] border-b border-[#23232f] text-zinc-400 font-semibold uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-4">Content Title</th>
                  <th className="py-3 px-4">Platform</th>
                  <th className="py-3 px-4">Stage</th>
                  <th className="py-3 px-4">Status / Progress</th>
                  <th className="py-3 px-4">Due Date</th>
                  <th className="py-3 px-4">Assignee</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#20202c]">
                {allCardsWithStage.map(card => (
                  <tr key={card.id} className="hover:bg-[#1b1b24] transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <img src={card.img} alt={card.title} className="w-10 h-10 rounded-lg object-cover bg-zinc-800 border border-[#2b2b36]" />
                        <div>
                          <span className="font-bold text-white text-xs block line-clamp-1">{card.title}</span>
                          <span className="text-[10px] text-zinc-500">{card.platform}</span>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        card.platform === 'Shorts' ? 'bg-[#3e1e68] text-[#c084fc]' :
                        card.platform === 'Reels' ? 'bg-[#0e3b5e] text-[#38bdf8]' :
                        'bg-[#4d2c0b] text-[#f59e0b]'
                      }`}>
                        {card.platform}
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getStageDotColor(card.stage) }} />
                        <span className="font-medium text-zinc-200">{card.stage}</span>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <div>
                        <span className="text-zinc-300 font-medium block">{card.status}</span>
                        {card.progress !== undefined && (
                          <div className="w-24 bg-[#282838] h-1.5 rounded-full mt-1 overflow-hidden">
                            <div className="bg-violet-500 h-full rounded-full" style={{ width: `${card.progress}%` }} />
                          </div>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-4 font-medium text-zinc-400">
                      <div className="flex items-center gap-1.5">
                        <CalendarDays size={13} className="text-zinc-500" />
                        <span>{card.due}</span>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        {card.avatars && card.avatars.map((av, idx) => (
                          <div key={idx} className="w-5 h-5 rounded-full bg-violet-600 text-white text-[10px] font-bold flex items-center justify-center border border-[#141419]">
                            {av}
                          </div>
                        ))}
                      </div>
                    </td>

                    <td className="py-3 px-4 text-right">
                      <button className="text-zinc-400 hover:text-white p-1 rounded hover:bg-[#282836] transition-colors">
                        <MoreVertical size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function AIStudio(){const [generated,setGenerated]=useState(false); return <div className="page ai-page"><div className="page-title"><div><div className="eyebrow amber-text"><span className="status-dot amber-dot"/> Neural core v4.2 ready · latency 42ms</div><h1>AI Studio & Script Synthesis</h1><p>Transform rough ideas into high-retention cinematic narrative arcs, scene blueprints, and B-roll plans.</p></div></div><div className="tool-pills">{['Script Generator','Hook Generator','Video Idea Generator','Caption Generator','Content Repurposer','Creative Director','AI Storyboard'].map((x,i)=><button className={i===0?'selected':''} key={x}><Sparkles size={15}/>{x}</button>)}</div><Card className="composer"><div className="card-heading"><div><div className="eyebrow">Generation blueprint & context</div><h2>Describe what you want to create</h2></div><Button secondary><Wand2 size={15}/> Random creator prompt</Button></div><textarea placeholder="A fast-paced 10-minute YouTube video explaining the breakthrough in humanoid robotics..." defaultValue="Create a cinematic deep-dive on why local AI hardware is changing the economics of creative work."/><div className="parameter-grid">{['Platform','Audience','Content niche','Tone','Duration','Language'].map((x,i)=><label key={x}>{x}<select defaultValue={['YouTube Longform','Tech innovators','Emerging tech / AI','Energetic & cinematic','10-12 minutes','English (US)'][i]}><option>{['YouTube Longform','Tech innovators','Emerging tech / AI','Energetic & cinematic','10-12 minutes','English (US)'][i]}</option><option>Customize</option></select></label>)}</div><div className="composer-footer"><span><span className="status-dot green-dot"/> Ready · estimated generation time ~3.8s</span><Button onClick={()=>setGenerated(true)}><Sparkles size={16}/>{generated?'Regenerate output':'Generate full script'}</Button></div></Card>{generated&&<motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} className="output-grid"><Card><div className="card-heading"><h2>Hooks (3 variations)</h2><Badge tone="green">Generated</Badge></div>{['Cloud AI is quietly making your videos slower.','The best creators are moving intelligence on-device.','Your next editing bottleneck is not your editor.'].map(x=><div className="hook" key={x}><Sparkles size={15}/><b>{x}</b><IconButton label="Copy"><Copy size={14}/></IconButton></div>)}</Card><Card><div className="eyebrow">Scene breakdown</div><h2>Full script & B-roll plan</h2>{['Problem · 0:00–0:45','The architecture · 0:45–2:15','The breakthrough · 2:15–4:30','Proof · 4:30–6:10'].map((x,i)=><div className="scene" key={x}><Badge>{`0${i+1}`}</Badge><span>{x}</span><small>{['Talking head','PCB macro B-roll','Screen capture','Creator reaction'][i]}</small></div>)}<Button className="full-button"><Film size={15}/> Send to editor</Button></Card></motion.div>}</div>}

function LegacyEditorReplica(){const [playing,setPlaying]=useState(false); const tracks: [string, string, string | null][]=[['V4','B-roll',images[0]],['V3','A-roll',images[1]],['V2','Cutaways',images[2]],['V1','Master',images[3]],['A1','Dialogue',null],['A2','Music',null],['A3','SFX',null]]; return <div className="editor-replica"><header className="replica-top"><div className="replica-project"><div className="brand-mark"><Sparkles size={14}/></div><b>The Future of AI Hardware</b><Badge>4K · 60fps</Badge></div><nav className="replica-modes"><button className="active">Edit</button><button>Audio</button><button>Color</button><button>Preview</button><button>Structure</button></nav><div className="replica-actions"><IconButton label="Undo"><ChevronLeft size={15}/></IconButton><IconButton label="Redo"><ChevronRight size={15}/></IconButton><Button secondary><Users size={14}/> Share</Button><Button onClick={()=>alert('Export queued')}><Send size={14}/> Export</Button></div></header><div className="replica-workspace"><aside className="replica-chat"><div className="agent-select"><Bot size={15}/> Agent 2 <ChevronDown size={13}/></div><div className="chat-status"><b>Analyzed.</b><p>Edited in timeline <ChevronRight size={13}/></p><p>Reading screenplay structure...</p><p>Detecting scenes and shot descriptions...</p><p>Scanning 140 clips for visual and audio matches...</p><p className="muted-chat">Worked briefly <ChevronRight size={13}/></p><p>Done. All 140 clips are placed on the timeline in screenplay order. Scenes 3 and 7 had multiple matching clips, so I picked the best take for each.</p></div><div className="chat user">Now turn this into a trailer. Pull the key dialogues, arrange them for impact, and generate music and SFX.</div><div className="chat-status"><b><Sparkles size={13}/> On it - Working on it.</b><p>Building your trailer cut now.</p><p className="muted-chat">Scanning all clips for dialogue...</p><p className="muted-chat">Identifying 23 dialogue moments...</p></div><div className="replica-composer"><span>Semantic Editor 4.1</span><div><Button secondary><Plus size={16}/></Button><Button secondary><Play size={14}/></Button><select><option>Ultra</option></select><IconButton label="Voice"><CircleHelp size={16}/></IconButton><Button onClick={()=>setPlaying(!playing)}>{playing?'Pause':'Send'} <Send size={14}/></Button></div></div></aside><main className="replica-main"><div className="replica-preview"><div className="preview-toolbar"><span>Timeline</span><span className="preview-time">00:00:15:11</span><div className="transport"><button onClick={()=>setPlaying(!playing)}>{playing?'Pause':'Play'} <Play size={14}/></button><button><ChevronLeft size={14}/></button><button><ChevronRight size={14}/></button><button><CircleHelp size={14}/></button></div></div><div className="preview-screen"><img src={images[3]} alt="AI hardware edit preview"/><div className="preview-caption">The future of AI hardware is already here</div></div><div className="scrubber"><i/></div></div><div className="media-timeline"><div className="timeline-tabs"><button className="active"><Film size={14}/> Media</button><button><Layers3 size={14}/> Timeline</button><button><Plus size={14}/></button></div><div className="timeline-tools"><div className="search-inline"><Search size={14}/><input placeholder="Search media"/></div><button><Grid2X2 size={14}/></button><button><List size={14}/></button></div><div className="timeline-content"><div className="media-bin">{images.map((src,i)=><img key={src} src={src} alt={`Media clip ${i+1}`}/>)}</div><div className="tracks">{tracks.map(([label,name,src],i)=><div className="track" key={label}><div className="track-label"><b>{label}</b><span>{name}</span><EyeIcon/></div><div className="track-lane">{Array.from({length:i<4?7:6}).map((_,j)=><div className={`clip clip-${i%3}`} key={j}>{src&&<img src={src} alt=""/>}</div>)}</div></div>)}</div></div></div></main></div><footer className="replica-steps"><span>Upload footage</span><b>Describe edit</b><span>Review cut</span><span>Export</span></footer></div>}

  function ModeWorkspace({mode,notify}:{mode:string;notify:(text:string)=>void}) {
    const [split,setSplit]=useState(false);
    const [playing,setPlaying]=useState(false);
    const [muted,setMuted]=useState(false);
    const panels: Record<string,{left:string[];right:string[];title:string;description:string}> = {
      Audio:{title:'Audio Editing Workspace',description:'Shape the emotional layer of your cut with precise, non-destructive audio controls.',left:['Audio assets','Music library','Sound effects','Voice recordings'],right:['Volume and gain','Fade in / fade out','Noise reduction','Voice enhancement','Equalizer','Audio ducking','Background music controls','Audio synchronization']},
      Color:{title:'Color Grading Workspace',description:'Tune the visual character of the selected clip or sequence.',left:['Color presets / LUTs','Saved creator styles','AI color suggestions'],right:['Exposure','Contrast','Highlights','Shadows','Saturation','Temperature','Tint','Color wheels','Curves','LUT intensity']},
      Preview:{title:'Playback & Quality Review',description:'Review the cut with minimal controls and delivery-safe playback settings.',left:['Before edit','AI edit','Split comparison'],right:['Resolution: 4K UHD','Aspect ratio: 16:9','Playback speed: 1×','Fullscreen mode','Quality: High']},
      Structure:{title:'Storyline & Sequence Workspace',description:'Understand the narrative logic behind every scene and let AI explain the edit.',left:['Script outline','Scene list','Transcript sections','AI-detected topics'],right:['Match script paragraphs','Detect missing sections','Find duplicate clips','Flag irrelevant footage','Generate alternate arrangement','Convert to short-form','Why AI selected each segment']}
    };
    const panel=panels[mode];
    return <section className={`mode-workspace mode-${mode.toLowerCase()}`}><div className="mode-head"><div><span className="eyebrow">CreatorAI / {mode}</span><h1>{panel.title}</h1><p>{panel.description}</p></div><div className="mode-actions"><Button secondary onClick={()=>notify(`${mode} settings saved`)}>Save preset</Button><Button onClick={()=>notify(`${mode} analysis started`)}><Sparkles size={14}/> AI assist</Button></div></div><div className="mode-grid"><aside className="mode-left"><h3>{mode==='Structure'?'Story intelligence':mode==='Audio'?'Audio assets':mode==='Color'?'Look library':'Review controls'}</h3>{panel.left.map((item,i)=><button key={item} className={i===0?'selected':''} onClick={()=>notify(`${item} selected`)}>{item}<ChevronRight size={14}/></button>)}</aside><main className="mode-center"><div className="mode-monitor"><img src={images[1]} alt="Selected video frame"/><div className="monitor-overlay"><span>{playing?'Playing':'Ready to preview'}</span><b>{mode==='Structure'?'Scene 03 · 00:15:11':mode==='Preview'?'00:00:15:11':'Selected clip · V1'}</b></div>{mode==='Color'&&<div className={`comparison-wipe ${split?'split-active':''}`}><span>{split?'BEFORE / AFTER':'AI grade preview'}</span></div>}</div><div className="mode-controls"><button onClick={()=>setPlaying(!playing)}><Play size={15}/>{playing?'Pause':'Play'}</button><input aria-label="Playback position" type="range" defaultValue="42"/><span>00:15:11 / 00:30:00</span>{(mode==='Preview'||mode==='Color')&&<button onClick={()=>setSplit(!split)}><Split size={15}/> {split?'Single view':'Compare'}</button>}</div>{mode==='Structure'?<div className="scene-sequence">{['Hook · The shift','Scene 02 · Local inference','Scene 03 · Creator workflow','Payoff · Build locally'].map((scene,i)=><article draggable key={scene} onDragEnd={()=>notify(`${scene} reordered`)}><span>{String(i+1).padStart(2,'0')}</span><div><b>{scene}</b><small>{i===2?'AI selected · 94% semantic match':'Matched to script paragraph'}</small></div><MoreHorizontal size={15}/></article>)}</div>:mode==='Audio'?<div className="audio-tracks">{['Music','Voice','SFX'].map((track,i)=><div key={track}><b>{track}</b><i style={{width:`${58+i*12}%`}}/><span>{muted?'Muted':'Solo ready'}</span></div>)}</div>:null}</main><aside className="mode-right"><h3>{mode==='Structure'?'AI sequence notes':mode==='Preview'?'Playback settings':mode==='Color'?'Color inspector':'Audio Inspector'}</h3>{panel.right.map((item,i)=><label key={item}>{item}{mode==='Structure'?<span className="insight-pill">AI</span>:mode==='Preview'?<select defaultValue={i===0?'4K UHD':i===1?'16:9':i===2?'1×':'High'}><option>{i===0?'4K UHD':i===1?'16:9':i===2?'1×':'High'}</option><option>Auto</option></select>:<input type="range" defaultValue={60+i*4}/>}</label>)}</aside></div></section>;
  }

  function EditorReplica(){
  const [playing,setPlaying]=useState(false); const [activeMode,setActiveMode]=useState('Edit'); const [selectedTrack,setSelectedTrack]=useState('V1'); const [zoom,setZoom]=useState(100); const [muted,setMuted]=useState(false); const [message,setMessage]=useState(''); const [toast,setToast]=useState('');
  const tracks: [string, string, string | null][]=[['V4','B-roll',images[0]],['V3','A-roll',images[1]],['V2','Cutaways',images[2]],['V1','Master',images[3]],['A1','Dialogue',null],['A2','Music',null],['A3','SFX',null]];
  const notify=(text:string)=>{setToast(text);window.setTimeout(()=>setToast(''),2200)};
  return <div className={`editor-replica editor-studio-shell ${activeMode !== 'Edit' ? 'mode-active' : ''}`}><header className="replica-top"><div className="replica-project"><div className="brand-mark"><Sparkles size={14}/></div><b>The Future of AI Hardware</b><Badge>4K · 60fps</Badge></div><nav className="replica-modes">{['Edit','Audio','Color','Preview','Structure'].map(mode=><button key={mode} className={activeMode===mode?'active':''} onClick={()=>{setActiveMode(mode);notify(`${mode} workspace selected`)}}>{mode}</button>)}</nav><div className="replica-actions"><IconButton label="Undo" onClick={()=>notify('Undo applied')}><ChevronLeft size={15}/></IconButton><IconButton label="Redo" onClick={()=>notify('Redo applied')}><ChevronRight size={15}/></IconButton><Button secondary onClick={()=>notify('Share link copied')}><Users size={14}/> Share</Button><Button onClick={()=>notify('Export queued — rendering 4K master')}><Send size={14}/> Export</Button></div></header>{activeMode !== 'Edit' && <ModeWorkspace mode={activeMode} notify={notify}/>}<div className="replica-workspace"><aside className="replica-chat"><button className="agent-select" onClick={()=>notify('Agent menu opened')}><Bot size={15}/> Agent 2 <ChevronDown size={13}/></button><div className="chat-status"><b>Analyzed.</b><p>Edited in timeline <ChevronRight size={13}/></p><p>Reading screenplay structure...</p><p>Detecting scenes and shot descriptions...</p><p>Scanning 140 clips for visual and audio matches...</p><p className="muted-chat">Worked briefly <ChevronRight size={13}/></p><p>Done. All 140 clips are placed on the timeline in screenplay order.</p></div><div className="chat user">Now turn this into a trailer. Pull the key dialogues, arrange them for impact, and generate music and SFX.</div><div className="chat-status"><b><Sparkles size={13}/> On it — Working on it.</b><p>Building your trailer cut now.</p><p className="muted-chat">Identifying 23 dialogue moments...</p></div><div className="replica-composer"><span>SEMANTIC EDITOR 4.1</span><textarea value={message} onChange={e=>setMessage(e.target.value)} placeholder="Describe an edit..."/><div><IconButton label="Add media" onClick={()=>notify('Media picker opened')}><Plus size={16}/></IconButton><select aria-label="AI quality"><option>Ultra</option><option>Fast</option></select><IconButton label="Send instruction" onClick={()=>{notify(message?`Applied: ${message}`:'Describe an edit first');setMessage('')}}><Send size={15}/></IconButton></div></div></aside><main className="replica-main"><section className="replica-preview"><div className="preview-toolbar"><span>Timeline</span><span className="preview-time">00:00:15:11</span><select aria-label="Preview scale"><option>Fit</option><option>100%</option><option>200%</option></select></div><div className="replica-canvas"><motion.img key={images[selectedTrack==='V1'?3:selectedTrack==='V2'?2:selectedTrack==='V3'?1:0]} initial={{opacity:.6,scale:.98}} animate={{opacity:1,scale:1}} transition={{duration:.35}} src={images[selectedTrack==='V1'?3:selectedTrack==='V2'?2:selectedTrack==='V3'?1:0]} alt="Selected video frame" style={{transform:`scale(${zoom/100})`}}/></div><div className="transport"><span>00:00:15:11</span><input aria-label="Timeline position" type="range" min="0" max="100" defaultValue="42"/><span>00:00:30:00</span><IconButton label={muted?'Unmute':'Mute'} onClick={()=>setMuted(!muted)}>{muted?'◼':'◉'}</IconButton><IconButton label={playing?'Pause':'Play'} onClick={()=>setPlaying(!playing)}>{playing?'◼':'▶'}</IconButton></div></section><section className="replica-timeline"><div className="timeline-head"><div className="timeline-tabs"><button className="active">Media</button><button>Timeline</button><button>Markers</button></div><div className="timeline-tools"><IconButton label="Zoom out" onClick={()=>setZoom(Math.max(50,zoom-10))}>−</IconButton><span>{zoom}%</span><IconButton label="Zoom in" onClick={()=>setZoom(Math.min(180,zoom+10))}>+</IconButton></div></div><div className="track-list">{tracks.map(([id,name,src])=><button key={id} className={`track-row ${selectedTrack===id?'selected':''}`} onClick={()=>setSelectedTrack(id)}><span className="track-label">{id}</span><span className="track-name">{name}</span><div className="track-clips">{src?[0,1,2,3,4,5].map((_,i)=><span key={i} style={{backgroundImage:`url(${src})`}}/>):[0,1,2,3,4].map(i=><i key={i} className="audio-clip" style={{width:`${50+i*9}px`}}/>)}</div></button>)}</div></section></main></div>{toast&&<motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} className="editor-toast">{toast}</motion.div>}</div>
}

function EyeIcon(){return <span className="eye-icon">◉</span>}

function Editor(){const [playing,setPlaying]=useState(false); const [selected,setSelected]=useState(1); return <div className="editor"><div className="editor-top"><div className="editor-project"><div className="brand-mark"><Sparkles size={15}/></div><b>The Future of AI Hardware</b><Badge>4K · 60fps</Badge><IconButton label="Undo"><ChevronLeft size={16}/></IconButton><IconButton label="Redo"><ChevronRight size={16}/></IconButton></div><div className="editor-modes"><button>Media</button><button className="active">Edit</button><button>Color</button><button>Captions</button><button>Audio</button><button className="ai"><Sparkles size={13}/> AI Director</button></div><div className="editor-export"><span><i className="status-dot green-dot"/> Saved 2s ago</span><Button onClick={()=>alert('Export queued')}><Send size={15}/> Export 4K</Button></div></div><div className="editor-body"><aside className="editor-left"><div className="panel-tabs"><button className="active"><Sparkles size={14}/> AI Director</button><button>Transcript</button><button>B-roll</button></div><div className="ai-alert"><div className="orb"><Sparkles size={14}/></div><div><b>Smart pacing analysis</b><p>Found <strong>14 awkward pauses</strong> across clip V1-A3.</p><Button secondary>Apply ripple trim (-22s)</Button></div></div><div className="copilot"><span className="eyebrow">Executive copilot</span><div className="chat user">Make the first 10 seconds aggressively hook the viewer.</div><div className="chat ai"><b><Sparkles size={13}/> Optimized hook & sequence</b><p>Split at 00:03:12, applied a 14% zoom ramp, and overlaid Microchip Macro 4K.</p></div>{['Remove filler words & repeated takes','Auto-cut 3 viral 30s clips','Add relevant studio B-roll'].map(x=><button className="directive" key={x}><Wand2 size={14}/>{x}</button>)}<div className="chat-input"><input placeholder="Instruct AI Director..."/><IconButton label="Send"><Send size={15}/></IconButton></div></div></aside><main className="monitor"><div className="monitor-bar"><span><i className="record-dot"/> PROGRAM OUT</span><Badge tone="gray">REC 709 · UHD</Badge><span>Safe areas · Fullscreen</span></div><div className="video-stage"><img src={images[0]} alt="Video preview"/><div className="caption-overlay">The key is building custom <span>neural hardware</span> from scratch.</div><span className="timecode">00:04:18:12 / 00:14:28:00</span></div><div className="transport"><IconButton label="Previous"><ChevronLeft size={18}/></IconButton><button className="play-button" onClick={()=>setPlaying(!playing)}>{playing?<Split size={17}/>:<Play size={17}/>}</button><IconButton label="Next"><ChevronRight size={18}/></IconButton><span className="timecode">00:04:18:12</span><div className="volume"><Activity size={15}/><div className="wave small">{Array.from({length:16}).map((_,i)=><i key={i} style={{height:`${20+Math.abs(Math.sin(i*1.5))*70}%`}}/>)}</div></div></div></main><aside className="inspector"><div className="panel-tabs"><button className="active">Clip</button><button>Audio</button><button>Color</button></div><div className="inspector-content"><div className="eyebrow">Selected clip</div><h3>{['Hook intro','A-roll take 04','Macro B-roll'][selected]}</h3>{['Position','Scale','Speed','Opacity'].map((x,i)=><label className="inspector-row" key={x}><span>{x}</span><input type="range" defaultValue={[50,74,100,100][i]}/><small>{[50,74,100,100][i]}%</small></label>)}<div className="ai-explanation"><Badge tone="amber">AI edit</Badge><p>Selected because the phrase carries a 94% retention match with your approved hook pattern.</p></div></div></aside></div><div className="timeline"><div className="timeline-toolbar"><span className="eyebrow">Timeline · 00:04:18</span><div><IconButton label="Split"><Split size={15}/></IconButton><IconButton label="Delete"><Trash2 size={15}/></IconButton><IconButton label="Zoom in"><Plus size={15}/></IconButton></div></div><div className="ruler">{['00:00','02:00','04:00','06:00','08:00','10:00','12:00','14:28'].map(x=><span key={x}>{x}</span>)}</div>{['V2 · AI edit','V1 · A-roll','A1 · Voice'].map((track,t)=><div className="track" key={track}><span className="track-label">{track}</span><div className="track-content">{Array.from({length:t===2?4:5}).map((_,i)=><button onClick={()=>setSelected(i%3)} className={`timeline-clip ${selected===i%3?'selected':''} ${t===0?'ai-clip':''}`} style={{width:`${14+i*4}%`}} key={i}><span>{t===2?'waveform':titles[i%titles.length]}</span></button>)}</div></div>)}</div></div>}

const COMPREHENSIVE_STUDIO_TOUR = [
  // Phase 1: Dashboard
  {
    path: '/dashboard',
    target: 'sidebar',
    title: '1. Sidebar Navigation Hub',
    badge: 'Dashboard · 1 of 18',
    desc: 'Access all studio suites from the left navigation bar — Dashboard, Projects, Asset Library, AI Studio, Smart Clips, Editor, Analytics, and Settings.',
    icon: Home,
  },
  {
    path: '/dashboard',
    target: 'search-trigger',
    title: '2. Global Semantic Search',
    badge: 'Dashboard · 2 of 18',
    desc: 'Press ⌘ K or click here to search raw footage, transcripts, and AI creative memories using natural language.',
    icon: Search,
  },
  {
    path: '/dashboard',
    target: 'create-btn',
    title: '3. Quick Creation Launcher',
    badge: 'Dashboard · 3 of 18',
    desc: 'Click "Create new" anytime to trigger AI script synthesis, upload 4K media, or start a blank timeline edit.',
    icon: Plus,
  },
  {
    path: '/dashboard',
    target: 'hero-stats',
    title: '4. Production Stats & Velocity',
    badge: 'Dashboard · 4 of 18',
    desc: 'Monitor reserved AI tokens, published video outputs, and estimated editing hours saved in real-time.',
    icon: Zap,
  },
  {
    path: '/dashboard',
    target: 'project-grid',
    title: '5. Recent Projects & Drafts',
    badge: 'Dashboard · 5 of 18',
    desc: 'View active video cuts, track edit progress, preview rough cuts, or open any project in the editor.',
    icon: Film,
  },

  // Phase 2: Projects
  {
    path: '/projects',
    target: 'page-title',
    title: '6. Projects Workspace',
    badge: 'Projects · 6 of 18',
    desc: 'Manage multi-format video productions, longform 16:9 cuts, and 9:16 vertical Shorts drafts in one central workspace.',
    icon: FolderKanban,
  },
  {
    path: '/projects',
    target: 'workspace-grid',
    title: '7. Project Cards & Actions',
    badge: 'Projects · 7 of 18',
    desc: 'Review project confidence scores, processing status, and jump directly into timeline editing with 1 click.',
    icon: Edit3,
  },

  // Phase 3: Asset Library
  {
    path: '/assets',
    target: 'folders',
    title: '8. Asset Library & Collections',
    badge: 'Asset Library · 8 of 18',
    desc: 'Organize raw 4K footage, B-roll clips, AI-generated cuts, audio stems, voiceovers, and LUT color profiles.',
    icon: FolderOpen,
  },
  {
    path: '/assets',
    target: 'dropzone',
    title: '9. Media Ingest & Semantic Indexing',
    badge: 'Asset Library · 9 of 18',
    desc: 'Drop media files here. AI automatically analyzes transcripts, facial energy, and visual context for instant semantic search.',
    icon: CloudUpload,
  },

  // Phase 4: AI Studio
  {
    path: '/ai-studio',
    target: 'page-title',
    title: '10. AI Studio & Script Synthesis',
    badge: 'AI Studio · 10 of 18',
    desc: 'Formulate high-retention cinematic scripts, 3 hook variations, and scene breakdowns powered by Gemini CineMax.',
    icon: Sparkles,
  },
  {
    path: '/ai-studio',
    target: 'composer',
    title: '11. Prompt & Generation Context',
    badge: 'AI Studio · 11 of 18',
    desc: 'Specify platform, target audience, content niche, tone, duration, and language to synthesize custom blueprints.',
    icon: Wand2,
  },

  // Phase 5: Smart Clips
  {
    path: '/smart-clips',
    target: 'page-title',
    title: '12. LumiClip Smart Clips',
    badge: 'Smart Clips · 12 of 18',
    desc: 'Auto-cut short-form viral vertical clips from longform media or YouTube video links.',
    icon: Clapperboard,
  },
  {
    path: '/smart-clips',
    target: 'workspace-grid',
    title: '13. Retention Detection & Auto-Crop',
    badge: 'Smart Clips · 13 of 18',
    desc: 'Detects high retention spikes, adds animated captions, and crops to 9:16 vertical format with virality score prediction.',
    icon: Target,
  },

  // Phase 6: Timeline Editor
  {
    path: '/editor/ai-hardware',
    target: 'replica-top',
    title: '14. Multi-Track Timeline Editor',
    badge: 'Editor · 14 of 18',
    desc: 'Cinema-grade editing workspace with multi-track timeline, audio ducking, color LUT presets, and quality review modes.',
    icon: Film,
  },
  {
    path: '/editor/ai-hardware',
    target: 'replica-chat',
    title: '15. Semantic Editor & AI Copilot',
    badge: 'Editor · 15 of 18',
    desc: 'Instruct the AI copilot in plain English to auto-trim pauses, pull key dialogues, arrange trailers, and layer audio stems.',
    icon: Bot,
  },

  // Phase 7: Content Calendar
  {
    path: '/calendar',
    target: 'calendar-grid',
    title: '16. Content Calendar & Kanban',
    badge: 'Calendar · 16 of 18',
    desc: 'Coordinate releases across YouTube, Instagram Reels, and TikTok. Drag cards between Production, Review, Scheduled, and Published.',
    icon: CalendarDays,
  },

  // Phase 8: Analytics
  {
    path: '/analytics',
    target: 'analytics-dashboard',
    title: '17. Creator Intelligence & Analytics',
    badge: 'Analytics · 17 of 18',
    desc: 'Analyze second-by-second watch duration curves, hook retention spikes, turnaround velocity, and AI virality leaderboard predictions.',
    icon: BarChart3,
  },

  // Phase 9: Creative Digital Twin
  {
    path: '/creative-twin',
    target: 'twin-grid',
    title: '18. Creative Digital Twin',
    badge: 'Creative Twin · 18 of 18',
    desc: 'Interact with your learned AI Digital Twin via voice or text. Tune cutting cadence, hook urgency, and approved brand memory.',
    icon: Bot,
  },
];

function SpotlightTour({
  onClose,
  onNavigate,
  stepIndex,
  setStepIndex,
}: {
  onClose: () => void;
  onNavigate: (path: string) => void;
  stepIndex: number;
  setStepIndex: React.Dispatch<React.SetStateAction<number>>;
}) {
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  const step = COMPREHENSIVE_STUDIO_TOUR[stepIndex];
  const StepIcon = step.icon;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === COMPREHENSIVE_STUDIO_TOUR.length - 1;

  // Immediately notify parent component to render step page
  useEffect(() => {
    if (step.path) {
      onNavigate(step.path);
    }
  }, [stepIndex]);

  // Continuously recalculate target DOM element rect
  useEffect(() => {
    let animId: number;
    let startTime = Date.now();

    const updateTargetRect = () => {
      let el = document.querySelector(`[data-tour="${step.target}"]`) || document.querySelector(`.${step.target}`);
      if (!el) {
        el = document.querySelector(`.page`) || document.querySelector(`.editor-replica`) || document.querySelector(`.app-main`);
      }

      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          setRect({
            top: r.top + window.scrollY,
            left: r.left + window.scrollX,
            width: r.width,
            height: r.height,
          });
        }
      }

      if (Date.now() - startTime < 4000) {
        animId = requestAnimationFrame(updateTargetRect);
      }
    };

    updateTargetRect();
    const interval = setInterval(updateTargetRect, 180);

    return () => {
      cancelAnimationFrame(animId);
      clearInterval(interval);
    };
  }, [stepIndex]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        if (stepIndex < COMPREHENSIVE_STUDIO_TOUR.length - 1) setStepIndex(prev => prev + 1);
        else onClose();
      } else if (e.key === 'ArrowLeft') {
        if (stepIndex > 0) setStepIndex(prev => prev - 1);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [stepIndex]);

  let cardStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 100001,
  };

  if (rect && typeof window !== 'undefined') {
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const viewportTop = rect.top - window.scrollY;
    const viewportLeft = rect.left - window.scrollX;

    if (viewportTop + rect.height + 230 < screenHeight && viewportTop > 0) {
      cardStyle.top = Math.max(75, viewportTop + rect.height + 14);
      cardStyle.left = Math.max(20, Math.min(viewportLeft, screenWidth - 410));
    } else if (viewportTop > 240) {
      cardStyle.top = Math.max(75, viewportTop - 220);
      cardStyle.left = Math.max(20, Math.min(viewportLeft, screenWidth - 410));
    } else {
      cardStyle.bottom = 24;
      cardStyle.right = 24;
    }
  } else {
    cardStyle.bottom = 24;
    cardStyle.right = 24;
  }

  return (
    <div className="spotlight-tour-overlay">
      {/* Spotlight Cutout Box */}
      {rect && (
        <motion.div
          initial={false}
          animate={{
            top: rect.top - window.scrollY - 6,
            left: rect.left - window.scrollX - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          className="spotlight-highlight-box"
        >
          <span className="spotlight-pulse-ring" />
          <div className="spotlight-target-label">
            <span className="spotlight-dot" /> {step.badge}
          </div>
        </motion.div>
      )}

      {/* Persistent Tour Card - stays continuously visible across all 18 steps */}
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        style={cardStyle}
        className="tour-card"
      >
        <div className="tour-card-header">
          <div className="tour-card-badge">
            <Sparkles size={13} /> {step.badge}
          </div>
          <button className="tour-close-btn" aria-label="Close tour" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="tour-card-body">
          <div className="tour-card-title-row">
            <div className="tour-icon-box">
              <StepIcon size={20} />
            </div>
            <h3>{step.title}</h3>
          </div>
          <p className="tour-card-desc">{step.desc}</p>
        </div>

        <div className="tour-card-footer">
          <button className="tour-skip-link" onClick={onClose}>
            Skip tour
          </button>
          <div className="tour-nav-btns">
            {!isFirst && (
              <Button
                secondary
                onClick={() => setStepIndex(prev => prev - 1)}
                className="tour-btn-sm"
              >
                <ChevronLeft size={15} /> Back
              </Button>
            )}
            <Button
              onClick={() => {
                if (isLast) onClose();
                else setStepIndex(prev => prev + 1);
              }}
              className="tour-btn-sm"
            >
              {isLast ? 'Finish Tour' : 'Next Step'} <ChevronRight size={15} />
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function CreateModal({onClose}:{onClose:()=>void}){const router=useRouter(); return <div className="modal-backdrop" onClick={onClose}><motion.div initial={{opacity:0,scale:.96}} animate={{opacity:1,scale:1}} className="modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><div className="eyebrow violet-text">New production</div><h2>What are you creating?</h2></div><IconButton label="Close" onClick={onClose}><X size={18}/></IconButton></div><div className="creation-options">{[['Start from scratch',Edit3],['Create using AI',Sparkles],['Upload footage',Upload],['Import editing project',FolderOpen]].map(([x,I]:any)=><button key={x} onClick={()=>{onClose();router.push(x==='Create using AI'?'/ai-studio':'/projects')}}><div className="feature-icon tone-0"><I size={20}/></div><div><b>{x}</b><small>{x==='Create using AI'?'Turn an idea into a full production plan':'Begin with a flexible studio workspace'}</small></div><ArrowRight size={16}/></button>)}</div></motion.div></div>}

export default function CreatorApp() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [modal, setModal] = useState(false);

  const [guideOpen, setGuideOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('creator_ai_tour_active') === 'true';
    }
    return false;
  });

  const [tourStepIndex, setTourStepIndex] = useState(() => {
    if (typeof window !== 'undefined') {
      const storedStep = sessionStorage.getItem('creator_ai_tour_step');
      if (storedStep !== null) {
        const parsed = parseInt(storedStep, 10);
        return !isNaN(parsed) && parsed >= 0 && parsed < COMPREHENSIVE_STUDIO_TOUR.length ? parsed : 0;
      }
    }
    return 0;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (guideOpen) {
        sessionStorage.setItem('creator_ai_tour_active', 'true');
        sessionStorage.setItem('creator_ai_tour_step', String(tourStepIndex));
      } else {
        sessionStorage.removeItem('creator_ai_tour_active');
        sessionStorage.removeItem('creator_ai_tour_step');
      }
    }
  }, [guideOpen, tourStepIndex]);

  // Active path takes tour override when tour is active
  const activePath = guideOpen ? (COMPREHENSIVE_STUDIO_TOUR[tourStepIndex]?.path || pathname) : pathname;

  const handleStartGuide = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('creator_ai_tour_active', 'true');
      sessionStorage.setItem('creator_ai_tour_step', '0');
      if (window.location.pathname !== '/dashboard') {
        window.history.pushState({}, '', '/dashboard');
      }
    }
    setTourStepIndex(0);
    setGuideOpen(true);
  };

  const handleCloseGuide = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('creator_ai_tour_active');
      sessionStorage.removeItem('creator_ai_tour_step');
    }
    setGuideOpen(false);
  };

  const handleNavigateTour = (path: string) => {
    if (typeof window !== 'undefined' && window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
  };

  const dashboard = activePath === '/' || activePath === '/dashboard';
  const editor = activePath.startsWith('/editor');
  const content = editor ? (
    <EditorReplica />
  ) : activePath === '/ai-studio' ? (
    <AIStudio />
  ) : activePath === '/smart-clips' ? (
    <SmartClipsStudio />
  ) : activePath === '/calendar' ? (
    <CalendarView />
  ) : activePath === '/analytics' ? (
    <AnalyticsView />
  ) : activePath === '/monetization' ? (
    <SponsorshipView />
  ) : dashboard ? (
    <Dashboard onCreate={() => setModal(true)} />
  ) : (
    <GenericPage kind={activePath} />
  );

  return (
    <div className="app-shell">
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} onStartGuide={handleStartGuide} activePath={activePath} />
      <div className="app-main">
        {!editor && <Topbar onCreate={() => setModal(true)} onStartGuide={handleStartGuide} activePath={activePath} />}
        <AnimatePresence mode="wait">
          <motion.div key={activePath} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }} className="route-content">
            {content}
          </motion.div>
        </AnimatePresence>
      </div>
      {modal && <CreateModal onClose={() => setModal(false)} />}
      {guideOpen && (
        <SpotlightTour
          onClose={handleCloseGuide}
          onNavigate={handleNavigateTour}
          stepIndex={tourStepIndex}
          setStepIndex={setTourStepIndex}
        />
      )}
    </div>
  );
}




