import { Client, GatewayIntentBits, type Message as DiscordMessage } from 'discord.js';
import type { Channel, ChannelOpts, NewMessage } from '../types.js';

export function createDiscordChannel(opts: ChannelOpts): Channel | null {
  const token = opts.config.discordBotToken;
  if (!token) return null;

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });

  let connected = false;
  let messageCallback: ((msg: NewMessage) => void) | null = null;
  let botUserId: string | null = null;
  const channelCache = new Map<string, any>();

  const messageListener = (msg: DiscordMessage): void => {
    if (!connected || !messageCallback || msg.author.bot) return;
    messageCallback({
      id: msg.id,
      chat_jid: `discord_${msg.channelId}`,
      sender: msg.author.id,
      sender_name: msg.author.displayName ?? msg.author.username,
      content: msg.content,
      timestamp: msg.createdTimestamp,
      is_from_me: msg.author.id === botUserId,
      is_bot_message: msg.author.id === botUserId,
    });
  };

  client.on('messageCreate', messageListener);

  return {
    name: 'discord',

    async connect() {
      await client.login(token);
      botUserId = client.user?.id ?? null;
      connected = true;
      opts.logger.info({ channel: 'discord' }, 'Connected');
    },

    async disconnect() {
      connected = false;
      client.off('messageCreate', messageListener);
      channelCache.clear();
      await client.destroy();
    },

    isConnected: () => connected,
    ownsJid: (jid: string) => jid.startsWith('discord_'),

    async sendMessage(jid: string, text: string) {
      const channelId = jid.replace('discord_', '');
      let channel = channelCache.get(channelId);
      if (!channel) {
        channel = await client.channels.fetch(channelId);
        if (channel) channelCache.set(channelId, channel);
      }
      if (channel?.isTextBased() && 'send' in channel) {
        for (let i = 0; i < text.length; i += 2000) {
          await channel.send(text.slice(i, i + 2000));
        }
      }
    },

    onInboundMessage(callback: (msg: NewMessage) => void) {
      messageCallback = callback;
    },
  };
}
