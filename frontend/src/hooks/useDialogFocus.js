import {useEffect,useRef} from 'react';
export default function useDialogFocus(open,onClose){
 const ref=useRef(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{if(!open||!ref.current)return;const previous=document.activeElement,node=ref.current;
 const controls=()=>[...node.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(el=>!el.hidden);
 (controls()[0]||node).focus();
 const key=e=>{if(e.key==='Escape'){e.preventDefault();close.current?.();}if(e.key==='Tab'){const all=controls(),first=all[0],last=all.at(-1);if(!first){e.preventDefault();return;}if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
 node.addEventListener('keydown',key);return()=>{node.removeEventListener('keydown',key);previous?.focus?.();};
 },[open]);return ref;
}
