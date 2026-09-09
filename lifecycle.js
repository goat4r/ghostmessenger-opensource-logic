export function createLifecycle(options={}){
 const native=globalThis;const clock=options.clock||{now:()=>Date.now(),setTimeout:(f,ms)=>native.setTimeout(f,ms),clearTimeout:id=>native.clearTimeout(id)};
 let active=false,disposed=false;const pending=new Map();
 const abort=()=>Object.assign(new Error('Operation stopped'),{name:'AbortError'});
 const emit=(name,data)=>{try{options[name]?.(data);}catch{}};
 return {clock,emit,get active(){return active;},begin(){if(disposed)throw Error('Engine disposed');active=true;},check(){if(!active)throw abort();},
  sleep(ms){if(!active)return Promise.reject(abort());return new Promise((resolve,reject)=>{const id=clock.setTimeout(()=>{pending.delete(id);if(active)resolve();else reject(abort());},Math.max(0,ms));pending.set(id,reject);});},
  stop(){active=false;for(const [id,reject] of pending){clock.clearTimeout(id);reject(abort());}pending.clear();},
  dispose(){this.stop();disposed=true;},error(e){if(e?.name!=='AbortError')emit('onError',{message:e.message});}
 };
}
export function requireDocument(options){const document=options.document||globalThis.document;if(!document?.defaultView)throw Error('A browser document with defaultView is required');return document;}
