import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { SmoothScroll } from '@/components/landing/SmoothScroll';
import { NewHero } from '@/components/landing/NewHero';
import { Features } from '@/components/landing/Features';
import { Github, Twitter, Linkedin, ExternalLink } from 'lucide-react';

const LandingPage = () => {
    const navigate = useNavigate();

    const handleLaunch = () => {
        navigate('/home');
    };

    return (
        <SmoothScroll>
            <div className="w-full bg-black text-white selection:bg-blue-500/30 selection:text-white">
                {/* ── Navigation ────────────────────────────────────────────────── */}
                <nav className="fixed top-0 left-0 w-full z-50 px-6 py-6 border-b border-white/5 bg-black/50 backdrop-blur-xl flex justify-between items-center transition-all duration-300">
                    <div className="flex items-center gap-2 group cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center font-black text-xl group-hover:rotate-12 transition-transform shadow-[0_0_20px_rgba(37,99,235,0.4)]">
                            D
                        </div>
                        <span className="text-xl font-black tracking-tighter uppercase">
                            Dobby<span className="text-blue-500">.</span>
                        </span>
                    </div>

                    <div className="hidden md:flex space-x-10 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                        <a href="#features" className="hover:text-white transition-colors">Features</a>
                        <a href="https://github.com/Prthmsh7/Dobby" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors flex items-center gap-1">
                            Docs <ExternalLink size={12} />
                        </a>
                        <a href="https://github.com/Prthmsh7/Dobby" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Source</a>
                    </div>

                    <button
                        onClick={handleLaunch}
                        className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase tracking-widest rounded-lg transition-all shadow-[0_0_20px_rgba(37,99,235,0.2)] active:scale-95"
                    >
                        Launch
                    </button>
                </nav>

                {/* ── Hero Section ──────────────────────────────────────────────── */}
                <NewHero onLaunch={handleLaunch} />

                {/* ── Tech Stack Marquee (Apt for a coding platform) ─────────────── */}
                <section className="py-10 border-y border-white/5 bg-white/[0.02]">
                    <div className="max-w-7xl mx-auto px-6 flex flex-wrap justify-center gap-8 md:gap-16 opacity-30 grayscale hover:grayscale-0 transition-all duration-500">
                        {['React', 'Node.js', 'Socket.IO', 'Yjs', 'Gemini AI', 'Monaco', 'Xterm', 'Piston'].map((tech) => (
                            <span key={tech} className="text-sm font-black uppercase tracking-[0.3em]">{tech}</span>
                        ))}
                    </div>
                </section>

                {/* ── Features Section ──────────────────────────────────────────── */}
                <div id="features">
                    <Features />
                </div>

                {/* ── CTA Section ────────────────────────────────────────────────── */}
                <section className="py-32 px-6">
                    <div className="max-w-5xl mx-auto rounded-3xl bg-gradient-to-br from-blue-600/20 via-purple-600/10 to-transparent border border-white/10 p-12 md:p-24 flex flex-col items-center text-center overflow-hidden relative">
                        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,rgba(37,99,235,0.1),transparent)]" />
                        
                        <motion.h2 
                            initial={{ opacity: 0, scale: 0.9 }}
                            whileInView={{ opacity: 1, scale: 1 }}
                            className="text-4xl md:text-7xl font-black mb-8 tracking-tighter relative z-10"
                        >
                            Ready to code at the <br /> 
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">speed of light?</span>
                        </motion.h2>
                        
                        <button 
                            onClick={handleLaunch}
                            className="group relative px-12 py-5 bg-white text-black font-black rounded-2xl transition-all hover:scale-105 active:scale-95 overflow-hidden z-10 shadow-2xl shadow-blue-500/20"
                        >
                            Get Started for Free
                        </button>
                    </div>
                </section>

                {/* ── Footer ───────────────────────────────────────────────────── */}
                <footer className="py-20 px-6 border-t border-white/5">
                    <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
                        <div className="col-span-1 md:col-span-2">
                            <div className="flex items-center gap-2 mb-6">
                                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-black text-lg">D</div>
                                <span className="text-xl font-black tracking-tighter uppercase">Dobby</span>
                            </div>
                            <p className="text-slate-500 max-w-sm text-sm leading-relaxed">
                                The ultimate collaborative IDE for modern developers. 
                                Built with love for the open-source community.
                            </p>
                        </div>
                        
                        <div>
                            <h4 className="text-xs font-black uppercase tracking-widest mb-6">Platform</h4>
                            <ul className="space-y-4 text-sm text-slate-400">
                                <li><a href="#" className="hover:text-white transition-colors">Features</a></li>
                                <li><a href="#" className="hover:text-white transition-colors">Architecture</a></li>
                                <li><a href="#" className="hover:text-white transition-colors">Security</a></li>
                            </ul>
                        </div>

                        <div>
                            <h4 className="text-xs font-black uppercase tracking-widest mb-6">Connect</h4>
                            <div className="flex gap-4">
                                <a href="#" className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-all"><Github size={18} /></a>
                                <a href="#" className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-all"><Twitter size={18} /></a>
                                <a href="#" className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-all"><Linkedin size={18} /></a>
                            </div>
                        </div>
                    </div>
                    
                    <div className="max-w-7xl mx-auto pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] uppercase tracking-widest font-bold text-slate-600">
                        <span>© 2026 Dobby Collaborative IDE — All Rights Reserved.</span>
                        <div className="flex gap-8">
                            <a href="#" className="hover:text-white transition-colors">Privacy</a>
                            <a href="#" className="hover:text-white transition-colors">Terms</a>
                        </div>
                    </div>
                </footer>
            </div>
        </SmoothScroll>
    );
};

export default LandingPage;
