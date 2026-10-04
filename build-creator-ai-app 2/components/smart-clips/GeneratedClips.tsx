'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Flame, Sparkles, Filter, SlidersHorizontal, Film } from 'lucide-react';
import { LumiClipItem } from '@/src/services/lumiclipService';
import ClipCard from './ClipCard';
import ClipPreviewModal from './ClipPreviewModal';

interface GeneratedClipsProps {
  clips: LumiClipItem[];
  projectName?: string;
  onExportClip: (clip: LumiClipItem, quality?: string) => void;
  exportingClipId?: string | null;
}

export function GeneratedClips({
  clips,
  projectName = 'AI Smart Clips',
  onExportClip,
  exportingClipId = null,
}: GeneratedClipsProps) {
  const [selectedPreviewClip, setSelectedPreviewClip] = useState<LumiClipItem | null>(null);
  const [sortBy, setSortBy] = useState<'score' | 'duration' | 'title'>('score');

  const sortedClips = [...clips].sort((a, b) => {
    if (sortBy === 'score') return b.score - a.score;
    if (sortBy === 'duration') return b.duration - a.duration;
    return a.title.localeCompare(b.title);
  });

  const avgScore =
    clips.length > 0
      ? Math.round((clips.reduce((acc, c) => acc + c.score, 0) / clips.length) * 100)
      : 0;

  const totalDurationSec = clips.reduce((acc, c) => acc + c.duration, 0);

  if (clips.length === 0) {
    return (
      <div className="bg-[#18181f] border border-[#2b2b36] rounded-2xl p-12 text-center flex flex-col items-center justify-center space-y-3 shadow-xl">
        <div className="w-16 h-16 rounded-2xl bg-violet-950/40 border border-violet-500/30 flex items-center justify-center text-violet-400">
          <Film size={32} />
        </div>
        <h3 className="text-base font-bold text-white">No Clips Generated Yet</h3>
        <p className="text-xs text-zinc-400 max-w-sm leading-relaxed">
          Upload a video or paste a URL above, configure your settings, and click &ldquo;Generate AI Clips&rdquo; to start processing.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header Summary */}
      <div className="bg-[#18181f] border border-[#2b2b36] rounded-2xl p-5 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-bold text-white">Generated AI Clips</h2>
            <span className="bg-violet-950/60 text-violet-300 border border-violet-500/40 text-xs font-semibold px-2.5 py-0.5 rounded-full">
              {clips.length} Clips Ready
            </span>
          </div>
          <p className="text-xs text-zinc-400">
            Project: <span className="text-zinc-200 font-medium">{projectName}</span> • Total Duration:{' '}
            <span className="text-zinc-200 font-mono">{(totalDurationSec / 60).toFixed(1)} mins</span>
          </p>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          {/* Average Virality */}
          <div className="flex items-center gap-2 bg-[#121217] px-3.5 py-2 rounded-xl border border-[#292936]">
            <Flame size={18} className="text-amber-400 fill-amber-400" />
            <div>
              <div className="text-[10px] text-zinc-400 uppercase font-semibold">Avg Virality</div>
              <div className="text-xs font-bold text-white">{avgScore}% Score</div>
            </div>
          </div>

          {/* Sort selector */}
          <div className="flex items-center gap-2 bg-[#121217] px-3 py-1.5 rounded-xl border border-[#292936]">
            <SlidersHorizontal size={14} className="text-zinc-400" />
            <span className="text-xs text-zinc-400 font-medium">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer"
            >
              <option value="score" className="bg-[#18181f] text-white">Highest Virality</option>
              <option value="duration" className="bg-[#18181f] text-white">Longest First</option>
              <option value="title" className="bg-[#18181f] text-white">Title (A-Z)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Clip Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {sortedClips.map((clip) => (
          <ClipCard
            key={clip.id}
            clip={clip}
            onPreview={(c) => setSelectedPreviewClip(c)}
            onExport={(c) => onExportClip(c)}
            isExporting={exportingClipId === clip.id}
          />
        ))}
      </div>

      {/* Video Preview Modal */}
      <ClipPreviewModal
        clip={selectedPreviewClip}
        onClose={() => setSelectedPreviewClip(null)}
        onDownload={(clip, quality) => {
          onExportClip(clip, quality);
        }}
      />
    </div>
  );
}

export default GeneratedClips;
