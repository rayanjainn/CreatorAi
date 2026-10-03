
'use client'


import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Sparkles, Play, Search, Wand2, Film, Clock3, Send, Zap } from 'lucide-react'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'


if (typeof window !== 'undefined') {
 gsap.registerPlugin(ScrollTrigger)
}


export default function LandingPage() {
 const sectionRef = useRef<HTMLElement>(null)
 const canvasRef = useRef<HTMLCanvasElement>(null)
 const particlesRef = useRef<HTMLCanvasElement>(null)
 const [scrollProgress, setScrollProgress] = useState(0)
 const [activeBeat, setActiveBeat] = useState(0)


 // Three.js Particle Background
 useEffect(() => {
   const canvas = particlesRef.current
   if (!canvas) return


   // Set canvas size explicitly
   canvas.width = window.innerWidth * window.devicePixelRatio
   canvas.height = window.innerHeight * window.devicePixelRatio


   const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
   const isMobile = window.matchMedia('(max-width: 768px)').matches
   const COUNT = isMobile ? 4000 : 12000
   const rand = Math.random
   const gauss = () => (rand() + rand() + rand() - 1.5) * 0.8


   const posArr = new Float32Array(COUNT * 3)
   const ringId = new Float32Array(COUNT)
   const seeds = new Float32Array(COUNT)
   const scales = new Float32Array(COUNT)
   const rings = [
     { r: 6.4, tx: -0.5, tz: 0 },
     { r: 5.3, tx: 0.9, tz: 0.7 },
     { r: 4.2, tx: 0.25, tz: -1.1 }
   ]


   for (let i = 0; i < COUNT; i++) {
     const i3 = i * 3
     const pick = rand()
     seeds[i] = rand()
     scales[i] = seeds[i] > 0.985 ? 2.4 : 0.5 + rand() * 0.9


     if (pick < 0.12) {
       ringId[i] = 4
       let x = gauss(), y = gauss(), z = gauss()
       const n = Math.hypot(x, y, z) || 1
       const r = 7.5 + rand() * 5.5
       posArr[i3] = x / n * r
       posArr[i3 + 1] = y / n * r
       posArr[i3 + 2] = z / n * r
       continue
     }


     if (pick < 0.24) {
       ringId[i] = 3
       let x = gauss(), y = gauss(), z = gauss()
       const n = Math.hypot(x, y, z) || 1
       const r = 1.7 * Math.cbrt(rand())
       posArr[i3] = x / n * r
       posArr[i3 + 1] = y / n * r
       posArr[i3 + 2] = z / n * r
       continue
     }


     ringId[i] = i % 3
     const ring = rings[i % 3]
     const ang = rand() * Math.PI * 2
     const x = Math.cos(ang) * ring.r + gauss() * 0.07
     const y = gauss() * 0.07
     const z = Math.sin(ang) * ring.r + gauss() * 0.07


     let y2 = y * Math.cos(ring.tx) - z * Math.sin(ring.tx)
     const z2 = y * Math.sin(ring.tx) + z * Math.cos(ring.tx)
     const x2Final = x * Math.cos(ring.tz) - y2 * Math.sin(ring.tz)
     const y2Final = x * Math.sin(ring.tz) + y2 * Math.cos(ring.tz)


     posArr[i3] = x2Final
     posArr[i3 + 1] = y2Final
     posArr[i3 + 2] = z2
   }


   const SNOISE = `
     vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
     vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
     vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
     vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
     float snoise(vec3 v){
       const vec2 C=vec2(1.0/6.0,1.0/3.0);
       const vec4 D=vec4(0.0,0.5,1.0,2.0);
       vec3 i=floor(v+dot(v,C.yyy));
       vec3 x0=v-i+dot(i,C.xxx);
       vec3 g=step(x0.yzx,x0.xyz);
       vec3 l=1.0-g;
       vec3 i1=min(g.xyz,l.zxy);
       vec3 i2=max(g.xyz,l.zxy);
       vec3 x1=x0-i1+C.xxx;
       vec3 x2=x0-i2+C.yyy;
       vec3 x3=x0-D.yyy;
       i=mod289(i);
       vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
       float n_=0.142857142857;
       vec3 ns=n_*D.wyz-D.xzx;
       vec4 j=p-49.0*floor(p*ns.z*ns.z);
       vec4 x_=floor(j*ns.z);
       vec4 y_=floor(j-7.0*x_);
       vec4 x=x_*ns.x+ns.yyyy;
       vec4 y=y_*ns.x+ns.yyyy;
       vec4 h=1.0-abs(x)-abs(y);
       vec4 b0=vec4(x.xy,y.xy);
       vec4 b1=vec4(x.zw,y.zw);
       vec4 s0=floor(b0)*2.0+1.0;
       vec4 s1=floor(b1)*2.0+1.0;
       vec4 sh=-step(h,vec4(0.0));
       vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
       vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
       vec3 p0=vec3(a0.xy,h.x);
       vec3 p1=vec3(a0.zw,h.y);
       vec3 p2=vec3(a1.xy,h.z);
       vec3 p3=vec3(a1.zw,h.w);
       vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
       p0*=norm.x;
       p1*=norm.y;
       p2*=norm.z;
       p3*=norm.w;
       vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
       m=m*m;
       return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
     }
   `


   const VERT = `
     attribute float aSeed;
     attribute float aScale;
     attribute float aRing;
     uniform float uTime;
     uniform float uSize;
     uniform float uPixelRatio;
     uniform vec3 uColor;
     uniform vec3 uCore;
     uniform vec3 uRing0;
     uniform vec3 uRing1;
     uniform vec3 uRing2;
     varying vec3 vColor;
     varying float vTwinkle;
     ${SNOISE}
     void main(){
       vec3 pos=position;
       if(aRing<2.5){
         vec3 ax=aRing<0.5?normalize(vec3(1.0,0.18,0.0)):aRing<1.5?normalize(vec3(0.0,1.0,0.22)):normalize(vec3(0.25,0.0,1.0));
         float ang=uTime*(aRing<0.5?0.24:aRing<1.5?-0.38:0.55);
         float c=cos(ang),s=sin(ang);
         pos=pos*c+cross(ax,pos)*s+ax*dot(ax,pos)*(1.0-c);
       }
       vec3 np=pos*0.2+vec3(uTime*0.18)+aSeed*6.28;
       pos+=vec3(snoise(np),snoise(np+31.7),snoise(np+74.3))*0.13;
       pos.x+=sin(uTime*0.9+aSeed*40.0)*0.05;
       pos.y+=cos(uTime*0.7+aSeed*30.0)*0.05;
       vColor=uColor;
       if(aRing<2.5){
         vColor=aRing<0.5?uRing0:aRing<1.5?uRing1:uRing2;
       }
       vColor=mix(vColor,uCore,smoothstep(2.5,1.4,length(pos)));
       vColor=mix(vColor,vec3(1.0),step(0.985,aSeed)*0.9);
       vTwinkle=0.6+0.4*sin(uTime*(0.6+aSeed*1.8)+aSeed*20.0);
       vec4 mv=modelViewMatrix*vec4(pos,1.0);
       gl_PointSize=uSize*aScale*uPixelRatio*(12.0/-mv.z);
       gl_Position=projectionMatrix*mv;
     }
   `


   const FRAG = `
     precision mediump float;
     uniform float uOpacity;
     varying vec3 vColor;
     varying float vTwinkle;
     void main(){
       float d=length(gl_PointCoord-0.5);
       float alpha=smoothstep(0.5,0.12,d);
       alpha+=smoothstep(0.12,0.0,d)*0.5;
       gl_FragColor=vec4(vColor,alpha*vTwinkle*uOpacity);
     }
   `


   const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false })
   const pr = Math.min(window.devicePixelRatio, isMobile ? 1.25 : 1.75)
   renderer.setPixelRatio(pr)
   renderer.setSize(window.innerWidth, window.innerHeight)
   renderer.toneMapping = THREE.ACESFilmicToneMapping
   renderer.toneMappingExposure = 1.1


   const scene = new THREE.Scene()
   scene.background = new THREE.Color('#0a0a0c')


   const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100)
   camera.position.z = 14.5


   const geo = new THREE.BufferGeometry()
   geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3))
   geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
   geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1))
   geo.setAttribute('aRing', new THREE.BufferAttribute(ringId, 1))


   const uniforms = {
     uTime: { value: 0 },
     uSize: { value: 3.0 },
     uPixelRatio: { value: pr },
     uOpacity: { value: 0.8 },
     uColor: { value: new THREE.Color('#f5b8d0') },
     uCore: { value: new THREE.Color('#ffd9e8') },
     uRing0: { value: new THREE.Color('#c26a97') },
     uRing1: { value: new THREE.Color('#f5b8d0') },
     uRing2: { value: new THREE.Color('#ffe3ef') }
   }


   const mat = new THREE.ShaderMaterial({
     uniforms,
     vertexShader: VERT,
     fragmentShader: FRAG,
     transparent: true,
     depthWrite: false,
     blending: THREE.AdditiveBlending
   })


   const group = new THREE.Group()
   group.add(new THREE.Points(geo, mat))
   scene.add(group)


   let composer: EffectComposer | null = null
   if (!isMobile && !reduced) {
     composer = new EffectComposer(renderer)
     composer.addPass(new RenderPass(scene, camera))
     composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.85, 0.55, 0.12))
   }


   let mx = 0, my = 0, tmx = 0, tmy = 0


   const handleMouseMove = (e: PointerEvent) => {
     tmx = e.clientX / window.innerWidth - 0.5
     tmy = e.clientY / window.innerHeight - 0.5
   }


   const handleResize = () => {
     camera.aspect = window.innerWidth / window.innerHeight
     camera.updateProjectionMatrix()
     renderer.setSize(window.innerWidth, window.innerHeight)
     if (composer) composer.setSize(window.innerWidth, window.innerHeight)
   }


   window.addEventListener('pointermove', handleMouseMove)
   window.addEventListener('resize', handleResize)


   const clock = new THREE.Clock()


   function frame() {
     const t = clock.getElapsedTime()
     uniforms.uTime.value = t


     mx += (tmx - mx) * 0.04
     my += (tmy - my) * 0.04


     group.rotation.y = mx * 0.35 + t * 0.06 + Math.sin(t * 0.07) * 0.06
     group.rotation.x = my * 0.22 + Math.sin(t * 0.23) * 0.1


     composer ? composer.render() : renderer.render(scene, camera)
     requestAnimationFrame(frame)
   }


   // Initial render to ensure canvas is visible
   renderer.render(scene, camera)


   if (reduced) {
     uniforms.uTime.value = 1
     renderer.render(scene, camera)
   } else {
     requestAnimationFrame(frame)
   }


   return () => {
     window.removeEventListener('pointermove', handleMouseMove)
     window.removeEventListener('resize', handleResize)
     renderer.dispose()
     geo.dispose()
     mat.dispose()
   }
 }, [])


 // Petal Canvas Animation
 useEffect(() => {
   const canvas = canvasRef.current
   if (!canvas) return


   const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches


   const ctx = canvas.getContext('2d')
   if (!ctx) return


   let W = canvas.width = window.innerWidth * window.devicePixelRatio
   let H = canvas.height = window.innerHeight * window.devicePixelRatio


   const petals = Array.from({ length: 70 }, () => ({
     x: Math.random(),
     y: Math.random(),
     r: 6 + Math.random() * 14,
     sp: 0.2 + Math.random() * 0.8,
     drift: Math.random() * Math.PI * 2,
     a: 0.3 + Math.random() * 0.5
   }))


   let startTime = Date.now()


   function drawPetals() {
     const t = Date.now() - startTime
     ctx!.clearRect(0, 0, W, H)
    
     const petalDensity = scrollProgress < 0.48 ? scrollProgress * 0.3 : Math.min(1, (scrollProgress - 0.40) * 2.2)
     const windAmt = Math.max(0, (scrollProgress - 0.60)) * 1.4


     for (const p of petals) {
       const px = (p.x + Math.sin(t * 0.0003 * p.sp + p.drift) * 0.04 * (0.5 + windAmt * 2)) * W
       const py = (((p.y + t * 0.00004 * p.sp) % 1)) * H
       const size = p.r * window.devicePixelRatio * (0.7 + petalDensity * 0.8)


       ctx!.globalAlpha = p.a * petalDensity
       const g = ctx!.createRadialGradient(px, py, 0, px, py, size)
       g.addColorStop(0, 'rgba(247,196,218,0.9)')
       g.addColorStop(1, 'rgba(194,106,151,0)')


       ctx!.fillStyle = g
       ctx!.beginPath()
       ctx!.ellipse(px, py, size, size * 0.6, p.drift + t * 0.0002, 0, Math.PI * 2)
       ctx!.fill()
     }
     ctx!.globalAlpha = 1
     requestAnimationFrame(drawPetals)
   }


   if (!reduced) {
     drawPetals()
   }


   const handleResize = () => {
     W = canvas.width = window.innerWidth * window.devicePixelRatio
     H = canvas.height = window.innerHeight * window.devicePixelRatio
   }
   window.addEventListener('resize', handleResize)
   return () => window.removeEventListener('resize', handleResize)
 }, [scrollProgress])


 // Cinematic Scroll Animation
 useEffect(() => {
   const section = sectionRef.current
   if (!section) return


   const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches


   // Deterministic beat windows
   const beats: Array<{ s: number; e: number; dot?: HTMLElement }> = [
     { s: 0.00, e: 0.10 },
     { s: 0.11, e: 0.22 },
     { s: 0.23, e: 0.33 },
     { s: 0.34, e: 0.47 },
     { s: 0.48, e: 0.64 },
     { s: 0.65, e: 0.81 },
     { s: 0.82, e: 1.00 }
   ]


   function beatOpacity(p: number, s: number, e: number) {
     const mid = (s + e) / 2
     const span = e - s
     const fade = span * 0.30
     if (p < s || p > e) return 0
     if (p < s + fade) return (p - s) / fade
     if (p > e - fade) return (e - p) / fade
     return 1
   }


   // Timeline dots
   const dotRow = document.getElementById('dotRow')
   if (dotRow) {
     beats.forEach((b, i) => {
       const d = document.createElement('span')
       d.style.cssText = 'width:0.5rem;height:0.5rem;border-radius:50%;background:rgba(255,255,255,0.25);transition:background .3s,transform .3s;cursor:pointer;'
       d.addEventListener('click', () => {
         const sec = document.getElementById('cinematic')
         if (sec) {
           const top = sec.offsetTop + ((b.s + b.e) / 2) * (sec.offsetHeight - window.innerHeight)
           window.scrollTo({ top, behavior: 'smooth' })
         }
       })
       dotRow.appendChild(d)
       b.dot = d
     })
   }


   // Velocity-aware render progress
   const bgLayer = document.getElementById('bgLayer')
   const midLayer = document.getElementById('midLayer')
   const bouquet = document.getElementById('bouquet')
   const grade = document.getElementById('gradeWash')
   const lbTop = document.getElementById('lbTop')
   const lbBot = document.getElementById('lbBot')
   const tlFill = document.getElementById('timelineFill')
   const timeLabel = document.getElementById('timeLabel')
   const DUR = 12.75


   let rawP = 0, renderP = 0


   function raf() {
     renderP += (rawP - renderP) * 0.10
     const p = renderP


     const scale = 1 + p * 0.55 - Math.max(0, p - 0.48) * 0.35
     const roll = p * 4 - Math.max(0, p - 0.65) * 3
     const fwd = p * -40


     if (bouquet) {
       bouquet.style.transform = `scale(${scale}) rotate(${roll}deg) translateY(${fwd}px)`
     }
     if (bgLayer) {
       bgLayer.style.transform = `scale(${1.1 + p * 0.15}) translateY(${p * -60}px)`
     }
     if (midLayer) {
       midLayer.style.transform = `translateY(${p * 30}px)`
     }


     const petalDensity = p < 0.48 ? p * 0.3 : Math.min(1, (p - 0.40) * 2.2)
     const windAmt = Math.max(0, (p - 0.60)) * 1.4


     if (grade) {
       grade.style.opacity = (0.4 + Math.sin(p * Math.PI) * 0.5).toString()
     }


     let lb = 0
     if (p < 0.06) lb = (p / 0.06) * 7
     else if (p > 0.92) lb = 7 * (1 - (p - 0.92) / 0.08)
     else lb = 7


     if (lbTop) lbTop.style.height = lb + 'vh'
     if (lbBot) lbBot.style.height = lb + 'vh'


     if (tlFill) tlFill.style.width = (p * 100) + '%'
     if (timeLabel) timeLabel.textContent = (p * DUR).toFixed(2) + 's'


     beats.forEach(b => {
       const el = document.querySelector(`[data-beat="${beats.indexOf(b)}"]`) as HTMLElement
       const o = beatOpacity(p, b.s, b.e)
       if (el) {
         el.style.opacity = o.toFixed(3)
         el.style.transform = `translateY(${(1 - o) * 18}px)`
       }
       const active = p >= b.s && p <= b.e
       if (b.dot) {
         b.dot.style.background = active ? '#f5b8d0' : 'rgba(255,255,255,0.25)'
         b.dot.style.transform = active ? 'scale(1.4)' : 'scale(1)'
       }
     })


     requestAnimationFrame(raf)
   }


   if (!reduced) {
     requestAnimationFrame(raf)
   }


   function updateScroll() {
     if (!section) return
     const rect = section.getBoundingClientRect()
     const travel = section.offsetHeight - window.innerHeight
     const scrolled = Math.min(Math.max(-rect.top, 0), travel)
     rawP = travel > 0 ? scrolled / travel : 0
     if (reduced) renderP = rawP
     setScrollProgress(rawP)
   }


   window.addEventListener('scroll', updateScroll, { passive: true })
   updateScroll()


   return () => {
     window.removeEventListener('scroll', updateScroll)
   }
 }, [])


 // GSAP Scroll Animations for other sections
 useEffect(() => {
   const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
   if (reduced) return


   // Animate feature cards on scroll
   const cards = document.querySelectorAll('.feature-card')
   cards.forEach((card, i) => {
     gsap.fromTo(card,
       { opacity: 0, y: 40 },
       {
         opacity: 1,
         y: 0,
         duration: 0.7,
         ease: 'power2.out',
         delay: i * 0.1,
         scrollTrigger: {
           trigger: card,
           start: 'top 88%'
         }
       }
     )
   })


   // Animate workflow cards
   const workflowCards = document.querySelectorAll('.workflow-card')
   workflowCards.forEach((card, i) => {
     gsap.fromTo(card,
       { opacity: 0, y: 40 },
       {
         opacity: 1,
         y: 0,
         duration: 0.7,
         ease: 'power2.out',
         delay: i * 0.08,
         scrollTrigger: {
           trigger: card,
           start: 'top 88%'
         }
       }
     )
   })


   // Animate section headings
   const headings = document.querySelectorAll('.section-heading')
   headings.forEach((heading) => {
     gsap.fromTo(heading,
       { opacity: 0, y: 30 },
       {
         opacity: 1,
         y: 0,
         duration: 0.8,
         ease: 'power3.out',
         scrollTrigger: {
           trigger: heading,
           start: 'top 85%'
         }
       }
     )
   })


   return () => {
     ScrollTrigger.getAll().forEach(trigger => trigger.kill())
   }
 }, [])


 // 3D Card Tilt Effect
 useEffect(() => {
   const cards = document.querySelectorAll('.tilt-card') as NodeListOf<HTMLElement>
  
   cards.forEach(card => {
     const handleMouseMove = (e: MouseEvent) => {
       const rect = card.getBoundingClientRect()
       const x = e.clientX - rect.left
       const y = e.clientY - rect.top
       const centerX = rect.width / 2
       const centerY = rect.height / 2
       const rotateX = ((y - centerY) / centerY) * -10
       const rotateY = ((x - centerX) / centerX) * 10


       card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`
       card.style.transition = 'transform 0.1s ease-out'
     }


     const handleMouseLeave = () => {
       card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)'
       card.style.transition = 'transform 0.5s ease-out'
     }


     card.addEventListener('mousemove', handleMouseMove as EventListener)
     card.addEventListener('mouseleave', handleMouseLeave)


     return () => {
       card.removeEventListener('mousemove', handleMouseMove as EventListener)
       card.removeEventListener('mouseleave', handleMouseLeave)
     }
   })
 }, [])


 return (
   <div className="min-h-screen bg-[#0a0a0c] text-[#f4f2ef] font-sans antialiased selection:bg-[#f5b8d0]/20 selection:text-white">
     {/* Three.js Particle Background */}
     <canvas
       ref={particlesRef}
       id="particlesBg"
       aria-hidden="true"
       className="fixed inset-0 pointer-events-none"
       style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', display: 'block' }}
     />


     {/* Navbar */}
     <header className="fixed top-0 left-0 right-0 z-60 backdrop-blur-xl bg-[#0a0a0c]/55 border-b border-white/[0.06]">
       <nav className="mx-auto flex items-center justify-between px-6 py-4 max-w-[77.5rem]">
         <div className="flex items-center gap-2">
           <Sparkles className="w-5 h-5 text-[#f5b8d0]" />
           <span className="text-sm font-medium tracking-tighter uppercase text-white">
             CreatorAI
           </span>
         </div>
         <div className="hidden md:flex items-center gap-8 text-sm text-[#b8b4ae]">
           <Link href="#platform" className="hover:text-white transition-colors duration-300">
             Platform
           </Link>
           <Link href="#ai-studio" className="hover:text-white transition-colors duration-300">
             AI Studio
           </Link>
           <Link href="#how-it-works" className="hover:text-white transition-colors duration-300">
             How It Works
           </Link>
           <Link href="#features" className="hover:text-white transition-colors duration-300">
             Features
           </Link>
         </div>
         <div className="flex items-center gap-4">
           <Link href="/login" className="text-sm text-[#b8b4ae] hover:text-white transition-colors">
             Login
           </Link>
           <Link href="/signup" className="text-sm font-normal px-4 py-1.5 rounded-full bg-[#ededed] text-[#1a1a1a] hover:bg-white transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.8),_0_2px_4px_rgba(0,0,0,0.1)]">
             Get Started
           </Link>
         </div>
       </nav>
     </header>


     {/* CINEMATIC PINNED SECTION */}
     <section ref={sectionRef} id="cinematic" className="relative" style={{ height: '820vh' }}>
       <div id="pinStage" className="sticky top-0 h-screen w-full overflow-hidden">
         {/* Canvas petal layer */}
         <canvas
           ref={canvasRef}
           id="petalCanvas"
           className="absolute inset-0 w-full h-full z-5 opacity-85"
           style={{ opacity: 0.85 }}
         />


         {/* Parallax visual layers */}
         <div id="visualWrap" className="absolute inset-0 z-1 will-change-transform">
           <div
             id="bgLayer"
             className="absolute inset-[-8%] bg-cover bg-center saturate-[0.7] brightness-[0.55] will-change-transform overflow-hidden isolation-auto"
           />
           <div id="midLayer" className="absolute inset-0 flex items-center justify-center will-change-transform">
             <div className="flex items-center justify-center w-full h-full">
               <div className="flex items-center justify-center" style={{ animation: 'soft-float-aura-emrgurr6g15xfazn2 6s ease-in-out infinite' }}>
                 <div
                   id="bouquet"
                   className="z-40 relative"
                   style={{
                     width: 'min(56vw, 40rem)',
                     aspectRatio: '16 / 11',
                     backgroundImage: 'url(https://hoirqrkdgbmvpwutwuwj.supabase.co/storage/v1/object/public/assets/assets/d0f628cf-26bf-473d-81b9-50e422c51521_3840w.png)',
                     backgroundSize: 'contain',
                     backgroundRepeat: 'no-repeat',
                     backgroundPosition: 'center center',
                     willChange: 'transform',
                     zIndex: 40,
                     animation: 'bouquetFloat 5s ease-in-out infinite'
                   }}
                 />
               </div>
             </div>
           </div>
         </div>


         <style jsx global>{`
           @keyframes bouquetFloat {
             0%   { transform: translateY(0); }
             50%  { transform: translateY(-1.25rem); }
             100% { transform: translateY(0); }
           }
           @keyframes soft-float-aura-emrgurr6g15xfazn2 {
             0%, 100% { transform: translateY(0px); }
             50% { transform: translateY(-24px); }
           }
         `}</style>


         {/* Color grade wash */}
         <div
           id="gradeWash"
           className="absolute inset-0 z-6 pointer-events-none"
           style={{
             background: 'radial-gradient(circle at 50% 45%, rgba(245, 184, 208, 0.1), rgba(10, 10, 12, 0.75) 70%)',
             mixBlendMode: 'screen'
           }}
         />


         {/* Letterbox bars */}
         <div
           id="lbTop"
           className="absolute top-0 left-0 right-0 bg-black z-20 will-change-transform"
           style={{ height: '0.000314vh' }}
         />
         <div
           id="lbBot"
           className="absolute bottom-0 left-0 right-0 bg-black z-20 will-change-transform"
           style={{ height: '0.000314vh' }}
         />


         {/* Corner brackets frame */}
         <div className="absolute inset-6 z-30 pointer-events-none">
           <span className="absolute top-0 left-0 w-[1.375rem] h-[1.375rem] border-t border-white/25 border-l border-white/25" />
           <span className="absolute top-0 right-0 w-[1.375rem] h-[1.375rem] border-t border-white/25 border-r border-white/25" />
           <span className="absolute bottom-0 left-0 w-[1.375rem] h-[1.375rem] border-b border-white/25 border-l border-white/25" />
           <span className="absolute bottom-0 right-0 w-[1.375rem] h-[1.375rem] border-b border-white/25 border-r border-white/25" />
         </div>


         {/* Copy beats */}
         <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
           <div className="beat flex flex-col items-center absolute text-center px-6" data-beat="0" style={{ opacity: 0 }}>
             <p className="text-xs uppercase tracking-[0.35rem] text-[#f5b8d0] mb-4">
               THE CREATIVE INTELLIGENCE PLATFORM
             </p>
             <h1 className="tracking-tight font-medium" style={{ fontSize: 'clamp(2.5rem,8vw,6rem)', lineHeight: 0.95 }}>
               From raw footage to<br />
               <span className="text-[#f5b8d0]">remarkable stories.</span>
             </h1>
           </div>
           <div className="beat flex flex-col items-center absolute text-center px-6" data-beat="1" style={{ opacity: 0 }}>
             <h2 className="tracking-tight font-medium" style={{ fontSize: 'clamp(2.125rem,7vw,5rem)', lineHeight: 1 }}>
               Your Ideas. Your Footage.
             </h2>
             <p className="text-sm mt-4 text-[#c9c4bd]" style={{ maxWidth: '27.5rem' }}>
               One intelligent creative workspace for everything you create.
             </p>
           </div>
           <div className="beat flex flex-col items-center absolute text-center px-6" data-beat="2" style={{ opacity: 0 }}>
             <p className="text-xs uppercase tracking-[0.3rem] text-[#f5b8d0] mb-3">
               Asset Intelligence
             </p>
             <h2 className="tracking-tight font-medium" style={{ fontSize: 'clamp(2.125rem,7vw,5rem)', lineHeight: 1 }}>
               Every Asset, Organized
             </h2>
           </div>
           <div className="beat flex flex-col items-center absolute text-center px-6" data-beat="3" style={{ opacity: 0 }}>
             <h2 className="tracking-tight font-medium" style={{ fontSize: 'clamp(2.125rem,7vw,5rem)', lineHeight: 1 }}>
               AI Creative Director
             </h2>
             <p className="text-sm mt-4 text-[#c9c4bd]" style={{ maxWidth: '26.25rem' }}>
               Generate hooks, scripts, story structures, and actionable feedback.
             </p>
           </div>
           <div className="beat flex flex-col items-center absolute text-center px-6" data-beat="4" style={{ opacity: 0 }}>
             <p className="text-xs uppercase tracking-[0.3rem] text-[#f5b8d0] mb-3">
               Intelligent Editor
             </p>
             <h2 className="tracking-tight font-medium" style={{ fontSize: 'clamp(2.125rem,7vw,5rem)', lineHeight: 1 }}>
               From Hours to Moments
             </h2>
           </div>
           <div className="beat flex flex-col items-center absolute text-center px-6" data-beat="5" style={{ opacity: 0 }}>
             <h2 className="tracking-tight font-medium" style={{ fontSize: 'clamp(2.125rem,7vw,5rem)', lineHeight: 1 }}>
               Take Control
             </h2>
           </div>
           <div className="beat flex flex-col items-center absolute text-center px-6" data-beat="6" style={{ opacity: 0 }}>
             <p className="text-xs uppercase tracking-[0.3rem] text-[#f5b8d0] mb-3">
               CreatorAI
             </p>
             <h2 className="tracking-tight uppercase font-medium" style={{ fontSize: 'clamp(2.375rem,8vw,5.625rem)', lineHeight: 1 }}>
               Start Creating
             </h2>
             <p className="text-sm mt-4 text-[#c9c4bd]">
               Your creative workflow begins here.
             </p>
           </div>
         </div>


         {/* Timeline HUD */}
         <div className="absolute left-8 bottom-14 z-45 flex items-center gap-4">
           <div
             id="timelineTrack"
             className="w-45 h-0.1875 rounded-full overflow-hidden"
             style={{ width: '11.25rem', height: '0.1875rem', background: 'rgba(255,255,255,0.16)' }}
           >
             <div
               id="timelineFill"
               className="h-full"
               style={{
                 width: '0%',
                 background: 'linear-gradient(90deg, rgb(245, 184, 208), rgb(194, 106, 151))'
               }}
             />
           </div>
           <span id="timeLabel" className="text-xs tabular-nums text-[#b8b4ae]">0.00s</span>
         </div>


         {/* Timeline dots */}
         <div
           id="dotRow"
           className="absolute right-8 bottom-14 z-45 flex gap-2.5"
         />
       </div>
     </section>


     {/* Features Section */}
     <section id="features" className="mx-auto px-6 py-24 max-w-[77.5rem] relative overflow-hidden">
       <div className="absolute inset-0 bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.015)_0,rgba(255,255,255,0.015)_1px,transparent_1px,transparent_9px)] pointer-events-none" />


       <div className="mb-12 section-heading">
         <p className="text-xs uppercase text-[#f5b8d0] tracking-[0.3rem] mb-3">
           Features
         </p>
         <h2 className="tracking-tight text-[clamp(1.875rem,5vw,3.5rem)] font-medium leading-[1.05]">
           Everything you need to create
         </h2>
       </div>


       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         {/* Feature Card 1 */}
         <div className="group flex flex-col border-white/[0.06] hover:bg-white/[0.04] transition-colors duration-500 cursor-pointer border rounded-2xl p-6 backdrop-blur-lg feature-card tilt-card">
           <div className="rounded-xl overflow-hidden mb-5 aspect-video bg-gradient-to-br from-[#f5b8d0]/20 to-[#c26a97]/20 flex items-center justify-center">
             <Search className="w-12 h-12 text-[#f5b8d0]" />
           </div>
           <div className="flex flex-col flex-grow justify-between">
             <div>
               <h3 className="text-base font-medium tracking-tight group-hover:text-white transition-colors text-[#e8e6e3]">
                 Asset Intelligence
               </h3>
               <p className="text-sm mt-1.5 text-[#9c988f]">
                 Every creative asset, organized and searchable.
               </p>
             </div>
             <p className="text-sm mt-4 text-[#c9c4bd]">
               Centralize video, image, and audio assets. Discover clips through semantic search, spoken content, and visual context.
             </p>
           </div>
         </div>


         {/* Feature Card 2 */}
         <div className="group flex flex-col border-white/[0.06] hover:bg-white/[0.04] transition-colors duration-500 cursor-pointer border rounded-2xl p-6 backdrop-blur-lg feature-card tilt-card">
           <div className="rounded-xl overflow-hidden mb-5 aspect-video bg-gradient-to-br from-[#f5b8d0]/20 to-[#c26a97]/20 flex items-center justify-center">
             <Wand2 className="w-12 h-12 text-[#f5b8d0]" />
           </div>
           <div className="flex flex-col flex-grow justify-between">
             <div>
               <h3 className="text-base font-medium tracking-tight group-hover:text-white transition-colors text-[#e8e6e3]">
                 AI Creative Director
               </h3>
               <p className="text-sm mt-1.5 text-[#9c988f]">
                 Turn ideas into a creative direction.
               </p>
             </div>
             <p className="text-sm mt-4 text-[#c9c4bd]">
               Generate hooks, scripts, story structures, and actionable feedback.
             </p>
           </div>
         </div>


         {/* Feature Card 3 */}
         <div className="group flex flex-col border-white/[0.06] hover:bg-white/[0.04] transition-colors duration-500 cursor-pointer border rounded-2xl p-6 backdrop-blur-lg feature-card tilt-card">
           <div className="rounded-xl overflow-hidden mb-5 aspect-video bg-gradient-to-br from-[#f5b8d0]/20 to-[#c26a97]/20 flex items-center justify-center">
             <Film className="w-12 h-12 text-[#f5b8d0]" />
           </div>
           <div className="flex flex-col flex-grow justify-between">
             <div>
               <h3 className="text-base font-medium tracking-tight group-hover:text-white transition-colors text-[#e8e6e3]">
                 Intelligent Editor
               </h3>
               <p className="text-sm mt-1.5 text-[#9c988f]">
                 From hours of footage to moments worth sharing.
               </p>
             </div>
             <p className="text-sm mt-4 text-[#c9c4bd]">
               Identify meaningful segments, generate short-form edits, and retain complete control over the editable timeline.
             </p>
           </div>
         </div>
       </div>
     </section>


     {/* Workflow Section */}
     <section id="how-it-works" className="mx-auto px-6 py-24 max-w-[77.5rem] relative">
       <div className="mb-12 section-heading">
         <p className="text-xs uppercase text-[#f5b8d0] tracking-[0.3rem] mb-3">
           Workflow
         </p>
         <h2 className="tracking-tight text-[clamp(1.875rem,5vw,3.5rem)] font-medium leading-[1.05]">
           From first thought to final frame.
         </h2>
       </div>


       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
         {[
           { icon: Sparkles, title: 'Imagine', desc: 'Generate concepts, hooks, and scripts.' },
           { icon: Search, title: 'Understand', desc: 'Analyze footage, audio, and transcripts.' },
           { icon: Play, title: 'Discover', desc: 'Find moments matching your creative vision.' },
           { icon: Film, title: 'Assemble', desc: 'Generate intelligent edits and shorts.' },
           { icon: Wand2, title: 'Take Control', desc: 'Refine AI edits using an editable timeline.' },
           { icon: Send, title: 'Deliver', desc: 'Prepare content for different social platforms.' }
         ].map((step, i) => (
           <div key={i} className="flex flex-col border-white/[0.06] hover:bg-white/[0.04] transition-colors duration-500 bg-neutral-900/50 border rounded-2xl p-6 workflow-card tilt-card">
             <div className="w-12 h-12 rounded-full bg-[#f5b8d0]/20 flex items-center justify-center mb-4">
               <step.icon className="w-6 h-6 text-[#f5b8d0]" />
             </div>
             <h3 className="text-lg font-medium tracking-tight text-[#e8e6e3] mb-2">
               {step.title}
             </h3>
             <p className="text-sm text-[#9c988f]">
               {step.desc}
             </p>
           </div>
         ))}
       </div>
     </section>


     {/* CTA Section */}
     <section className="mx-auto px-6 py-24 max-w-[77.5rem] relative text-center">
       <div className="absolute inset-0 bg-gradient-to-b from-[#f5b8d0]/5 to-transparent pointer-events-none" />
       <h2 className="tracking-tight text-[clamp(2rem,6vw,4rem)] font-medium leading-[1.1] mb-6">
         Your next great story starts here.
       </h2>
       <p className="text-lg text-[#c9c4bd] max-w-2xl mx-auto mb-10">
         Join thousands of creators who are transforming their workflow with AI-powered creativity.
       </p>
       <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
         <Link href="/signup" className="inline-flex items-center gap-2 text-sm font-medium px-6 py-3 rounded-full bg-[#f5b8d0] text-[#1a1a1a] hover:bg-[#f5b8d0]/90 transition-colors">
           <Sparkles className="w-4 h-4" />
           Start Creating
         </Link>
         <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-medium px-6 py-3 rounded-full bg-white/10 border border-white/10 text-white hover:bg-white/20 transition-colors backdrop-blur-md">
           Explore Workspace
           <ArrowRight className="w-4 h-4" />
         </Link>
       </div>
     </section>


     {/* Footer */}
     <footer className="mx-auto px-6 py-16 max-w-[77.5rem] border-t border-white/[0.06]">
       <div className="flex flex-col md:flex-row justify-between gap-10">
         <div>
           <div className="flex items-center gap-2 mb-4">
             <Sparkles className="w-5 h-5 text-[#f5b8d0]" />
             <span className="text-sm font-medium tracking-tighter uppercase text-white">
               CreatorAI
             </span>
           </div>
           <p className="text-sm text-[#7d7a73] max-w-[17.5rem]">
             Your AI-powered creative operating system.
           </p>
         </div>
         <div className="flex gap-16 text-sm text-[#9c988f]">
           <div className="flex flex-col gap-3">
             <Link href="#platform" className="hover:text-white transition-colors">
               Platform
             </Link>
             <Link href="#ai-studio" className="hover:text-white transition-colors">
               AI Studio
             </Link>
             <Link href="#features" className="hover:text-white transition-colors">
               Features
             </Link>
           </div>
           <div className="flex flex-col gap-3">
             <Link href="/login" className="hover:text-white transition-colors">
               Login
             </Link>
             <Link href="/signup" className="hover:text-white transition-colors">
               Sign Up
             </Link>
             <Link href="/dashboard" className="hover:text-white transition-colors">
               Dashboard
             </Link>
           </div>
         </div>
       </div>
       <div className="mt-16 flex items-center justify-between">
         <p className="text-xs text-[#5c5a55]">
           © 2026 CreatorAI. All rights reserved.
         </p>
       </div>
     </footer>
   </div>
 )
}
