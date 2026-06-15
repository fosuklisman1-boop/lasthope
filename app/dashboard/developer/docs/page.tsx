'use client'

import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { API_DOCS_MARKDOWN } from '@/lib/api-docs'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

export default function DeveloperDocsPage() {
    return (
        <div className="max-w-4xl space-y-6">
            {/* Back navigation */}
            <div>
                <Link href="/dashboard/developer">
                    <Button variant="ghost" size="sm" className="gap-2 pl-0 text-muted-foreground hover:text-foreground">
                        <ArrowLeft className="w-4 h-4" />
                        Back to Developer API
                    </Button>
                </Link>
            </div>

            {/* Docs content */}
            <div className="prose prose-sm max-w-none dark:prose-invert
                prose-headings:font-bold prose-headings:tracking-tight
                prose-h1:text-2xl prose-h2:text-xl prose-h2:mt-8 prose-h3:text-base prose-h3:mt-6
                prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
                prose-pre:bg-muted prose-pre:border prose-pre:rounded-lg prose-pre:text-sm
                prose-table:text-sm prose-th:font-semibold
                prose-blockquote:border-l-4 prose-blockquote:border-yellow-400 prose-blockquote:bg-yellow-50 dark:prose-blockquote:bg-yellow-950/20 prose-blockquote:py-1 prose-blockquote:not-italic
                prose-a:text-yellow-600 hover:prose-a:text-yellow-700
                prose-strong:font-semibold
            ">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {API_DOCS_MARKDOWN}
                </ReactMarkdown>
            </div>
        </div>
    )
}
