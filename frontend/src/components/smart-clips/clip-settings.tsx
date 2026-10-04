'use client'

import { Smartphone, Tv } from 'lucide-react'
import { Field, Input, Select } from '@/components/ui/field'
import { Segmented } from '@/components/common/segmented'

export type ClipSettingsValues = {
  aspect: '9:16' | '16:9'
  language: string
  subtitleStyle: 'punch' | 'spot' | 'retro'
  start: string
  end: string
}

export const DEFAULT_SETTINGS: ClipSettingsValues = { aspect: '9:16', language: 'auto', subtitleStyle: 'punch', start: '', end: '' }

const LANGUAGES: [string, string][] = [
  ['auto', 'Detect automatically'],
  ['en', 'English'],
  ['hi', 'Hindi'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['it', 'Italian'],
  ['ru', 'Russian'],
  ['ar', 'Arabic'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
  ['tr', 'Turkish'],
  ['ur', 'Urdu'],
]

const STYLES: { id: ClipSettingsValues['subtitleStyle']; name: string; hint: string }[] = [
  { id: 'punch', name: 'Punch', hint: 'Bold pop-in words with a yellow highlight' },
  { id: 'spot', name: 'Spot', hint: 'A dark pill behind the key phrases' },
  { id: 'retro', name: 'Retro', hint: 'Classic subtitles with a drop shadow' },
]

export function ClipSettings({ value, onChange, disabled, rangeError }: { value: ClipSettingsValues; onChange: (v: ClipSettingsValues) => void; disabled?: boolean; rangeError?: string | null }) {
  const set = <K extends keyof ClipSettingsValues>(k: K, v: ClipSettingsValues[K]) => onChange({ ...value, [k]: v })
  return (
    <div className="sc-settings" data-testid="clip-settings">
      <div className="sc-row">
        <Field label="Shape">
          <Segmented<'9:16' | '16:9'>
            label="Aspect ratio"
            value={value.aspect}
            onChange={(v) => set('aspect', v)}
            options={[
              { value: '9:16', label: 'Vertical' },
              { value: '16:9', label: 'Wide' },
            ]}
          />
          <span className="field-hint sc-aspect-hint">
            {value.aspect === '9:16' ? <Smartphone size={12} /> : <Tv size={12} />} {value.aspect === '9:16' ? '9:16 for Shorts, Reels, TikTok' : '16:9 for YouTube and the web'}
          </span>
        </Field>
        <Field label="Spoken language" htmlFor="sc-lang">
          <Select id="sc-lang" value={value.language} disabled={disabled} onChange={(e) => set('language', e.target.value)}>
            {LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Caption style">
        <div className="sc-styles" role="radiogroup" aria-label="Caption style">
          {STYLES.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={value.subtitleStyle === s.id} className="sc-style" data-style={s.id} data-selected={value.subtitleStyle === s.id} disabled={disabled} onClick={() => set('subtitleStyle', s.id)}>
              <span className="sc-style-sample" aria-hidden>
                Aa
              </span>
              <b>{s.name}</b>
              <small>{s.hint}</small>
            </button>
          ))}
        </div>
      </Field>

      <div className="sc-row">
        <Field label="Start at (optional)" htmlFor="sc-start" hint="mm:ss or seconds" error={rangeError}>
          <Input id="sc-start" inputMode="numeric" placeholder="0:00" value={value.start} disabled={disabled} onChange={(e) => set('start', e.target.value)} />
        </Field>
        <Field label="End at (optional)" htmlFor="sc-end" hint="Leave empty for the whole video">
          <Input id="sc-end" inputMode="numeric" placeholder="e.g. 12:30" value={value.end} disabled={disabled} onChange={(e) => set('end', e.target.value)} />
        </Field>
      </div>
    </div>
  )
}
