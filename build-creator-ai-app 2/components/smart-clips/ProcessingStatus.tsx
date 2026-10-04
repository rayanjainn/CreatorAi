'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  Loader2,
  Sparkles,
  RefreshCw,
  Clock,
  Radio,
  CheckCircle2,
  XCircle,
  Video,
  FileText,
  Brain,
  Scissors,
} from 'lucide-react';

interface ProcessingStatusProps {
  projectId: string;
  status: string; // 'processing' | 'completed' | 'failed'
  step?: string; // 'downloading' | 'transcribing' | 'analyzing' | 'cutting' | 'done'
  estimatedMinutes?: number;
  message?: string;
  isDemo?: boolean;
  onCancel: () => void;
}

const STEPS = [
  { id: 'downloading', label: 'Ingesting Video', icon: Video },
  { id: 'transcribing', label: 'Transcribing Audio', icon: FileText },
  { id: 'analyzing', label: 'AI Virality Analysis', icon: Brain },
  { id: 'cutting', label: 'Cropping 9:16 Shorts', icon: Scissors },
];

export function ProcessingStatus({
  projectId,
  status,
  step = 'transcribing',
  estimatedMinutes,
  message,
  isDemo = false,
  onCancel,
}: ProcessingStatusProps) {
  const getStepIndex = (currentStep: string) => {
    if (currentStep === 'done') return 4;
    const idx = STEPS.findIndex((s) => s.id === currentStep);
    return idx >= 0 ? idx : 1;
  };

  const currentStepIdx = getStepIndex(step);

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      className="bg-[#18181f] border border-violet-500/40 rounded-2xl p-7 shadow-2xl shadow-violet-950/40 relative overflow-hidden"
    >
      {/* Background glow overlay */}
      <div className="absolute top-0 right-0 w-80 h-80 bg-violet-600/10 rounded-full filter blur-3xl pointer-events-none -mr-20 -mt-20" />
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-amber-500/10 rounded-full filter blur-3xl pointer-events-none -ml-20 -mb-20" />

      <div className="relative z-10 space-y-6">
        {/* Top Header */}
        <div className="flex items-center justify-between flex-wrap gap-3 pb-4 border-b border-[#292936]">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-violet-900/50">
                <Sparkles size={20} className="animate-pulse" />
              </div>
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-[#18181f] animate-ping" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">Generating AI Clips</h3>
                {isDemo && (
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full font-medium">
                    Demo Mode
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400 flex items-center gap-1.5 mt-0.5">
                <Radio size={12} className="text-violet-400 animate-pulse" />
                <span>Smart Clips AI Engine processing</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 bg-[#252530] hover:bg-[#303040] text-zinc-300 hover:text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all"
          >
            <RefreshCw size={14} />
            <span>Cancel / Reset</span>
          </button>
        </div>

        {/* Status Alert Banner */}
        <div className="p-4 bg-[#111116] border border-[#2b2b3a] rounded-xl flex items-center gap-3">
          <Loader2 size={20} className="text-violet-400 animate-spin flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-white flex items-center justify-between flex-wrap gap-2">
              <span>{message || 'Groq AI model is analyzing speech transcript & keyframes...'}</span>
              {estimatedMinutes && (
                <span className="text-[11px] text-amber-400 flex items-center gap-1 bg-amber-950/60 px-2 py-0.5 rounded-md border border-amber-500/30">
                  <Clock size={12} /> ~{estimatedMinutes} min remaining
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-400 mt-0.5 font-mono truncate">
              Project ID: {projectId}
            </p>
          </div>
        </div>

        {/* Pipeline Step Progress */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
            Pipeline Processing Steps
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
            {STEPS.map((s, idx) => {
              const Icon = s.icon;
              const isCompleted = idx < currentStepIdx;
              const isCurrent = idx === currentStepIdx;

              return (
                <div
                  key={s.id}
                  className={`p-3 rounded-xl border flex items-center gap-2.5 transition-all ${
                    isCompleted
                      ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
                      : isCurrent
                      ? 'border-violet-500 bg-violet-950/40 text-white shadow-md shadow-violet-950/40'
                      : 'border-[#262633] bg-[#121217] text-zinc-500'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      isCompleted
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : isCurrent
                        ? 'bg-violet-600 text-white'
                        : 'bg-[#202028] text-zinc-500'
                    }`}
                  >
                    {isCompleted ? (
                      <CheckCircle2 size={15} />
                    ) : isCurrent ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Icon size={15} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold truncate">{s.label}</div>
                    <div className="text-[9px] text-zinc-400 uppercase tracking-wider">
                      {isCompleted ? 'Done' : isCurrent ? 'Active' : 'Queued'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default ProcessingStatus;
