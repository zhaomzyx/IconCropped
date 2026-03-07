import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import { existsSync } from 'fs';

// 路径参数中的 [...path] 意味着这是一个捕获所有路径段的动态路由
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    // 获取请求的路径
    const { path: pathSegments } = await params;
    const requestedPath = pathSegments.join('/');
    const filePath = join(process.cwd(), 'public', 'wiki-cropped', requestedPath);

    // 检查文件是否存在
    if (!existsSync(filePath)) {
      console.error(`Wiki cropped image not found: ${filePath}`);
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // 检查是否是目录
    const fileStats = await stat(filePath);
    if (fileStats.isDirectory()) {
      return NextResponse.json({ error: 'Is directory' }, { status: 400 });
    }

    // 读取文件
    const fileBuffer = await readFile(filePath);

    // 确定内容类型
    const ext = extname(requestedPath).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' :
                       ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                       ext === '.webp' ? 'image/webp' :
                       'image/png';

    // 返回图片
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000', // 缓存1年
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to serve image';
    console.error('Error serving wiki cropped image:', error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
