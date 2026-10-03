// Gemini primary, Groq fallback on 429/5xx, one shared rate limiter (phase 4).
import { notImplemented } from '../pick.js';

export const completeJson = notImplemented('llm', 'completeJson', 4);
