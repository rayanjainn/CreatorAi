'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, Pause, Download, Flame, Sparkles, Check, Share2, Layers } from 'lucide-react';
import { LumiClipItem } from '@/src/services/lumiclipService';

interface ClipPreviewModalProps {
  clip: LumiClipItem | null;
  onClose: () => void;
  onDownload: (clip: LumiClipItem, quality: string) => void;
}

export function ClipPreviewModal({
  clip,
  onClose,
  onDownload,
}: ClipPreviewModalProps) {
  const [selectedQuality, setSelectedQuality] = useState<'1080p' | '720p'>('1080p');
  const [subtitleStyle, setSubtitleStyle] = useState<'punch' | 'spot' | 'retro' | 'minimal'>('punch');
  const [copied, setCopied] = useState(false);

  if (!clip) return null;

  const handleShare = () => {
    if (clip.download_url) {
      navigator.clipboard.writeText(clip.download_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const viralityPercent = Math.round(clip.score * 100);

  const rawUrl = clip.download_url || clip.thumbnail_url || '';
  const isYouTubeUrl = rawUrl.includes('youtube.com') || rawUrl.includes('youtu.be');

  let ytVideoId = '';
  let ytStartSec = 0;
  if (isYouTubeUrl) {
    if (rawUrl.includes('v=')) ytVideoId = rawUrl.split('v=')[1]?.split('&')[0];
    else if (rawUrl.includes('youtu.be/')) ytVideoId = rawUrl.split('youtu.be/')[1]?.split('?')[0];

    if (rawUrl.includes('t=')) {
      const match = rawUrl.match(/t=(\d+)s?/);
      if (match) ytStartSec = parseInt(match[1], 10);
    }
  }

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-[#18181f] border border-[#343444] rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl grid grid-cols-1 md:grid-cols-12 max-h-[90vh]"
        >
          {/* Left Column: Vertical Video Player with Live Subtitle Overlay */}
          <div className="md:col-span-6 bg-black flex items-center justify-center relative p-4 min-h-[420px] overflow-hidden group">
            {isYouTubeUrl && ytVideoId ? (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${ytVideoId}?start=${ytStartSec}&autoplay=1&rel=0`}
                title={clip.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full min-h-[400px] aspect-[9/16] rounded-xl border border-[#262633] shadow-xl"
              />
            ) : (
              <video
                src={clip.download_url}
                controls
                autoPlay
                playsInline
                className="w-full max-h-[500px] object-contain rounded-xl border border-[#262633] shadow-xl"
              />
            )}

            {/* Live Subtitle Overlay Badge */}
            <div className="absolute bottom-16 left-8 right-8 pointer-events-none flex justify-center text-center">
              <div
                className={`px-3.5 py-1.5 rounded-xl font-black text-sm uppercase tracking-wide shadow-2xl transition-all ${
                  subtitleStyle === 'punch'
                    ? 'bg-amber-400 text-black border-2 border-black font-extrabold shadow-amber-500/20'
                    : subtitleStyle === 'spot'
                    ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white border border-violet-400/50 shadow-violet-900/60'
                    : subtitleStyle === 'retro'
                    ? 'bg-black/90 text-yellow-300 border border-yellow-400/60 font-mono'
                    : 'bg-black/80 backdrop-blur-md text-white border border-zinc-700'
                }`}
              >
                <span>💬 {clip.title}</span>
              </div>
            </div>
          </div>

          {/* Right Column: Metadata & Controls */}
          <div className="md:col-span-6 p-6 flex flex-col justify-between space-y-5 bg-[#18181f]">
            {/* Header */}
            <div>
              <div className="flex items-start justify-between gap-3 mb-2">
                <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                  <Flame size={13} className="text-amber-400 fill-amber-400" />
                  {viralityPercent}% VIRALITY SCORE
                </span>

                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 text-zinc-400 hover:text-white bg-[#252530] hover:bg-[#303040] rounded-lg transition-all"
                >
                  <X size={18} />
                </button>
              </div>

              <h2 className="text-lg font-bold text-white mb-3 leading-snug">{clip.title}</h2>

              {/* AI Reasoning box */}
              <div className="p-3.5 bg-[#121217] border border-[#2b2b38] rounded-xl space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                  <Sparkles size={14} />
                  <span>AI Selection Rationale</span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">{clip.reason}</p>
              </div>
            </div>

            {/* Quality & Duration Details */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-[#121217] border border-[#262632] rounded-xl">
                  <span className="block text-[10px] text-zinc-400 uppercase tracking-wider mb-1">
                    Duration
                  </span>
                  <span className="text-sm font-bold text-white font-mono">
                    {clip.duration.toFixed(1)}s
                  </span>
                </div>

                <div className="p-3 bg-[#121217] border border-[#262632] rounded-xl">
                  <span className="block text-[10px] text-zinc-400 uppercase tracking-wider mb-1">
                    Status
                  </span>
                  <span className="text-xs font-bold text-emerald-400 uppercase flex items-center gap-1">
                    <Check size={14} /> Ready to Export
                  </span>
                </div>
              </div>

              {/* Subtitle Style Selector */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
                  Subtitle Caption Overlay Style
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(['punch', 'spot', 'retro', 'minimal'] as const).map((style) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() => setSubtitleStyle(style)}
                      className={`py-1.5 px-2 rounded-lg border text-[11px] font-bold capitalize transition-all ${
                        subtitleStyle === style
                          ? 'border-violet-500 bg-violet-950/60 text-white'
                          : 'border-[#292936] bg-[#121217] text-zinc-400 hover:text-white'
                      }`}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quality selector */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
                  Export Resolution Quality
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedQuality('1080p')}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      selectedQuality === '1080p'
                        ? 'border-violet-500 bg-violet-950/40 text-white'
                        : 'border-[#292936] bg-[#121217] text-zinc-400'
                    }`}
                  >
                    <span>1080p Full HD</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedQuality('720p')}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                      selectedQuality === '720p'
                        ? 'border-violet-500 bg-violet-950/40 text-white'
                        : 'border-[#292936] bg-[#121217] text-zinc-400'
                    }`}
                  >
                    <span>720p Standard</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="pt-3 border-t border-[#292936] flex items-center gap-2">
              <button
                type="button"
                onClick={handleShare}
                className="py-2.5 px-4 bg-[#23232d] hover:bg-[#2e2e3b] text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-all"
              >
                {copied ? <Check size={16} className="text-emerald-400" /> : <Share2 size={16} />}
                <span>{copied ? 'Copied Link' : 'Copy Link'}</span>
              </button>

              <button
                type="button"
                onClick={() => onDownload(clip, selectedQuality)}
                className="flex-1 py-2.5 px-4 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-violet-950/40 transition-all cursor-pointer"
              >
                <Download size={16} />
                <span>Download Video ({selectedQuality})</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export default ClipPreviewModal;
