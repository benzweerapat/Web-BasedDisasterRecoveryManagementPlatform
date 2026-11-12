import React from 'react';
import { ArrowLeft, ArrowRight, LogIn, Ban, Zap, CalendarX, Check, CheckCheck, ChevronRight, Circle, CircleCheck, CircleAlert, CircleHelp, CircleMinus, CircleX, Clock, History, Database, Monitor, FileText, FolderOpen, FastForward, HardDrive, Info, Link, Unlink, Lock, Search, MemoryStick, Cpu, Pause, RefreshCw, Server, Shield, AlertTriangle, Timer, X, User, Copy } from 'lucide-react';

const icons = {
  'arrow-left':ArrowLeft,'arrow-right':ArrowRight,'arrow-right-to-bracket':LogIn,ban:Ban,bolt:Zap,'calendar-xmark':CalendarX,
  check:Check,'check-circle':CircleCheck,'check-double':CheckCheck,'chevron-right':ChevronRight,circle:Circle,
  'circle-check':CircleCheck,'circle-exclamation':CircleAlert,'circle-half-stroke':CircleAlert,'circle-info':Info,
  'circle-minus':CircleMinus,'circle-notch':RefreshCw,'circle-question':CircleHelp,'circle-xmark':CircleX,
  clock:Clock,'clock-rotate-left':History,database:Database,desktop:Monitor,'exclamation-triangle':AlertTriangle,
  file:FileText,'file-alt':FileText,'folder-open':FolderOpen,forward:FastForward,'hard-drive':HardDrive,hdd:HardDrive,
  'info-circle':Info,link:Link,'link-slash':Unlink,lock:Lock,'magnifying-glass':Search,memory:MemoryStick,microchip:Cpu,
  pause:Pause,'question-circle':CircleHelp,radiation:AlertTriangle,'rotate-right':RefreshCw,search:Search,server:Server,
  shield:Shield,'shield-halved':Shield,'skull-crossbones':AlertTriangle,spinner:RefreshCw,stopwatch:Timer,'sync-alt':RefreshCw,
  times:X,'times-circle':CircleX,'triangle-exclamation':AlertTriangle,user:User,vmware:Copy
};
// Render existing semantic icon names as bundled SVGs, independent of icon fonts.
export default function SemanticIcon({className='',...props}) {
  const names=className.split(/\s+/),name=names.find(n=>n.startsWith('fa-')&&icons[n.slice(3)]);
  const Icon=icons[name?.slice(3)]||Info;
  return <Icon width="1em" height="1em" aria-hidden="true" {...props} className={`inline-block shrink-0 align-middle ${names.filter(n=>!/^fa[srb]?$|^fa-/.test(n)).join(' ')} ${names.includes('fa-spin')?'animate-spin':''}`}/>;
}
