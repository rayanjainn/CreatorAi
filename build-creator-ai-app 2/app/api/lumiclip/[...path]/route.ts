import { NextRequest, NextResponse } from 'next/server';

const LUMICLIP_BASE_URL = 'https://api.lumiclip.ai';

async function handleProxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  const pathParts = resolvedParams.path || [];
  const endpoint = pathParts.join('/');
  
  const apiKey = process.env.LUMICLIP_API_KEY || process.env.NEXT_PUBLIC_LUMICLIP_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        error: 'LUMICLIP_API_KEY is not configured in server environment variables.',
        message: 'Please set LUMICLIP_API_KEY in your .env file.',
      },
      { status: 500 }
    );
  }

  const searchParams = req.nextUrl.search;
  const targetUrl = `${LUMICLIP_BASE_URL}/api/v1/${endpoint}${searchParams}`;

  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${apiKey}`,
    };

    let body: any = null;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try {
        body = await req.text();
        headers['Content-Type'] = req.headers.get('content-type') || 'application/json';
      } catch (e) {}
    }

    const apiRes = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: body || undefined,
    });

    const responseData = await apiRes.text();
    let json;
    try {
      json = JSON.parse(responseData);
    } catch {
      json = { raw: responseData };
    }

    return NextResponse.json(json, { status: apiRes.status });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: 'Proxy Gateway Error',
        message: err.message || 'Failed to reach LumiClip API backend.',
      },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handleProxy(req, ctx);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handleProxy(req, ctx);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handleProxy(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handleProxy(req, ctx);
}
