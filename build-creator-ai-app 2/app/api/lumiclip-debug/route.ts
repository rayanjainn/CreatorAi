import { NextRequest, NextResponse } from 'next/server';

/**
 * DEBUG ONLY route: GET /api/lumiclip-debug?projectId=<id>
 * Fetches the raw LumiClip project response and returns it unmodified.
 * Remove or protect this route before production.
 */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId');
  const apiKey = process.env.LUMICLIP_API_KEY || process.env.NEXT_PUBLIC_LUMICLIP_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: 'LUMICLIP_API_KEY not set in environment' }, { status: 500 });
  }

  if (!projectId) {
    return NextResponse.json({ error: 'Pass ?projectId=<project-uuid> as a query param' }, { status: 400 });
  }

  const url = `https://api.lumiclip.ai/api/v1/projects/${projectId}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    });

    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { raw_text: text }; }

    return NextResponse.json({
      project_id: projectId,
      http_status: res.status,
      lumiclip_response: json,
    }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
