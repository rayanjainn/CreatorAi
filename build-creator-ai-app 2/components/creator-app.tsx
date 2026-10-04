'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { usePathname, useRouter } from 'next/navigation'
import { useMemo, useState, useEffect } from 'react'
import {
  Activity, Archive, ArrowRight, BarChart3, Bell, BookOpen, Bot, BriefcaseBusiness, CalendarDays, Check, ChevronDown, ChevronLeft,
  ChevronRight, CircleHelp, Clapperboard, Clock3, CloudUpload, Compass, Copy, CreditCard, Edit3, Film, FolderKanban, FolderOpen,
  Gauge, Grid2X2, Heart, Home, Image as ImageIcon, Layers3, LayoutDashboard, List, Menu, MessageSquareText, MoreHorizontal,
  Music2, Package, Palette, Play, Plus, Search, Send, Settings, Sparkles, Split, Target, Trash2, Upload, UserRound, Users, Wand2,
  X, Zap
} from 'lucide-react'
import NeuralTwinPanel from '@/components/NeuralTwinPanel'
import SmartClipsStudio from '@/components/smart-clips/SmartClipsStudio'


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
    <div className="brand"><div className="brand-mark"><Sparkles size={18}/></div>{!collapsed&&<><strong>Creator<span>AI</span></strong><Badge tone="amber">BETA</Badge></>}</div>
    <div className="workspace-switcher"><div className="avatar">A</div>{!collapsed&&<div><b>Aarav Studio</b><small>Pro workspace</small></div>}{!collapsed&&<ChevronDown size={14}/>}</div>
    <nav className="side-nav">{nav.map(([label,path,Icon])=><button key={path} title={collapsed?label:''} onClick={()=>router.push(path)} className={`nav-item ${currentPath===path?'active':''}`}><Icon size={17}/>{!collapsed&&<span>{label}</span>}{!collapsed&&label==='AI Studio'&&<i>4</i>}</button>)}</nav>
    {!collapsed&&<div data-tour="sidebar-footer" className="sidebar-footer"><button className="help" onClick={onStartGuide}><CircleHelp size={15}/> Interactive Guide</button><div className="profile"><div className="avatar">A</div><div><b>Aarav Mehta</b><small>Top 1% Creator</small></div><MoreHorizontal size={16}/></div></div>}
    <IconButton label="Toggle sidebar" onClick={()=>setCollapsed(!collapsed)}>{collapsed?<ChevronRight size={18}/>:<ChevronLeft size={18}/>}</IconButton>
  </aside>
}

function Topbar({onCreate,onStartGuide,activePath}:{onCreate:()=>void;onStartGuide?:()=>void;activePath?:string}) { const router=useRouter(); const pathname=usePathname(); const currentPath=activePath||pathname; const title=routeNames[currentPath]|| (currentPath.startsWith('/editor')?'Editor':'Dashboard'); return <header className="topbar"><div className="breadcrumbs"><span>Studio</span><ChevronRight size={13}/><b>{title}</b></div><div className="top-actions"><button data-tour="search-trigger" className="search-trigger" onClick={()=>router.push('/search')}><Search size={16}/><span>Search your studio...</span><kbd>⌘ K</kbd></button><IconButton label="Notifications"><Bell size={17}/><em/></IconButton><Button secondary onClick={onStartGuide}><Compass size={15}/> Guide</Button><div data-tour="create-btn" style={{display:'inline-flex'}}><Button onClick={onCreate}><Plus size={16}/> Create new</Button></div><div className="avatar">A</div></div></header> }

function Hero({onCreate}:{onCreate:()=>void}) { return <div className="hero"><div className="glow violet"/><div className="glow amber"/><div className="hero-copy"><div className="eyebrow"><span className="status-dot"/> Good afternoon, Aarav <Badge tone="amber"><Sparkles size={12}/> Top 1% Creator</Badge></div><h1>Your creative workflow, <span>reimagined.</span></h1><p>From the first spark of inspiration to the final cinema-grade master frame — conceive, direct, auto-cut, and broadcast at warp speed.</p><div className="hero-actions"><Button onClick={onCreate}><Plus size={18}/> Create New Project</Button><Button secondary><Sparkles size={17}/> Start with AI Studio</Button><small><Wand2 size={14}/> Autofill from rough cut or script</small></div></div><div data-tour="hero-stats" className="hero-stats"><Stat label="AI Tokens Reserved" value="8,450 / 10k" icon={<Zap/>} tone="amber"/><Stat label="Outputs Broadcast" value="14 this month" icon={<Send/>}/><Stat label="Studio Hours Saved" value="28.4 hrs" icon={<Clock3/>} tone="cyan"/></div></div> }
function Stat({label,value,icon,tone='violet'}:{label:string;value:string;icon:React.ReactNode;tone?:string}) { return <div className="stat"><div className={`stat-icon ${tone}`}>{icon}</div><div><small>{label}</small><strong>{value}</strong></div></div> }

function ProjectCard({i=0, progress=78}:{i?:number;progress?:number}) { const router=useRouter(); return <motion.article whileHover={{y:-4}} className="project-card"><div className="thumb"><img src={images[i%images.length]} alt="Creator studio project thumbnail"/><div className="thumb-overlay"/><Badge>{i===2?'9:16 Shorts':'16:9 4K'}</Badge><span className="duration">{i===2?'00:58':i===1?'08:45':'14:28'}</span><div className="hover-actions"><IconButton label="Preview"><Play size={17}/></IconButton><IconButton label="Duplicate"><Copy size={16}/></IconButton><IconButton label="Export"><Send size={16}/></IconButton></div></div><div className="project-info"><div className="meta"><span><Clock3 size={12}/> {i+1}h ago</span><Badge tone={i===2?'green':'violet'}>{i===2?'Ready to publish':i===1?'AI processing':'Editing'}</Badge></div><h3>{titles[i%titles.length]}</h3><p>{i===0?'Synthesized B-roll layered over Sony A7SIII timeline with automatic audio ducking.':'Auto-removing breath pauses and color matching warm moody tones across clips.'}</p><div className="progress-label"><span>Rough cut to master</span><b>{progress}%</b></div><div className="progress"><i style={{width:`${progress}%`}}/></div><Button onClick={()=>router.push('/editor/ai-hardware')} secondary className="full-button"><Film size={15}/> Open in editor</Button></div></motion.article> }

function Dashboard({onCreate}:{onCreate:()=>void}) { return <div className="page"><Hero onCreate={onCreate}/><div className="section-head"><div><div className="eyebrow violet-text">Active timeline slots</div><h2>Continue editing & recent projects</h2></div><div className="segmented"><button>All (8)</button><button>16:9 Longform</button><button>9:16 Shorts</button></div></div><div data-tour="project-grid" className="project-grid">{[0,1,2].map(i=><ProjectCard key={i} i={i} progress={[78,45,100][i]}/>)}</div><div className="lower-grid"><Card><div className="card-heading"><div><span className="eyebrow">Production velocity</span><h3>Weekly output</h3></div><Badge tone="green">+24.8%</Badge></div><div className="bars">{[42,58,38,72,64,86,94].map((h,i)=><div key={i}><i style={{height:`${h}%`}}/><small>{['M','T','W','T','F','S','S'][i]}</small></div>)}</div></Card><Card><div className="card-heading"><div><span className="eyebrow">Up next</span><h3>Publishing schedule</h3></div><ChevronRight size={17}/></div>{['AI hardware breakdown','3 editing myths','Studio desk tour'].map((t,i)=><div className="schedule" key={t}><div className="mini-thumb" style={{backgroundImage:`url(${images[i]})`}}/><div><b>{t}</b><small>{['Today · 6:00 PM','Tomorrow · 10:00 AM','Fri · 4:30 PM'][i]}</small></div><Badge tone={i===0?'amber':'gray'}>{['YouTube','Reels','TikTok'][i]}</Badge></div>)}</Card></div></div> }

function GenericPage({kind}:{kind:string}) { const router=useRouter(); const data:any={
  '/projects':['Projects Workspace','Manage multi-format productions, active video timelines, and AI synthesized drafts','Create project'], '/assets':['Asset Library','Search, organize, and understand every piece of media in your studio','Upload media'], '/search':['Semantic Search','Find the exact moment across transcripts, footage, and creative memory','Execute match'], '/script-match':['Script-to-Footage Match','Match every written beat to the strongest footage with confidence-aware AI','Analyze script'], '/smart-clips':['Smart Clip Generator','Discover high-retention moments and turn them into platform-ready clips','Rescan video hooks'], '/creative-director':['Creative Director','A multi-perspective AI council for narrative, visual, and platform strategy','Regenerate council'], '/repurpose':['Repurpose Studio','Transform one master cut into a family of native platform outputs','Generate variants'], '/calendar':['Content Calendar','Coordinate ideas, edits, reviews, and releases across every channel','Schedule release'], '/analytics':['Creator Intelligence','Predictive engagement metrics calibrated against your channel history','Regenerate insights'], '/monetization':['Sponsorship Studio','Plan natural brand integrations that protect audience trust and retention','Pitch brand deal'], '/creative-twin':['Creative Digital Twin','Your approved creative preferences, learned and ready to apply','Re-index creative DNA'], '/settings':['Settings & Profile','Tune your workspace, AI preferences, exports, and connected platforms','Save changes']}[kind]||['CreatorAI Studio','Your operating system for the entire content creation lifecycle','Create new'];
  const isAssets=kind==='/assets', isSearch=kind==='/search', isAnalytics=kind==='/analytics', isTwin=kind==='/creative-twin', isCalendar=kind==='/calendar';
  return <div className="page"><div className="page-title"><div><div className="eyebrow"><span className="status-dot"/> CreatorAI / Studio</div><h1>{data[0]}</h1><p>{data[1]}</p></div><Button onClick={()=>kind==='/projects'?router.push('/editor/ai-hardware'):undefined}><Sparkles size={16}/>{data[2]}</Button></div><div className="toolbar"><div className="search-inline"><Search size={16}/><input placeholder={isSearch?'Find the clip where I explain why consistency matters...':'Search this workspace...'}/></div><div className="segmented"><button className="selected">Overview</button><button>Recent</button><button>Favorites</button></div><IconButton label="Filter"><Target size={17}/></IconButton></div>{isAssets?<AssetGrid/>:isSearch?<SearchResults/>:isAnalytics?<AnalyticsView/>:isTwin?<TwinView/>:isCalendar?<CalendarView/>:<WorkspaceView kind={kind}/>}</div>
}
function WorkspaceView({kind}:{kind:string}) { const cards=kind==='/smart-clips'?['Urgent warning hook','The 3-second rule','Local beats cloud']:kind==='/creative-director'?['Storytelling director','Audience strategist','Visual director','Editor']:kind==='/monetization'?['Keychron integration','NordVPN campaign','CleanMyMac brief']:['AI Hardware Ecosystem Review','Desk Setup Minimalist 2025','The 30-Second ACES LUT Trick','LUT Pack 2026 Announcement']; return <div className="workspace-grid">{cards.map((x,i)=><Card key={x} className="feature-card"><div className={`feature-icon tone-${i%4}`}><Sparkles size={20}/></div><div className="card-heading"><h3>{x}</h3><Badge tone={i%2?'amber':'green'}>{i%2?'Processing':'Ready'}</Badge></div><p>{kind==='/smart-clips'?'High retention surge triggered by an immediate contrarian thesis and pacing shifts.':kind==='/creative-director'?'Review the cut from a distinct creative perspective and apply suggested improvements.':'AI-assisted production workspace with realistic sample data and editable output.'}</p><div className="confidence"><span>Confidence</span><b>{98-i*3}%</b></div><div className="progress"><i style={{width:`${98-i*8}%`}}/></div><Button secondary className="full-button"><ArrowRight size={15}/> Review workspace</Button></Card>)}</div> }
function AssetGrid(){return <div className="asset-layout"><div className="folders"><h3>Collections</h3>{['All media','Raw 4K footage','B-roll library','AI generated clips','Audio & stems','Voiceovers & SFX'].map((x,i)=><button className={i===0?'selected':''} key={x}><FolderOpen size={15}/>{x}<small>{[3420,142,840,312,420,680][i]}</small></button>)}<div className="dropzone"><CloudUpload size={24}/><b>Drop media to ingest</b><small>ProRes, MP4, WAV, CUBE</small><Button secondary><Upload size={14}/> Browse</Button></div></div><div className="asset-grid">{images.map((src,i)=><Card key={src} className="asset-card"><div className="asset-thumb"><img src={src} alt="Media asset"/><span>{['00:24','14:28','00:58','01:42'][i]}</span></div><h3>{['Studio_Broll_NeonKeybd_04.mp4','Aarav_Main_ARoll_Take3.mov','Creator_Hook_Vertical_02.mp4','Synth_Audio_Bed.wav'][i]}</h3><div className="tag-row"><Badge>{i%2?'A-ROLL':'PRORES 422'}</Badge><Badge tone="gray">4K UHD</Badge></div><small className="muted">98% semantic fit · imported {i+1}h ago</small></Card>)}</div></div>}
function SearchResults(){return <div className="search-results"><div className="scan-card"><div className="orb"><Sparkles size={22}/></div><div><h2>Semantic match ready</h2><p>Found 6 moments across 18 ingested takes. Ranked by transcript meaning, facial energy, and visual context.</p></div><Badge tone="green">96.4% coherence</Badge></div>{['Why consistency beats motivation','The exact moment the workflow changed','Build a system, not a habit'].map((x,i)=><Card className="result" key={x}><div className="result-image"><img src={images[i%images.length]} alt="Search result"/><button><Play size={18}/></button></div><div><Badge tone="amber">{['01:14','04:28','08:52'][i]}</Badge><h3>{x}</h3><p>“The difference is not motivation. It is building a system that makes consistency automatic...”</p><div className="result-meta"><span>Take_{i+4}.mov</span><b>{98-i*4}% relevance</b></div></div></Card>)}</div>}
function AnalyticsView(){const metrics=[['Total views & reach','2.4M','+34.2%','violet'],['Production time saved','48.6 hrs','3.8× faster','amber'],['Avg retention rate','68.4%','+14.8%','cyan'],['AI viral prediction','92.4%','High confidence','amber']]; return <div className="analytics-dashboard"><div className="analytics-controls"><div className="filter-row"><button className="filter-active">Last 30 Days</button><button>Q3 2025</button><button>Custom</button><span className="filter-divider"/><Badge>● YouTube Longform</Badge><Badge tone="amber">● TikTok</Badge><Badge tone="gray">● Instagram Reels</Badge><Badge tone="gray">× Video</Badge></div><div className="view-row"><span>VIEW:</span><button className="filter-active">Growth</button><button>Virality</button><button>Workflow Efficiency</button></div></div><div className="analytics-metrics">{metrics.map(([label,value,change,tone],i)=><Card key={label} className={`analytics-metric metric-${tone}`}><div className="metric-top"><span>{label}</span><span className="metric-icon">{i===0?'◉':i===1?'ϟ':i===2?'Top 2%':'• High'}</span></div><strong className="analytics-number">{value}</strong><Badge tone={tone==='amber'?'amber':'green'}>{change}</Badge>{i===2?<div className="retention-bar"><i/></div>:<div className="analytics-spark"><i/><i/><i/><i/><i/></div>}<div className="metric-foot"><span>{i===0?'Across 14 published pieces':i===1?'Manual edit equivalent: 72.0 hrs':i===2?'Median watch duration: 8:44':'Based on 32 analyzed clips'}</span><small>{i===0?'vs. 1.78M prev.':i===1?'Smart Clips used':i===2?'Target: 70%':'4 viral hits'}</small></div></Card>)}</div><div className="analytics-columns"><div className="analytics-main"><Card className="retention-card"><div className="card-heading"><div><h2>Second-by-Second Viewer Retention Curve</h2><p>Project: “The Future of AI Hardware: M4 Max vs Tensor Runtimes”</p></div><div className="legend"><span className="legend-project"/> This Project <span/> Tech Benchmark</div></div><div className="retention-chart"><div className="chart-axis"><span>00:00</span><span>02:30</span><span>05:00</span><span>07:30</span><span>10:00</span><span>13:20</span></div><div className="curve curve-main"/><div className="curve curve-benchmark"/><div className="chart-callout callout-one"><b>Hook Spike +12%</b><small>Contrarian assertion</small></div><div className="chart-callout callout-two"><b>B-Roll Cutaway holds 88%</b><small>Silicon wafer macro</small></div><div className="chart-callout callout-three"><b>Sponsor drop-off -4%</b><small>Standard pre-roll bridge</small></div></div><div className="ai-recommendation"><Sparkles size={16}/> <span><b>AI Recommendation:</b> Adding the macro B-roll at 02:14 increased watch time by <strong>180 seconds.</strong> For the sponsor block at 07:10, try overlaying a dynamic code execution PIP instead of a static talking head.</span></div></Card><Card className="velocity-card"><div className="card-heading"><div><h2>Content Velocity & Production Cadence</h2><p>Turnaround Time: Manual Workflow vs. CreatorAI Orchestration</p></div><div className="legend"><span className="legend-manual"/> Manual Hours <span className="legend-ai"/> AI-Assisted Hours</div></div>{[['Episode 41: “Liquid Neural Networks”','3.8h','14.2 hrs total saved'],['Episode 42: “Future of AI Hardware (Benchmark)”','4.5h','16.5 hrs total saved'],['Shorts Series: “60-Second Silicon Breakdown” (×5)','1.2h','12.0 hrs total saved'],['Episode 43: “Open Source Weights Explained”','3.6h','18.4 hrs total saved']].map(([title,time,saved],i)=><div className="cadence-row" key={title}><div><b>{title}</b><small>{saved}</small></div><div className="cadence-track"><i style={{width:`${[25,30,15,24][i]}%`}}>{time}</i><span>Manual equivalent: {['18.0h','21.0h','13.2h','22.0h'][i]}</span></div></div>)}<div className="cadence-summary"><span>↗ Cadence Velocity: <b>2.8 videos / week (+140% YOY)</b></span><strong>Editing bottleneck eliminated</strong></div></Card></div><div className="analytics-side"><Card className="insights-card"><div className="card-heading"><h2>◉ Predictive Insights</h2><Badge>v4.2 Engine</Badge></div>{[['HOOK FORMAT ALERT','Short-Form Contrarian Hooks are outperforming Question Hooks by 2.3x in organic shares across TikTok & YouTube Shorts.','violet'],['PACING CALIBRATION','B-Roll heavy intros (<5s cut cadence) preserve 74% viewer retention through minute 3, vs 48% on single static headshots.','amber'],['LENGTH OPTIMIZATION','Optimal duration for your tech deepdives is 12:45 to 14:30. Longer cuts see a sharp drop-off before your final subscribe card.','cyan']].map(([title,body,tone])=><div className={`insight insight-${tone}`} key={title}><b>{title}</b><p>{body}</p><small>{tone==='amber'?'Apply preset: “High-Frequency Cut”':tone==='cyan'?'Timeline trim targets updated':'Action: auto-apply contrarian hook prompt'} <ArrowRight size={13}/></small></div>)}</Card><Card className="leaderboard-card"><div className="card-heading"><h2>🏆 Virality Leaderboard</h2><span>This Cycle</span></div>{['Why Everyone is Wrong About Local AI','The M4 Max Review: Silicon Decoded','Can You Train a Model on 16GB RAM?'].map((title,i)=><div className="leader-row" key={title}><div className="rank">{i+1}</div><div className="leader-thumb" style={{backgroundImage:`url(${images[i]})`}}/><div><b>{title}</b><small>{['1.2M views','780K views','420K views'][i]} · <strong>{['14.8%','11.2%','9.8%']} eng.</strong></small></div><Badge tone={i===0?'violet':'amber'}>{[98,94,89][i]} VIRAL SCORE</Badge></div>)}</Card></div></div></div>}
function TwinView(){return <div className="twin-grid"><NeuralTwinPanel /><Card><div className="card-heading"><div><div className="eyebrow">Learned style profile</div><h2>Creative DNA</h2></div><Button secondary><Archive size={15}/> Reset baseline</Button></div>{['Cutting cadence','Hook urgency','B-roll saturation'].map((x,i)=><div className="slider-row" key={x}><div><b>{x}</b><span>{['Aggressive fast-cut','Contrarian provocative','High frequency b-roll'][i]}</span></div><input type="range" defaultValue={[82,94,62][i]}/></div>)}<div className="memory"><Badge tone="green">Approved memory</Badge><h3>The 3-second hook rule</h3><p>First spoken sentence must contradict an industry consensus before any branded intro.</p></div></Card></div>}
function CalendarView(){
  type CalendarCard={id:string;platform:string;title:string;progress:string;due:string;notes:string}
  const columns=['Ideas & scripts','In production','AI Studio & review','Scheduled','Published']
  const [cards,setCards]=useState<Record<string,CalendarCard[]>>({
    'Ideas & scripts':[
      {id:'idea-1',platform:'YouTube',title:'AI Hardware Ecosystem Review',progress:'Script drafting · 90%',due:'Oct 12',notes:'6 notes'},
      {id:'idea-2',platform:'Shorts',title:'The 30-Second ACES LUT Trick',progress:'Hook drafted · 6 notes',due:'Oct 13',notes:'6 notes'},
      {id:'idea-3',platform:'Reels',title:'Desk Setup Minimalist 2025',progress:'Hook drafted · 6 notes',due:'Oct 14',notes:'6 notes'},
    ],
    'In production':[], 'AI Studio & review':[], Scheduled:[], Published:[],
  })
  const [dragged,setDragged]=useState<{card:CalendarCard;from:string}|null>(null)
  const [dropTarget,setDropTarget]=useState<string|null>(null)
  const moveCard=(to:string)=>{if(!dragged||dragged.from===to){setDragged(null);setDropTarget(null);return};setCards(prev=>({...prev,[dragged.from]:prev[dragged.from].filter(card=>card.id!==dragged.card.id),[to]:[...prev[to],dragged.card]}));setDragged(null);setDropTarget(null)}
  const addCard=(column:string)=>{const card={id:`new-${Date.now()}`,platform:'YouTube',title:'New content concept',progress:'Draft · just added',due:'Oct 18',notes:'0 notes'};setCards(prev=>({...prev,[column]:[...prev[column],card]}))}
  return <div className="calendar-grid">{columns.map((column,i)=><section className={`kanban ${dropTarget===column?'kanban-drop-target':''}`} key={column} onDragOver={event=>{event.preventDefault();setDropTarget(column)}} onDragLeave={()=>setDropTarget(null)} onDrop={()=>moveCard(column)}><div className="kanban-title"><span className={`kanban-dot d${i}`}/><b>{column}</b><small>{cards[column].length}</small><button className="kanban-add" aria-label={`Add card to ${column}`} onClick={()=>addCard(column)}><Plus size={15}/></button></div><div className="kanban-cards">{cards[column].length===0&&<div className="kanban-empty">Drop cards here</div>}{cards[column].map(card=><Card className={`kanban-card ${dragged?.card.id===card.id?'kanban-dragging':''}`} key={card.id} draggable onDragStart={event=>{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',card.id);setDragged({card,from:column})}} onDragEnd={()=>{setDragged(null);setDropTarget(null)}}><div className="kanban-card-drag"><Badge tone={card.platform==='YouTube'?'amber':'gray'}>{card.platform}</Badge><span aria-hidden="true">⋮⋮</span></div><h3>{card.title}</h3><p>{card.progress}</p><small><CalendarDays size={13}/> Due {card.due}</small><div className="kanban-card-meta">{card.notes}</div></Card>)}</div></section>)}</div>}

function AIStudio(){const [generated,setGenerated]=useState(false); return <div className="page ai-page"><div className="page-title"><div><div className="eyebrow amber-text"><span className="status-dot amber-dot"/> Neural core v4.2 ready · latency 42ms</div><h1>AI Studio & Script Synthesis</h1><p>Transform rough ideas into high-retention cinematic narrative arcs, scene blueprints, and B-roll plans.</p></div><div className="credits-card"><Bot size={18}/><span>Gemini CineMax<br/><b>8,450 tokens</b></span></div></div><div className="tool-pills">{['Script Generator','Hook Generator','Video Idea Generator','Caption Generator','Content Repurposer','Creative Director','AI Storyboard'].map((x,i)=><button className={i===0?'selected':''} key={x}><Sparkles size={15}/>{x}</button>)}</div><Card className="composer"><div className="card-heading"><div><div className="eyebrow">Generation blueprint & context</div><h2>Describe what you want to create</h2></div><Button secondary><Wand2 size={15}/> Random creator prompt</Button></div><textarea placeholder="A fast-paced 10-minute YouTube video explaining the breakthrough in humanoid robotics..." defaultValue="Create a cinematic deep-dive on why local AI hardware is changing the economics of creative work."/><div className="parameter-grid">{['Platform','Audience','Content niche','Tone','Duration','Language'].map((x,i)=><label key={x}>{x}<select defaultValue={['YouTube Longform','Tech innovators','Emerging tech / AI','Energetic & cinematic','10-12 minutes','English (US)'][i]}><option>{['YouTube Longform','Tech innovators','Emerging tech / AI','Energetic & cinematic','10-12 minutes','English (US)'][i]}</option><option>Customize</option></select></label>)}</div><div className="composer-footer"><span><span className="status-dot green-dot"/> Ready · estimated generation time ~3.8s</span><Button onClick={()=>setGenerated(true)}><Sparkles size={16}/>{generated?'Regenerate output':'Generate full script'}</Button></div></Card>{generated&&<motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} className="output-grid"><Card><div className="card-heading"><h2>Hooks (3 variations)</h2><Badge tone="green">Generated</Badge></div>{['Cloud AI is quietly making your videos slower.','The best creators are moving intelligence on-device.','Your next editing bottleneck is not your editor.'].map(x=><div className="hook" key={x}><Sparkles size={15}/><b>{x}</b><IconButton label="Copy"><Copy size={14}/></IconButton></div>)}</Card><Card><div className="eyebrow">Scene breakdown</div><h2>Full script & B-roll plan</h2>{['Problem · 0:00–0:45','The architecture · 0:45–2:15','The breakthrough · 2:15–4:30','Proof · 4:30–6:10'].map((x,i)=><div className="scene" key={x}><Badge>{`0${i+1}`}</Badge><span>{x}</span><small>{['Talking head','PCB macro B-roll','Screen capture','Creator reaction'][i]}</small></div>)}<Button className="full-button"><Film size={15}/> Send to editor</Button></Card></motion.div>}</div>}

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
    target: 'credits-card',
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




