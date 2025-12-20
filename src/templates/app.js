export const getMainTsx = (title, indexPath) => {
    const safeTitle = title.replace(/'/g, "\\'");
    // Ensure indexPath is safe (remove quotes/backslashes)
    const safePath = indexPath.replace(/["'\\]/g, ''); 
    
    return `
/** @jsx Devvit.createElement */
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
        context.ui.webView.postMessage('gameview', JSON.stringify({
          type: 'WEBSIM_SOCKET_EVT',
          payload: msg
        }));
      },
    });

    channel.subscribe();

    return (
      <vstack height="100%" width="100%" alignment="center middle">
        <webview
          id="gameview"
          grow
          url="${safePath}"
          width="100%"
          height="100%"
          key={key.toString()}
          onMessage={async (event) => {
            let msg = event;
            // Parse if strictly a string (Android/older clients sometimes stringify twice)
            if (typeof msg === 'string') {
                try { msg = JSON.parse(msg); } catch(e) {}
            }
            if (!msg || typeof msg !== 'object') return;

            // 0. Handle User Context Request
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
                    context.ui.webView.postMessage('gameview', JSON.stringify({
                        type: 'set_user_context',
                        payload: {
                            id: 'anon',
                            username: 'Anonymous',
                            avatar_url: 'https://www.redditstatic.com/avatars/avatar_default_02_FF4500.png'
                        }
                    }));
                }
                return;
            }

            // 1. Handle Socket/Redis messages
            if (msg.type === 'WEBSIM_SOCKET_MSG') {
               const { type, payload } = msg.payload || {};
               
               // Avoid processing if payload is missing
               if (!payload) return;

               // A. Database Operations (Direct Redis Access)
               if (type === 'db_op') {
                   // Ensure collection is valid string to prevent bad keys
                   const colName = payload.collection || 'default'; 
                   const redisKey = \`websim:data:\${colName}\`;
                   
                   try {
                       if (payload.cmd === 'create' || payload.cmd === 'update') {
                           if (payload.data && payload.data.id) {
                               await context.redis.hSet(redisKey, { [payload.data.id]: JSON.stringify(payload.data) });
                           }
                       } else if (payload.cmd === 'delete') {
                           if (payload.data && payload.data.id) {
                               await context.redis.hDel(redisKey, [payload.data.id]);
                           }
                       }
                       // Broadcast change via Realtime
                       try {
                           await channel.send({
                               type: 'db_sync',
                               collection: colName,
                               op: payload 
                           });
                       } catch (e) { /* ignore offline */ }
                   } catch(e) {
                       console.error('[Redis] DB Op Error:', e);
                   }
               }
               
               // B. Initial Data Load Request
               else if (type === 'db_load') {
                   const colName = payload.collection || 'default';
                   const redisKey = \`websim:data:\${colName}\`;
                   try {
                       const data = await context.redis.hGetAll(redisKey);
                       const count = data ? Object.keys(data).length : 0;
                       console.log(\`[Redis] Loaded \${count} records for \${colName}\`);
                       
                       context.ui.webView.postMessage('gameview', JSON.stringify({
                           type: 'WEBSIM_SOCKET_EVT',
                           payload: {
                               type: 'db_dump',
                               collection: colName,
                               data: data || {} 
                           }
                       }));
                   } catch(e) {
                       console.error('[Redis] Load Error:', e);
                   }
               }

               // C. Standard Realtime Relay (Broadcast)
               else {
                   try {
                       await channel.send(msg.payload);
                   } catch (e) {
                       // Suppress 'not connected' if just broadcasting presence etc
                   }
               }
            }
            
            // 2. Handle Console Logs
            if (msg.type === 'console' && msg.args) {
              const args = ['[Web]', ...(msg.args || [])];
              if (msg.level === 'error') console.error(...args);
              else if (msg.level === 'warn') console.warn(...args);
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
  label: 'Create ${safeTitle}',
  location: 'subreddit',
  onPress: async (_event, context) => {
    const { reddit, ui } = context;
    try {
      const subreddit = await reddit.getCurrentSubreddit();
      const post = await reddit.submitPost({
        title: '${safeTitle}',
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
};
`;

