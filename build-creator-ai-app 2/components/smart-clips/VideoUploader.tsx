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
  Sparkles,
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

  if (sourceMode === 'url') {
    return (
      <div className="bg-[#18181f] border border-[#2b2b36] rounded-2xl p-6 transition-all shadow-xl">
        <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
          Video Source URL
        </label>
        <div className="relative flex items-center">
          <div className="absolute left-3.5 text-zinc-400">
            <LinkIcon size={18} />
          </div>
          <input
            type="url"
            disabled={disabled}
            value={videoUrl}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="YouTube, Vimeo, or direct MP4/MOV/WEBM link..."
            className={`w-full pl-11 pr-4 py-3 bg-[#111116] border rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 transition-all ${
              urlError
                ? 'border-red-500/80 focus:border-red-500'
                : videoUrl && !urlError
                ? 'border-emerald-500/60'
                : 'border-[#333340] focus:border-violet-500'
            }`}
          />
          {videoUrl && !urlError && (
            <div className="absolute right-3.5 text-emerald-400">
              <CheckCircle2 size={18} />
            </div>
          )}
        </div>

        {urlError && (
          <div className="flex items-center gap-1.5 mt-2.5 text-xs text-red-400">
            <AlertCircle size={14} />
            <span>{urlError}</span>
          </div>
        )}

        <div className="mt-4 p-3 bg-[#111116] border border-[#252530] rounded-xl flex items-start gap-3">
          <div className="p-2 bg-violet-950/60 text-violet-400 rounded-lg">
            <Sparkles size={16} />
          </div>
          <div>
            <h4 className="text-xs font-medium text-white mb-0.5">Supported Sources (Groq AI Engine)</h4>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Cloudinary MP4 Links · YouTube · Vimeo · Direct MP4 / MOV / WEBM URLs
            </p>
            <p className="text-[10px] text-violet-400/90 mt-1 font-medium">
              Powered by Groq Whisper & Llama AI + Cloudinary dynamic 9:16 transformations.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#18181f] border border-[#2b2b36] rounded-2xl p-6 transition-all shadow-xl">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/mov,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv"
        onChange={handleFileChange}
        className="hidden"
      />

      {!selectedFile ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !disabled && fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-8 text-center flex flex-col items-center justify-center cursor-pointer transition-all duration-200 min-h-[220px] ${
            isDragging
              ? 'border-violet-500 bg-violet-500/10 scale-[1.01]'
              : 'border-[#383846] hover:border-violet-500/60 bg-[#121217] hover:bg-[#15151c]'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-violet-600/20 to-indigo-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400 mb-4 shadow-lg shadow-violet-950/40">
            <UploadCloud size={28} />
          </div>

          <h3 className="text-sm font-semibold text-white mb-1">
            Drag and drop your video file here
          </h3>
          <p className="text-xs text-zinc-400 mb-4 max-w-sm">
            Supports MP4, MOV, WEBM or MKV long-form videos up to 2GB.
          </p>

          <button
            type="button"
            disabled={disabled}
            className="px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold rounded-lg shadow-md transition-all flex items-center gap-2"
          >
            <FileVideo size={15} />
            Browse Files
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3.5 bg-[#121217] border border-[#2c2c38] rounded-xl">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-violet-950/60 border border-violet-500/30 flex items-center justify-center text-violet-400 flex-shrink-0">
                <FileVideo size={20} />
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-semibold text-white truncate max-w-xs">
                  {selectedFile.name}
                </h4>
                <p className="text-[11px] text-zinc-400">
                  {formatFileSize(selectedFile.size)} • Local Preview
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => fileInputRef.current?.click()}
                className="p-2 text-zinc-400 hover:text-white hover:bg-[#252530] rounded-lg text-xs flex items-center gap-1 transition-all"
                title="Replace Video"
              >
                <RefreshCw size={14} />
                <span className="hidden sm:inline text-[11px]">Replace</span>
              </button>

              <button
                type="button"
                disabled={disabled}
                onClick={onRemoveFile}
                className="p-2 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                title="Remove Video"
              >
                <X size={16} />
              </button>
            </div>
          </div>

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

          {videoPreviewUrl && (
            <div className="relative rounded-xl overflow-hidden border border-[#2b2b38] bg-black aspect-video max-h-[280px] flex items-center justify-center">
              <video
                src={videoPreviewUrl}
                controls
                className="w-full h-full object-contain"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default VideoUploader;
