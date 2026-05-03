import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

const FeatureCard = ({ icon: Icon, title, description, gradient }) => {
    return (
        <Card className="group relative overflow-hidden border-slate-700 bg-slate-800/50 backdrop-blur-sm hover:border-blue-500/50 transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/20 hover:-translate-y-1">
            <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-10 transition-opacity duration-300`} />
            <CardContent className="p-6 relative">
                <div className="mb-4 inline-flex p-3 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 text-blue-400 group-hover:scale-110 transition-transform duration-300">
                    <Icon size={24} />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-blue-400 transition-colors">
                    {title}
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                    {description}
                </p>
            </CardContent>
        </Card>
    );
};

export default FeatureCard;
