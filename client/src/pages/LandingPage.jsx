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
            <div className="w-full bg-[#f8f9fa] text-black selection:bg-[#00E5FF] selection:text-black">
                {/* ── Navigation ────────────────────────────────────────────────── */}
                <nav className="fixed top-0 left-0 w-full z-50 px-6 py-6 border-b-4 border-black bg-white flex justify-between items-center transition-all duration-300">
                    <div className="flex items-center gap-2 group cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                        <div className="w-12 h-12 bg-[#FFEB3B] border-4 border-black neo-shadow flex items-center justify-center font-black text-2xl group-hover:rotate-12 transition-transform">
                            D
                        </div>
                        <span className="text-2xl font-black tracking-tighter uppercase">
                            Dobby<span className="text-[#FF4081]">.</span>
                        </span>
                    </div>

                    <div className="hidden md:flex space-x-10 text-sm font-black uppercase tracking-[0.2em] text-black">
                        <a href="#features" className="hover:text-[#FF4081] transition-colors hover:underline decoration-4 underline-offset-4">Features</a>
                        <a href="https://github.com/Prthmsh7/Dobby" target="_blank" rel="noopener noreferrer" className="hover:text-[#00E5FF] transition-colors flex items-center gap-1 hover:underline decoration-4 underline-offset-4">
                            Docs <ExternalLink size={14} className="stroke-[3]" />
                        </a>
                        <a href="https://github.com/Prthmsh7/Dobby" target="_blank" rel="noopener noreferrer" className="hover:text-[#FFEB3B] transition-colors hover:underline decoration-4 underline-offset-4">Source</a>
                    </div>

                    <button
                        onClick={handleLaunch}
                        className="px-8 py-3 bg-[#00E5FF] hover:bg-[#00B8D4] text-black text-sm font-black uppercase tracking-widest border-4 border-black neo-shadow-hover transition-all active:translate-y-1"
                    >
                        Launch
                    </button>
                </nav>

                {/* ── Hero Section ──────────────────────────────────────────────── */}
                <NewHero onLaunch={handleLaunch} />

                {/* ── Tech Stack Marquee ─────────────── */}
                <section className="py-12 border-y-4 border-black bg-[#FFEB3B] overflow-hidden">
                    <div className="max-w-7xl mx-auto px-6 flex flex-wrap justify-center gap-8 md:gap-16">
                        {['React', 'Node.js', 'Socket.IO', 'Yjs', 'Monaco', 'Xterm', 'Piston'].map((tech) => (
                            <span key={tech} className="text-xl md:text-3xl font-black uppercase tracking-[0.3em] text-black drop-shadow-[2px_2px_0px_#fff] whitespace-nowrap">{tech}</span>
                        ))}
                    </div>
                </section>

                {/* ── Features Section ──────────────────────────────────────────── */}
                <div id="features">
                    <Features />
                </div>

                {/* ── CTA Section ────────────────────────────────────────────────── */}
                <section className="py-32 px-6 bg-white border-y-4 border-black relative overflow-hidden">
                    {/* Brutalist BG pattern */}
                    <div className="absolute inset-0 pointer-events-none opacity-[0.1]" style={{ backgroundImage: 'radial-gradient(#000 2px, transparent 2px)', backgroundSize: '32px 32px' }} />

                    <div className="max-w-5xl mx-auto bg-[#FF4081] border-4 border-black neo-shadow p-12 md:p-24 flex flex-col items-center text-center relative z-10">
                        <motion.h2 
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            className="text-4xl md:text-7xl font-black mb-12 tracking-tighter text-black uppercase"
                        >
                            Ready to code at the <br /> 
                            <span className="bg-white px-4 border-4 border-black neo-shadow-sm inline-block mt-4 rotate-2">speed of light?</span>
                        </motion.h2>
                        
                        <button 
                            onClick={handleLaunch}
                            className="group relative px-12 py-6 bg-[#00E5FF] text-black font-black uppercase tracking-widest text-xl border-4 border-black neo-shadow-hover transition-all z-10 hover:bg-[#FFEB3B]"
                        >
                            Get Started for Free
                        </button>
                    </div>
                </section>

                {/* ── Footer ───────────────────────────────────────────────────── */}
                <footer className="py-20 px-6 bg-black text-white">
                    <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
                        <div className="col-span-1 md:col-span-2">
                            <div className="flex items-center gap-2 mb-6">
                                <div className="w-10 h-10 bg-white text-black flex items-center justify-center font-black text-xl">D</div>
                                <span className="text-2xl font-black tracking-tighter uppercase">Dobby.</span>
                            </div>
                            <p className="text-gray-400 max-w-sm text-sm leading-relaxed font-bold">
                                The ultimate collaborative IDE for modern developers. 
                                Built with love for the open-source community.
                            </p>
                        </div>
                        
                        <div>
                            <h4 className="text-sm font-black uppercase tracking-widest mb-6 border-b-2 border-white pb-2 inline-block">Platform</h4>
                            <ul className="space-y-4 text-sm font-bold text-gray-400 uppercase">
                                <li><a href="#" className="hover:text-[#FFEB3B] transition-colors hover:underline">Features</a></li>
                                <li><a href="#" className="hover:text-[#FF4081] transition-colors hover:underline">Architecture</a></li>
                                <li><a href="#" className="hover:text-[#00E5FF] transition-colors hover:underline">Security</a></li>
                            </ul>
                        </div>

                        <div>
                            <h4 className="text-sm font-black uppercase tracking-widest mb-6 border-b-2 border-white pb-2 inline-block">Connect</h4>
                            <div className="flex gap-4">
                                <a href="#" className="p-3 bg-white text-black border-2 border-transparent hover:border-white hover:bg-black hover:text-white transition-all"><Github size={20} strokeWidth={3} /></a>
                                <a href="#" className="p-3 bg-white text-black border-2 border-transparent hover:border-white hover:bg-black hover:text-white transition-all"><Twitter size={20} strokeWidth={3} /></a>
                                <a href="#" className="p-3 bg-white text-black border-2 border-transparent hover:border-white hover:bg-black hover:text-white transition-all"><Linkedin size={20} strokeWidth={3} /></a>
                            </div>
                        </div>
                    </div>
                    
                    <div className="max-w-7xl mx-auto pt-8 border-t-4 border-white flex flex-col md:flex-row justify-between items-center gap-4 text-xs uppercase tracking-widest font-black text-gray-500">
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
