'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Zap,
  Shield,
  Key,
  Info,
  Play,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Settings2,
  ChevronDown,
  ChevronUp,
  Download,
  UploadCloud,
} from 'lucide-react';

import VideoSourceSelector, { VideoSourceMode } from './VideoSourceSelector';
import VideoUploader from './VideoUploader';
import ClipSettings, { ClipSettingsValues } from './ClipSettings';
import ProcessingStatus from './ProcessingStatus';
import GeneratedClips from './GeneratedClips';
import { lumiclipService, LumiClipProject, LumiClipItem, ApiExecutionMode } from '@/src/services/lumiclipService';
import { defaultUploadProvider } from '@/src/services/uploadService';

export function SmartClipsStudio() {
  const [sourceMode, setSourceMode] = useState<VideoSourceMode>('url');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');

  const [urlError, setUrlError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const [clipSettings, setClipSettings] = useState<ClipSettingsValues>({
    aspectRatio: '9:16',
    language: 'auto',
    subtitleStyle: 'punch',
    startTime: '',
    endTime: '',
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectData, setProjectData] = useState<LumiClipProject | null>(null);
  const [exportingClipId, setExportingClipId] = useState<string | null>(null);

  const [executionMode, setExecutionMode] = useState<ApiExecutionMode>('proxy');
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [showConfigDrawer, setShowConfigDrawer] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setExecutionMode(lumiclipService.getExecutionMode());
    setApiKeyInput(lumiclipService.getApiKey());
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  /**
   * Converts a Google Drive share/view URL to a direct download URL.
   * drive.google.com/file/d/{FILE_ID}/view  →  drive.google.com/uc?export=download&id={FILE_ID}&confirm=t
   * drive.google.com/open?id={FILE_ID}      →  same
   * Already-converted or non-Drive URLs are returned unchanged.
   */
  const convertDriveUrl = (url: string): string => {
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.includes('drive.google.com')) return url;

      // Format: /file/d/{id}/view or /file/d/{id}/preview
      const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
      if (fileMatch) {
        return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}&confirm=t`;
      }

      // Format: /open?id={id} or /uc?id={id}
      const idParam = parsed.searchParams.get('id');
      if (idParam) {
        return `https://drive.google.com/uc?export=download&id=${idParam}&confirm=t`;
      }
    } catch {}
    return url;
  };

  // Validate YouTube / Video URL
  const validateUrl = (url: string): boolean => {
    if (!url.trim()) {
      setUrlError('Please enter a valid video URL.');
      return false;
    }

    try {
      const parsed = new URL(url);
      const isYoutube = parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be');
      const isVimeo = parsed.hostname.includes('vimeo.com');
      const isDrive = parsed.hostname.includes('drive.google.com');
      const isDirectMedia = url.match(/\.(mp4|mov|webm|mkv)(\?.*)?$/i);

      // Google Drive is explicitly NOT supported by LumiClip API (returns 400)
      if (isDrive) {
        setUrlError('Google Drive share pages are not supported — use direct Cloudinary MP4 links or YouTube URLs.');
        return false;
      }

      if (!isYoutube && !isVimeo && !isDirectMedia) {
        setUrlError('Please enter a YouTube, Vimeo, or direct MP4/MOV/WEBM video URL.');
        return false;
      }
    } catch {
      setUrlError('Invalid URL format. Include http:// or https://');
      return false;
    }

    setUrlError(null);
    return true;
  };

  const handleUrlChange = (val: string) => {
    setVideoUrl(val);
    if (val.trim()) validateUrl(val);
    else setUrlError(null);
  };

  const handleFileSelect = async (file: File) => {
    setSelectedFile(file);
    setUploadProgress(0);

    try {
      const uploadRes = await defaultUploadProvider.uploadVideo(file, (prog) => {
        setUploadProgress(prog.percentage);
      });
      setVideoPreviewUrl(uploadRes.url);
      showToast(`Selected "${file.name}" for local preview.`);
    } catch (err: any) {
      setErrorMessage(`Failed to load video preview: ${err.message}`);
    } finally {
      setUploadProgress(null);
    }
  };

  const handleRemoveFile = () => {
    if (videoPreviewUrl) {
      URL.revokeObjectURL(videoPreviewUrl);
    }
    setSelectedFile(null);
    setVideoPreviewUrl(null);
    setUploadProgress(null);
  };

  const handleSaveApiSettings = (mode: ApiExecutionMode, key: string) => {
    lumiclipService.setExecutionMode(mode);
    lumiclipService.setApiKey(key);
    setExecutionMode(mode);
    setApiKeyInput(key);
    showToast(`Configuration updated: ${mode.toUpperCase()} mode.`);
  };

  // Polling Project Status
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const pollProjectStatus = useCallback(
    async (pid: string) => {
      try {
        const proj = await lumiclipService.getProjectStatus(pid);
        setProjectData(proj);

        const statusLower = (proj.status || '').toLowerCase();
        const isCompleted = statusLower === 'completed';
        const isFailed =
          statusLower === 'failed' ||
          statusLower === 'error' ||
          statusLower === 'cancelled' ||
          statusLower === 'canceled';

        if (isCompleted) {
          stopPolling();
          setIsGenerating(false);
          showToast(`Clips generation completed! ${proj.clips.length} clips ready.`);
        } else if (isFailed) {
          stopPolling();
          setIsGenerating(false);

          const actualMsg = proj.error || proj.message || 'LumiClip backend failed to process video.';
          const codePrefix = proj.error_code ? `[Error Code: ${proj.error_code}] ` : '';

          setErrorMessage(`${codePrefix}${actualMsg}`);
        }
      } catch (err: any) {
        console.error('Polling error:', err);
      }
    },
    [stopPolling]
  );


  useEffect(() => {
    if (projectId && isGenerating) {
      // Immediate first poll
      pollProjectStatus(projectId);

      // Poll every 10 seconds as per specification
      pollTimerRef.current = setInterval(() => {
        pollProjectStatus(projectId);
      }, 10000);
    }

    return () => {
      stopPolling();
    };
  }, [projectId, isGenerating, pollProjectStatus, stopPolling]);

  // Handle CTA Generate Clips
  const handleGenerateClips = async () => {
    setErrorMessage(null);

    let targetUrl = videoUrl;

    if (sourceMode === 'upload') {
      if (!selectedFile) {
        setErrorMessage('Please select a video file from your computer or switch to URL mode.');
        return;
      }
      if (executionMode !== 'demo') {
        setErrorMessage(
          `Local PC file "${selectedFile.name}" is previewed in browser via Object URL. LumiClip's live backend requires an accessible HTTP/HTTPS URL. Switch to Demo Mode to test with local PC files, or switch to Paste Video URL mode for live generation.`
        );
        return;
      }
      targetUrl = videoPreviewUrl || `https://local-file/${encodeURIComponent(selectedFile.name)}`;
    } else {
      if (!validateUrl(videoUrl)) {
        return;
      }
      // Auto-convert Google Drive share links → direct download URLs
      targetUrl = convertDriveUrl(videoUrl);
      if (targetUrl !== videoUrl) {
        console.log('[SmartClips] Converted Drive URL:', videoUrl, '→', targetUrl);
      }
    }


    setIsGenerating(true);
    setProjectData(null);

    try {
      let res;
      try {
        // Primary: Groq + Cloudinary AI Engine (Instant, robust, no scraper failures)
        res = await lumiclipService.generateClipsWithGroq({
          url: targetUrl,
          aspect_ratio: clipSettings.aspectRatio,
          language: clipSettings.language,
          subtitle_style: clipSettings.subtitleStyle,
          start_time: clipSettings.startTime ? parseFloat(clipSettings.startTime) : undefined,
          end_time: clipSettings.endTime ? parseFloat(clipSettings.endTime) : undefined,
        });
      } catch (groqErr) {
        console.warn('Groq AI Clipper failed, falling back to LumiClip API...', groqErr);
        res = await lumiclipService.generateClips({
          url: targetUrl,
          aspect_ratio: clipSettings.aspectRatio,
          language: clipSettings.language,
          subtitle_style: clipSettings.subtitleStyle,
          start_time: clipSettings.startTime ? parseFloat(clipSettings.startTime) : undefined,
          end_time: clipSettings.endTime ? parseFloat(clipSettings.endTime) : undefined,
        });
      }

      setProjectId(res.project_id);
      showToast(res.message || 'AI clip generation completed!');
    } catch (err: any) {
      setIsGenerating(false);
      setErrorMessage(err.message || 'Failed to start AI clip generation.');
    }
  };

  const handleCancelProcessing = () => {
    stopPolling();
    setIsGenerating(false);
    setProjectId(null);
    setProjectData(null);
    showToast('Generation cancelled.');
  };

  const handleExportClip = async (clip: LumiClipItem, quality: string = '1080p') => {
    setExportingClipId(clip.id);
    try {
      if (clip.download_url && (clip.download_url.startsWith('http://') || clip.download_url.startsWith('https://'))) {
        window.open(clip.download_url, '_blank');
        showToast(`Clip downloaded / opened!`);
        return;
      }
      const res = await lumiclipService.exportClip(clip.id, quality as any);
      showToast(`Clip export requested (${quality})!`);

      if (res.url) {
        window.open(res.url, '_blank');
      }
    } catch (err: any) {
      setErrorMessage(`Export clip failed: ${err.message}`);
    } finally {
      setExportingClipId(null);
    }
  };

  const isCTADisabled =
    isGenerating ||
    (sourceMode === 'url' && (!videoUrl.trim() || !!urlError)) ||
    (sourceMode === 'upload' && !selectedFile);

  return (
    <div className="space-y-8 pb-16">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-2 border-b border-[#252530]/50">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#211938] border border-[#3b2b63] flex items-center justify-center text-violet-400 shadow-lg shadow-violet-950/40 flex-shrink-0">
            <Sparkles size={24} />
          </div>
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">
              Smart Clips
            </h1>
            <p className="text-sm text-zinc-400 mt-0.5 leading-relaxed">
              Turn long-form videos into engaging short-form content with AI.
            </p>
          </div>
        </div>
      </div>


      {/* Actionable Error Banner & Source Inaccessibility Fallback Box */}
      {errorMessage && (
        <div className="space-y-3">
          <div className="p-4 bg-red-950/40 border border-red-500/50 rounded-2xl flex items-start justify-between text-red-200 text-xs">
            <div className="flex items-start gap-2.5">
              <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold block text-red-300">
                  {projectData?.error_category === 'source_auth'
                    ? 'Source Video Authentication Required'
                    : projectData?.error_category === 'source_unavailable'
                    ? 'Source Video Download / Ingestion Failed'
                    : projectData?.error_category === 'api_auth'
                    ? 'LumiClip API Key Authentication Error'
                    : projectData?.error_category === 'quota'
                    ? 'LumiClip Quota / Rate Limit Exceeded'
                    : 'LumiClip Processing Error'}
                </span>
                <span className="block">{errorMessage}</span>
                {/* Show raw LumiClip error details if available */}
                {projectData?.error && projectData.error !== errorMessage && (
                  <span className="block text-red-400/70 font-mono text-[10px] mt-1">
                    LumiClip raw error: {projectData.error}
                    {projectData.error_code ? ` [code: ${projectData.error_code}]` : ''}
                  </span>
                )}
                {!projectData && (
                  <span className="block text-red-400/60 text-[10px] mt-1">
                    Error occurred before project was created (likely a bad request or API config issue).
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-red-400 hover:text-white text-xs font-semibold px-2 py-1 flex-shrink-0"
            >
              Dismiss
            </button>
          </div>

          {/* Source Auth: Video is paywalled (Prime Video, Netflix, private YouTube etc) */}
          {projectData?.error_category === 'source_auth' && (
            <div className="p-5 bg-[#1a1726] border border-amber-500/40 rounded-2xl space-y-4">
              <div className="flex items-start gap-3">
                <div className="p-2.5 bg-amber-600/20 text-amber-400 rounded-xl border border-amber-500/30 flex-shrink-0">
                  <Shield size={20} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-amber-200">Video is Behind a Paywall / Login Wall</h4>
                  <p className="text-[11px] text-zinc-300 leading-relaxed mt-1">
                    LumiClip detected this video is protected (Prime Video, Netflix, private YouTube, age-gated etc.) and cannot download it. This is expected — no API can bypass DRM or login-required streams.
                  </p>
                </div>
              </div>

              <div className="border-t border-amber-500/20 pt-3 space-y-2">
                <p className="text-[11px] font-semibold text-zinc-300">✅ URLs that work with Smart Clips AI:</p>
                <ul className="text-[11px] text-zinc-400 space-y-1 list-disc list-inside">
                  <li>Public YouTube videos (not age-gated, not private)</li>
                  <li>Direct MP4 links (e.g. Cloudinary, S3, Bunny CDN)</li>
                  <li>Public Vimeo videos</li>
                </ul>
                <p className="text-[11px] text-zinc-500 mt-2">
                  Try: <button
                    type="button"
                    onClick={() => { handleUrlChange('https://www.youtube.com/watch?v=dQw4w9WgXcQ'); setErrorMessage(null); }}
                    className="text-violet-400 hover:text-violet-300 underline cursor-pointer"
                  >youtube.com/watch?v=dQw4w9WgXcQ</button> or <button
                    type="button"
                    onClick={() => { handleUrlChange('https://res.cloudinary.com/dttdcuqwf/video/upload/v1766416327/samples/elephants.mp4'); setErrorMessage(null); }}
                    className="text-violet-400 hover:text-violet-300 underline cursor-pointer"
                  >cloudinary sample MP4</button>
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => { handleSaveApiSettings('demo', apiKeyInput); setErrorMessage(null); }}
                  className="px-3.5 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl whitespace-nowrap shadow-md transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Sparkles size={14} />
                  <span>Try Demo Mode Instead</span>
                </button>
                {sourceMode === 'url' && (
                  <button
                    type="button"
                    onClick={() => { setSourceMode('upload'); setErrorMessage(null); }}
                    className="px-3.5 py-2 bg-[#252532] hover:bg-[#303040] text-zinc-200 hover:text-white text-xs font-semibold rounded-xl whitespace-nowrap transition-all cursor-pointer"
                  >
                    Upload Local File Instead
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Source Unavailable: video doesn't exist, deleted, geo-blocked etc */}
          {projectData?.error_category === 'source_unavailable' && (
            <div className="p-4 bg-[#1a1726] border border-violet-500/40 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2.5 bg-violet-600/20 text-violet-400 rounded-xl border border-violet-500/30">
                  <UploadCloud size={20} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">Source Video Could Not Be Downloaded</h4>
                  <p className="text-[11px] text-zinc-400 leading-relaxed mt-0.5">
                    The video may be deleted, geo-blocked, or the URL is unreachable. Try a different public URL or switch to Demo Mode.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
                <button
                  type="button"
                  onClick={() => { handleSaveApiSettings('demo', apiKeyInput); setErrorMessage(null); }}
                  className="px-3.5 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl whitespace-nowrap shadow-md transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Sparkles size={14} />
                  <span>Switch to Demo Mode</span>
                </button>
              </div>
            </div>
          )}

          {/* For unknown/general errors: show retry + demo options */}
          {(!projectData || projectData?.error_category === 'unknown') && sourceMode === 'url' && (
            <div className="p-4 bg-[#1a1726] border border-zinc-600/40 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2.5 bg-zinc-700/30 text-zinc-400 rounded-xl border border-zinc-600/30">
                  <Info size={20} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">What to do next</h4>
                  <p className="text-[11px] text-zinc-400 leading-relaxed mt-0.5">
                    Open browser DevTools → Console to see the full LumiClip raw response. Or try Demo Mode to verify the UI is working correctly without API calls.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  handleSaveApiSettings('demo', apiKeyInput);
                  setErrorMessage(null);
                }}
                className="px-3.5 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl whitespace-nowrap shadow-md transition-all cursor-pointer flex items-center gap-1.5 flex-shrink-0"
              >
                <Sparkles size={14} />
                <span>Try Demo Mode</span>
              </button>
            </div>
          )}
        </div>
      )}




      {/* Main Grid: Upload & Source Input (Left) vs Settings (Right) - Equal Size (50/50 & Stretched Height) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
        {/* Left Column: Video Source */}
        <div className="h-full">
          <VideoUploader
            sourceMode={sourceMode}
            selectedFile={selectedFile}
            videoPreviewUrl={videoPreviewUrl}
            videoUrl={videoUrl}
            urlError={urlError}
            uploadProgress={uploadProgress}
            onFileSelect={handleFileSelect}
            onRemoveFile={handleRemoveFile}
            onUrlChange={handleUrlChange}
            disabled={isGenerating}
          />
        </div>

        {/* Right Column: Settings */}
        <div className="h-full">
          <ClipSettings
            values={clipSettings}
            onChange={setClipSettings}
            disabled={isGenerating}
          />
        </div>
      </div>

      {/* Bottom Centered Generate Button */}
      <div className="flex justify-center pt-2">
        <button
          type="button"
          disabled={isCTADisabled}
          onClick={handleGenerateClips}
          className={`px-10 py-4 bg-gradient-to-r from-violet-600 via-indigo-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-extrabold text-sm md:text-base rounded-2xl flex items-center gap-3 shadow-2xl shadow-violet-950/70 transition-all ${
            isCTADisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:scale-[1.03] active:scale-95'
          }`}
        >
          {isGenerating ? (
            <Loader2 size={20} className="animate-spin" />
          ) : (
            <Sparkles size={20} />
          )}
          <span>{isGenerating ? 'Processing AI Clips...' : 'Generate AI Clips'}</span>
        </button>
      </div>

      {/* Active Processing Status Section */}
      {isGenerating && projectId && (
        <ProcessingStatus
          projectId={projectId}
          status={projectData?.status || 'processing'}
          step={projectData?.step || 'transcribing'}
          estimatedMinutes={projectData?.estimated_minutes || 3}
          message={projectData?.message}
          isDemo={executionMode === 'demo'}
          onCancel={handleCancelProcessing}
        />
      )}

      {/* Generated Clips Dashboard */}
      {projectData && projectData.clips && projectData.clips.length > 0 && (
        <GeneratedClips
          clips={projectData.clips}
          projectName={projectData.name}
          onExportClip={handleExportClip}
          exportingClipId={exportingClipId}
        />
      )}

      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 right-6 z-50 bg-[#2b2046] border border-violet-500/60 text-white px-4 py-3 rounded-xl shadow-2xl text-xs font-semibold flex items-center gap-2"
          >
            <CheckCircle2 size={16} className="text-emerald-400" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default SmartClipsStudio;
