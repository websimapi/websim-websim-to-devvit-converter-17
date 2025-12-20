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
            let msg = event as any;
            if (typeof msg === 'string') {
                try { msg = JSON.parse(msg); } catch(e) {}
            }

            // 0. Handle User Context Request (Identity Handshake)
            if (msg.type === 'get_user_context') {
                try {
                    const currUser = await context.reddit.getCurrentUser();
                    context.ui.webView.postMessage('gameview', JSON.stringify({
                        type: 'set_user_context',
                        payload: {
                            id: currUser.id,
                            username: currUser.username,
                            avatar_url: currUser.snoovatarImage || 'https://www.redditstatic.com/avatars/avatar_default_02_FF4500.png'
                        }
                    }));
                } catch (e) {
                    console.error('Failed to fetch user context', e);
                    // Fallback
                    context.ui.webView.postMessage('gameview', JSON.stringify({
                        type: 'set_user_context',
                        payload: {
                            id: 'anon_' + Math.random().toString(36).substr(2,8),
                            username: 'Anonymous',
                            avatar_url: 'https://www.redditstatic.com/avatars/avatar_default_02_FF4500.png'
                        }
                    }));
                }
                return;
            }

            // 1. Handle Realtime Sends from WebView
            if (msg.type === 'WEBSIM_SOCKET_MSG') {
               const { type, payload, senderId } = msg.payload || {};

               // A. Database Operations (Redis Bridge)
               if (type === 'db_op') {
                 const redisKey = \`websim:data:\${payload.collection}\`;
                 
                 (async () => {
                   try {
                     // 1. Perform Redis Operation
                     if (payload.cmd === 'create' || payload.cmd === 'update') {
                        await context.redis.hSet(redisKey, { [payload.data.id]: JSON.stringify(payload.data) });
                     } else if (payload.cmd === 'delete') {
                        await context.redis.hDel(redisKey, [payload.data.id]);
                     }
                     // Log success for debugging confidence
                     console.log(\`[Redis] \${payload.cmd} success on \${payload.collection}\`);

                     // 2. Broadcast change to other clients
                     try {
                        await channel.send({
                            type: 'db_sync',
                            collection: payload.collection,
                            op: payload 
                        });
                     } catch (sendErr) {
                         // Suppress 'not connected' errors during startup
                         if (!String(sendErr).includes('not connected')) {
                             console.warn('[Realtime] Sync failed:', sendErr);
                         }
                     }
                   } catch(e) {
                     console.error('[Redis] DB Error:', e);
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

