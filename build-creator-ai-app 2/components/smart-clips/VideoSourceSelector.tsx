'use client';

import React from 'react';
import { UploadCloud, Link as LinkIcon } from 'lucide-react';

export type VideoSourceMode = 'upload' | 'url';

interface VideoSourceSelectorProps {
  mode: VideoSourceMode;
  onChangeMode: (mode: VideoSourceMode) => void;
  disabled?: boolean;
}

export function VideoSourceSelector({
  mode,
  onChangeMode,
  disabled = false,
}: VideoSourceSelectorProps) {
  return (
    <div className="flex items-center gap-1 p-1.5 bg-[#141419] border border-[#272730] rounded-xl w-full max-w-md mx-auto mb-6">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChangeMode('upload')}
        className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-semibold transition-all duration-200 ${
          mode === 'upload'
            ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-900/30'
            : 'text-zinc-400 hover:text-white hover:bg-[#202028]'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <UploadCloud size={16} />
        <span>Upload Video</span>
      </button>

      <button
        type="button"
        disabled={disabled}
        onClick={() => onChangeMode('url')}
        className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-semibold transition-all duration-200 ${
          mode === 'url'
            ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-900/30'
            : 'text-zinc-400 hover:text-white hover:bg-[#202028]'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <LinkIcon size={16} />
        <span>Paste Video URL</span>
      </button>
    </div>
  );
}

export default VideoSourceSelector;
