/**
 * pages/AuthPage.jsx
 * Sign in / create account. The entry point to everything else.
 */

import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ArrowRight, LogIn, UserPlus } from 'lucide-react';

const inputClass =
    'bg-white border-4 border-black neo-shadow-sm h-14 text-lg font-mono focus-visible:ring-0 focus-visible:ring-offset-0 focus:bg-[#FFF9C4] rounded-none';
const labelClass = 'text-sm font-black text-black ml-1 uppercase tracking-widest';

const AuthPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { login, register, isAuthenticated, loading } = useAuth();

    const [signIn, setSignIn] = useState({ email: '', password: '' });
    const [signUp, setSignUp] = useState({ email: '', username: '', password: '' });
    const [busy, setBusy] = useState(false);

    // Where the user was headed before being bounced here.
    const next = location.state?.from || '/home';

    if (loading) return null;
    if (isAuthenticated) return <Navigate to={next} replace />;

    const submit = async (event, action) => {
        event.preventDefault();
        setBusy(true);
        try {
            await action();
            navigate(next, { replace: true });
        } catch (error) {
            toast.error(error.message || 'Something went wrong.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            className="min-h-screen text-black relative overflow-x-hidden bg-[linear-gradient(180deg,#FFF8DB_0%,#FFE8F2_45%,#E7F7FF_100%)]"
            style={{
                backgroundImage:
                    'radial-gradient(#00000022 1px, transparent 1px), linear-gradient(180deg,#FFF8DB 0%,#FFE8F2 45%,#E7F7FF 100%)',
                backgroundSize: '26px 26px, auto',
            }}
        >
            <div className="mx-auto w-full max-w-xl px-4 py-12">
                <Card className="border-4 border-black bg-[#fffdf5] neo-shadow overflow-hidden rounded-none shadow-[8px_8px_0_0_#000]">
                    <Tabs defaultValue="signin" className="w-full">
                        <TabsList className="grid w-full grid-cols-2 bg-[#fff3bf] border-b-4 border-black p-0 rounded-none h-14">
                            <TabsTrigger
                                value="signin"
                                className="data-[state=active]:bg-[#00E5FF] data-[state=active]:text-black text-black font-black uppercase tracking-widest border-r-4 border-transparent data-[state=active]:border-black rounded-none h-full transition-none"
                            >
                                Sign In
                            </TabsTrigger>
                            <TabsTrigger
                                value="signup"
                                className="data-[state=active]:bg-[#FF4081] data-[state=active]:text-black text-black font-black uppercase tracking-widest rounded-none h-full transition-none"
                            >
                                Create Account
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="signin" className="p-4 sm:p-6">
                            <form onSubmit={(e) => submit(e, () => login(signIn.email, signIn.password))}>
                                <CardHeader className="px-0 pt-0 pb-6 border-b-4 border-black mb-6 bg-[#dff9ff]">
                                    <div className="flex items-center gap-2 mb-2 p-6 pb-0">
                                        <LogIn className="text-black stroke-[3]" size={28} />
                                        <CardTitle className="text-3xl font-black tracking-tight text-black uppercase">
                                            Welcome Back
                                        </CardTitle>
                                    </div>
                                    <CardDescription className="text-black font-bold text-base px-6">
                                        Sign in to reach your rooms
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="px-2 sm:px-6 space-y-6">
                                    <div className="space-y-3">
                                        <Label htmlFor="signin-email" className={labelClass}>Email</Label>
                                        <Input
                                            id="signin-email"
                                            type="email"
                                            autoComplete="email"
                                            required
                                            value={signIn.email}
                                            onChange={(e) => setSignIn({ ...signIn, email: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div className="space-y-3">
                                        <Label htmlFor="signin-password" className={labelClass}>Password</Label>
                                        <Input
                                            id="signin-password"
                                            type="password"
                                            autoComplete="current-password"
                                            required
                                            value={signIn.password}
                                            onChange={(e) => setSignIn({ ...signIn, password: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                </CardContent>
                                <CardFooter className="px-2 sm:px-6 pt-6 pb-6">
                                    <Button
                                        type="submit"
                                        disabled={busy}
                                        className="w-full bg-[#00E5FF] hover:bg-[#00cfe6] text-black font-black py-8 text-xl uppercase tracking-widest border-4 border-black neo-shadow-hover rounded-none transition-none disabled:opacity-50"
                                    >
                                        {busy ? 'Signing in…' : 'Sign In'}
                                        <ArrowRight size={24} className="ml-2 stroke-[3]" />
                                    </Button>
                                </CardFooter>
                            </form>
                        </TabsContent>

                        <TabsContent value="signup" className="p-4 sm:p-6">
                            <form
                                onSubmit={(e) =>
                                    submit(e, () => register(signUp.email, signUp.username, signUp.password))
                                }
                            >
                                <CardHeader className="px-0 pt-0 pb-6 border-b-4 border-black mb-6 bg-[#FFD6E5]">
                                    <div className="flex items-center gap-2 mb-2 p-6 pb-0">
                                        <UserPlus className="text-black stroke-[3]" size={28} />
                                        <CardTitle className="text-3xl font-black tracking-tight text-black uppercase">
                                            Create Account
                                        </CardTitle>
                                    </div>
                                    <CardDescription className="text-black font-bold text-base px-6">
                                        Your rooms and their history stay tied to this account
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="px-2 sm:px-6 space-y-6">
                                    <div className="space-y-3">
                                        <Label htmlFor="signup-email" className={labelClass}>Email</Label>
                                        <Input
                                            id="signup-email"
                                            type="email"
                                            autoComplete="email"
                                            required
                                            value={signUp.email}
                                            onChange={(e) => setSignUp({ ...signUp, email: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div className="space-y-3">
                                        <Label htmlFor="signup-username" className={labelClass}>Display Name</Label>
                                        <Input
                                            id="signup-username"
                                            required
                                            minLength={2}
                                            maxLength={32}
                                            value={signUp.username}
                                            onChange={(e) => setSignUp({ ...signUp, username: e.target.value })}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div className="space-y-3">
                                        <Label htmlFor="signup-password" className={labelClass}>Password</Label>
                                        <Input
                                            id="signup-password"
                                            type="password"
                                            autoComplete="new-password"
                                            required
                                            minLength={10}
                                            value={signUp.password}
                                            onChange={(e) => setSignUp({ ...signUp, password: e.target.value })}
                                            className={inputClass}
                                        />
                                        <p className="text-xs font-bold uppercase tracking-widest text-black/60 ml-1">
                                            At least 10 characters
                                        </p>
                                    </div>
                                </CardContent>
                                <CardFooter className="px-2 sm:px-6 pt-6 pb-6">
                                    <Button
                                        type="submit"
                                        disabled={busy}
                                        className="w-full bg-[#FF4081] hover:bg-[#f50057] text-black font-black py-8 text-xl uppercase tracking-widest border-4 border-black neo-shadow-hover rounded-none transition-none disabled:opacity-50"
                                    >
                                        {busy ? 'Creating…' : 'Create Account'}
                                        <ArrowRight size={24} className="ml-2 stroke-[3]" />
                                    </Button>
                                </CardFooter>
                            </form>
                        </TabsContent>
                    </Tabs>
                </Card>
            </div>
        </div>
    );
};

export default AuthPage;
