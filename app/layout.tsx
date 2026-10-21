import type { Metadata, Viewport } from 'next'

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    themeColor: '#0f172a',
    interactiveWidget: 'resizes-content', // Helps with virtual keyboard handling
}
import { Fira_Sans, Fira_Code } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/contexts/auth-context'
import { Toaster } from '@/components/ui/sonner'
import { RolesProvider } from '@/components/providers/roles-provider'

const firaSans = Fira_Sans({
    weight: ['300', '400', '500', '600', '700'],
    subsets: ['latin'],
    display: 'swap'
})

// Keys, URLs and code samples
const firaCode = Fira_Code({
    weight: ['400', '500'],
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-fira-code',
})

export const metadata: Metadata = {
    title: 'LASTHOPE - Buy Cheap Data Bundles Online',
    description: 'LASTHOPE is the most reliable platform to buy cheap data bundles for MTN, Telecel, and AT in Ghana.',
    keywords: ['Ghana', 'mobile data', 'airtime', 'MTN', 'Telecel', 'AirtelTigo', 'data bundles'],
    authors: [{ name: 'LASTHOPE' }],
    openGraph: {
        title: 'LASTHOPE - Mobile Data & Airtime Platform',
        description: 'Purchase data packages for all Ghanaian networks',
        type: 'website',
    },
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="en" className="dark" suppressHydrationWarning>
            <body className={`${firaSans.className} ${firaCode.variable}`}>
                <RolesProvider>
                    <AuthProvider>
                        {children}
                        <Toaster position="top-right" richColors />
                    </AuthProvider>
                </RolesProvider>
            </body>
        </html>
    )
}
