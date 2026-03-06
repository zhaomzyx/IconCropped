'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, ArrowLeft, CheckCircle, AlertCircle, Link2, X, ChevronDown, FileImage, Package, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { ResourceItem, WikiCroppedImage, MappingRelation } from '@/types';
import { detectWikiImage } from '@/lib/wiki-image-detector';
import DebugModal, { DetectedPanel } from '@/components/debug-modal';

// Wiki图片预览组件
const WikiImagePreview = ({ filename, wikiName, onRemove }: { filename: string; wikiName?: string; onRemove: () => void }) => {
  const [imageInfo, setImageInfo] = useState<{ width: number; height: number } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // 构建图片URL（直接使用静态文件服务，无需API路由）
  const imageUrl = wikiName
    ? `/WikiPic/${wikiName}/${filename}`
    : `/WikiPic/${filename}`;

  // 加载图片信息
  React.useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImageInfo({ width: img.width, height: img.height });
      setIsLoading(false);
    };
    img.onerror = () => {
      setIsLoading(false);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  return (
    <>
      <div className="relative group">
        <img
          src={imageUrl}
          alt={filename}
          className="w-full h-16 object-cover rounded border border-blue-200 dark:border-blue-800 cursor-pointer hover:border-blue-400 transition-colors"
          onClick={() => setShowModal(true)}
          loading="lazy"
        />
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110 text-xs shadow-sm hover:shadow"
        >
          ×
        </button>
        {isLoading && (
          <div className="absolute inset-0 bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
            <FileImage className="w-4 h-4 text-blue-400 animate-pulse" />
          </div>
        )}
      </div>

      {/* 图片详情模态框 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-lg p-6 max-w-4xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold mb-2">{filename}</h3>
                {imageInfo && (
                  <div className="flex gap-4 text-sm text-slate-600 dark:text-slate-400">
                    <span>宽度: {imageInfo.width}px</span>
                    <span>高度: {imageInfo.height}px</span>
                  </div>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowModal(false)} className="hover:bg-slate-200 dark:hover:bg-slate-800 hover:shadow-sm transition-all duration-200">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <img
              src={imageUrl}
              alt={filename}
              className="max-w-full h-auto rounded border border-slate-200 dark:border-slate-700"
            />
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  window.open(imageUrl, '_blank');
                }}
                className="hover:bg-blue-50 dark:hover:bg-blue-950 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm transition-all duration-200"
              >
                下载图片
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(filename);
                  alert('已复制文件名到剪贴板');
                }}
                className="hover:bg-blue-50 dark:hover:bg-blue-950 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm transition-all duration-200"
              >
                复制文件名
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

interface ProcessSummary {
  wikiImageCount: number;
  localItemCount: number;
  chainCount: number;
  matchResult: any;
}

export default function WorkbenchPage() {
  const [dragActive, setDragActive] = useState(false);
  const [wikiFiles, setWikiFiles] = useState<File[]>([]);
  const [fetchedWikiFiles, setFetchedWikiFiles] = useState<string[]>([]);
  const [fetchedWikiName, setFetchedWikiName] = useState<string>(''); // 新增：保存Wiki名称
  const [wikiUrl, setWikiUrl] = useState('');
  const [isFetchingWiki, setIsFetchingWiki] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<string>('');
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const [localFolders, setLocalFolders] = useState<{ name: string; files: File[] }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  const [processingProgress, setProcessingProgress] = useState(0);
  const [mappings, setMappings] = useState<MappingRelation[]>([]);
  const [wikiImages, setWikiImages] = useState<WikiCroppedImage[]>([]);
  const [localResources, setLocalResources] = useState<ResourceItem[]>([]);
  const [showSummary, setShowSummary] = useState(false);
  const [processSummary, setProcessSummary] = useState<ProcessSummary | null>(null);

  // 新增：分步处理状态
  const [wikiProcessed, setWikiProcessed] = useState(false);  // Wiki是否已裁切
  const [localProcessed, setLocalProcessed] = useState(false);  // 本地资源是否已分析
  const [isProcessingWiki, setIsProcessingWiki] = useState(false);  // Wiki裁切中
  const [isProcessingLocal, setIsProcessingLocal] = useState(false);  // 本地资源分析中
  const [wikiProcessingStep, setWikiProcessingStep] = useState('');  // Wiki处理步骤
  const [localProcessingStep, setLocalProcessingStep] = useState('');  // 本地资源处理步骤

  // 新增：裁切统计信息
  const [chainCount, setChainCount] = useState<number>(0);  // 合成链数量（大Panel数量）

  // 🌟 新增：调试台相关状态
  const [showDebugModal, setShowDebugModal] = useState(false);  // 是否显示调试台 Modal
  const [currentImageUrl, setCurrentImageUrl] = useState('');  // 当前调试的图片 URL
  const [currentFilename, setCurrentFilename] = useState('');  // 当前调试的文件名

  // 预设Wiki URL列表
  const presetWikiUrls = [
    { name: 'Travel Town', url: 'https://travel-town-mobile-game.fandom.com/wiki/Collection' },
  ];

  const [selectedPresetUrl, setSelectedPresetUrl] = useState<string>('');

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent, type: 'wiki' | 'local') => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files);
    const items = Array.from(e.dataTransfer.items);

    if (type === 'wiki' && files.length > 0) {
      setWikiFiles(prev => [...prev, ...files]);

      // 不自动触发处理，避免竞态条件
      // 用户需要手动点击"开始处理"按钮
    } else if (type === 'local') {
      // 检查是否有文件夹（通过 DataTransferItem API）
      let hasDirectory = false;
      const regularFiles: File[] = [];
      const newFolders: { name: string; files: File[] }[] = [];

      // 遍历所有拖拽项
      for (const item of items) {
        // @ts-ignore - webkitGetAsEntry is not in TypeScript types
        const entry = item.webkitGetAsEntry?.();

        if (entry) {
          if (entry.isDirectory) {
            hasDirectory = true;
            const folderName = entry.name;
            const filesInFolder = await readDirectory(entry as FileSystemDirectoryEntry, folderName);
            // 为每个文件夹创建独立的对象
            newFolders.push({ name: folderName, files: filesInFolder });
          } else if (entry.isFile) {
            // 处理单个文件
            const file = await new Promise<File>((resolve, reject) => {
              (entry as FileSystemFileEntry).file(resolve, reject);
            });
            regularFiles.push(file);
          }
        }
      }

      // 如果通过items没有检测到文件夹，尝试从files中识别（某些浏览器可能不支持items）
      if (!hasDirectory && files.length > 0) {
        // 检查是否有文件包含webkitRelativePath（表示是文件夹中的文件）
        const hasRelativePath = files.some(f => f.webkitRelativePath);

        if (hasRelativePath) {
          // 从webkitRelativePath中提取所有文件夹
          const folderMap = new Map<string, File[]>();

          files.forEach(file => {
            const parts = file.webkitRelativePath.split('/');
            if (parts.length > 1) {
              const folderName = parts[0];
              if (!folderMap.has(folderName)) {
                folderMap.set(folderName, []);
              }
              folderMap.get(folderName)!.push(file);
            }
          });

          // 为每个文件夹创建独立对象
          folderMap.forEach((folderFiles, folderName) => {
            newFolders.push({ name: folderName, files: folderFiles });
          });
          hasDirectory = newFolders.length > 0;
        }
      }

      // 如果检测到文件夹
      if (hasDirectory) {
        // 为每个文件夹独立保存
        setLocalFolders(prev => {
          const updated = [...prev];
          newFolders.forEach(newFolder => {
            // 检查是否已存在同名文件夹，如果存在则合并文件
            const existingIndex = updated.findIndex(f => f.name === newFolder.name);
            if (existingIndex !== -1) {
              updated[existingIndex] = {
                ...updated[existingIndex],
                files: [...updated[existingIndex].files, ...newFolder.files]
              };
            } else {
              updated.push(newFolder);
            }
          });
          return updated;
        });
      } else {
        // 检查是否通过文件夹选择器上传（通过webkitRelativePath）
        if (files.length > 0 && files[0].webkitRelativePath) {
          const folderName = files[0].webkitRelativePath.split('/')[0];
          // 检查是否已存在同名文件夹
          const existingFolder = localFolders.find(f => f.name === folderName);
          if (existingFolder) {
            setLocalFolders(prev => prev.map(f =>
              f.name === folderName
                ? { ...f, files: [...f.files, ...files] }
                : f
            ));
          } else {
            setLocalFolders(prev => [...prev, { name: folderName, files }]);
          }
        } else {
          // 普通文件
          setLocalFiles(prev => [...prev, ...regularFiles]);
        }
      }
    }
  };

  // 递归读取文件夹内容
  const readDirectory = async (entry: FileSystemDirectoryEntry, folderName: string): Promise<File[]> => {
    const files: File[] = [];
    const reader = entry.createReader();

    const readEntries = async (): Promise<void> => {
      const entries = await new Promise<FileSystemEntry[]>((resolve) => {
        reader.readEntries(resolve);
      });

      for (const childEntry of entries) {
        if (childEntry.isFile) {
          const file = await new Promise<File>((resolve, reject) => {
            (childEntry as FileSystemFileEntry).file(resolve, reject);
          });
          files.push(file);
        } else if (childEntry.isDirectory) {
          // 递归读取子文件夹
          await readDirectory(childEntry as FileSystemDirectoryEntry, folderName);
        }
      }

      // 继续读取剩余条目（readEntries 每次最多返回100个）
      if (entries.length === 100) {
        await readEntries();
      }
    };

    await readEntries();
    return files;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type: 'wiki' | 'local') => {
    const files = Array.from(e.target.files || []);

    if (type === 'wiki' && files.length > 0) {
      setWikiFiles(prev => [...prev, ...files]);
    } else if (type === 'local') {
      // 检查是否是文件夹上传（通过webkitRelativePath）
      if (files.length > 0 && files[0].webkitRelativePath) {
        const folderName = files[0].webkitRelativePath.split('/')[0];
        // 检查是否已存在同名文件夹
        const existingFolder = localFolders.find(f => f.name === folderName);
        if (existingFolder) {
          setLocalFolders(prev => prev.map(f =>
            f.name === folderName
              ? { ...f, files: [...f.files, ...files] }
              : f
          ));
        } else {
          setLocalFolders(prev => [...prev, { name: folderName, files }]);
        }
      } else {
        setLocalFiles(prev => [...prev, ...files]);
      }
    }
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0 && files[0].webkitRelativePath) {
      const folderName = files[0].webkitRelativePath.split('/')[0];
      // 检查是否已存在同名文件夹
      const existingFolder = localFolders.find(f => f.name === folderName);
      if (existingFolder) {
        setLocalFolders(prev => prev.map(f =>
          f.name === folderName
            ? { ...f, files: [...f.files, ...files] }
            : f
        ));
      } else {
        setLocalFolders(prev => [...prev, { name: folderName, files }]);
      }
    }
  };

  const handleFetchWiki = async () => {
    if (!wikiUrl) {
      alert('请输入Wiki URL');
      return;
    }

    setIsFetchingWiki(true);
    setFetchProgress('正在初始化...');

    try {
      const response = await fetch('/api/fetch-wiki-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: wikiUrl }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应流');
      }

      const decoder = new TextDecoder();
      let downloadedImages: string[] = [];
      let currentEventType = '';
      let filteringCompleteData = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEventType = line.slice(6).trim();
            continue;
          }
          if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim();
            if (!dataStr) continue; // 跳过空数据行
            try {
              const data = JSON.parse(dataStr);

              // 通用消息显示
              if (data.message) {
                // 为不同阶段的消息添加图标
                let icon = '';
                if (data.step === 'filtering') icon = '📊 ';
                if (data.step === 'saving') icon = '💾 ';
                if (data.step === 'saved') icon = '✓ ';
                if (data.message.startsWith('✗')) icon = '';

                setFetchProgress(icon + data.message);
              }

              // 监听筛选完成事件
              if (currentEventType === 'filtering_complete') {
                filteringCompleteData = data;
                const { totalFound, validCount, filtered } = data;
                const message = `🎯 筛选完成！共检测 ${totalFound} 张图片，找到 ${validCount} 张长图，已过滤 ${filtered.tooSmall + filtered.notLong + filtered.invalid} 张`;
                setFetchProgress(message);
              }

              // 监听最终完成事件
              if (currentEventType === 'complete' && data.success) {
                downloadedImages = data.images;
                // 保存Wiki名称（用于后续访问图片）
                if (data.wikiName) {
                  setFetchedWikiName(data.wikiName);
                }
              }

              // 监听错误事件
              if (currentEventType === 'error') {
                alert('获取失败：' + (data.message || '未知错误'));
                setIsFetchingWiki(false);
                setFetchProgress('');
                return;
              }
            } catch (parseError) {
              console.warn('JSON解析失败，跳过该行:', dataStr, parseError);
              // 继续处理下一行，不中断整个流程
            }
          }
        }
      }

      // 显示获取结果（包含过滤统计）
      if (downloadedImages.length > 0) {
        const totalValid = filteringCompleteData?.validCount || downloadedImages.length;
        const totalFound = filteringCompleteData?.totalFound || 0;
        const filtered = filteringCompleteData?.filtered;

        let message = `🎉 成功保存 ${downloadedImages.length}/${totalValid} 张长图！\n`;
        if (totalFound > 0) {
          message += `\n共检测 ${totalFound} 张图片，过滤 ${totalFound - totalValid} 张`;
        }
        alert(message);
        setFetchedWikiFiles(prev => [...prev, ...downloadedImages]);
        setWikiUrl('');
        setFetchProgress('');
      } else {
        alert('未能获取到任何图片');
      }
    } catch (error) {
      console.error('Fetch Wiki error:', error);
      alert('获取失败，请重试');
    } finally {
      setIsFetchingWiki(false);
      setFetchProgress('');
    }
  };

  const removeWikiFile = (index: number) => {
    setWikiFiles(prev => prev.filter((_, i) => i !== index));
  };

  const removeFetchedWikiFile = (index: number) => {
    setFetchedWikiFiles(prev => prev.filter((_, i) => i !== index));
  };

  const removeLocalFile = (index: number) => {
    setLocalFiles(prev => prev.filter((_, i) => i !== index));
  };

  // 🌟 下载ZIP打包函数
  const handleDownloadZip = async () => {
    try {
      const wikiName = fetchedWikiName || 'default';
      
      // 调用后端API生成ZIP
      const response = await fetch('/api/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wikiName }),
      });

      if (!response.ok) {
        throw new Error(`下载失败: ${response.status}`);
      }

      // 获取Blob并下载
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${wikiName}-cropped.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      console.log('✅ ZIP 下载成功');
    } catch (error) {
      console.error('下载ZIP失败:', error);
      alert('下载失败：' + (error instanceof Error ? error.message : '未知错误'));
    }
  };

  // 步骤1：打开调试台（修改：不再直接处理，而是打开调试台）
  const handleProcessWiki = async () => {
    if (wikiFiles.length === 0 && fetchedWikiFiles.length === 0) {
      alert('请先上传Wiki长图或从Wiki URL获取图片');
      return;
    }

    // 🌟 修改：打开调试台而不是直接处理
    // 获取第一张图片的 URL
    let imageUrl: string;
    let filename: string;
    const actualWikiName = fetchedWikiName || 'default';

    if (wikiFiles.length > 0) {
      // 用户上传的文件
      filename = wikiFiles[0].name;
      imageUrl = `/api/uploads/wiki/${filename}`;
    } else {
      // 从 Wiki URL 获取的文件
      filename = fetchedWikiFiles[0];
      imageUrl = `/WikiPic/${actualWikiName}/${filename}`;
    }

    // 打开调试台
    setCurrentImageUrl(imageUrl);
    setCurrentFilename(filename);
    setShowDebugModal(true);
  };

  // 🌟 新增：处理从调试台导出的裁切坐标
  const handleDebugExport = async (panels: DetectedPanel[]) => {
    setShowDebugModal(false);
    setIsProcessingWiki(true);
    setWikiProcessingStep('正在裁切...');
    setWikiProcessed(false);

    try {
      const actualWikiName = fetchedWikiName || 'default';

      // 🌟 打点2 - 发起请求前
      console.log(`[打点2 - 发起请求前] 准备发给后端的 payload:`, JSON.stringify({
        imageUrl: currentImageUrl,
        panelsCount: panels.length,
        firstPanelRedBoxesCount: panels[0]?.redBoxes?.length
      }, null, 2));

      // 调用裁切 API
      const cropResponse = await fetch('/api/crop-with-coordinates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: currentImageUrl,
          debugPanels: panels,
          wikiName: actualWikiName || 'default',
        }),
      });

      if (!cropResponse.ok) {
        throw new Error(`裁切失败: ${cropResponse.status}`);
      }

      const cropData = await cropResponse.json();

      if (!cropData.success) {
        throw new Error(cropData.error || '裁切失败');
      }

      console.log(`裁切完成，共裁切 ${cropData.total} 个图标`);

      // 转换结果格式
      const convertedCrops: WikiCroppedImage[] = cropData.results.map((result: any) => ({
        path: result.filename,
        name: result.name,
        row: result.row,
        col: result.col,
        totalRows: result.row + 1,
        totalCols: result.col + 1,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        panelName: result.name.split('_')[0],
        title: result.name.split('_')[0],
        wikiName: actualWikiName || 'default',
        id: `${actualWikiName || 'default'}_${result.filename}`,
        imageUrl: result.imageUrl,
      }));

      setWikiImages(convertedCrops);
      setChainCount(panels.length);  // 合成链数量 = 面板数量
      setWikiProcessed(true);
      setWikiProcessingStep('✅ 裁切完成');

      // 🌟 显示切图完成弹窗
      alert(`✅ 切图完成！\n\n📊 统计信息：\n- 合成链数量：${panels.length} 条\n- 图标数量：${cropData.total} 个\n\n📁 保存位置：\npublic/wiki-cropped/${currentFilename.split('.')[0]}/`);
    } catch (error) {
      console.error('裁切失败:', error);
      alert('裁切失败：' + (error instanceof Error ? error.message : '未知错误'));
      setWikiProcessingStep('❌ 裁切失败');
    } finally {
      setIsProcessingWiki(false);
    }
  };

  // 步骤1：处理Wiki图片裁切（保留原函数，供后续多图处理使用）
  const handleProcessWikiLegacy = async () => {
    if (wikiFiles.length === 0 && fetchedWikiFiles.length === 0) {
      alert('请先上传Wiki长图或从Wiki URL获取图片');
      return;
    }

    setIsProcessingWiki(true);
    setWikiProcessingStep('准备处理...');
    setWikiProcessed(false);

    try {
      // 上传Wiki长图
      const wikiFilenames: string[] = [];

      if (wikiFiles.length > 0) {
        setWikiProcessingStep('📤 正在上传Wiki长图...');
        for (let i = 0; i < wikiFiles.length; i++) {
          const wikiFile = wikiFiles[i];
          const wikiFormData = new FormData();
          wikiFormData.append('file', wikiFile);
          wikiFormData.append('type', 'wiki');

          await fetch('/api/upload', {
            method: 'POST',
            body: wikiFormData,
          });

          wikiFilenames.push(wikiFile.name);
        }
      }

      // 合并通过URL获取的文件（已经在服务器上）
      wikiFilenames.push(...fetchedWikiFiles);

      // 批量处理Wiki图像切割（使用前端 Canvas 检测）
      if (wikiFilenames.length > 0) {
        setWikiProcessingStep(`📊 正在梳理图片资源（共${wikiFilenames.length}张）...`);

        // 读取调试参数
        const STORAGE_KEY = 'wiki_slice_config';
        let customParams = {};
        try {
          const saved = localStorage.getItem(STORAGE_KEY);
          if (saved) {
            customParams = JSON.parse(saved);
          }
        } catch (e) {
          console.warn('无法读取调试参数，使用默认值');
        }

        console.log('🔧 使用的自定义检测参数:', customParams);

        let allWikiCrops: WikiCroppedImage[] = [];
        let failedCount = 0;
        let totalChainCount = 0;  // 🌟 累加所有图片的合成链数量

        // 🔧 添加：确定实际的 wikiName
        const actualWikiName = fetchedWikiName || 'default';

        // 逐张处理 Wiki 图片（使用前端 Canvas 滑动窗口算法）
        for (let i = 0; i < wikiFilenames.length; i++) {
          const filename = wikiFilenames[i];
          setWikiProcessingStep(`🖼️ 正在处理第 ${i + 1}/${wikiFilenames.length} 张图片...`);

          try {
            // 步骤1：调用前端 Canvas 滑动窗口算法（隐藏处理），获取图片上的所有信息
            setWikiProcessingStep(`🔍 图片 ${i + 1}/${wikiFilenames.length} - 正在识别大板块和裁切坐标...`);

            console.log(`[步骤1] 开始前端检测，图片: ${filename}`);

            // 🔧 构建图片URL：区分来源
            let imageUrl: string;
            // 检查文件名是否以 wiki- 开头（从 Wiki URL 获取的文件）
            if (filename.startsWith('wiki-') && fetchedWikiFiles.includes(filename)) {
              // 从 Wiki URL 获取的文件保存在 /WikiPic/{wikiName}/ 目录
              imageUrl = `/WikiPic/${actualWikiName}/${filename}`;
            } else {
              // 用户手动上传的文件通过 /api/uploads/wiki/ 访问
              imageUrl = `/api/uploads/wiki/${filename}`;
            }
            
            console.log(`[步骤1] 图片URL: ${imageUrl}`);

            // 使用纯前端检测算法
            const detectedPanels = await detectWikiImage(imageUrl);

            console.log(`[步骤1] 前端检测完成，检测到 ${detectedPanels.length} 个面板`);
            console.log(`[步骤1] 检测结果:`, JSON.stringify(detectedPanels, null, 2));

            if (detectedPanels.length === 0) {
              // 🌟 改进：提供更详细的错误信息和调试选项
              let errorMsg = `❌ 未检测到任何面板\n\n`;
              errorMsg += `文件名: ${filename}\n`;
              errorMsg += `图片URL: ${imageUrl}\n\n`;
              errorMsg += `可能的原因：\n`;
              errorMsg += `1. 图片尺寸过大（建议压缩到 3000px 以下）\n`;
              errorMsg += `2. 图片格式不支持\n`;
              errorMsg += `3. 默认检测参数不适合此图片\n\n`;
              errorMsg += `解决方案：\n`;
              errorMsg += `1. 访问调试台页面手动调整参数 (/debug)\n`;
              errorMsg += `2. 在浏览器控制台执行以下代码修改参数：\n\n`;
              errorMsg += `localStorage.setItem('wiki_slice_config', JSON.stringify({\n`;
              errorMsg += `  boundsMinRowHeight: 5,\n`;
              errorMsg += `  colorTolerance: 50,\n`;
              errorMsg += `  scanLineX: 100,\n`;
              errorMsg += `  scanStartY: 100,\n`;
              errorMsg += `}));\n\n`;
              errorMsg += `location.reload();`;

              alert(errorMsg);
              throw new Error('未检测到任何面板');
            }

            // 🌟 累加合成链数量
            totalChainCount += detectedPanels.length;
            console.log(`[步骤1] 累加合成链数量，当前总数: ${totalChainCount}`);

            // 步骤2：根据获取的信息进行裁切
            setWikiProcessingStep(`✂️ 图片 ${i + 1}/${wikiFilenames.length} - 正在裁切图标...`);

            console.log(`[步骤2] 开始裁切，图片: ${filename}`);
            console.log(`[步骤2] 发送给后端的裁切坐标:`, JSON.stringify({
              imageUrl,
              debugPanels: detectedPanels,
              wikiName: actualWikiName || 'default',
            }, null, 2));

            // 🌟 打点2 - 发起请求前
            console.log(`[打点2 - 发起请求前] 准备发给后端的 payload:`, JSON.stringify({
              imageUrl: imageUrl, // 检查原图URL是否正确
              panelsCount: detectedPanels.length, // 检查一共有几个大面板
              firstPanelRedBoxesCount: detectedPanels[0]?.redBoxes?.length // 检查第一个面板里有没有红框坐标
            }, null, 2));

            const cropResponse = await fetch('/api/crop-with-coordinates', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                imageUrl,
                debugPanels: detectedPanels,
                wikiName: actualWikiName || 'default',
              }),
            });

            if (!cropResponse.ok) {
              throw new Error(`裁切失败: ${cropResponse.status}`);
            }

            const cropData = await cropResponse.json();

            if (!cropData.success) {
              throw new Error(cropData.error || '裁切失败');
            }

            console.log(`[步骤2] 裁切完成，共裁切 ${cropData.total} 个图标`);

            // 转换结果格式
            const convertedCrops: WikiCroppedImage[] = cropData.results.map((result: any) => ({
              path: result.filename,
              name: result.name,
              row: result.row,
              col: result.col,
              totalRows: result.row + 1,
              totalCols: result.col + 1,
              x: 0,
              y: 0,
              width: 0,
              height: 0,
              panelName: result.name.split('_')[0],
              title: result.name.split('_')[0],
              wikiName: actualWikiName || 'default',
              id: `${actualWikiName || 'default'}_${result.filename}`,
              imageUrl: result.imageUrl,
            }));

            allWikiCrops = [...allWikiCrops, ...convertedCrops];
            setWikiProcessingStep(`✓ 图片 ${i + 1}/${wikiFilenames.length} 处理完成，已切割 ${cropData.total} 个图标`);

            // 步骤3：裁切完后通知下一张图片进行此流程（自动进入下一次循环）
          } catch (error) {
            console.error(`处理图片 ${filename} 失败:`, error);
            
            // 构造详细的错误信息
            let errorMessage = `❌ 图片 ${i + 1}/${wikiFilenames.length} 处理失败\n\n`;
            errorMessage += `文件名: ${filename}\n`;
            
            if (error instanceof Error) {
              errorMessage += `错误原因: ${error.message}\n`;
              errorMessage += `\n详细堆栈:\n${error.stack}`;
            } else {
              errorMessage += `错误原因: 未知错误\n`;
            }
            
            // 显示详细的错误弹窗
            alert(errorMessage);
            
            // 不中断整个流程，只记录失败的图片
            setWikiProcessingStep(`⚠️ 图片 ${i + 1}/${wikiFilenames.length} 处理失败，跳过...`);
            failedCount++;
            continue;
          }
        }

        // 设置最终结果
        setWikiImages(allWikiCrops);
        setFetchedWikiName(fetchedWikiName);
        setChainCount(totalChainCount);  // 🌟 设置合成链数量
        setWikiProcessed(true);

        // 汇总处理结果
        const successCount = wikiFilenames.length - (allWikiCrops.length === 0 ? wikiFilenames.length : 0);
        setWikiProcessingStep(`✅ 全部处理完成！共裁切 ${allWikiCrops.length} 个图标，${successCount === wikiFilenames.length ? '全部成功' : `部分成功 (${successCount}/${wikiFilenames.length})`}`);
      }
    } catch (error) {
      console.error('Wiki processing error:', error);
      alert('❌ Wiki处理失败，请重试\n\n错误信息：' + (error instanceof Error ? error.message : '未知错误'));
      setWikiProcessingStep('');
      return;
    } finally {
      setIsProcessingWiki(false);
    }

    setWikiProcessed(true);
    setTimeout(() => setWikiProcessingStep(''), 3000);
  };

  // 步骤2：处理本地资源分析
  const handleProcessLocal = async () => {
    if (localFiles.length === 0 && localFolders.length === 0) {
      alert('请先上传本地资源文件或文件夹');
      return;
    }

    setIsProcessingLocal(true);
    setLocalProcessingStep('准备处理...');
    setLocalProcessed(false);

    try {
      // 上传本地资源（包括文件夹）
      const allLocalFiles = [...localFiles];
      // 合并所有文件夹中的文件
      localFolders.forEach(folder => {
        allLocalFiles.push(...folder.files);
      });

      if (allLocalFiles.length > 0) {
        setLocalProcessingStep(`📦 正在上传本地资源（${allLocalFiles.length}个文件）...`);
        for (let i = 0; i < allLocalFiles.length; i++) {
          const file = allLocalFiles[i];
          const localFormData = new FormData();
          localFormData.append('file', file);
          localFormData.append('type', 'local');

          await fetch('/api/upload', {
            method: 'POST',
            body: localFormData,
          });
        }
      }

      // 获取本地资源列表
      setLocalProcessingStep('🔎 正在分析本地资源结构...');
      const resourcesResponse = await fetch('/api/upload');
      const resourcesData = await resourcesResponse.json();
      if (resourcesData.success) {
        const allItems = resourcesData.chains.flatMap((chain: any) => chain.items);
        setLocalResources(allItems);
        setLocalProcessingStep(`✅ 分析完成！共 ${resourcesData.chains.length} 条链，${allItems.length} 个物品`);
        console.log(`资源分析完成：${resourcesData.chains.length}条链，${allItems.length}个物品`);
      } else {
        throw new Error(resourcesData.error || '本地资源分析失败');
      }
    } catch (error) {
      console.error('Local processing error:', error);
      alert('❌ 本地资源分析失败，请重试\n\n错误信息：' + (error instanceof Error ? error.message : '未知错误'));
      setLocalProcessingStep('');
      return;
    } finally {
      setIsProcessingLocal(false);
    }

    setLocalProcessed(true);
    setTimeout(() => setLocalProcessingStep(''), 3000);
  };

  // 步骤3：执行智能比对
  const handleMatch = async () => {
    if (!wikiProcessed || !localProcessed) {
      alert('请先完成Wiki裁切和本地资源分析');
      return;
    }

    if (wikiImages.length === 0 || localResources.length === 0) {
      alert('缺少必要的数据，请重新处理');
      return;
    }

    setIsProcessing(true);
    setProcessingStep('🔗 正在执行智能匹配...');
    setProcessingProgress(0);

    try {
      const matchResponse = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          localResources,
          wikiImages,
        }),
      });

      const matchData = await matchResponse.json();
      if (matchData.success) {
        setMappings(matchData.result.mappings);
        setProcessingStep('✅ 比对完成！');
        setProcessingProgress(100);

        // 显示处理总结
        setShowSummary(true);

        // 准备总结数据
        const summaryData = {
          wikiImageCount: wikiImages.length,
          localItemCount: localResources.length,
          chainCount: matchData.result.chains || Object.keys(matchData.result.chainDetails || {}).length,
          matchResult: matchData.result
        };
        setProcessSummary(summaryData);
      } else {
        throw new Error(matchData.error || '匹配失败');
      }
    } catch (error) {
      console.error('Matching error:', error);
      alert('❌ 比对失败，请重试\n\n错误信息：' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      setIsProcessing(false);
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
    if (confidence >= 0.5) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
    return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto px-4 py-8">
        {/* 头部导航 */}
        <div className="flex items-center justify-between mb-8">
          <Link href="/">
            <Button
              variant="ghost"
              className="gap-2 hover:bg-slate-200 dark:hover:bg-slate-800 hover:shadow-sm transition-all duration-200"
            >
              <ArrowLeft className="w-4 h-4" />
              返回首页
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            映射校对工作台
          </h1>
          <div className="w-24" />
        </div>

        <div className="grid lg:grid-cols-2 gap-6 mb-6">
          {/* 左侧：Wiki 长图上传区域 */}
          <Card>
            <CardHeader>
              <CardTitle>Wiki 合成链长图</CardTitle>
              <CardDescription>
                从 Wiki URL 自动获取或上传合成链全家福长图
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* URL 输入 */}
              <div className="space-y-2">
                <div className="flex gap-2">
                  {/* 预设选择下拉 */}
                  <Select
                    value={selectedPresetUrl}
                    onValueChange={(value) => {
                      setSelectedPresetUrl(value);
                      setWikiUrl(value);
                    }}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="选择预设" />
                    </SelectTrigger>
                    <SelectContent>
                      {presetWikiUrls.map((preset) => (
                        <SelectItem key={preset.url} value={preset.url}>
                          {preset.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* URL 输入框 */}
                  <div className="flex-1 relative">
                    <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      placeholder="输入 Wiki 页面 URL..."
                      value={wikiUrl}
                      onChange={(e) => {
                        setWikiUrl(e.target.value);
                        // 清除预设选择（如果手动修改了URL）
                        if (!presetWikiUrls.some(p => p.url === e.target.value)) {
                          setSelectedPresetUrl('');
                        }
                      }}
                      className="pl-10"
                    />
                  </div>

                  {/* 获取按钮 */}
                  <Button
                    onClick={handleFetchWiki}
                    disabled={isFetchingWiki || !wikiUrl}
                  >
                    {isFetchingWiki ? '获取中...' : '获取图片'}
                  </Button>
                </div>
              </div>

              {/* 分隔线 */}
              <div className="relative flex items-center justify-between">
                <div className="flex-1">
                  <div className="absolute inset-0 left-0 right-16 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white dark:bg-slate-950 px-2 text-muted-foreground">
                      或手动上传
                    </span>
                  </div>
                </div>

                {/* 进度显示区域 */}
                {isFetchingWiki && fetchProgress && (
                  <div className="flex items-center gap-2 ml-4 text-sm min-w-[200px]">
                    {/* 流光动画文本 */}
                    <div className="relative px-3 py-1 rounded-full overflow-hidden bg-gradient-to-r from-blue-500 via-blue-600 to-blue-500 text-white font-medium animate-shimmer">
                      <span className="relative z-10 truncate flex items-center gap-2">
                        <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                        {fetchProgress}
                      </span>
                      {/* 流光效果 */}
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
                    </div>
                  </div>
                )}
              </div>

              {/* 文件上传区域 */}
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragActive
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                    : 'border-slate-300 dark:border-slate-700'
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={(e) => handleDrop(e, 'wiki')}
              >
                <Upload className="w-12 h-12 mx-auto mb-4 text-slate-400" />
                <div className="space-y-3">
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    拖拽 Wiki 长图到此处，或点击上传
                  </p>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => handleFileSelect(e, 'wiki')}
                    className="hidden"
                    id="wiki-upload"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="hover:bg-blue-50 dark:hover:bg-blue-950 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm transition-all duration-200"
                  >
                    <label htmlFor="wiki-upload" className="cursor-pointer">
                      选择文件
                    </label>
                  </Button>
                </div>
              </div>

              {/* 已获取的文件列表 */}
              {(fetchedWikiFiles.length > 0 || wikiFiles.length > 0) && (
                <div className="space-y-3">
                  {/* 通过URL获取的文件 - 图片预览模式 */}
                  {fetchedWikiFiles.length > 0 && (
                    <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">🌐</span>
                          <div>
                            <p className="font-medium text-blue-900 dark:text-blue-100">
                              从Wiki URL获取
                            </p>
                            <p className="text-xs text-blue-700 dark:text-blue-300">
                              {fetchedWikiFiles.length} 个文件
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setFetchedWikiFiles([]);
                            setFetchedWikiName('');
                          }}
                          className="h-8 w-8 p-0 hover:bg-red-100 dark:hover:bg-red-900 hover:text-red-600 dark:hover:text-red-400 transition-all duration-200"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                      {/* 图片缩略图网格 */}
                      <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto">
                        {fetchedWikiFiles.slice(0, 12).map((filename, index) => (
                          <WikiImagePreview
                            key={index}
                            filename={filename}
                            wikiName={fetchedWikiName}
                            onRemove={() => removeFetchedWikiFile(index)}
                          />
                        ))}
                        {fetchedWikiFiles.length > 12 && (
                          <div className="col-span-4 text-center text-xs text-blue-700 dark:text-blue-300">
                            还有 {fetchedWikiFiles.length - 12} 个文件...
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 手动上传的文件 */}
                  {wikiFiles.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        已手动上传 {wikiFiles.length} 个文件
                      </p>
                      {wikiFiles.map((file, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-800 rounded"
                        >
                          <span className="text-sm text-slate-700 dark:text-slate-300 truncate flex-1">
                            {file.name}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeWikiFile(index)}
                            className="h-8 w-8 p-0 hover:bg-red-100 dark:hover:bg-red-900 hover:text-red-600 dark:hover:text-red-400 transition-all duration-200"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Wiki处理按钮和进度 */}
              {(fetchedWikiFiles.length > 0 || wikiFiles.length > 0) && (
                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <Button
                      onClick={handleProcessWiki}
                      disabled={isProcessingWiki || wikiProcessed}
                      className={wikiProcessed ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}
                    >
                      {isProcessingWiki ? '裁切中...' : wikiProcessed ? '✓ 已裁切' : '开始裁切'}
                    </Button>
                    
                    {/* 🌟 使用调试台按钮 */}
                    <Button
                      onClick={() => window.open('/debug', '_blank')}
                      disabled={isProcessingWiki}
                      variant="outline"
                      size="sm"
                      className="border-purple-200 dark:border-purple-800 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950"
                    >
                      使用调试台
                    </Button>
                    
                    {wikiProcessed && (
                      <>
                        {/* 🌟 合成链数量 */}
                        <Badge variant="outline" className="bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800">
                          {chainCount} 条合成链
                        </Badge>
                        
                        {/* 图标数量 */}
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800">
                          {wikiImages.length} 个图标
                        </Badge>

                        {/* 🌟 下载按钮 */}
                        <Button
                          onClick={handleDownloadZip}
                          variant="outline"
                          size="sm"
                          className="ml-2 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950"
                        >
                          下载全部
                        </Button>
                      </>
                    )}
                  </div>
                  {wikiProcessingStep && (
                    <div className="flex items-center gap-2">
                      {/* 流光动画文本 */}
                      <div className="relative px-3 py-1.5 rounded-full overflow-hidden bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500 text-white text-sm font-medium">
                        <span className="relative z-10 truncate flex items-center gap-2">
                          <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                          {wikiProcessingStep}
                        </span>
                        {/* 流光效果 */}
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 右侧：本地资源上传区域 */}
          <Card>
            <CardHeader>
              <CardTitle>本地资源文件夹</CardTitle>
              <CardDescription>
                上传本地导出的游戏资源文件或整个文件夹
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 文件夹上传按钮 */}
              <div className="flex gap-2">
                <input
                  type="file"
                  // @ts-ignore - webkitdirectory is not in TypeScript types but works in browsers
                  webkitdirectory="true"
                  onChange={handleFolderSelect}
                  className="hidden"
                  id="folder-upload"
                />
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="flex-1 hover:bg-green-50 dark:hover:bg-green-950 hover:border-green-300 dark:hover:border-green-700 hover:shadow-sm transition-all duration-200"
                >
                  <label htmlFor="folder-upload" className="cursor-pointer">
                    📁 选择文件夹
                  </label>
                </Button>

                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => handleFileSelect(e, 'local')}
                  className="hidden"
                  id="local-upload"
                />
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="flex-1 hover:bg-green-50 dark:hover:bg-green-950 hover:border-green-300 dark:hover:border-green-700 hover:shadow-sm transition-all duration-200"
                >
                  <label htmlFor="local-upload" className="cursor-pointer">
                    📄 选择文件
                  </label>
                </Button>
              </div>

              {/* 文件夹信息 */}
              {localFolders.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    已选择 {localFolders.length} 个文件夹，共 {localFolders.reduce((sum, f) => sum + f.files.length, 0)} 个文件
                  </p>
                  {localFolders.map((folder, folderIndex) => (
                    <div
                      key={folderIndex}
                      className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800"
                    >
                      <div className="flex items-center gap-2 flex-1">
                        <span className="text-lg">📁</span>
                        <div className="flex-1">
                          <p className="font-medium text-green-900 dark:text-green-100 text-sm">
                            {folder.name}
                          </p>
                          <p className="text-xs text-green-700 dark:text-green-300">
                            {folder.files.length} 个文件
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setLocalFolders(prev => prev.filter((_, i) => i !== folderIndex))}
                        className="h-8 w-8 p-0 flex-shrink-0 hover:bg-red-100 dark:hover:bg-red-900 hover:text-red-600 dark:hover:text-red-400 transition-all duration-200"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {/* 单个文件上传区域 */}
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragActive
                    ? 'border-green-500 bg-green-50 dark:bg-green-950'
                    : 'border-slate-300 dark:border-slate-700'
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={(e) => handleDrop(e, 'local')}
              >
                <Upload className="w-12 h-12 mx-auto mb-4 text-slate-400" />
                <div className="space-y-3">
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    或拖拽资源文件/文件夹到此处
                  </p>
                </div>
              </div>

              {/* 已上传的单个文件列表 */}
              {localFiles.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    已选择 {localFiles.length} 个文件
                  </p>
                  <div className="max-h-40 overflow-y-auto space-y-2">
                    {localFiles.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-800 rounded"
                      >
                        <span className="text-sm text-slate-700 dark:text-slate-300 truncate flex-1">
                          {file.name}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeLocalFile(index)}
                          className="h-8 w-8 p-0 hover:bg-red-100 dark:hover:bg-red-900 hover:text-red-600 dark:hover:text-red-400 transition-all duration-200"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 本地资源处理按钮和进度 */}
              {(localFiles.length > 0 || localFolders.length > 0) && (
                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between mb-3">
                    <Button
                      onClick={handleProcessLocal}
                      disabled={isProcessingLocal || localProcessed}
                      className={localProcessed ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}
                    >
                      {isProcessingLocal ? '分析中...' : localProcessed ? '✓ 已分析' : '开始分析'}
                    </Button>
                    {localProcessed && (
                      <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800">
                        {localResources.length} 个物品
                      </Badge>
                    )}
                  </div>
                  {localProcessingStep && (
                    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 p-2 rounded">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                      <span>{localProcessingStep}</span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 比对按钮 */}
        <div className="flex flex-col items-center gap-4 mb-6">
          <Button
            size="lg"
            onClick={handleMatch}
            disabled={isProcessing || !wikiProcessed || !localProcessed}
            className={`${
              wikiProcessed && localProcessed
                ? 'bg-purple-600 hover:bg-purple-700'
                : 'bg-slate-400 hover:bg-slate-500'
            }`}
          >
            {isProcessing ? '比对中...' : '开始比对'}
          </Button>

          {/* 比对步骤提示 */}
          {!wikiProcessed && !localProcessed && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              请先完成Wiki裁切和本地资源分析
            </p>
          )}
          {wikiProcessed && !localProcessed && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Wiki已处理，请完成本地资源分析
            </p>
          )}
          {!wikiProcessed && localProcessed && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              本地资源已分析，请完成Wiki裁切
            </p>
          )}

          {/* 进度条 */}
          {isProcessing && (
            <div className="w-full max-w-md space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">{processingStep}</span>
                <span className="text-slate-600 dark:text-slate-400">{processingProgress}%</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${processingProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* 处理完成统计信息 */}
          {!isProcessing && wikiImages.length > 0 && localResources.length > 0 && (
            <div className="w-full max-w-2xl">
              <Card className="border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                      <CheckCircle className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100">
                        处理完成！
                      </h3>
                      <p className="text-sm text-blue-700 dark:text-blue-300">
                        已识别并切割所有图标
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-3 bg-white dark:bg-slate-800 rounded-lg">
                      <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                        {wikiImages.length}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        Wiki Icon
                      </div>
                    </div>
                    <div className="text-center p-3 bg-white dark:bg-slate-800 rounded-lg">
                      <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                        {localResources.length}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        本地物品
                      </div>
                    </div>
                    <div className="text-center p-3 bg-white dark:bg-slate-800 rounded-lg">
                      <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                        {processSummary?.chainCount || 0}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        合成链
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* 处理结果摘要 */}
          {mappings.length > 0 && !isProcessing && (
            <div className="w-full max-w-2xl">
              <Card className="border-green-200 dark:border-green-800 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
                      <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-green-900 dark:text-green-100">
                        处理完成！
                      </h3>
                      <p className="text-sm text-green-700 dark:text-green-300">
                        共找到 {mappings.length} 个匹配项
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-3 bg-white dark:bg-slate-800 rounded-lg">
                      <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                        {mappings.filter(m => m.confidence >= 0.8).length}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        高匹配度
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">
                        ≥80%
                      </div>
                    </div>
                    <div className="text-center p-3 bg-white dark:bg-slate-800 rounded-lg">
                      <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                        {mappings.filter(m => m.confidence >= 0.5 && m.confidence < 0.8).length}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        中匹配度
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">
                        50%-80%
                      </div>
                    </div>
                    <div className="text-center p-3 bg-white dark:bg-slate-800 rounded-lg">
                      <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                        {mappings.filter(m => m.confidence < 0.5).length}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        低匹配度
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">
                        &lt;50%
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 p-3 bg-white dark:bg-slate-800 rounded-lg">
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      💡 向下滚动查看详细的匹配结果和图片对比，低匹配度的项目请人工校对
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* 匹配结果区域 */}
        {mappings.length > 0 && (
          <Card id="match-results">
            <CardHeader>
              <CardTitle>匹配结果</CardTitle>
              <CardDescription>
                共找到 {mappings.length} 个匹配项
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {mappings.map((mapping, index) => {
                  const localResource = localResources.find(r => r.id === mapping.resourceId);
                  return (
                    <div
                      key={index}
                      className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg"
                    >
                      {/* 标题行 */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          {mapping.confidence >= 0.8 ? (
                            <CheckCircle className="w-5 h-5 text-green-500" />
                          ) : (
                            <AlertCircle className="w-5 h-5 text-yellow-500" />
                          )}
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            {localResource?.displayName || localResource?.filename}
                          </span>
                          <span className="text-slate-400">→</span>
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            {mapping.wikiName}
                          </span>
                        </div>
                        <Badge className={getConfidenceColor(mapping.confidence)}>
                          匹配度: {(mapping.confidence * 100).toFixed(1)}%
                        </Badge>
                      </div>

                      {/* 图片对比行 */}
                      <div className="flex gap-4 items-start">
                        {/* 本地图片 */}
                        <div className="flex-1">
                          <div className="text-xs text-slate-600 dark:text-slate-400 mb-2">本地图片</div>
                          <div className="w-24 h-24 bg-slate-200 dark:bg-slate-700 rounded-lg overflow-hidden flex items-center justify-center">
                            {localResource?.imageUrl ? (
                              <img
                                src={localResource.imageUrl}
                                alt={localResource.filename}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                }}
                              />
                            ) : null}
                            <span className="text-3xl hidden">🎮</span>
                          </div>
                        </div>

                        {/* Wiki图片 */}
                        <div className="flex-1">
                          <div className="text-xs text-slate-600 dark:text-slate-400 mb-2">Wiki清晰图</div>
                          <div className="w-24 h-24 bg-green-100 dark:bg-green-900 rounded-lg overflow-hidden flex items-center justify-center">
                            {mapping.wikiImageUrl ? (
                              <img
                                src={mapping.wikiImageUrl}
                                alt={mapping.wikiName}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                }}
                              />
                            ) : null}
                            {!mapping.wikiImageUrl && (
                              <span className="text-xs text-green-700 dark:text-green-300 text-center px-2">
                                无图片
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 处理总结对话框 */}
      {showSummary && processSummary && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle className="w-6 h-6 text-green-500" />
                    处理完成
                  </CardTitle>
                  <CardDescription>以下是本次处理的详细统计信息</CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSummary(false)}
                  className="h-8 w-8 p-0 hover:bg-slate-200 dark:hover:bg-slate-800 hover:shadow-sm transition-all duration-200"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* 基础统计 */}
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg text-center">
                  <FileImage className="w-8 h-8 mx-auto mb-2 text-blue-500" />
                  <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                    {processSummary.wikiImageCount}
                  </div>
                  <div className="text-sm text-blue-700 dark:text-blue-300">Wiki Icon</div>
                </div>

                <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg text-center">
                  <Package className="w-8 h-8 mx-auto mb-2 text-green-500" />
                  <div className="text-2xl font-bold text-green-900 dark:text-green-100">
                    {processSummary.localItemCount}
                  </div>
                  <div className="text-sm text-green-700 dark:text-green-300">本地物品</div>
                </div>

                <div className="p-4 bg-purple-50 dark:bg-purple-950 rounded-lg text-center">
                  <Link2 className="w-8 h-8 mx-auto mb-2 text-purple-500" />
                  <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                    {processSummary.chainCount}
                  </div>
                  <div className="text-sm text-purple-700 dark:text-purple-300">合成链</div>
                </div>
              </div>

              {/* 匹配结果 */}
              {processSummary.matchResult && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-orange-500" />
                    <h3 className="font-semibold text-lg">智能匹配结果</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                      <div className="text-sm text-slate-600 dark:text-slate-400 mb-1">匹配成功</div>
                      <div className="text-xl font-bold text-green-600">
                        {processSummary.matchResult.mappings.length}
                      </div>
                    </div>
                    <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                      <div className="text-sm text-slate-600 dark:text-slate-400 mb-1">高匹配度 (≥80%)</div>
                      <div className="text-xl font-bold text-green-600">
                        {processSummary.matchResult.mappings.filter((m: MappingRelation) => m.confidence >= 0.8).length}
                      </div>
                    </div>
                    <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                      <div className="text-sm text-slate-600 dark:text-slate-400 mb-1">缺图 (Wiki有本地无)</div>
                      <div className="text-xl font-bold text-red-600">
                        {processSummary.matchResult.missingImages}
                      </div>
                    </div>
                    <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                      <div className="text-sm text-slate-600 dark:text-slate-400 mb-1">多图 (本地有Wiki无)</div>
                      <div className="text-xl font-bold text-blue-600">
                        {processSummary.matchResult.extraImages}
                      </div>
                    </div>
                  </div>

                  {/* 匹配度分布 */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                      匹配度分布
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="w-24 text-sm text-slate-600 dark:text-slate-400">高匹配度</div>
                        <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500 transition-all"
                            style={{
                              width: `${(processSummary.matchResult.mappings.filter((m: MappingRelation) => m.confidence >= 0.8).length / Math.max(processSummary.matchResult.mappings.length, 1)) * 100}%`
                            }}
                          />
                        </div>
                        <div className="w-20 text-sm text-right text-slate-600 dark:text-slate-400">
                          {processSummary.matchResult.mappings.filter((m: MappingRelation) => m.confidence >= 0.8).length}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-24 text-sm text-slate-600 dark:text-slate-400">中匹配度</div>
                        <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-yellow-500 transition-all"
                            style={{
                              width: `${(processSummary.matchResult.mappings.filter((m: MappingRelation) => m.confidence >= 0.5 && m.confidence < 0.8).length / Math.max(processSummary.matchResult.mappings.length, 1)) * 100}%`
                            }}
                          />
                        </div>
                        <div className="w-20 text-sm text-right text-slate-600 dark:text-slate-400">
                          {processSummary.matchResult.mappings.filter((m: MappingRelation) => m.confidence >= 0.5 && m.confidence < 0.8).length}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-24 text-sm text-slate-600 dark:text-slate-400">低匹配度</div>
                        <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-red-500 transition-all"
                            style={{
                              width: `${(processSummary.matchResult.mappings.filter((m: MappingRelation) => m.confidence < 0.5).length / Math.max(processSummary.matchResult.mappings.length, 1)) * 100}%`
                            }}
                          />
                        </div>
                        <div className="w-20 text-sm text-right text-slate-600 dark:text-slate-400">
                          {processSummary.matchResult.mappings.filter((m: MappingRelation) => m.confidence < 0.5).length}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex gap-3 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setShowSummary(false)}
                  className="flex-1"
                >
                  关闭
                </Button>
                <Button
                  onClick={() => {
                    // 跳转到查阅大厅
                    window.location.href = '/gallery';
                  }}
                  className="flex-1"
                >
                  查看详细结果
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 调试台 Modal */}
      {showDebugModal && currentImageUrl && (
        <DebugModal
          imageUrl={currentImageUrl}
          isOpen={showDebugModal}
          onExport={handleDebugExport}
          onClose={() => setShowDebugModal(false)}
        />
      )}
    </div>
  );
}
