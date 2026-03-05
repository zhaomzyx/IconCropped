import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Image as ImageIcon, LayoutGrid, FileText } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto px-4 py-12">
        {/* 头部 */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4 text-slate-900 dark:text-slate-100">
            合成游戏资源映射与可视化工具
          </h1>
          <p className="text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
            将 Wiki 上的合成链资源与本地导出的零散资源进行自动化拆解、对齐与替换
          </p>
        </div>

        {/* 功能卡片 */}
        <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          {/* 映射校对工作台 */}
          <Card className="hover:shadow-lg transition-shadow duration-300 border-2 hover:border-blue-300 dark:hover:border-blue-700">
            <CardHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
                  <ImageIcon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
                <CardTitle>映射校对工作台</CardTitle>
              </div>
              <CardDescription>
                上传本地资源和 Wiki 长图，自动切割与匹配，支持人工校对
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 dark:text-blue-400 mt-1">•</span>
                    <span>Wiki 长图自动切割与 OCR 文本提取</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 dark:text-blue-400 mt-1">•</span>
                    <span>智能名称匹配算法，自动关联资源</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 dark:text-blue-400 mt-1">•</span>
                    <span>可视化校对界面，拖拽绑定未匹配项</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 dark:text-blue-400 mt-1">•</span>
                    <span>一键替换本地混淆资源</span>
                  </li>
                </ul>
                <Link href="/workbench" className="block">
                  <Button className="w-full bg-blue-600 hover:bg-blue-700">
                    进入工作台
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* 可视化查阅大厅 */}
          <Card className="hover:shadow-lg transition-shadow duration-300 border-2 hover:border-green-300 dark:hover:border-green-700">
            <CardHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-3 bg-green-100 dark:bg-green-900 rounded-lg">
                  <LayoutGrid className="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
                <CardTitle>可视化查阅大厅</CardTitle>
              </div>
              <CardDescription>
                结构化展示所有合成链，支持搜索筛选与详情查看
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-green-500 dark:text-green-400 mt-1">•</span>
                    <span>瀑布流展示所有合成链，卡片化视图</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-500 dark:text-green-400 mt-1">•</span>
                    <span>多维度筛选：类型、等级、自定义标签</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-500 dark:text-green-400 mt-1">•</span>
                    <span>全局检索：支持中英文、模糊拼音搜索</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-500 dark:text-green-400 mt-1">•</span>
                    <span>树状图展示完整合成路径和数量</span>
                  </li>
                </ul>
                <Link href="/gallery" className="block">
                  <Button className="w-full bg-green-600 hover:bg-green-700">
                    进入查阅大厅
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 使用说明 */}
        <Card className="max-w-5xl mx-auto mt-8">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-lg">
                <FileText className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <CardTitle>使用流程</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-6 text-sm">
              <div className="space-y-2">
                <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                  <span className="w-6 h-6 flex items-center justify-center bg-blue-600 text-white rounded-full text-xs">1</span>
                  上传资源
                </div>
                <p className="text-slate-600 dark:text-slate-400 ml-8">
                  进入映射校对工作台，上传本地资源文件夹和 Wiki 合成链长图
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                  <span className="w-6 h-6 flex items-center justify-center bg-blue-600 text-white rounded-full text-xs">2</span>
                  智能映射
                </div>
                <p className="text-slate-600 dark:text-slate-400 ml-8">
                  系统自动切割图片、提取文本、匹配资源，人工校对未匹配项
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                  <span className="w-6 h-6 flex items-center justify-center bg-blue-600 text-white rounded-full text-xs">3</span>
                  查阅分析
                </div>
                <p className="text-slate-600 dark:text-slate-400 ml-8">
                  进入可视化查阅大厅，搜索筛选，查看合成链详情
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
