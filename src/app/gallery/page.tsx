'use client';

import { useState, useEffect } from 'react';
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Search, Filter, LayoutGrid, List, ChevronDown, X, AlertTriangle, CheckCircle, Image as ImageIcon, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { ResourceType, SynthesisChain } from '@/types';

// 自定义悬浮对比组件
const HoverPopover = ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = React.useRef<HTMLDivElement>(null);

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 8,
        left: rect.left + rect.width / 2 - 160, // 居中，假设宽度320px
      });
    }
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    setIsOpen(false);
  };

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ position: 'relative' }}
    >
      {children}
      {isOpen && (
        <div
          className="fixed z-50 bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 p-4 w-80"
          style={{
            top: `${position.top}px`,
            left: `${position.left}px`,
          }}
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
        >
          {content}
        </div>
      )}
    </div>
  );
};

export default function GalleryPage() {
  const [chains, setChains] = useState<SynthesisChain[]>([]);
  const [filteredChains, setFilteredChains] = useState<SynthesisChain[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedTypes, setSelectedTypes] = useState<ResourceType[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<{chainId: string, itemId: string} | null>(null);

  // 加载数据
  useEffect(() => {
    loadChains();
  }, []);

  // 应用筛选
  useEffect(() => {
    applyFilters();
  }, [chains, searchQuery, selectedTypes, selectedLevel]);

  const loadChains = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/upload');
      const data = await response.json();
      if (data.success) {
        setChains(data.chains);
      }
    } catch (error) {
      console.error('Failed to load chains:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const clearHistory = async () => {
    if (!confirm('确定要清空所有历史记录吗？此操作不可恢复！')) {
      return;
    }

    try {
      const response = await fetch('/api/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await response.json();
      if (data.success) {
        alert('历史记录已清空！');
        setChains([]);
        setFilteredChains([]);
      } else {
        alert('清空失败：' + (data.error || '未知错误'));
      }
    } catch (error) {
      console.error('Clear history error:', error);
      alert('清空失败，请重试');
    }
  };

  const applyFilters = () => {
    let filtered = [...chains];

    // 搜索筛选
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(chain =>
        chain.name.toLowerCase().includes(query) ||
        chain.baseName.toLowerCase().includes(query)
      );
    }

    // 类型筛选
    if (selectedTypes.length > 0) {
      filtered = filtered.filter(chain =>
        selectedTypes.includes(chain.type)
      );
    }

    // 等级筛选
    if (selectedLevel !== null) {
      filtered = filtered.filter(chain => chain.maxLevel === selectedLevel);
    }

    setFilteredChains(filtered);
  };

  const getTypeBadgeColor = (type: ResourceType) => {
    switch (type) {
      case ResourceType.SPAWNER:
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
      case ResourceType.ALIGN:
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
      case ResourceType.SIMPLE_OPT:
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300';
      default:
        return 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-300';
    }
  };

  const getTypeLabel = (type: ResourceType) => {
    switch (type) {
      case ResourceType.SPAWNER:
        return '生产器';
      case ResourceType.ALIGN:
        return '合成物';
      case ResourceType.SIMPLE_OPT:
        return '盲盒';
      default:
        return '未知';
    }
  };

  const toggleType = (type: ResourceType) => {
    setSelectedTypes(prev =>
      prev.includes(type)
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };

  // 获取可用的等级列表
  const availableLevels = Array.from(
    new Set(chains.map(chain => chain.maxLevel))
  ).sort((a, b) => a - b);

  // 检测合成链的差异
  const detectIssues = (chain: SynthesisChain) => {
    const issues: string[] = [];

    // 1. 检查本地图片缺失
    const missingImages = chain.items.filter(item => !item.imageUrl).length;
    if (missingImages > 0) {
      issues.push(`${missingImages}个物品缺少本地图片`);
    }

    return issues;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 dark:from-slate-950 dark:to-slate-900">
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
            可视化查阅大厅
          </h1>
          <Button
            variant="destructive"
            size="sm"
            onClick={clearHistory}
            className="gap-2 hover:bg-red-600 hover:shadow-sm transition-all duration-200"
          >
            <Trash2 className="w-4 h-4" />
            清空历史
          </Button>
        </div>

        {/* 搜索和筛选区域 */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex flex-col md:flex-row gap-4">
                {/* 搜索框 */}
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="搜索物品名称（支持中英文、模糊拼音）..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>

                {/* 筛选按钮 */}
                <Button
                  variant={showFilters ? 'default' : 'outline'}
                  onClick={() => setShowFilters(!showFilters)}
                  className="gap-2 hover:bg-blue-50 dark:hover:bg-blue-950 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm transition-all duration-200"
                >
                  <Filter className="w-4 h-4" />
                  筛选
                  <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                </Button>

                {/* 视图切换 */}
                <div className="flex gap-2">
                  <Button
                    variant={viewMode === 'grid' ? 'default' : 'outline'}
                    size="icon"
                    onClick={() => setViewMode('grid')}
                    className="hover:bg-slate-100 dark:hover:bg-slate-800 hover:shadow-sm transition-all duration-200"
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </Button>
                  <Button
                    variant={viewMode === 'list' ? 'default' : 'outline'}
                    size="icon"
                    onClick={() => setViewMode('list')}
                    className="hover:bg-slate-100 dark:hover:bg-slate-800 hover:shadow-sm transition-all duration-200"
                  >
                    <List className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* 筛选面板 */}
              {showFilters && (
                <div className="space-y-4 pt-4 border-t">
                  {/* 类型筛选 */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
                      资源类型
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {Object.values(ResourceType).filter(type => type !== ResourceType.UNKNOWN).map(type => (
                        <Badge
                          key={type}
                          variant={selectedTypes.includes(type) ? 'default' : 'outline'}
                          className="cursor-pointer"
                          onClick={() => toggleType(type)}
                        >
                          {getTypeLabel(type)}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* 等级筛选 */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
                      最高等级
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Badge
                        variant={selectedLevel === null ? 'default' : 'outline'}
                        className="cursor-pointer"
                        onClick={() => setSelectedLevel(null)}
                      >
                        全部
                      </Badge>
                      {availableLevels.map(level => (
                        <Badge
                          key={level}
                          variant={selectedLevel === level ? 'default' : 'outline'}
                          className="cursor-pointer"
                          onClick={() => setSelectedLevel(level)}
                        >
                          Lv.{level}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 统计信息 */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            显示 {filteredChains.length} / {chains.length} 条结果
          </p>
          {(searchQuery || selectedTypes.length > 0 || selectedLevel !== null) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setSelectedTypes([]);
                setSelectedLevel(null);
              }}
              className="hover:bg-slate-200 dark:hover:bg-slate-800 hover:shadow-sm transition-all duration-200"
            >
              清除筛选
            </Button>
          )}
        </div>

        {/* 物品展示区域 - 合成路径视图 */}
        {isLoading ? (
          <Card>
            <CardContent className="py-16 text-center">
              <p className="text-slate-500 dark:text-slate-400">加载中...</p>
            </CardContent>
          </Card>
        ) : chains.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <p className="text-slate-500 dark:text-slate-400 mb-4">
                暂无数据，请先在映射校对工作台上传资源
              </p>
              <Link href="/workbench">
                <Button className="hover:bg-green-600 hover:shadow-sm transition-all duration-200">
                  前往工作台上传
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : filteredChains.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <p className="text-slate-500 dark:text-slate-400">
                没有找到匹配的结果，请调整筛选条件
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {filteredChains.map((chain) => {
              const issues = detectIssues(chain);

              return (
                <Card
                  key={chain.id}
                  className={`transition-all duration-300 hover:shadow-lg ${
                    issues.length > 0 ? 'border-yellow-300 dark:border-yellow-700' : ''
                  }`}
                >
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CardTitle className="text-xl">{chain.name}</CardTitle>
                        <Badge className={getTypeBadgeColor(chain.type)}>
                          {getTypeLabel(chain.type)}
                        </Badge>
                        <Badge variant="outline">
                          Lv.{chain.maxLevel}
                        </Badge>
                        {issues.length > 0 && (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            {issues.length} 个问题
                          </Badge>
                        )}
                      </div>
                    </div>
                    {issues.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {issues.map((issue, idx) => (
                          <Badge key={idx} variant="outline" className="text-yellow-700 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            {issue}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardHeader>

                  <CardContent>
                    {/* 合成路径 - 水平滚动 */}
                    <div className="flex items-center gap-4 overflow-x-auto pb-4">
                      {chain.items.map((item, index) => (
                        <React.Fragment key={item.id}>
                          {/* 悬浮对比组件 */}
                          <HoverPopover
                            content={
                              <div className="space-y-4">
                                <div className="text-sm font-semibold">Lv.{item.level} - {item.displayName || item.filename}</div>

                                {/* Wiki图片 */}
                                <div>
                                  <div className="text-xs text-slate-600 dark:text-slate-400 mb-2 flex items-center gap-1">
                                    <ImageIcon className="w-3 h-3" />
                                    Wiki清晰图
                                    {item.wikiImageUrl && <CheckCircle className="w-3 h-3 text-green-500" />}
                                  </div>
                                  <div className="w-full h-40 bg-green-50 dark:bg-green-950 rounded-lg overflow-hidden flex items-center justify-center">
                                    {item.wikiImageUrl ? (
                                      <img
                                        src={item.wikiImageUrl}
                                        alt={item.filename}
                                        className="w-full h-full object-contain"
                                      />
                                    ) : (
                                      <span className="text-sm text-slate-500">无Wiki图片</span>
                                    )}
                                  </div>
                                </div>

                                {/* 本地图片 */}
                                <div>
                                  <div className="text-xs text-slate-600 dark:text-slate-400 mb-2 flex items-center gap-1">
                                    <ImageIcon className="w-3 h-3" />
                                    本地图片
                                    {item.imageUrl ? <CheckCircle className="w-3 h-3 text-green-500" /> : <AlertTriangle className="w-3 h-3 text-red-500" />}
                                  </div>
                                  <div className="w-full h-40 bg-slate-50 dark:bg-slate-800 rounded-lg overflow-hidden flex items-center justify-center">
                                    {item.imageUrl ? (
                                      <img
                                        src={item.imageUrl}
                                        alt={item.filename}
                                        className="w-full h-full object-contain"
                                      />
                                    ) : (
                                      <span className="text-sm text-slate-500">❌ 缺失本地图片</span>
                                    )}
                                  </div>
                                </div>

                                {/* 对比提示 */}
                                {item.wikiImageUrl && item.imageUrl && (
                                  <div className="text-xs text-slate-500 dark:text-slate-400">
                                    💡 鼠标悬浮可对比Wiki和本地图片的差异
                                  </div>
                                )}
                              </div>
                            }
                          >
                            <div className="flex flex-col items-center flex-shrink-0 cursor-pointer group">
                              <div className={`w-24 h-24 rounded-lg flex items-center justify-center overflow-hidden hover:shadow-md transition-all relative ${
                                item.wikiImageUrl ? 'bg-green-100 dark:bg-green-900' : 'bg-slate-200 dark:bg-slate-700'
                              } ${!item.imageUrl ? 'opacity-60' : ''}`}>
                                {item.wikiImageUrl ? (
                                  <img
                                    src={item.wikiImageUrl}
                                    alt={item.filename}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                      e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                    }}
                                  />
                                ) : null}
                                {!item.wikiImageUrl && (
                                  <span className="text-4xl">🎮</span>
                                )}
                                {!item.imageUrl && (
                                  <div className="absolute top-1 right-1">
                                    <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                                      缺失
                                    </Badge>
                                  </div>
                                )}
                              </div>
                              <div className="text-xs mt-2 font-medium text-slate-700 dark:text-slate-300">
                                Lv.{item.level}
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                {item.displayName || item.filename}
                              </div>
                              {item.wikiImageUrl && (
                                <Badge variant="default" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 text-[10px] h-5 px-1.5 mt-1">
                                  Wiki清晰图
                                </Badge>
                              )}
                            </div>
                          </HoverPopover>

                          {/* 箭头 */}
                          {index < chain.items.length - 1 && (
                            <div className="flex items-center text-slate-400 flex-shrink-0">
                              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                              </svg>
                            </div>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
