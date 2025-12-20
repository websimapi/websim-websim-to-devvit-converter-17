export const getMainTsx = (title, webviewPath) => `/** @jsx Devvit.createElement */
/** @jsxFrag Devvit.Fragment */

import { Devvit, useState, useChannel } from '@devvit/public-api';

Devvit.configure({
  redditAPI: true,
  redis: true,
  realtime: true,
});

Devvit.addCustomPostType({
  name: 'WebSim Game',
  height: 'tall',
  render: (context) => {
    const [key, setKey] = useState(0);
    
    // Realtime Channel Bridge
    const channel = useChannel({
      name: 'websim_global',
      onMessage: (msg) => {
        // Forward realtime events to WebView
        // We use JSON.stringify for maximum compatibility with Android/WebViews
        context.ui.webView.postMessage('gameview', JSON.stringify({
          type: 'WEBSIM_SOCKET_EVT',
          payload: msg
        }));
      },
    });

    // Subscribe on mount
    channel.subscribe();

    return (
      <vstack height="100%" width="100%" alignment="center middle">
        <webview
          id="gameview"
          grow
          url="index.html"
          width="100%"
          height="100%"
          key={key.toString()}
          onMessage={async (event) => {
            // Handle incoming messages from WebView (Client)
            // Note: msg might be a string or object depending on environment, so we try to parse if string
            let msg = event as any;
            if (typeof msg === 'string') {
                try { msg = JSON.parse(msg); } catch(e) {}
            }

            // 1. Handle Realtime Sends from WebView
            if (msg.type === 'WEBSIM_SOCKET_MSG') {
               const { type, payload, senderId } = msg.payload || {};

               // A. Database Operations (Redis Bridge)
               if (type === 'db_op') {
                 // payload: { cmd: 'create'|'update'|'delete', collection: string, data: object }
                 const redisKey = \`websim:data:\${payload.collection}\`;
                 
                 (async () => {
                   try {
                     if (payload.cmd === 'create' || payload.cmd === 'update') {
                        // Store in Redis Hash
                        await context.redis.hSet(redisKey, { [payload.data.id]: JSON.stringify(payload.data) });
                     } else if (payload.cmd === 'delete') {
                        await context.redis.hDel(redisKey, [payload.data.id]);
                     }
                     
                     // Broadcast change to all clients (Sync) via Realtime
                     try {
                        await channel.send({
                            type: 'db_sync',
                            collection: payload.collection,
                            op: payload 
                        });
                     } catch (sendErr) {
                         // Swallowing 'not connected' errors during early initialization
                         // This prevents app crash if the WebView loads faster than Realtime connects
                         if (String(sendErr).includes('not connected')) {
                             console.warn('Realtime channel not ready yet. Sync broadcast skipped.');
                         } else {
                             throw sendErr;
                         }
                     }
                   } catch(e) {
                     console.error('Redis DB Error:', e);
                   }
                 })();
                 return;
               }

               // B. Initial Data Load Request
               if (type === 'db_load') {
                  const redisKey = \`websim:data:\${payload.collection}\`;
                  (async () => {
                    try {
                      const data = await context.redis.hGetAll(redisKey);
                      // Send back to THIS client only
                      context.ui.webView.postMessage('gameview', JSON.stringify({
                        type: 'WEBSIM_SOCKET_EVT',
                        payload: {
                          type: 'db_dump',
                          collection: payload.collection,
                          data: data || {} 
                        }
                      }));
                    } catch(e) {
                      console.error('Redis Load Error:', e);
                    }
                  })();
                  return;
               }

               // C. Standard Realtime Relay
               try {
                   await channel.send(msg.payload);
               } catch (e) {
                   // Ignore not connected errors
                   if (!String(e).includes('not connected')) {
                       console.warn('Realtime relay failed:', e);
                   }
               }
            }
            
            // 2. Handle Console Logs
            if (msg.type === 'console' && msg.args) {
              const prefix = '[Web]';
              const args = [prefix, ...(msg.args || [])];
              if (msg.level === 'error') console.error(...args);
              else if (msg.level === 'warn') console.warn(...args);
              else if (msg.level === 'info') console.log(...args);
              else console.log(...args);
            }
          }}
        />
        <vstack padding="medium" gap="medium">
            <button icon="refresh" onPress={() => setKey(k => k + 1)}>Reload Game</button>
            <text size="small" color="neutral-content-weak">Logs are piped to terminal</text>
        </vstack>
      </vstack>
    );
  },
});

Devvit.addMenuItem({
  label: 'Create ${title.replace(/'/g, "\\'")}',
  location: 'subreddit',
  onPress: async (_event, context) => {
    const { reddit, ui } = context;
    try {
      const subreddit = await reddit.getCurrentSubreddit();
      const post = await reddit.submitPost({
        title: '${title.replace(/'/g, "\\'")}',
        subredditName: subreddit.name,
        preview: (
          <vstack height="100%" width="100%" alignment="center middle">
            <text size="large">Loading Game...</text>
          </vstack>
        ),
      });
      ui.showToast('Game created!');
      ui.navigateTo(post);
    } catch (error) {
      console.error('Error creating post:', error);
      ui.showToast('Failed to create game post');
    }
  },
});

export default Devvit;
`;

