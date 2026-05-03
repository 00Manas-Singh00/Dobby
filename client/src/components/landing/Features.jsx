import React from 'react';
import { motion } from 'framer-motion';
import { Code2, Globe, Shield, Sparkles, Users, Zap } from 'lucide-react';

const features = [
    {
        title: "AI Pair Programmer",
        description: "Built-in Gemini AI that explains code, fixes bugs, and completes snippets in real-time.",
        icon: Sparkles,
        color: "text-amber-400",
        bg: "bg-amber-400/10"
    },
    {
        title: "Piston Execution",
        description: "Run your code in a secure, sandboxed environment across 14+ different languages.",
        icon: Zap,
        color: "text-blue-400",
        bg: "bg-blue-400/10"
    },
    {
        title: "Yjs CRDT Sync",
        description: "Industry-standard conflict resolution. Edit simultaneously with zero merge conflicts.",
        icon: Users,
        color: "text-green-400",
        bg: "bg-green-400/10"
    },
    {
        title: "Cloud Terminals",
        description: "Fully functional Unix terminals connected directly to your coding workspace.",
        icon: Code2,
        color: "text-purple-400",
        bg: "bg-purple-400/10"
    },
    {
        title: "Global Collaboration",
        description: "Share your room ID and start coding with anyone, anywhere in the world instantly.",
        icon: Globe,
        color: "text-pink-400",
        bg: "bg-pink-400/10"
    },
    {
        title: "Secure Sandbox",
        description: "Your code runs in isolated containers. Security is baked into every execution.",
        icon: Shield,
        color: "text-indigo-400",
        bg: "bg-indigo-400/10"
    }
];

export const Features = () => {
    return (
        <section className="py-32 px-6 bg-black relative">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col items-center text-center mb-20">
                    <motion.h2 
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-4xl md:text-6xl font-black mb-6 tracking-tight"
                    >
                        Built for the <span className="text-blue-500">modern</span> developer.
                    </motion.h2>
                    <motion.p 
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.1 }}
                        className="text-slate-400 text-lg max-w-2xl"
                    >
                        Every tool you need to build, test, and collaborate on world-class software, 
                        optimized for performance and developer experience.
                    </motion.p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {features.map((feature, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 30 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: i * 0.1 }}
                            whileHover={{ y: -5 }}
                            className="p-8 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-blue-500/50 hover:bg-white/[0.05] transition-all group"
                        >
                            <div className={`w-12 h-12 rounded-xl ${feature.bg} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                                <feature.icon className={`${feature.color}`} size={24} />
                            </div>
                            <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                            <p className="text-slate-400 text-sm leading-relaxed">
                                {feature.description}
                            </p>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
};
