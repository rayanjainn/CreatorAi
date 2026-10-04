'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Download, Sparkles, Flame, CheckCircle, ExternalLink, ShieldCheck, Loader2 } from 'lucide-react';
import { LumiClipItem } from '@/src/services/lumiclipService';

interface ClipCardProps {
  clip: LumiClipItem;
  onPreview: (clip: LumiClipItem) => void;
  onExport: (clip: LumiClipItem) => void;
  isExporting?: boolean;
}

export function ClipCard({ clip, onPreview, onExport, isExporting = false }: ClipCardProps) {
  const [imgError, setImgError] = useState(false);

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const remainder = Math.floor(sec % 60);
    return `${mins}:${remainder.toString().padStart(2, '0')}`;
  };

  const viralityPercent = Math.round(clip.score * 100);

  const getThumbnailSrc = (): string => {
    const raw = clip.thumbnail_url || clip.download_url || '';
    if (raw.includes('youtube.com') || raw.includes('youtu.be')) {
      let ytId = '';
      if (raw.includes('v=')) ytId = raw.split('v=')[1]?.split('&')[0];
      else if (raw.includes('youtu.be/')) ytId = raw.split('youtu.be/')[1]?.split('?')[0];
      if (ytId) return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
    }
    // If it's a direct video URL ending in .mp4, img tag fails, so fallback to null to render stylish badge
    if (raw.match(/\.(mp4|webm|mov)(\?.*)?$/i)) {
      return '';
    }
    return raw;
  };

  const thumbSrc = getThumbnailSrc();

  return (
    <motion.article
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      className="bg-[#18181f] border border-[#2b2b36] hover:border-violet-500/50 rounded-2xl overflow-hidden shadow-xl flex flex-col group"
    >
      {/* Thumbnail Container */}
      <div className="relative aspect-[9/16] bg-[#111115] overflow-hidden max-h-[320px] w-full flex items-center justify-center">
        {!imgError && thumbSrc ? (
          <img
            src={thumbSrc}
            alt={clip.title}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-violet-950/80 via-zinc-900 to-indigo-950 flex flex-col items-center justify-center p-4 text-center">
            <div className="w-12 h-12 rounded-full bg-violet-600/20 border border-violet-500/40 flex items-center justify-center text-violet-400 mb-2">
              <Sparkles size={24} />
            </div>
            <span className="text-xs font-semibold text-white line-clamp-2 px-2 mb-1">{clip.title}</span>
            <span className="text-[10px] font-mono text-zinc-400">Click to Preview & Download</span>
          </div>
        )}

        {/* Top Badges Overlay */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2 pointer-events-none">
          <span className="bg-[#09090d]/90 backdrop-blur-md text-emerald-400 border border-emerald-500/30 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 shadow-lg">
            <Flame size={12} className="text-amber-400 fill-amber-400" />
            {viralityPercent}% VIRAL SCORE
          </span>

          <span className="bg-[#09090d]/90 backdrop-blur-md text-zinc-300 border border-[#333340] text-[10px] font-mono px-2 py-0.5 rounded-md shadow-lg">
            {clip.quality || '1080p'}
          </span>
        </div>

        {/* Bottom Duration Badge */}
        <div className="absolute bottom-3 right-3 bg-[#08080b]/90 backdrop-blur-md text-white font-mono text-[10px] font-bold px-2 py-1 rounded-md shadow-md">
          {formatDuration(clip.duration)}
        </div>

        {/* Hover Play Button Overlay */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => onPreview(clip)}
            className="w-12 h-12 rounded-full bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center shadow-xl shadow-violet-900/60 scale-90 hover:scale-100 transition-all cursor-pointer"
            title="Preview Clip"
          >
            <Play size={20} className="ml-0.5" />
          </button>
        </div>
      </div>

      {/* Clip Content Details */}
      <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
        <div>
          <h3 className="text-sm font-bold text-white line-clamp-1 mb-1.5 group-hover:text-violet-300 transition-colors">
            {clip.title}
          </h3>

          <div className="p-2.5 bg-[#121217] border border-[#252530] rounded-xl text-[11px] text-zinc-300 line-clamp-2 leading-relaxed">
            <span className="text-amber-400 font-semibold mr-1">AI Reason:</span>
            {clip.reason}
          </div>
        </div>

        {/* Actions Footer */}
        <div className="pt-2 border-t border-[#272733] flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPreview(clip)}
            className="flex-1 py-2 px-3 bg-[#23232c] hover:bg-[#2d2d38] text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all"
          >
            <Play size={14} />
            <span>Preview</span>
          </button>

          <button
            type="button"
            disabled={isExporting}
            onClick={() => onExport(clip)}
            className="flex-1 py-2 px-3 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-violet-950/40 transition-all cursor-pointer disabled:opacity-50"
          >
            {isExporting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} />
            )}
            <span>{isExporting ? 'Exporting...' : 'Download'}</span>
          </button>
        </div>
      </div>
    </motion.article>
  );
}

export default ClipCard;
