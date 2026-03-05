import { NextRequest, NextResponse } from 'next/server';
import { FetchClient, Config } from 'coze-coding-dev-sdk';

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const config = new Config();
    const client = new FetchClient(config);

    const response = await client.fetch(url);

    // Extract all text content
    const textContent = response.content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('\n');

    return NextResponse.json({
      title: response.title,
      text: textContent,
      status: response.status_code,
      filetype: response.filetype,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch PDF' },
      { status: 500 }
    );
  }
}
