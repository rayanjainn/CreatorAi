'use client';

import React, { useState } from 'react';
import {
  Smartphone,
  Tv,
  Globe,
  Type,
  Clock,
  CheckCircle2,
  Sliders,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export interface ClipSettingsValues {
  aspectRatio: '9:16' | '16:9';
  language: string;
  subtitleStyle: 'punch' | 'spot' | 'retro' | string;
  startTime: string; // in seconds or mm:ss
  endTime: string; // in seconds or mm:ss
}

interface ClipSettingsProps {
  values: ClipSettingsValues;
  onChange: (newValues: ClipSettingsValues) => void;
  disabled?: boolean;
}

const LANGUAGES = [
  { code: 'auto', name: 'Auto Detect (Recommended)' },
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese' },
];

export function ClipSettings({
  values,
  onChange,
  disabled = false,
}: ClipSettingsProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const updateField = <K extends keyof ClipSettingsValues>(
    field: K,
    val: ClipSettingsValues[K]
  ) => {
    onChange({
      ...values,
      [field]: val,
    });
  };

  return (
    <div className="bg-[#16161c] border border-[#2b2b36] rounded-2xl p-6 shadow-xl space-y-6 h-full flex flex-col justify-between">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-xl bg-violet-600 text-white font-extrabold text-xs flex items-center justify-center shadow-md shadow-violet-950/40">
            2
          </div>
          <h3 className="text-base font-extrabold text-white tracking-tight">AI Clip Settings</h3>
        </div>
        <p className="text-xs text-zinc-400 font-medium pl-10">
          Customize your output for the best results
        </p>
      </div>

      {/* 1. Output Aspect Ratio */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 text-xs font-bold text-white">
          <Smartphone size={16} className="text-violet-400" />
          <span>Output aspect ratio</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* 9:16 Vertical */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => updateField('aspectRatio', '9:16')}
            className={`relative p-3.5 rounded-2xl border flex items-center gap-3 transition-all text-left ${
              values.aspectRatio === '9:16'
                ? 'border-violet-500 bg-violet-950/40 shadow-lg shadow-violet-950/30'
                : 'border-[#2c2c38] bg-[#121217] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                values.aspectRatio === '9:16'
                  ? 'bg-violet-600 text-white'
                  : 'bg-[#21212a] text-zinc-400'
              }`}
            >
              <Smartphone size={18} />
            </div>
            <div>
              <div className="text-xs font-extrabold text-white">9:16 Vertical</div>
              <div className="text-[10px] text-zinc-400 font-medium">Reels / Shorts / TikTok</div>
            </div>
            {values.aspectRatio === '9:16' && (
              <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center text-white">
                <CheckCircle2 size={14} className="fill-violet-600 text-white" />
              </div>
            )}
          </button>

          {/* 16:9 Landscape */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => updateField('aspectRatio', '16:9')}
            className={`relative p-3.5 rounded-2xl border flex items-center gap-3 transition-all text-left ${
              values.aspectRatio === '16:9'
                ? 'border-violet-500 bg-violet-950/40 shadow-lg shadow-violet-950/30'
                : 'border-[#2c2c38] bg-[#121217] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                values.aspectRatio === '16:9'
                  ? 'bg-violet-600 text-white'
                  : 'bg-[#21212a] text-zinc-400'
              }`}
            >
              <Tv size={18} />
            </div>
            <div>
              <div className="text-xs font-extrabold text-white">16:9 Landscape</div>
              <div className="text-[10px] text-zinc-400 font-medium">YouTube / Widescreen</div>
            </div>
            {values.aspectRatio === '16:9' && (
              <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center text-white">
                <CheckCircle2 size={14} className="fill-violet-600 text-white" />
              </div>
            )}
          </button>
        </div>
      </div>

      {/* 2. Audio Language */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-bold text-white">
          <Globe size={16} className="text-violet-400" />
          <span>Audio language</span>
        </div>

        <div className="relative">
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none">
            <Globe size={16} />
          </div>
          <select
            disabled={disabled}
            value={values.language}
            onChange={(e) => updateField('language', e.target.value)}
            className="w-full pl-10 pr-10 py-3 bg-[#121217] border border-[#2c2c38] rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-violet-500 transition-all cursor-pointer appearance-none"
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code} className="bg-[#18181f] text-white">
                {lang.name}
              </option>
            ))}
          </select>
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none">
            <ChevronDown size={16} />
          </div>
        </div>
      </div>

      {/* 3. Subtitle Style */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 text-xs font-bold text-white">
          <Type size={16} className="text-violet-400" />
          <span>Subtitle style</span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {/* Punch */}
          <div className="flex flex-col items-center">
            <button
              type="button"
              disabled={disabled}
              onClick={() => updateField('subtitleStyle', 'punch')}
              className={`relative w-full aspect-[16/10] rounded-xl overflow-hidden border transition-all cursor-pointer bg-black/80 flex items-center justify-center p-2 text-center group ${
                values.subtitleStyle === 'punch'
                  ? 'border-2 border-violet-500 ring-2 ring-violet-500/40 shadow-xl shadow-violet-950/50'
                  : 'border-[#2c2c38] hover:border-zinc-500'
              }`}
            >
              <img
                src="https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=400&q=80"
                alt="Punch"
                className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
              <div className="relative z-10 font-extrabold text-[9px] leading-snug uppercase tracking-wider text-white drop-shadow-md">
                THE MOMENT <br />
                <span className="text-amber-300 bg-amber-950/80 px-1 rounded">THAT CHANGED</span> <br />
                EVERYTHING
              </div>
              {values.subtitleStyle === 'punch' && (
                <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-violet-600 flex items-center justify-center text-white">
                  <CheckCircle2 size={12} className="fill-violet-600 text-white" />
                </div>
              )}
            </button>
            <span className="text-xs font-bold text-zinc-300 mt-2">Punch</span>
          </div>

          {/* Spot */}
          <div className="flex flex-col items-center">
            <button
              type="button"
              disabled={disabled}
              onClick={() => updateField('subtitleStyle', 'spot')}
              className={`relative w-full aspect-[16/10] rounded-xl overflow-hidden border transition-all cursor-pointer bg-black/80 flex items-center justify-center p-2 text-center group ${
                values.subtitleStyle === 'spot'
                  ? 'border-2 border-violet-500 ring-2 ring-violet-500/40 shadow-xl shadow-violet-950/50'
                  : 'border-[#2c2c38] hover:border-zinc-500'
              }`}
            >
              <img
                src="https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=400&q=80"
                alt="Spot"
                className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
              <div className="relative z-10 font-bold text-[9px] text-white bg-black/85 px-2 py-0.5 rounded border border-white/10 shadow-lg">
                Clean Minimal Look
              </div>
              {values.subtitleStyle === 'spot' && (
                <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-violet-600 flex items-center justify-center text-white">
                  <CheckCircle2 size={12} className="fill-violet-600 text-white" />
                </div>
              )}
            </button>
            <span className="text-xs font-bold text-zinc-400 mt-2">Spot</span>
          </div>

          {/* Retro */}
          <div className="flex flex-col items-center">
            <button
              type="button"
              disabled={disabled}
              onClick={() => updateField('subtitleStyle', 'retro')}
              className={`relative w-full aspect-[16/10] rounded-xl overflow-hidden border transition-all cursor-pointer bg-black/80 flex items-center justify-center p-2 text-center group ${
                values.subtitleStyle === 'retro'
                  ? 'border-2 border-violet-500 ring-2 ring-violet-500/40 shadow-xl shadow-violet-950/50'
                  : 'border-[#2c2c38] hover:border-zinc-500'
              }`}
            >
              <img
                src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=400&q=80"
                alt="Retro"
                className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />
              <div className="relative z-10 font-black italic text-[10px] text-amber-300 tracking-wider drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
                GOOD VIBES ONLY
              </div>
              {values.subtitleStyle === 'retro' && (
                <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-violet-600 flex items-center justify-center text-white">
                  <CheckCircle2 size={12} className="fill-violet-600 text-white" />
                </div>
              )}
            </button>
            <span className="text-xs font-bold text-zinc-400 mt-2">Retro</span>
          </div>
        </div>
      </div>

      {/* 4. Advanced Options Accordion */}
      <div className="border border-[#2c2c38] bg-[#121217] rounded-2xl overflow-hidden transition-all">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full p-3.5 flex items-center justify-between text-left hover:bg-[#181822] transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#21212a] border border-white/5 flex items-center justify-center text-violet-400 flex-shrink-0">
              <Sliders size={16} />
            </div>
            <div>
              <div className="text-xs font-extrabold text-white">Advanced options</div>
              <div className="text-[10px] text-zinc-400 font-medium">
                Trim specific time range, adjust sensitivity, and more
              </div>
            </div>
          </div>
          <div className="text-zinc-400 p-1">
            {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>

        {showAdvanced && (
          <div className="p-4 border-t border-[#272733] space-y-4 bg-[#101015]">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-300">
                <Clock size={14} className="text-violet-400" />
                <span>Timestamp Clipping Range (Optional)</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="block text-[10px] text-zinc-400 mb-1">Start Time (sec)</span>
                  <input
                    type="number"
                    min="0"
                    disabled={disabled}
                    placeholder="0"
                    value={values.startTime}
                    onChange={(e) => updateField('startTime', e.target.value)}
                    className="w-full px-3 py-2 bg-[#16161c] border border-[#2c2c38] rounded-xl text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <span className="block text-[10px] text-zinc-400 mb-1">End Time (sec)</span>
                  <input
                    type="number"
                    min="0"
                    disabled={disabled}
                    placeholder="600"
                    value={values.endTime}
                    onChange={(e) => updateField('endTime', e.target.value)}
                    className="w-full px-3 py-2 bg-[#16161c] border border-[#2c2c38] rounded-xl text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ClipSettings;
