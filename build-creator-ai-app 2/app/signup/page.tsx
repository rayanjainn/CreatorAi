'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSignup = (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setTimeout(() => {
      router.push('/dashboard')
    }, 1000)
  }

  return (
    <div className="min-h-screen w-full flex bg-[#0d0d0d] text-[#f4f2ef] font-sans antialiased">
      {/* Left Sidebar - Signup Form */}
      <div className="w-full lg:w-[480px] flex flex-col justify-center px-8 sm:px-12 md:px-16 bg-[#121212] border-r border-white/[0.05] relative z-10 shadow-2xl">
        <Link href="/" className="flex items-center gap-2 mb-12 hover:opacity-80 transition-opacity self-center">
          <Sparkles className="w-8 h-8 text-white" />
        </Link>
        
        <h1 className="text-[28px] font-medium tracking-tight mb-8 text-center text-white">Create an account</h1>
        
        <form onSubmit={handleSignup} className="flex flex-col gap-5">
          <div>
            <input 
              type="text" 
              id="name"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-transparent border border-white/10 rounded-full px-5 py-3.5 text-sm focus:outline-none focus:border-white transition-colors text-white placeholder-white/40"
              placeholder="Full Name"
              required
            />
          </div>
          <div>
            <input 
              type="email" 
              id="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-transparent border border-white/10 rounded-full px-5 py-3.5 text-sm focus:outline-none focus:border-white transition-colors text-white placeholder-white/40"
              placeholder="Email address"
              required
            />
          </div>
          <div>
            <input 
              type="password" 
              id="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-transparent border border-white/10 rounded-full px-5 py-3.5 text-sm focus:outline-none focus:border-white transition-colors text-white placeholder-white/40"
              placeholder="Password"
              required
            />
          </div>
          
          <button 
            type="submit" 
            disabled={loading}
            className="mt-2 w-full bg-white text-black font-medium px-4 py-3.5 rounded-full hover:bg-white/90 transition-colors disabled:opacity-70 text-sm"
          >
            {loading ? 'Creating account...' : 'Continue'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[#9c988f]">
          Already have an account? <Link href="/login" className="text-white hover:underline transition-all font-medium">Sign in</Link>
        </p>


      </div>

      {/* Right Side - Video Presentation */}
      <div className="hidden lg:flex flex-1 flex-col items-center justify-center relative overflow-hidden" 
           style={{
             backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.03) 0, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 15px)',
             backgroundSize: '15px 15px'
           }}>
        
        <div className="max-w-[80%] xl:max-w-[1000px] w-full flex flex-col items-center">
          <h2 className="text-4xl xl:text-5xl font-serif mb-3 text-center text-white">Introducing CreatorAI editor</h2>
          <p className="text-white/60 text-center mb-10 text-sm">A professional online video editor with AI editing agents you can assign real work to.</p>
          
          <div className="w-full aspect-[16/9] rounded-2xl overflow-hidden border border-white/[0.08] shadow-2xl relative bg-neutral-900">
            <video 
              src="/InvideoEditorPromo.mp4" 
              autoPlay 
              loop 
              muted 
              playsInline
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
