import type { ChannelRegistry } from './channels/registry.js';
import type { Database } from './db.js';
import type { NewMessage, RegisteredGroup } from './types.js';

export class Router {
  constructor(
    private readonly registry: ChannelRegistry,
    private readonly db: Database,
  ) {}

  formatMessages(messages: NewMessage[], isMain: boolean, groups?: RegisteredGroup[]): string {
    let xml = '<messages>\n';
    for (const msg of messages) {
      const ts = new Date(msg.timestamp).toISOString();
      const escaped = escapeXml(msg.content);
      xml += `  <message sender="${escapeXml(msg.sender_name)}" timestamp="${ts}">${escaped}</message>\n`;
    }
    xml += '</messages>';

    if (isMain && groups) {
      xml += '\n<available_groups>\n';
      for (const g of groups) {
        xml += `  <group name="${escapeXml(g.name)}" folder="${escapeXml(g.folder)}" trigger="${escapeXml(g.trigger)}" />\n`;
      }
      xml += '</available_groups>';
    }

    return xml;
  }

  async routeOutbound(jid: string, text: string): Promise<void> {
    const channel = this.registry.findByJid(jid);
    if (!channel) return;
    await channel.sendMessage(jid, text);
  }

  getCursor(chatJid: string): number {
    return this.db.getCursor(chatJid);
  }

  updateCursor(chatJid: string, timestamp: number): void {
    this.db.setCursor(chatJid, timestamp);
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
