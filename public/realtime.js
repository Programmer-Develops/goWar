async function initializeRoomRealtime() {
  try {
    const configResponse = await fetch('/api/config', { cache: 'no-store' });
    if (!configResponse.ok) return;
    const config = await configResponse.json();
    const realtime = config.realtime;
    if (!realtime?.url || !realtime?.publishableKey) return;

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const client = createClient(realtime.url, realtime.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    let channel = null;
    let activeCode = null;
    let activeCallback = null;

    window.goWarRealtime = {
      subscribe(code, callback) {
        if (activeCode === code && channel) { activeCallback = callback; return; }
        if (channel) client.removeChannel(channel);
        activeCode = code;
        activeCallback = callback;
        channel = client.channel(`gowar:${code}`, { config: { broadcast: { self: false, ack: false } } })
          .on('broadcast', { event: 'state' }, (message) => activeCallback?.(message.payload))
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') activeCallback?.({ connected: true });
          });
      },
      unsubscribe() {
        if (channel) client.removeChannel(channel);
        channel = null;
        activeCode = null;
        activeCallback = null;
      },
    };
    window.dispatchEvent(new Event('gowar-realtime-ready'));
  } catch {
    // The room API's polling fallback remains active when Realtime is unavailable.
  }
}

initializeRoomRealtime();
