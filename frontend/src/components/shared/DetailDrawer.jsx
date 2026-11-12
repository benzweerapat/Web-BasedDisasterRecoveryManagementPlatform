import Button from './Button';
import React, { useId } from 'react';
import useDialogFocus from '../../hooks/useDialogFocus';
import { X } from 'lucide-react';

export default function DetailDrawer({ isOpen, onClose, title, children, widthClassName = 'md:w-[600px]' }) {
  const drawerRef = useDialogFocus(isOpen,onClose);
  const titleId=useId();

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Drawer */}
      <div 
        ref={drawerRef}
        tabIndex={-1}
        className={`fixed inset-y-0 right-0 w-full ${widthClassName} bg-white shadow-2xl z-50 transform transition-transform duration-300 flex flex-col`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h2 id={titleId} className="text-xl font-bold text-slate-800">
            {title}
          </h2>
          <Button 
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors"
            aria-label="Close details"
          >
            <X size={19} aria-hidden="true" />
          </Button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
          {children}
        </div>
      </div>
    </>
  );
}
