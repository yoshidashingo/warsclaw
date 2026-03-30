import type { Channel, ChannelFactory, ChannelOpts } from '../types.js';

export class ChannelRegistry {
  private readonly factories = new Map<string, ChannelFactory>();
  private readonly channels: Channel[] = [];

  register(name: string, factory: ChannelFactory): void {
    this.factories.set(name, factory);
  }

  initialize(opts: ChannelOpts): void {
    for (const [name, factory] of this.factories) {
      const channel = factory(opts);
      if (channel) this.channels.push(channel);
      else opts.logger.info({ channel: name }, 'Channel skipped (not configured)');
    }
  }

  getAll(): Channel[] {
    return this.channels;
  }

  findByJid(jid: string): Channel | undefined {
    return this.channels.find((ch) => ch.ownsJid(jid));
  }

  async connectAll(): Promise<void> {
    await Promise.all(this.channels.map((ch) => ch.connect()));
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(this.channels.map((ch) => ch.disconnect()));
  }
}
