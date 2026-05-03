import React from 'react';
import { motion } from 'framer-motion';
import { Code2, Globe, Shield, Sparkles, Users, Zap } from 'lucide-react';

const features = [
    {
        title: "Piston Execution",
        description: "Run your code in a secure, sandboxed environment across 14+ different languages.",
        icon: Zap,
        color: "text-black",
        bg: "bg-[#00E5FF]"
    },
    {
        title: "Yjs CRDT Sync",
        description: "Industry-standard conflict resolution. Edit simultaneously with zero merge conflicts.",
        icon: Users,
        color: "text-black",
        bg: "bg-[#FFEB3B]"
    },
    {
        title: "Cloud Terminals",
        description: "Fully functional Unix terminals connected directly to your coding workspace.",
        icon: Code2,
        color: "text-black",
        bg: "bg-[#FF4081]"
    },
    {
        title: "Global Collaboration",
        description: "Share your room ID and start coding with anyone, anywhere in the world instantly.",
        icon: Globe,
        color: "text-black",
        bg: "bg-[#00E5FF]"
    },
    {
        title: "Secure Sandbox",
        description: "Your code runs in isolated containers. Security is baked into every execution.",
        icon: Shield,
        color: "text-black",
        bg: "bg-[#FFEB3B]"
    }
];

export const Features = () => {
    return (
        <section className="py-32 px-6 bg-[#f8f9fa] relative border-b-4 border-black" id="features">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col items-center text-center mb-20">
                    <motion.h2 
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-4xl md:text-6xl font-black mb-6 tracking-tight text-black uppercase"
                    >
                        Built for the <span className="bg-[#FF4081] px-4 border-4 border-black neo-shadow-sm inline-block rotate-[-2deg]">modern</span> developer.
                    </motion.h2>
                    <motion.p 
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.1 }}
                        className="text-black font-semibold text-lg max-w-2xl border-l-4 border-black pl-4 text-left mx-auto"
                    >
                        Every tool you need to build, test, and collaborate on world-class software, 
                        optimized for performance and developer experience.
                    </motion.p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {features.map((feature, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 30 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: i * 0.1 }}
                            className={`p-8 ${feature.bg} border-4 border-black neo-shadow-hover transition-all group`}
                        >
                            <div className={`w-16 h-16 border-4 border-black bg-white flex items-center justify-center mb-6 neo-shadow-sm`}>
                                <feature.icon className={`text-black stroke-[3]`} size={32} />
                            </div>
                            <h3 className="text-2xl font-black mb-3 text-black uppercase tracking-wider">{feature.title}</h3>
                            <p className="text-black font-semibold text-sm leading-relaxed border-t-4 border-black pt-4">
                                {feature.description}
                            </p>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
};
