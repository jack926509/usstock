import React from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[999] flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white w-full max-w-xs rounded-[2rem] shadow-2xl p-8 transform transition-all scale-100 border border-white/50">
        <h3 className="text-xl font-bold text-slate-800 mb-6 text-center">{title}</h3>
        {children}
      </div>
    </div>
  );
};