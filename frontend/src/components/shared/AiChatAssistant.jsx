import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Database, Send, Trash2, X } from 'lucide-react';
import apiClient from '../../api/apiClient';

const STARTER_QUESTIONS = [
  'vCenter และ Host ตอนนี้มีสถานะอย่างไร',
  'มี SRM issue อะไรที่ต้องตรวจสอบ',
  'สรุปสถานะ Replication และ RPO'
];

function errorText(error) {
  return error?.response?.data?.error?.safeMessage || 'AI chat could not complete the request.';
}

export default function AiChatAssistant() {
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState([]);
  const [collectedAt, setCollectedAt] = useState(null);
  const endRef = useRef(null);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError('');
    try {
      const response = await apiClient.get('/ai/status');
      setConfigured(Boolean(response.data?.data?.configured));
    } catch {
      setConfigured(null);
      setStatusError('ไม่สามารถตรวจสอบสถานะ AI Chat ได้');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    window.addEventListener('inventory-cache-invalidated',loadStatus);
    return()=>window.removeEventListener('inventory-cache-invalidated',loadStatus);
  }, [loadStatus]);

  useEffect(() => {
    const scrollIntoView = endRef.current?.scrollIntoView;
    if (typeof scrollIntoView === 'function') scrollIntoView.call(endRef.current, { behavior: 'smooth' });
  }, [messages, sending]);

  const submit = async (text = question) => {
    const value = String(text || '').trim();
    if (!value || sending || !configured) return;
    const previous = messages.slice(-8).map(item => ({ role: item.role, content: item.content }));
    setMessages(current => [...current, { role: 'user', content: value }]);
    setQuestion('');
    setSending(true);
    try {
      const response = await apiClient.post('/ai/chat', { question: value, history: previous });
      const data = response.data?.data || {};
      setMessages(current => [...current, { role: 'assistant', content: data.answer || 'No answer returned.' }]);
      setCollectedAt(data.collectedAt || null);
    } catch (error) {
      setMessages(current => [...current, { role: 'assistant', content: errorText(error), error: true }]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50" data-ai-chat="read-only">
      {open && (
        <section className="mb-3 flex h-[min(620px,calc(100vh-110px))] w-[min(420px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" aria-label="VMware AI chat">
          <header className="flex items-center justify-between border-b border-slate-200 bg-[#0A0A0A] px-4 py-3 text-white">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FE5E37]"><Bot size={19} /></span>
              <div>
                <h2 className="text-sm font-semibold text-white">VMware AI assistant</h2>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/10" aria-label="Close AI chat"><X size={18} /></button>
          </header>

          {collectedAt && (
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-600">
              <div className="flex items-center gap-1.5"><Database size={13} />ข้อมูลล่าสุด {new Date(collectedAt).toLocaleString('th-TH')}</div>
            </div>
          )}

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {statusLoading && (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                กำลังตรวจสอบ AI Chat…
              </div>
            )}
            {!statusLoading && statusError && (
              <div className="rounded-xl border border-[#FE5E37]/30 bg-[#FE5E37]/5 p-3 text-sm text-slate-800">
                <p>{statusError}</p>
                <button type="button" onClick={loadStatus} className="mt-2 rounded-lg border border-[#FE5E37] px-3 py-1.5 text-xs font-semibold text-[#FE5E37] hover:bg-white">
                  ลองใหม่
                </button>
              </div>
            )}
            {!statusLoading && !statusError && configured === false && (
              <div className="rounded-xl border border-[#FE5E37]/30 bg-[#FE5E37]/5 p-3 text-sm text-slate-800">
                AI Chat ปิดอยู่ ผู้ดูแลต้องเปิดใช้งานตามคู่มือก่อน ข้อมูลที่ใช้ตอบจะส่งไปยังบริการ AI ภายนอก
              </div>
            )}
            {!statusLoading && configured && messages.length === 0 && (
              <div>
                <p className="mb-3 text-sm text-slate-600">คำถามและข้อมูล inventory ที่เลือกจะส่งไป Google Gemini ถามเฉพาะข้อมูลที่องค์กรอนุญาตให้ส่งออกได้</p>
                <div className="space-y-2">
                  {STARTER_QUESTIONS.map(item => <button key={item} type="button" onClick={() => submit(item)} className="block w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:border-[#FE5E37] hover:bg-slate-50">{item}</button>)}
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-6 ${message.role === 'user' ? 'bg-[#FE5E37] text-white' : message.error ? 'border border-[#FE5E37]/30 bg-[#FE5E37]/5 text-slate-800' : 'bg-slate-100 text-slate-800'}`}>{message.content}</div>
              </div>
            ))}
            {sending && <div className="w-fit rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-500">กำลังตรวจข้อมูล…</div>}
            <div ref={endRef} />
          </div>

          <footer className="border-t border-slate-200 p-3">
            <div className="flex items-end gap-2">
              <textarea value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={handleKeyDown} disabled={configured !== true || sending} maxLength={2000} rows={2} placeholder={statusLoading ? 'กำลังตรวจสอบ AI Chat…' : statusError ? 'ตรวจสอบสถานะ AI Chat ไม่สำเร็จ' : configured ? 'ถามเกี่ยวกับ VMware…' : 'AI chat ยังไม่พร้อม'} className="min-h-11 flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#FE5E37] disabled:bg-slate-100" />
              <button type="button" onClick={() => submit()} disabled={!configured || sending || !question.trim()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#FE5E37] text-white disabled:opacity-40" aria-label="Send question"><Send size={18} /></button>
            </div>
            {messages.length > 0 && <button type="button" onClick={() => { setMessages([]); setCollectedAt(null); }} className="mt-2 flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900"><Trash2 size={12} />ล้างบทสนทนา</button>}
          </footer>
        </section>
      )}
      <button type="button" onClick={() => setOpen(value => !value)} className="ml-auto flex h-13 items-center gap-2 rounded-full bg-[#0A0A0A] px-4 text-sm font-semibold text-white shadow-xl hover:bg-[#FE5E37]" aria-expanded={open} aria-label="Open VMware AI chat">
        <Bot size={19} /><span>AI chat</span>
      </button>
    </div>
  );
}
