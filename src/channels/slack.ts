import { App } from '@slack/bolt';
import type { Channel, ChannelOpts, NewMessage } from '../types.js';

export function createSlackChannel(opts: ChannelOpts): Channel | null {
  const botToken = opts.config.slackBotToken;
  const appToken = opts.config.slackAppToken;
  if (!botToken || !appToken) return null;

  const app = new App({ token: botToken, appToken, socketMode: true });
  let connected = false;
  let messageCallback: ((msg: NewMessage) => void) | null = null;
  let botUserId: string | null = null;

  app.message(async ({ message }) => {
    if (!connected || !messageCallback) return;
    if (!('text' in message) || !('user' in message)) return;
    if (message.subtype) return;

    const msg = message as { text: string; user: string; ts: string; channel: string };
    messageCallback({
      id: msg.ts,
      chat_jid: `slack_${msg.channel}`,
      sender: msg.user,
      sender_name: msg.user,
      content: msg.text,
      timestamp: Math.floor(parseFloat(msg.ts) * 1000),
      is_from_me: msg.user === botUserId,
      is_bot_message: msg.user === botUserId,
    });
  });

  return {
    name: 'slack',

    async connect() {
      await app.start();
      const auth = await app.client.auth.test({ token: botToken });
      botUserId = auth.user_id ?? null;
      connected = true;
      opts.logger.info({ channel: 'slack' }, 'Connected');
    },

    async disconnect() {
      await app.stop();
      connected = false;
    },

    isConnected: () => connected,

    ownsJid: (jid: string) => jid.startsWith('slack_'),

    async sendMessage(jid: string, text: string) {
      const channel = jid.replace('slack_', '');
      await app.client.chat.postMessage({ token: botToken, channel, text });
    },

    onInboundMessage(callback: (msg: NewMessage) => void) {
      messageCallback = callback;
    },
  };
}
