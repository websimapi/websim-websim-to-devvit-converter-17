export const getMainTsx = (title, webviewPath) => `/** @jsx Devvit.createElement */
/** @jsxFrag Devvit.Fragment */

import { Devvit, useState, useChannel, useAsync } from '@devvit/public-api';

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
    const [rpcMessage, setRpcMessage] = useState({ id: 0, msg: null });
    
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

    // Async Processor for Server-Side Operations (Redis)
    useAsync(async () => {
        if (!rpcMessage.msg) return;
        
        const { type, payload } = rpcMessage.msg.payload || {};

        // A. Database Operations (Redis Bridge)
        if (type === 'db_op') {
            const redisKey = \`websim:data:\${payload.collection}\`;
            try {
                if (payload.cmd === 'create' || payload.cmd === 'update') {
                    await context.redis.hSet(redisKey, { [payload.data.id]: JSON.stringify(payload.data) });
                } else if (payload.cmd === 'delete') {
                    await context.redis.hDel(redisKey, [payload.data.id]);
                }
                
                // Broadcast change
                try {
                    await channel.send({
                        type: 'db_sync',
                        collection: payload.collection,
                        op: payload 
                    });
                } catch (e) { /* ignore offline */ }
                
                console.log(\`[Redis] \${payload.cmd} success on \${payload.collection}\`);
            } catch(e) {
                console.error('[Redis] DB Op Error:', e);
            }
        }

        // B. Initial Data Load Request
        if (type === 'db_load') {
            const redisKey = \`websim:data:\${payload.collection}\`;
            try {
                const data = await context.redis.hGetAll(redisKey);
                const count = data ? Object.keys(data).length : 0;
                console.log(\`[Redis] Loaded \${count} records for \${payload.collection}\`);
                
                context.ui.webView.postMessage('gameview', JSON.stringify({
                    type: 'WEBSIM_SOCKET_EVT',
                    payload: {
                        type: 'db_dump',
                        collection: payload.collection,
                        data: data || {} 
                    }
                }));
            } catch(e) {
                console.error('[Redis] Load Error:', e);
            }
        }
    }, { depends: [rpcMessage] });

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
            let msg = event;
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

            // 1. Handle Socket/Redis messages -> Offload to Server via State
            if (msg.type === 'WEBSIM_SOCKET_MSG') {
               const p = msg.payload || {};
               
               // Move DB ops to server-side async hook via state update
               if (p.type === 'db_op' || p.type === 'db_load') {
                   setRpcMessage({ id: Math.random(), msg: msg });
                   return;
               }

               // Standard Realtime Relay
               try {
                   await channel.send(msg.payload);
               } catch (e) {
                   // Suppress 'not connected'
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

