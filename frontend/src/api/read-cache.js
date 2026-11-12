export function createReadCache(){
 const values=new Map(),pending=new Map(),stale=new Set();let generation=0;
 return {
  // Return a copy so a component cannot mutate the shared in-memory value.
  peek:key=>values.has(key)?{...structuredClone(values.get(key)),stale:stale.has(key)}:undefined,
  // Keep the last successful response visible while a new collection is fetched.
  invalidate(){generation++;pending.clear();for(const key of values.keys())stale.add(key);},
  clear(){generation++;values.clear();pending.clear();stale.clear();},
  async read(key,loader,refresh=false){
   if(!refresh&&values.has(key)&&!stale.has(key))return structuredClone(values.get(key));
   if(pending.has(key))return pending.get(key).then(structuredClone);
   const epoch=generation;
   const task=Promise.resolve().then(loader).then(value=>{if(epoch===generation){values.set(key,structuredClone(value));stale.delete(key);}return value;});
   pending.set(key,task);
   try{return structuredClone(await task);}finally{if(pending.get(key)===task)pending.delete(key);}
  }
 };
}