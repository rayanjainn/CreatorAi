'use client';

import React from 'react';
import {
  Smartphone,
  Tv,
  Globe,
  Type,
  Clock,
  Sparkles,
  Sliders,
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
  { code: 'auto', name: 'Auto Detect' },
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'it', name: 'Italian' },
  { code: 'ru', name: 'Russian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese' },
  { code: 'tr', name: 'Turkish' },
  { code: 'fa', name: 'Farsi' },
  { code: 'ur', name: 'Urdu' },
];

const SUBTITLE_STYLES = [
  {
    id: 'punch',
    name: 'Punch',
    desc: 'Bold dynamic pop font with yellow emphasis',
    previewColor: 'from-amber-400 to-amber-500',
  },
  {
    id: 'spot',
    name: 'Spot',
    desc: 'Sleek dark pill background around key phrases',
    previewColor: 'from-violet-500 to-indigo-500',
  },
  {
    id: 'retro',
    name: 'Retro',
    desc: 'Classic vintage subtitle font with drop shadow',
    previewColor: 'from-emerald-400 to-cyan-500',
  },
];

export function ClipSettings({
  values,
  onChange,
  disabled = false,
}: ClipSettingsProps) {
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
    <div className="bg-[#18181f] border border-[#2b2b36] rounded-2xl p-6 shadow-xl space-y-6">
      <div className="flex items-center justify-between pb-3 border-b border-[#292934]">
        <div className="flex items-center gap-2">
          <Sliders size={18} className="text-violet-400" />
          <h3 className="text-sm font-semibold text-white">AI Clip Settings</h3>
        </div>
        <span className="text-[11px] text-zinc-400 font-medium bg-[#111116] px-2.5 py-1 rounded-full border border-[#272733]">
          Smart Clips AI v2.0
        </span>
      </div>

      {/* Aspect Ratio */}
      <div>
        <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2.5">
          Output Aspect Ratio
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={disabled}
            onClick={() => updateField('aspectRatio', '9:16')}
            className={`p-3.5 rounded-xl border flex items-center gap-3 transition-all text-left ${
              values.aspectRatio === '9:16'
                ? 'border-violet-500 bg-violet-950/40 text-white shadow-md shadow-violet-950/30'
                : 'border-[#2c2c38] bg-[#121217] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <div
              className={`p-2 rounded-lg ${
                values.aspectRatio === '9:16'
                  ? 'bg-violet-600 text-white'
                  : 'bg-[#21212a] text-zinc-400'
              }`}
            >
              <Smartphone size={18} />
            </div>
            <div>
              <div className="text-xs font-bold text-white">9:16 Vertical</div>
              <div className="text-[10px] text-zinc-400">Reels / Shorts / TikTok</div>
            </div>
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={() => updateField('aspectRatio', '16:9')}
            className={`p-3.5 rounded-xl border flex items-center gap-3 transition-all text-left ${
              values.aspectRatio === '16:9'
                ? 'border-violet-500 bg-violet-950/40 text-white shadow-md shadow-violet-950/30'
                : 'border-[#2c2c38] bg-[#121217] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <div
              className={`p-2 rounded-lg ${
                values.aspectRatio === '16:9'
                  ? 'bg-violet-600 text-white'
                  : 'bg-[#21212a] text-zinc-400'
              }`}
            >
              <Tv size={18} />
            </div>
            <div>
              <div className="text-xs font-bold text-white">16:9 Landscape</div>
              <div className="text-[10px] text-zinc-400">YouTube / Widescreen</div>
            </div>
          </button>
        </div>
      </div>

      {/* Language */}
      <div>
        <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2 flex items-center justify-between">
          <span>Audio Language Hint</span>
          <span className="text-[10px] text-amber-400 lowercase font-normal flex items-center gap-1">
            <Sparkles size={11} /> explicit hint improves accuracy
          </span>
        </label>
        <div className="relative">
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none">
            <Globe size={16} />
          </div>
          <select
            disabled={disabled}
            value={values.language}
            onChange={(e) => updateField('language', e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-[#121217] border border-[#2c2c38] rounded-xl text-xs text-white focus:outline-none focus:border-violet-500 transition-all cursor-pointer"
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code} className="bg-[#18181f] text-white">
                {lang.name} {lang.code !== 'auto' ? `(${lang.code.toUpperCase()})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Subtitle Style */}
      <div>
        <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
          <Type size={14} className="text-violet-400" />
          <span>Subtitle Style Preset</span>
        </label>
        <div className="grid grid-cols-3 gap-2.5">
          {SUBTITLE_STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              disabled={disabled}
              onClick={() => updateField('subtitleStyle', style.id)}
              className={`p-3 rounded-xl border flex flex-col justify-between transition-all text-left min-h-[85px] ${
                values.subtitleStyle === style.id
                  ? 'border-violet-500 bg-violet-950/40 shadow-md shadow-violet-950/30'
                  : 'border-[#2c2c38] bg-[#121217] hover:border-zinc-700'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div className="flex items-center justify-between w-full mb-1">
                <span className="text-xs font-bold text-white capitalize">{style.name}</span>
                <span
                  className={`w-2.5 h-2.5 rounded-full bg-gradient-to-r ${style.previewColor}`}
                />
              </div>
              <p className="text-[10px] text-zinc-400 leading-tight">{style.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Optional Range (Start & End Time) */}
      <div>
        <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Clock size={14} className="text-violet-400" />
          <span>Timestamp Clipping Range (Optional)</span>
        </label>
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
              className="w-full px-3 py-2 bg-[#121217] border border-[#2c2c38] rounded-xl text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500"
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
              className="w-full px-3 py-2 bg-[#121217] border border-[#2c2c38] rounded-xl text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default ClipSettings;
