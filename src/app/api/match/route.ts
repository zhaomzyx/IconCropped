import { NextRequest, NextResponse } from 'next/server';
import { ResourceItem, WikiCroppedImage, MappingRelation, DiffItem, MatchResult } from '@/types';
import { readFile } from 'fs/promises';
import sharp from 'sharp';

// 计算命名相似度（使用编辑距离算法）
function calculateNameSimilarity(name1: string, name2: string): number {
  if (!name1 || !name2) return 0;

  // 提取共同前缀（移除数字和下划线）
  const normalizeName = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[_\-\s]+/g, ' ')
      .replace(/\d+/g, '') // 移除数字
      .trim();
  };

  const norm1 = normalizeName(name1);
  const norm2 = normalizeName(name2);

  if (norm1 === norm2) return 1.0; // 完全相同

  // 检查是否包含共同词
  const words1 = norm1.split(' ');
  const words2 = norm2.split(' ');
  const commonWords = words1.filter(word => words2.includes(word));

  if (commonWords.length === 0) return 0; // 没有共同词

  // 计算编辑距离（Levenshtein Distance）
  const levenshteinDistance = (s1: string, s2: string): number => {
    const m = s1.length;
    const n = s2.length;
    const dp: number[][] = [];

    for (let i = 0; i <= m; i++) {
      dp[i] = [i];
    }
    for (let j = 0; j <= n; j++) {
      dp[0][j] = j;
    }

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,      // 删除
            dp[i][j - 1] + 1,      // 插入
            dp[i - 1][j - 1] + 1   // 替换
          );
        }
      }
    }

    return dp[m][n];
  };

  const distance = levenshteinDistance(norm1, norm2);
  const maxLength = Math.max(norm1.length, norm2.length);

  // 转换为相似度（0-1）
  const similarity = 1 - (distance / maxLength);

  // 提高共同词的权重
  const commonRatio = commonWords.length / Math.max(words1.length, words2.length);
  const weightedSimilarity = similarity * 0.7 + commonRatio * 0.3;

  return weightedSimilarity;
}

// 计算感知哈希（增加尺寸以提高精度）
async function calculatePerceptualHash(imagePath: string): Promise<string> {
  try {
    const buffer = await readFile(imagePath);

    // 生成感知哈希（使用16x16而不是8x8，保留更多细节）
    const hash = await sharp(buffer)
      .resize(16, 16, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();

    // 计算哈希值
    let hashString = '';
    for (let i = 0; i < hash.length; i++) {
      hashString += hash[i].toString(16).padStart(2, '0');
    }

    return hashString;
  } catch (error) {
    console.error('Calculate perceptual hash error:', error);
    return '';
  }
}

// 计算汉明距离
function hammingDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) return 100;

  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) distance++;
  }

  return distance;
}

// 计算图片和命名综合相似度
async function calculateImageSimilarity(
  wikiImage: WikiCroppedImage,
  localImage: ResourceItem
): Promise<{ imageScore: number; nameScore: number; combinedScore: number }> {
  if (!localImage.imageUrl || !wikiImage.imageUrl) {
    return { imageScore: 0, nameScore: 0, combinedScore: 0 };
  }

  try {
    // 从URL中提取文件路径
    const wikiImagePath = wikiImage.imageUrl.replace('/api/crops/', '/workspace/projects/public/wiki-cropped/');
    const localImagePath = localImage.imageUrl.replace('/api/uploads/', '/tmp/uploads/');

    // 计算命名相似度（使用filename）
    const nameScore = calculateNameSimilarity(wikiImage.name, localImage.filename);

    console.log(`Comparing: ${wikiImage.name} with ${localImage.filename}`);

    // 计算感知哈希
    const wikiHash = await calculatePerceptualHash(wikiImagePath);
    const localHash = await calculatePerceptualHash(localImagePath);

    if (!wikiHash || !localHash) {
      return { imageScore: 0, nameScore, combinedScore: nameScore * 0.3 };
    }

    // 计算汉明距离
    const distance = hammingDistance(wikiHash, localHash);
    const maxDistance = wikiHash.length;

    // 转换为相似度（0-1）
    const imageScore = 1 - (distance / maxDistance);

    // 综合评分：视觉相似度占70%，命名相似度占30%
    const combinedScore = imageScore * 0.7 + nameScore * 0.3;

    console.log(`  Image score: ${imageScore.toFixed(3)}, Name score: ${nameScore.toFixed(3)}, Combined: ${combinedScore.toFixed(3)}`);

    return { imageScore, nameScore, combinedScore };
  } catch (error) {
    console.error('Calculate image similarity error:', error);
    return { imageScore: 0, nameScore: 0, combinedScore: 0 };
  }
}

// 智能匹配（基于命名相似性和图片相似度）
async function matchResources(
  localResources: ResourceItem[],
  wikiImages: WikiCroppedImage[]
): Promise<MatchResult> {
  const mappings: MappingRelation[] = [];
  const diffs: DiffItem[] = [];
  const mappedResourceIds = new Set<string>();
  const matchedWikiImageIds = new Set<string>();

  console.log(`\n=== Starting match process ===`);
  console.log(`Wiki images: ${wikiImages.length}`);
  console.log(`Local resources: ${localResources.length}`);

  for (const wikiImage of wikiImages) {
    console.log(`\nProcessing Wiki image: ${wikiImage.name}`);

    // 第一步：找出命名相似的候选图片
    const nameSimilarCandidates: Array<{
      local: ResourceItem;
      nameScore: number;
    }> = [];

    for (const local of localResources) {
      if (mappedResourceIds.has(local.id)) continue; // 跳过已匹配的

      const nameScore = calculateNameSimilarity(wikiImage.name, local.filename);
      if (nameScore > 0.5) { // 命名相似度阈值
        nameSimilarCandidates.push({ local, nameScore });
      }
    }

    // 按命名相似度排序
    nameSimilarCandidates.sort((a, b) => b.nameScore - a.nameScore);

    console.log(`  Found ${nameSimilarCandidates.length} name-similar candidates`);

    let bestMatch: ResourceItem | null = null;
    let bestScore = 0;
    let bestImageScore = 0;
    let bestNameScore = 0;

    // 第二步：只对命名相似的候选进行视觉比对
    if (nameSimilarCandidates.length > 0) {
      console.log(`  Comparing with name-similar candidates (priority):`);

      for (const { local, nameScore } of nameSimilarCandidates) {
        const { imageScore, combinedScore } = await calculateImageSimilarity(wikiImage, local);

        if (combinedScore > bestScore) {
          bestScore = combinedScore;
          bestImageScore = imageScore;
          bestNameScore = nameScore;
          bestMatch = local;
        }
      }
    }

    // 第三步：如果没有命名相似的候选，进行全局比对
    if (bestMatch === null) {
      console.log(`  No name-similar candidates, performing global comparison:`);

      for (const local of localResources) {
        if (mappedResourceIds.has(local.id)) continue;

        const { imageScore, nameScore, combinedScore } = await calculateImageSimilarity(wikiImage, local);

        if (combinedScore > bestScore) {
          bestScore = combinedScore;
          bestImageScore = imageScore;
          bestNameScore = nameScore;
          bestMatch = local;
        }
      }
    }

    // 第四步：判断是否匹配成功
    if (bestMatch && bestScore > 0.35) { // 降低综合评分阈值（考虑了命名相似度）
      console.log(`  ✓ Matched with ${bestMatch.filename}:`);
      console.log(`    Name score: ${bestNameScore.toFixed(3)}, Image score: ${bestImageScore.toFixed(3)}, Combined: ${bestScore.toFixed(3)}`);

      mappings.push({
        resourceId: bestMatch.id,
        wikiImageId: wikiImage.id,
        wikiName: wikiImage.name,
        wikiImageUrl: wikiImage.imageUrl,
        confidence: bestScore,
        isManual: false,
      });

      mappedResourceIds.add(bestMatch.id);
      matchedWikiImageIds.add(wikiImage.id);

      // 检查相似度是否过低
      if (bestScore < 0.5) { // 降低阈值
        diffs.push({
          type: 'low_similarity',
          wikiImage: wikiImage,
          localImage: bestMatch,
          confidence: bestScore
        });
        console.log(`  ⚠ Low similarity warning`);
      }
    } else {
      console.log(`  ✗ No match found (best score: ${bestScore.toFixed(3)})`);

      // 缺图：Wiki有但本地没有
      diffs.push({
        type: 'missing',
        wikiImage: wikiImage,
      });
    }
  }

  // 检查多图：本地有但Wiki没有
  for (const local of localResources) {
    if (!mappedResourceIds.has(local.id)) {
      diffs.push({
        type: 'extra',
        localImage: local,
      });
    }
  }

  const missingCount = diffs.filter(d => d.type === 'missing').length;
  const extraCount = diffs.filter(d => d.type === 'extra').length;
  const lowSimilarityCount = diffs.filter(d => d.type === 'low_similarity').length;

  console.log(`\n=== Match result ===`);
  console.log(`Mappings: ${mappings.length}`);
  console.log(`Missing: ${missingCount}, Extra: ${extraCount}, Low similarity: ${lowSimilarityCount}`);

  return {
    mappings,
    diffs,
    missingImages: missingCount,
    extraImages: extraCount,
    lowSimilarityCount
  };
}

// POST: 执行智能匹配
export async function POST(request: NextRequest) {
  try {
    const { localResources, wikiImages } = await request.json();

    if (!localResources || !wikiImages) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const matchResult = await matchResources(localResources, wikiImages);

    return NextResponse.json({
      success: true,
      result: matchResult
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to match resources';
    console.error('Match error:', error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
