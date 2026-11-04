import React from 'react';
import { Navigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { FileText } from 'lucide-react';

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f1ece4] flex flex-col items-center justify-center p-6">
        <motion.div
          animate={{
            y: [-8, 8, -8],
            rotate: [-3, 3, -3],
            scale: [0.98, 1.02, 0.98],
          }}
          transition={{
            duration: 2.2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          className="w-20 h-24 bg-white rounded-2xl shadow-xl border-2 border-[#141414] flex flex-col items-center justify-center relative p-3"
        >
          <div className="w-10 h-2 bg-[#ff6a2b] rounded-full mb-3" />
          <FileText className="w-8 h-8 text-[#4a6cf0]" />
          <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-[#ffd23f] border-2 border-[#141414] flex items-center justify-center shadow-sm">
            <span className="text-xs font-black">✦</span>
          </div>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-6 font-bold text-[#141414] text-lg tracking-tight"
        >
          Chargement de votre espace…
        </motion.p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
