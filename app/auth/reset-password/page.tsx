'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Mail, ArrowLeft, Activity } from 'lucide-react'
import { BackgroundBubbles } from '@/components/background-bubbles'
import { FloatingWhatsApp } from '@/components/floating-whatsapp'

export default function ResetPasswordPage() {
    const [email, setEmail] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState(false)
    const supabase = createClientComponentClient()

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setIsLoading(true)

        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/auth/update-password`,
            })

            if (error) {
                setError(error.message)
                return
            }

            setSuccess(true)
        } catch (err) {
            setError('An unexpected error occurred')
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="relative min-h-screen w-full flex flex-col items-center justify-center px-4 py-8 sm:py-10 overflow-y-auto">
            <BackgroundBubbles scrollable />
            <FloatingWhatsApp variant="auth" />

            <div className="w-full max-w-[380px] sm:max-w-md relative z-10 flex flex-col items-center">
                <div className="flex flex-col items-center mb-8 text-center px-4">
                    <div className="w-16 h-16 bg-gradient-to-br from-purple-600 to-indigo-700 rounded-2xl flex items-center justify-center shadow-2xl mb-4 transform hover:rotate-6 transition-transform">
                        <Activity className="w-10 h-10 text-white" />
                    </div>
                    <h1 className="text-3xl font-black text-slate-900 bg-clip-text text-transparent bg-gradient-to-r from-purple-600 to-indigo-600">LASTHOPE</h1>
                    <p className="text-slate-500 font-medium">No worries! We'll help you get back in.</p>
                </div>

                <Card className="w-full border-0 bg-[#EEEEEE]/30 backdrop-blur-md shadow-2xl rounded-2xl overflow-hidden">
                    <CardContent className="p-5 sm:p-6">
                        {!success ? (
                            <form onSubmit={handleSubmit} className="space-y-4">
                                {error && (
                                    <Alert variant="destructive" className="bg-red-500/10 border-red-500/50 py-2">
                                        <AlertDescription className="text-red-600 text-sm">{error}</AlertDescription>
                                    </Alert>
                                )}

                                <div className="space-y-1.5">
                                    <Label htmlFor="email" className="text-slate-700 font-semibold text-sm">Email Address</Label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                        <Input
                                            id="email"
                                            type="email"
                                            placeholder="your@email.com"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            required
                                            className="h-12 pl-11 bg-white/95 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-[#0056B3] focus:ring-[#0056B3]/20 rounded-xl text-base"
                                        />
                                    </div>
                                    <p className="text-xs text-slate-500 pt-1 px-1">
                                        We'll send you a secure link to reset your password.
                                    </p>
                                </div>

                                <Button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full sm:w-auto sm:min-w-[200px] sm:mx-auto h-12 text-base font-bold bg-sky-500 hover:bg-sky-600 text-white shadow-lg rounded-xl"
                                >
                                    {isLoading ? (
                                        <>
                                            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                            Sending link...
                                        </>
                                    ) : (
                                        'Send Reset Link'
                                    )}
                                </Button>
                            </form>
                        ) : (
                            <div className="text-center py-4">
                                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center mx-auto mb-4">
                                    <Mail className="w-8 h-8 text-white" />
                                </div>
                                <h2 className="text-xl font-bold text-slate-900 mb-2">Check Your Email</h2>
                                <p className="text-slate-600 text-sm">
                                    Reset link sent to <strong className="text-slate-900">{email}</strong>
                                </p>
                            </div>
                        )}

                        <div className="mt-6 border-t border-slate-300/50 pt-4 text-center">
                            <Link
                                href="/auth/login"
                                className="inline-flex items-center text-sm font-semibold text-[#0056B3] hover:text-[#004494] transition-colors"
                            >
                                <ArrowLeft className="w-4 h-4 mr-2" />
                                Back to Sign In
                            </Link>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
