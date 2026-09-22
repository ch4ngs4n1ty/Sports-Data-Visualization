/* One serial request per NFL game per page, shared by all subscribers.
   ESPN is still the source; five seconds is our polling interval, not its latency. */
(function(root) {
  function createNflLiveHub({fetch: request, normalize, document: doc, window: win,
    setTimeout: schedule = setTimeout, clearTimeout: cancel = clearTimeout, now = Date.now}) {
    const channels = new Map();
    function subscribe(eventId, listener) {
      const id = String(eventId);
      if (!/^\d+$/.test(id)) throw new Error('Invalid NFL event ID');
      let channel = channels.get(id);
      if (!channel) {
        const listeners = new Set();
        let timer, controller, latest, stopped = false, busy = false, failures = 0;
        let retryUntil = 0;
        const emit = update => {latest = {...latest,...update};for(const fn of listeners)fn(latest);};
        async function load() {
          if(stopped || busy || doc.hidden) return;
          cancel(timer);
          if(now()<retryUntil){timer=schedule(load,retryUntil-now());return;}
          busy=true;controller=new AbortController();
          const timeout=schedule(()=>controller.abort(),12000);
          let interval=5000;
          try {
            const response=await request(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`,{cache:'no-store',signal:controller.signal});
            if(!response.ok){
              const retry=response.headers?.get('Retry-After');
              const seconds=retry && /^\d+$/.test(retry)?Number(retry)*1000:Date.parse(retry)-now();
              if(Number.isFinite(seconds)&&seconds>0)retryUntil=now()+seconds;
              throw new Error('Feed unavailable');
            }
            const data=normalize(await response.json());
            if(stopped)return;
            failures=0;
            interval=data.final?60000:data.live?5000:30000;
            emit({data,status:'connected',interval,checkedAt:now()});
          } catch {
            if(stopped)return;
            interval=Math.min(60000,5000*2**Math.min(++failures,4));
            emit({status:'reconnecting',interval});
          } finally {
            cancel(timeout);busy=false;
            if(!stopped && !doc.hidden)timer=schedule(load,Math.max(interval,retryUntil-now()));
          }
        }
        const recover=()=>{cancel(timer);if(!doc.hidden)load();};
        doc.addEventListener('visibilitychange',recover);
        for(const event of ['online','pageshow','focus'])win.addEventListener(event,recover);
        channel={listeners,load,get latest(){return latest;},close(){stopped=true;cancel(timer);controller?.abort();doc.removeEventListener('visibilitychange',recover);for(const event of ['online','pageshow','focus'])win.removeEventListener(event,recover);channels.delete(id);}};
        channels.set(id,channel);
      }
      channel.listeners.add(listener);
      if(channel.latest)listener(channel.latest);
      if(channel.listeners.size===1)channel.load();
      return ()=>{channel.listeners.delete(listener);if(!channel.listeners.size)channel.close();};
    }
    return {subscribe};
  }
  root.createNflLiveHub=createNflLiveHub;
  if(typeof window!=='undefined') {
    const hub=createNflLiveHub({fetch:(...args)=>fetch(...args),normalize:d=>window.NflLive.normalize(d),document,window});
    root.subscribeNflLive=hub.subscribe;
  }
})(typeof window==='undefined'?module.exports:window);
