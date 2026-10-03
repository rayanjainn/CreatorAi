'use client'

import { create } from 'zustand'
import type { EngineState, PlaybackEngine } from './engine'

/** Holds the live playback engine (created by the Monitor) so the timeline, shortcuts and inspector can drive it. */
export const useEngine = create<{ engine: PlaybackEngine | null; state: EngineState | null }>(() => ({ engine: null, state: null }))

export const getEngine = () => useEngine.getState().engine
