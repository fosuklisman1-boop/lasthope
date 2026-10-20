'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { API_DOCS_MARKDOWN } from '@/lib/api-docs'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { ArrowLeft, Rocket, Code2, AlertTriangle, Webhook, Wallet, type LucideIcon } from 'lucide-react'

// The project has no typography plugin, so the markdown is styled here.
// Code sits in pressed-in wells; blockquotes are lit with an amber edge.
const markdownComponents: Components = {
    h1: (props) => <h1 className="mb-4 text-3xl font-semibold tracking-tight" {...props} />,
    h2: (props) => <h2 className="mb-3 mt-10 border-b border-border pb-3 text-xl font-semibold tracking-tight first:mt-0" {...props} />,
    h3: (props) => <h3 className="mb-3 mt-8 text-base font-semibold text-foreground" {...props} />,
    h4: (props) => <h4 className="mb-2 mt-6 text-sm font-semibold text-foreground" {...props} />,
    p: (props) => <p className="my-4 leading-relaxed text-foreground/85" {...props} />,
    ul: (props) => <ul className="my-4 list-disc space-y-1.5 pl-6 text-foreground/85 marker:text-primary/60" {...props} />,
    ol: (props) => <ol className="my-4 list-decimal space-y-1.5 pl-6 text-foreground/85 marker:text-primary/60" {...props} />,
    li: (props) => <li className="leading-relaxed" {...props} />,
    a: (props) => <a className="font-medium text-primary hover:underline" {...props} />,
    strong: (props) => <strong className="font-semibold text-foreground" {...props} />,
    hr: () => <hr className="my-8 border-border" />,
    blockquote: (props) => (
        <blockquote
            className="my-6 rounded-r-2xl border-l-4 border-[hsl(var(--neon-amber))] bg-[hsl(var(--neon-amber)/0.08)] px-5 py-1 text-foreground/90 [&>p]:my-3"
            {...props}
        />
    ),
    pre: (props) => (
        <pre
            className="neo-inset my-5 overflow-x-auto rounded-2xl p-5 text-[13px] leading-relaxed [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-foreground/90"
            {...props}
        />
    ),
    code: (props) => (
        <code
            className="rounded-md bg-[hsl(var(--well))] px-1.5 py-0.5 font-mono text-[13px] text-[hsl(var(--neon-cyan))]"
            {...props}
        />
    ),
    table: (props) => (
        <div className="neo-inset my-6 overflow-x-auto rounded-2xl">
            <table className="w-full border-collapse text-left text-sm" {...props} />
        </div>
    ),
    th: (props) => <th className="border-b border-border px-4 py-3 font-semibold text-foreground" {...props} />,
    td: (props) => <td className="border-b border-border/60 px-4 py-3 align-top text-foreground/85 [tr:last-child>&]:border-0" {...props} />,
}

function Md({ children }: { children: string }) {
    return (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {children}
        </ReactMarkdown>
    )
}

// ── Splitting the reference into sections ─────────────────────────────────

interface SubSection { title: string; body: string }
interface Section { title: string; number: number | null; intro: string; subs: SubSection[]; raw: string }

/** Split markdown on headings of one level, ignoring "#" lines inside code fences. */
function splitOn(md: string, prefix: '## ' | '### '): { before: string; parts: { title: string; body: string }[] } {
    const parts: { title: string; lines: string[] }[] = []
    const before: string[] = []
    let inFence = false
    for (const line of md.split('\n')) {
        if (/^\s*```/.test(line)) inFence = !inFence
        if (!inFence && line.startsWith(prefix)) {
            parts.push({ title: line.slice(prefix.length).trim(), lines: [] })
        } else if (parts.length) {
            parts[parts.length - 1].lines.push(line)
        } else {
            before.push(line)
        }
    }
    return {
        before: before.join('\n'),
        parts: parts.map(p => ({ title: p.title, body: p.lines.join('\n').trim() })),
    }
}

function parseDocs(md: string): { head: string; sections: Section[] } {
    const { before, parts } = splitOn(md, '## ')
    const sections = parts
        .filter(p => p.title.toLowerCase() !== 'table of contents') // the tabs replace it
        .map<Section>(p => {
            const sub = splitOn(p.body, '### ')
            const num = /^(\d+)\./.exec(p.title)
            return {
                title: p.title.replace(/^\d+\.\s*/, ''),
                number: num ? Number(num[1]) : null,
                intro: sub.before.trim(),
                subs: sub.parts,
                raw: p.body,
            }
        })
    return { head: before.replace(/\n-{3,}\s*$/, '').trim(), sections }
}

interface Group { id: string; label: string; icon: LucideIcon; numbers: number[] }

const GROUPS: Group[] = [
    { id: 'start', label: 'Get started', icon: Rocket, numbers: [1, 2, 3, 4, 5] },
    { id: 'endpoints', label: 'Endpoints', icon: Code2, numbers: [6] },
    { id: 'errors', label: 'Errors', icon: AlertTriangle, numbers: [7] },
    { id: 'webhooks', label: 'Webhooks', icon: Webhook, numbers: [8] },
    { id: 'wallet', label: 'Wallet', icon: Wallet, numbers: [9] },
]

// ── Rendering ─────────────────────────────────────────────────────────────

const METHOD_STYLE: Record<string, string> = {
    GET: 'text-[hsl(var(--neon-mint))] bg-[hsl(var(--neon-mint)/0.12)]',
    POST: 'text-[hsl(var(--neon-cyan))] bg-[hsl(var(--neon-cyan)/0.12)]',
    PUT: 'text-[hsl(var(--neon-amber))] bg-[hsl(var(--neon-amber)/0.12)]',
    PATCH: 'text-[hsl(var(--neon-amber))] bg-[hsl(var(--neon-amber)/0.12)]',
    DELETE: 'text-[hsl(var(--neon-coral))] bg-[hsl(var(--neon-coral)/0.12)]',
}

function Endpoint({ title, compact = false }: { title: string; compact?: boolean }) {
    const m = /^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/.exec(title)
    if (!m) return <span>{title}</span>
    return (
        <span className="flex min-w-0 items-center gap-2">
            <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium', METHOD_STYLE[m[1]])}>
                {m[1]}
            </span>
            <span className={cn('truncate font-mono', compact ? 'text-xs' : 'text-base font-medium')}>{m[2]}</span>
        </span>
    )
}

/** A section with sub-sections: a side list on desktop, a scrolling row on mobile. */
function SectionRail({ section }: { section: Section }) {
    const [active, setActive] = useState(section.subs[0]?.title)

    return (
        <div className="space-y-6">
            {section.intro && <Md>{section.intro}</Md>}
            <Tabs value={active} onValueChange={setActive} orientation="vertical" className="grid gap-6 md:grid-cols-[18rem_minmax(0,1fr)]">
                <TabsList className="h-auto w-full scrollbar-hide justify-start gap-1 self-start overflow-x-auto p-2 md:flex-col md:items-stretch md:overflow-visible">
                    {section.subs.map(s => (
                        <TabsTrigger key={s.title} value={s.title} className="justify-start whitespace-nowrap px-3 py-2.5 text-left">
                            <Endpoint title={s.title} compact />
                        </TabsTrigger>
                    ))}
                </TabsList>
                <div className="min-w-0">
                    {section.subs.map(s => (
                        <TabsContent key={s.title} value={s.title} className="mt-0 focus-visible:outline-none">
                            <h3 className="mb-2 mt-0 text-base font-semibold"><Endpoint title={s.title} /></h3>
                            <Md>{s.body}</Md>
                        </TabsContent>
                    ))}
                </div>
            </Tabs>
        </div>
    )
}

function GroupBody({ sections }: { sections: Section[] }) {
    // A group that is a single section with sub-sections gets the side list.
    if (sections.length === 1 && sections[0].subs.length > 0) {
        return <SectionRail section={sections[0]} />
    }
    return (
        <>
            {sections.map(s => (
                <section key={s.title}>
                    <Md>{`## ${s.title}\n\n${s.raw}`}</Md>
                </section>
            ))}
        </>
    )
}

export default function DeveloperDocsPage() {
    const { head, sections } = useMemo(() => parseDocs(API_DOCS_MARKDOWN), [])

    const groups = useMemo(() => {
        const used = new Set<Section>()
        const out = GROUPS.map(g => {
            const items = sections.filter(s => s.number !== null && g.numbers.includes(s.number))
            items.forEach(s => used.add(s))
            return { ...g, items }
        }).filter(g => g.items.length > 0)
        // Anything the layout does not know about still shows up, under the first tab.
        const rest = sections.filter(s => !used.has(s))
        if (rest.length && out.length) out[0].items = [...out[0].items, ...rest]
        return out
    }, [sections])

    const [tab, setTab] = useState(groups[0]?.id ?? 'start')

    // Deep links: /dashboard/developer/docs#webhooks opens that tab.
    useEffect(() => {
        const fromHash = window.location.hash.replace('#', '')
        if (groups.some(g => g.id === fromHash)) setTab(fromHash)
    }, [groups])

    const handleTab = (value: string) => {
        setTab(value)
        window.history.replaceState(null, '', `#${value}`)
    }

    return (
        <div className="dev-page mx-auto max-w-5xl space-y-6">
            {/* Back navigation */}
            <div>
                <Button variant="ghost" size="sm" asChild className="gap-2 pl-2 text-muted-foreground hover:text-foreground">
                    <Link href="/dashboard/developer">
                        <ArrowLeft className="h-4 w-4" />
                        Back to Developer API
                    </Link>
                </Button>
            </div>

            <header className="max-w-3xl">
                <Md>{head}</Md>
            </header>

            <Tabs value={tab} onValueChange={handleTab} className="space-y-6">
                <div className="scrollbar-hide -mx-1 overflow-x-auto px-1 pb-3 pt-1">
                    <TabsList className="w-max">
                        {groups.map(g => (
                            <TabsTrigger key={g.id} value={g.id} className="gap-2 px-4">
                                <g.icon className="h-4 w-4" />
                                {g.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>

                {groups.map(g => (
                    <TabsContent key={g.id} value={g.id} className="mt-0 focus-visible:outline-none">
                        <Card className="p-6 sm:p-8">
                            <GroupBody sections={g.items} />
                        </Card>
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    )
}
