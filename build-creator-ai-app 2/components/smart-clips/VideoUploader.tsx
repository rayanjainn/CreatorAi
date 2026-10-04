'use client';

import React, { useRef, useState } from 'react';
import {
  UploadCloud,
  FileVideo,
  X,
  RefreshCw,
  Play,
  CheckCircle2,
  AlertCircle,
  Link as LinkIcon,
  Trash2,
} from 'lucide-react';
import { VideoSourceMode } from './VideoSourceSelector';

interface VideoUploaderProps {
  sourceMode: VideoSourceMode;
  selectedFile: File | null;
  videoPreviewUrl: string | null;
  videoUrl: string;
  urlError: string | null;
  uploadProgress: number | null; // null or 0-100
  onFileSelect: (file: File) => void;
  onRemoveFile: () => void;
  onUrlChange: (url: string) => void;
  disabled?: boolean;
}

export function VideoUploader({
  sourceMode,
  selectedFile,
  videoPreviewUrl,
  videoUrl,
  urlError,
  uploadProgress,
  onFileSelect,
  onRemoveFile,
  onUrlChange,
  disabled = false,
}: VideoUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('video/') || file.name.match(/\.(mp4|mov|webm|mkv|avi|m4v)$/i)) {
        onFileSelect(file);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelect(e.target.files[0]);
    }
  };

  const handlePasteClick = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          onUrlChange(text.trim());
          return;
        }
      }
    } catch {}
    // Fallback if clipboard permission not granted: focus input
    const inputEl = document.getElementById('video-url-input');
    if (inputEl) inputEl.focus();
  };

  const isVideoLoaded = Boolean(selectedFile || videoUrl.trim());

  return (
    <div className="bg-[#16161c] border border-[#2b2b36] rounded-2xl p-6 shadow-xl space-y-5 h-full flex flex-col justify-between">
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/mov,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Card Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-xl bg-violet-600 text-white font-extrabold text-xs flex items-center justify-center shadow-md shadow-violet-950/40">
            1
          </div>
          <h3 className="text-base font-extrabold text-white tracking-tight">Video source</h3>
        </div>
        <span className="text-xs text-zinc-400 font-medium">
          Supports YouTube, MP4, MOV, WEBM and more
        </span>
      </div>

      {/* Dashed Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
        className={`flex-1 border-2 border-dashed rounded-2xl py-10 px-6 text-center flex flex-col items-center justify-center cursor-pointer transition-all duration-200 min-h-[220px] ${
          isDragging
            ? 'border-violet-500 bg-violet-500/10 scale-[1.01]'
            : 'border-violet-500/40 bg-[#121217] hover:bg-[#15151e] hover:border-violet-500/70'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-violet-600/20 to-indigo-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400 mb-3 shadow-lg shadow-violet-950/40">
          <UploadCloud size={28} />
        </div>

        <h4 className="text-base font-bold text-white mb-1">Drop your video here</h4>
        <p className="text-xs text-zinc-400 mb-2">or click to browse</p>
        <span className="text-[11px] text-zinc-500 font-medium mb-3">MP4, MOV, WEBM • Up to 2GB</span>

        <button
          type="button"
          disabled={disabled}
          className="px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-md shadow-violet-950/40 transition-all flex items-center gap-2 cursor-pointer"
        >
          <FileVideo size={15} />
          <span>Browse Files</span>
        </button>
      </div>

      {/* Or Paste a Video Link Divider */}
      <div className="flex items-center gap-4 text-xs text-zinc-500 my-2">
        <div className="flex-1 h-[1px] bg-[#272733]" />
        <span className="text-[11px] text-zinc-400 font-medium">or paste a video link</span>
        <div className="flex-1 h-[1px] bg-[#272733]" />
      </div>

      {/* URL Input Bar */}
      <div className="space-y-2">
        <div className="bg-[#121217] border border-[#2c2c38] focus-within:border-violet-500/70 rounded-xl p-1.5 pl-3.5 flex items-center gap-3 transition-all">
          <LinkIcon size={16} className="text-zinc-400 flex-shrink-0" />
          <input
            id="video-url-input"
            type="url"
            disabled={disabled}
            value={videoUrl}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="Paste YouTube or direct video URL..."
            className="w-full bg-transparent border-none text-xs text-white placeholder-zinc-500 focus:outline-none"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={handlePasteClick}
            className="px-5 py-2 bg-violet-600 hover:bg-violet-500 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md shadow-violet-950/40 transition-all cursor-pointer flex-shrink-0"
          >
            Paste
          </button>
        </div>

        {urlError && (
          <div className="flex items-center gap-1.5 px-1 text-xs text-red-400">
            <AlertCircle size={14} />
            <span>{urlError}</span>
          </div>
        )}
      </div>

      {/* Loaded Video Card (Preview) - Only rendered when user has uploaded a file or entered a valid URL */}
      {isVideoLoaded && (
        <div className="bg-[#121217] border border-[#292938] rounded-2xl p-4 flex items-center justify-between gap-4 transition-all">
          <div className="flex items-center gap-4 min-w-0">
            {/* Video Thumbnail with Play overlay */}
            <div className="relative w-24 aspect-[16/9] rounded-xl overflow-hidden bg-black flex-shrink-0 border border-white/10 group shadow-md flex items-center justify-center">
              {videoPreviewUrl ? (
                <video src={videoPreviewUrl} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-violet-950/60 to-black flex items-center justify-center">
                  <Play size={16} className="text-violet-400" />
                </div>
              )}
            </div>

            {/* Title & Metadata */}
            <div className="min-w-0 space-y-1">
              <h4 className="text-xs font-bold text-white truncate max-w-[220px] sm:max-w-xs">
                {selectedFile?.name || videoUrl}
              </h4>
              <p className="text-[11px] text-zinc-400 font-medium">
                {selectedFile ? `${formatFileSize(selectedFile.size)} • Local File` : 'Video URL Source'}
              </p>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-950/70 border border-emerald-500/40 text-emerald-400 text-[10px] font-bold">
                <CheckCircle2 size={12} className="text-emerald-400" />
                <span>Video loaded successfully</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {selectedFile && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => fileInputRef.current?.click()}
                className="px-3.5 py-2 bg-[#21212a] hover:bg-[#2c2c38] border border-[#2e2e3a] text-zinc-200 hover:text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <RefreshCw size={13} />
                <span>Replace</span>
              </button>
            )}

            <button
              type="button"
              disabled={disabled}
              onClick={onRemoveFile}
              className="p-2 bg-[#21212a] hover:bg-red-500/15 border border-[#2e2e3a] text-zinc-400 hover:text-red-400 rounded-xl text-xs transition-all cursor-pointer"
              title="Remove Video"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Ingestion Progress */}
      {uploadProgress !== null && (
        <div className="p-3 bg-[#111116] border border-[#262632] rounded-xl">
          <div className="flex justify-between text-xs text-zinc-300 mb-1.5 font-medium">
            <span>Ingesting Video File...</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="w-full h-1.5 bg-[#252530] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-amber-400 transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default VideoUploader;
