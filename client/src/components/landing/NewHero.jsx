import React, { useEffect, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import Lottie from 'lottie-react';
import { motion } from 'framer-motion';
import { ArrowRight, Code2, Sparkles, Zap } from 'lucide-react';

// A high-quality lottie animation for development/coding
const LOTTIE_URL = "https://assets9.lottiefiles.com/packages/lf20_m6cuL6.json";

export const NewHero = ({ onLaunch }) => {
    const containerRef = useRef(null);
    const titleRef = useRef(null);
    const subtitleRef = useRef(null);
    const ctaRef = useRef(null);
    const lottieRef = useRef(null);

    useGSAP(() => {
        const tl = gsap.timeline({ defaults: { ease: 'power4.out', duration: 1.5 } });

        tl.from(titleRef.current.querySelectorAll('.char'), {
            y: 100,
            opacity: 0,
            stagger: 0.05,
            delay: 0.5
        })
        .from(subtitleRef.current, {
            y: 30,
            opacity: 0,
        }, "-=1")
        .from(ctaRef.current, {
            scale: 0.8,
            opacity: 0,
            duration: 1
        }, "-=1.2")
        .from(lottieRef.current, {
            opacity: 0,
            scale: 0.9,
            duration: 2
        }, "-=1.5");
    }, { scope: containerRef });

    const title = "Collaborate. Create. Conquer.";
    const chars = title.split("");

    return (
        <section ref={containerRef} className="relative min-h-screen flex flex-col items-center justify-center pt-20 px-6 overflow-hidden bg-black text-white">
            {/* Background Gradients */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full pointer-events-none overflow-hidden">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full animate-pulse" />
                <div className="absolute bottom-[10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/10 blur-[120px] rounded-full" />
            </div>

            <div className="max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">
                {/* Left Content */}
                <div className="flex flex-col items-start space-y-8">
                    <motion.div 
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-blue-400 text-xs font-semibold tracking-wider uppercase"
                    >
                        <Zap size={14} className="fill-current" />
                        <span>v2.0 Now Live</span>
                    </motion.div>

                    <h1 ref={titleRef} className="text-6xl md:text-8xl font-black tracking-tight leading-[0.9] flex flex-wrap">
                        {chars.map((char, i) => (
                            <span key={i} className="char inline-block min-w-[0.2em]">
                                {char === " " ? "\u00A0" : char}
                            </span>
                        ))}
                    </h1>

                    <p ref={subtitleRef} className="text-lg md:text-xl text-slate-400 max-w-xl leading-relaxed">
                        Experience the world's most advanced collaborative coding environment. 
                        AI-powered assistance, real-time sync, and sandboxed execution—all in one place.
                    </p>

                    <div ref={ctaRef} className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
                        <button 
                            onClick={onLaunch}
                            className="group relative px-8 py-4 bg-white text-black font-bold rounded-xl transition-all hover:scale-105 active:scale-95 w-full sm:w-auto overflow-hidden"
                        >
                            <span className="relative z-10 flex items-center gap-2">
                                Launch Codespace <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                            </span>
                            <div className="absolute inset-0 bg-gradient-to-r from-blue-400 via-white to-purple-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                        
                        <a 
                            href="https://github.com/Prthmsh7/Dobby" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="px-8 py-4 bg-white/5 hover:bg-white/10 text-white font-semibold rounded-xl border border-white/10 transition-all w-full sm:w-auto text-center"
                        >
                            View Source
                        </a>
                    </div>

                    <div className="flex items-center gap-8 pt-8">
                        <div className="flex flex-col">
                            <span className="text-2xl font-bold">14+</span>
                            <span className="text-xs text-slate-500 uppercase tracking-widest">Languages</span>
                        </div>
                        <div className="w-[1px] h-8 bg-white/10" />
                        <div className="flex flex-col">
                            <span className="text-2xl font-bold">5ms</span>
                            <span className="text-xs text-slate-500 uppercase tracking-widest">Latency</span>
                        </div>
                        <div className="w-[1px] h-8 bg-white/10" />
                        <div className="flex flex-col">
                            <span className="text-2xl font-bold">100%</span>
                            <span className="text-xs text-slate-500 uppercase tracking-widest">Sandboxed</span>
                        </div>
                    </div>
                </div>

                {/* Right Visual */}
                <div ref={lottieRef} className="relative aspect-square w-full max-w-xl mx-auto lg:mr-0">
                    <div className="absolute inset-0 bg-blue-500/20 blur-[100px] rounded-full" />
                    <Lottie 
                        animationData={null} // We'll load via path
                        path={LOTTIE_URL}
                        loop={true}
                        className="w-full h-full relative z-10"
                    />
                </div>
            </div>
            
            {/* Scroll Indicator */}
            <motion.div 
                animate={{ y: [0, 10, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-slate-500"
            >
                <span className="text-[10px] uppercase tracking-[0.3em] font-medium">Scroll to explore</span>
                <div className="w-[1px] h-12 bg-gradient-to-b from-slate-500/50 to-transparent" />
            </motion.div>
        </section>
    );
};
