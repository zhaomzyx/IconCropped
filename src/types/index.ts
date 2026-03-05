// 资源类型枚举
export enum ResourceType {
  SPAWNER = 'spawner', // 生产器
  ALIGN = 'align', // 对齐物品
  SIMPLE_OPT = 'simple_opt', // 盲盒物品
  UNKNOWN = 'unknown'
}

// 资源项
export interface ResourceItem {
  id: string;
  filename: string; // 本地文件名
  displayName?: string; // 显示名称（从OCR或映射获得）
  level: number; // 等级（1, 2, 3...）
  type: ResourceType; // 资源类型
  imageUrl?: string; // 图片URL（本地或Wiki清晰图）
  wikiImageUrl?: string; // Wiki清晰图URL
  isConfused?: boolean; // 是否是混淆图片
  confidence?: number; // 匹配置信度 0-1
  chainId?: string; // 所属合成链ID
}

// 合成链
export interface SynthesisChain {
  id: string;
  name: string; // 合成链名称
  type: ResourceType; // 链条类型
  maxLevel: number; // 最高等级
  baseName: string; // 基础名称（去除了前缀和后缀）
  wikiName?: string; // Wiki官方名称
  items: ResourceItem[]; // 所有等级的物品
  thumbnailUrl?: string; // 缩略图
  spawnRate?: number; // 生产器掉落数量
}

// 映射关系
export interface MappingRelation {
  resourceId: string; // 本地资源ID
  wikiImageId?: string; // Wiki图片ID
  wikiName?: string; // Wiki名称
  wikiImageUrl?: string; // Wiki图片URL
  confidence: number; // 匹配置信度
  isManual: boolean; // 是否人工确认
}

// Wiki切割结果
export interface WikiCroppedImage {
  id: string;
  name: string; // OCR提取的名称
  imageUrl: string; // 切割后的图片URL
  level?: number; // 等级（如果能识别）
  width: number;
  height: number;
  categoryId?: string; // 所属品类模块ID
}

// 上传结果
export interface UploadResult {
  success: boolean;
  message?: string;
  fileCount?: number;
  chains?: SynthesisChain[];
}

// 搜索筛选条件
export interface FilterOptions {
  keyword?: string; // 搜索关键词
  types?: ResourceType[]; // 类型筛选
  minLevel?: number; // 最低等级
  maxLevel?: number; // 最高等级
  hasSpawner?: boolean; // 是否有生产器
}

// 差异类型
export type DiffType = 'missing' | 'extra' | 'low_similarity';

// 差异项
export interface DiffItem {
  type: DiffType;
  wikiImage?: WikiCroppedImage;
  localImage?: ResourceItem;
  confidence?: number;
}

// 映射结果
export interface MatchResult {
  mappings: MappingRelation[];
  diffs: DiffItem[];
  missingImages: number;
  extraImages: number;
  lowSimilarityCount: number;
}

