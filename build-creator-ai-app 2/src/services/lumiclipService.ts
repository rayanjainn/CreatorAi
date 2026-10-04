export interface LumiClipGenerateParams {
  url: string;
  start_time?: number;
  end_time?: number;
  aspect_ratio?: '9:16' | '16:9';
  language?: string;
  subtitle_style?: 'punch' | 'spot' | 'retro' | string;
  callback_url?: string;
}

export interface LumiClipItem {
  id: string;
  title: string;
  duration: number; // in seconds
  score: number; // 0 to 1
  reason: string;
  clip_status: 'processing' | 'completed' | 'failed';
  download_url: string;
  quality: string; // e.g. "1080p", "720p"
  thumbnail_url: string;
}

export interface LumiClipProject {
  id: string;
  name: string;
  status: 'processing' | 'completed' | 'failed' | 'cancelled' | string;
  step?: 'downloading' | 'transcribing' | 'analyzing' | 'cutting' | 'done' | string;
  expected_clips?: number;
  duration?: number;
  aspect_ratio?: '9:16' | '16:9';
  estimated_minutes?: number;
  message?: string;
  error?: string;
  error_code?: string;
  error_category?: 'source_auth' | 'source_unavailable' | 'api_auth' | 'quota' | 'unknown';
  poll_url?: string;
  clips: LumiClipItem[];
}


export interface ExportClipResponse {
  status: 'ready' | 'processing' | 'failed';
  clip_id: string;
  url?: string;
  cached?: boolean;
  estimated_seconds?: number;
}

export type ApiExecutionMode = 'proxy' | 'direct' | 'demo';

class LumiClipService {
  private apiBaseUrl: string = 'https://api.lumiclip.ai';
  private executionMode: ApiExecutionMode = 'proxy';
  private groqProjectsMap: Map<string, LumiClipProject> = new Map();

  /**
   * Retrieves the configured API key from env or localStorage
   */
  public getApiKey(): string {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('lumiclip_api_key');
      if (stored) return stored;
    }
    return (
      process.env.NEXT_PUBLIC_LUMICLIP_API_KEY ||
      process.env.LUMICLIP_API_KEY ||
      ''
    );
  }

  public setApiKey(key: string): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('lumiclip_api_key', key);
    }
  }

  public getExecutionMode(): ApiExecutionMode {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('lumiclip_execution_mode');
      if (stored === 'proxy' || stored === 'direct' || stored === 'demo') {
        return stored;
      }
    }
    return 'proxy';
  }

  public setExecutionMode(mode: ApiExecutionMode): void {
    this.executionMode = mode;
    if (typeof window !== 'undefined') {
      localStorage.setItem('lumiclip_execution_mode', mode);
    }
  }

  /**
   * Submits a video URL to generate clips via Groq + Cloudinary AI Engine
   */
  public async generateClipsWithGroq(
    params: LumiClipGenerateParams
  ): Promise<{
    project_id: string;
    status: string;
    estimated_minutes?: number;
    poll_url?: string;
    message?: string;
    is_demo?: boolean;
    error_details?: string;
  }> {
    const res = await fetch('/api/groq/clipper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq AI Clipper Engine failed: ${errText}`);
    }

    const data = await res.json();
    
    // Store in groqProjectsMap for immediate retrieval
    const project: LumiClipProject = {
      id: data.id || data.project_id,
      name: data.name || 'AI Generated Short Clips',
      status: 'completed',
      step: 'done',
      expected_clips: data.clips?.length || 0,
      duration: data.duration || 90,
      aspect_ratio: params.aspect_ratio || '9:16',
      message: data.message || 'Clips generated successfully via Groq AI!',
      clips: (data.clips || []).map((c: any) => ({
        id: c.id,
        title: c.title,
        duration: Math.max(1, (c.end_time || 0) - (c.start_time || 0)),
        score: (c.viral_score || 90) / 100,
        reason: c.hook_summary || 'Generated via Groq AI LLM',
        clip_status: 'completed',
        download_url: c.download_url || params.url,
        quality: '1080p HD',
        thumbnail_url: c.download_url || params.url,
      })),
    };

    this.groqProjectsMap.set(project.id, project);

    return {
      project_id: project.id,
      status: 'completed',
      estimated_minutes: 0,
      poll_url: `/api/groq/clipper`,
      message: project.message,
      is_demo: false,
    };
  }

  /**
   * Submits a video URL to generate clips via LumiClip API
   */
  public async generateClips(
    params: LumiClipGenerateParams
  ): Promise<{
    project_id: string;
    status: string;
    estimated_minutes?: number;
    poll_url?: string;
    message?: string;
    is_demo?: boolean;
    error_details?: string;
  }> {
    const mode = this.getExecutionMode();
    const apiKey = this.getApiKey();

    if (mode === 'demo') {
      return this.mockGenerateResponse(params);
    }

    // Determine target URL based on mode
    const targetEndpoint =
      mode === 'proxy'
        ? '/api/lumiclip/clips/generate'
        : `${this.apiBaseUrl}/api/v1/clips/generate`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (mode === 'direct') {
      if (!apiKey) {
        throw new Error(
          'LumiClip API Key is missing. Please configure your LUMICLIP_API_KEY in settings or env.'
        );
      }
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
      const payload: Record<string, any> = {
        url: params.url,
        aspect_ratio: params.aspect_ratio || '9:16',
      };
      if (params.start_time !== undefined && params.start_time > 0) {
        payload.start_time = params.start_time;
      }
      if (params.end_time !== undefined && params.end_time > 0) {
        payload.end_time = params.end_time;
      }
      if (params.language && params.language !== 'auto') {
        payload.language = params.language;
      }
      if (params.subtitle_style) {
        payload.subtitle_style = params.subtitle_style;
      }
      if (params.callback_url) {
        payload.callback_url = params.callback_url;
      }

      const res = await fetch(targetEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        let parsedMessage = errorText;
        try {
          const jsonErr = JSON.parse(errorText);
          parsedMessage = jsonErr.error || jsonErr.message || errorText;
        } catch (e) {}

        if (res.status === 401) {
          throw new Error('401 Unauthorized: Invalid or missing LumiClip API key.');
        } else if (res.status === 402) {
          throw new Error('402 Payment Required: LumiClip API account out of credits or quota.');
        } else if (res.status === 429) {
          throw new Error('429 Too Many Requests: Rate limited by LumiClip API. Please wait and retry.');
        }
        throw new Error(`API Error (${res.status}): ${parsedMessage}`);
      }


      const data = await res.json();
      return {
        project_id: data.project_id || data.id,
        status: data.status || 'processing',
        estimated_minutes: data.estimated_minutes || 3,
        poll_url: data.poll_url || `/api/v1/projects/${data.project_id}`,
        message: data.message || 'Processing started via LumiClip API.',
        is_demo: false,
      };
    } catch (err: any) {
      console.warn('[LumiClipService] API call failed:', err);

      // Handle CORS or network security restrictions in Direct Browser API mode
      if (mode === 'direct' && (err.name === 'TypeError' || err.message.includes('fetch'))) {
        throw new Error(
          'Browser CORS / Network policy blocked direct cross-origin request to api.lumiclip.ai. ' +
            'Direct browser access requires CORS permission. Switch execution mode to "Next.js Backend Proxy" or "Demo Mode".'
        );
      }
      throw err;
    }
  }

  /**
   * Polls the status of a LumiClip project by project_id
   */
  public async getProjectStatus(projectId: string): Promise<LumiClipProject> {
    const mode = this.getExecutionMode();
    const apiKey = this.getApiKey();

    if (projectId.startsWith('groq-project-') || this.groqProjectsMap.has(projectId)) {
      const groqProj = this.groqProjectsMap.get(projectId);
      if (groqProj) return groqProj;
    }

    if (mode === 'demo' || projectId.startsWith('demo-project-')) {
      return this.mockPollProjectStatus(projectId);
    }

    const targetEndpoint =
      mode === 'proxy'
        ? `/api/lumiclip/projects/${projectId}`
        : `${this.apiBaseUrl}/api/v1/projects/${projectId}`;

    const headers: Record<string, string> = {};
    if (mode === 'direct') {
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
    }

    const res = await fetch(targetEndpoint, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to fetch project status (${res.status}): ${errorText}`);
    }

    const data = await res.json();

    // --- DEBUG: Log the full raw LumiClip project response ---
    console.log('[LumiClip] Raw project response for', projectId, JSON.stringify(data, null, 2));

    const rawError = data.error || data.message || data.reason || '';
    const errorCode = data.error_code || data.code || '';
    const statusStr = (data.status || 'processing').toLowerCase();

    // Categorize errors — only match on CLEAR, SPECIFIC keywords to avoid false positives
    let errorCategory: 'source_auth' | 'source_unavailable' | 'api_auth' | 'quota' | 'unknown' = 'unknown';
    if (rawError || errorCode || statusStr === 'failed' || statusStr === 'error') {
      const combined = `${rawError} ${errorCode}`.toLowerCase();

      // source_auth: when the SOURCE VIDEO itself requires authentication
      // Catches: "This video requires authentication and cannot be processed." (exact LumiClip phrase)
      // Also catches: YouTube login walls, age-restricted, members-only, private videos
      if (
        combined.includes('requires authentication') ||
        combined.includes('sign in to confirm') ||
        combined.includes('sign in to watch') ||
        combined.includes('login required') ||
        combined.includes('age restricted') ||
        combined.includes('members only') ||
        combined.includes('private video') ||
        combined.includes('authentication and cannot') ||
        (combined.includes('authentication') && (combined.includes('video') || combined.includes('source')))
      ) {
        errorCategory = 'source_auth';
      // source_unavailable: video can't be fetched/downloaded
      } else if (
        combined.includes('download failed') ||
        combined.includes('unavailable') ||
        combined.includes('video not found') ||
        combined.includes('unreachable') ||
        combined.includes('deleted') ||
        combined.includes('geo') ||
        combined.includes('region')
      ) {
        errorCategory = 'source_unavailable';
      // api_auth: our API key issues
      } else if (
        combined.includes('unauthorized') ||
        combined.includes('invalid key') ||
        combined.includes('invalid api') ||
        errorCode === '401'
      ) {
        errorCategory = 'api_auth';
      // quota/rate limits
      } else if (
        combined.includes('quota') ||
        combined.includes('rate limit') ||
        combined.includes('credit') ||
        combined.includes('429')
      ) {
        errorCategory = 'quota';
      }
      // else stays 'unknown' — show generic error message, NOT a misleading auth error
    }

    console.log('[LumiClip] Categorized error:', { rawError, errorCode, statusStr, errorCategory });

    return {
      id: data.id || projectId,
      name: data.name || 'AI Video Clips',
      status: data.status || 'processing',
      step: data.step || data.pipeline_step || 'transcribing',
      expected_clips: data.expected_clips || 4,
      duration: data.duration || 300,
      aspect_ratio: data.aspect_ratio || '9:16',
      estimated_minutes: data.estimated_minutes,
      message: data.message || (statusStr === 'failed' ? rawError : undefined),
      error: rawError || undefined,
      error_code: errorCode || undefined,
      error_category: errorCategory,
      clips: data.clips || [],
    };

  }

  /**
   * Triggers export/render for a single clip
   */
  public async exportClip(
    clipId: string,
    quality: '720p' | '1080p' = '1080p'
  ): Promise<ExportClipResponse> {
    const mode = this.getExecutionMode();
    const apiKey = this.getApiKey();

    if (mode === 'demo' || clipId.startsWith('demo-clip-')) {
      return {
        status: 'ready',
        clip_id: clipId,
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        cached: true,
      };
    }

    const targetEndpoint =
      mode === 'proxy'
        ? `/api/lumiclip/clips/${clipId}/export`
        : `${this.apiBaseUrl}/api/v1/clips/${clipId}/export`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (mode === 'direct' && apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(targetEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ quality }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Export clip failed (${res.status}): ${errorText}`);
    }

    return await res.json();
  }

  // --- DEMO / FALLBACK GENERATORS ---

  private mockGenerateResponse(params: LumiClipGenerateParams) {
    const demoId = `demo-project-${Date.now()}`;
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(
        `lumiclip_${demoId}`,
        JSON.stringify({
          created: Date.now(),
          params,
        })
      );
    }
    return {
      project_id: demoId,
      status: 'processing',
      estimated_minutes: 1,
      poll_url: `/api/v1/projects/${demoId}`,
      message: 'Processing started in Demo Mode (Simulated AI Clipping pipeline).',
      is_demo: true,
    };
  }

  private mockPollProjectStatus(projectId: string): LumiClipProject {
    let elapsedSec = 15;
    let params: LumiClipGenerateParams = { aspect_ratio: '9:16', url: 'https://youtube.com/watch?v=demo' };

    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem(`lumiclip_${projectId}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          elapsedSec = Math.floor((Date.now() - parsed.created) / 1000);
          params = parsed.params || params;
        } catch (e) {}
      }
    }

    const isDone = elapsedSec >= 12; // Ready after 12 seconds in demo
    const step = elapsedSec < 3 ? 'downloading' : elapsedSec < 6 ? 'transcribing' : elapsedSec < 9 ? 'analyzing' : elapsedSec < 12 ? 'cutting' : 'done';

    const sampleClips: LumiClipItem[] = [
      {
        id: `demo-clip-1-${projectId}`,
        title: 'The Viral Breakthrough Moment',
        duration: 38.5,
        score: 0.98,
        reason: 'Peak emotional energy shift, strong contrarian statement, instant audience retention.',
        clip_status: 'completed',
        download_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        quality: '1080p',
        thumbnail_url: 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=600&q=80',
      },
      {
        id: `demo-clip-2-${projectId}`,
        title: 'Why Most Creators Fail in 2026',
        duration: 45.2,
        score: 0.94,
        reason: 'High spoken retention rate, sharp cut rhythm, and punchy punch-subtitle overlay.',
        clip_status: 'completed',
        download_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
        quality: '1080p',
        thumbnail_url: 'https://images.unsplash.com/photo-1593697821252-0c9137d9fc45?auto=format&fit=crop&w=600&q=80',
      },
      {
        id: `demo-clip-3-${projectId}`,
        title: 'On-Device AI vs Cloud Bottlenecks',
        duration: 52.0,
        score: 0.91,
        reason: 'Dense technical insight presented clearly with visual demonstration callout.',
        clip_status: 'completed',
        download_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
        quality: '1080p',
        thumbnail_url: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&w=600&q=80',
      },
      {
        id: `demo-clip-4-${projectId}`,
        title: 'The Golden 3-Second Hook Rule',
        duration: 29.8,
        score: 0.88,
        reason: 'Concise actionable advice ideal for TikTok & Shorts virality.',
        clip_status: 'completed',
        download_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
        quality: '1080p',
        thumbnail_url: 'https://images.unsplash.com/photo-1492724441997-5dc865305da7?auto=format&fit=crop&w=600&q=80',
      },
    ];

    return {
      id: projectId,
      name: 'AI Smart Clips Project',
      status: isDone ? 'completed' : 'processing',
      step,
      expected_clips: 4,
      duration: 420,
      aspect_ratio: params.aspect_ratio || '9:16',
      estimated_minutes: 1,
      clips: isDone ? sampleClips : [],
    };
  }
}

export const lumiclipService = new LumiClipService();
export default lumiclipService;
