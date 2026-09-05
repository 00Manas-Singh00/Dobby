import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';

const StatsCard = ({ icon: Icon, label, value, color = "blue", delay = 0 }) => {
    const [count, setCount] = useState(0);

    useEffect(() => {
        const timeout = setTimeout(() => {
            const duration = 1000;
            const steps = 30;
            const increment = value / steps;
            let current = 0;

            const timer = setInterval(() => {
                current += increment;
                if (current >= value) {
                    setCount(value);
                    clearInterval(timer);
                } else {
                    setCount(Math.floor(current));
                }
            }, duration / steps);

            return () => clearInterval(timer);
        }, delay);

        return () => clearTimeout(timeout);
    }, [value, delay]);

    const colorClasses = {
        blue: 'from-blue-500 to-cyan-500',
        purple: 'from-purple-500 to-pink-500',
        green: 'from-green-500 to-emerald-500',
        orange: 'from-orange-500 to-red-500'
    };

    return (
        <Card className={`border-slate-700 bg-slate-800/50 backdrop-blur-sm overflow-hidden animate-slide-in-up`} style={{ animationDelay: `${delay}ms` }}>
            <CardContent className="p-6">
                <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-lg bg-gradient-to-br ${colorClasses[color]} shadow-lg`}>
                        <Icon size={24} className="text-white" />
                    </div>
                    <div>
                        <p className="text-2xl font-bold text-white tabular-nums">
                            {count.toLocaleString()}
                            {value >= 1000 && '+'}
                        </p>
                        <p className="text-sm text-slate-400">{label}</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

export default StatsCard;
