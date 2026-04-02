FROM node:22-slim

RUN apt-get update && apt-get install -y \
    chromium \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user
RUN useradd -r -m -s /bin/false agent

# Agent runner
WORKDIR /agent-runner
COPY agent-runner/package*.json ./
RUN npm install
COPY agent-runner/src ./src
RUN npx tsc --outDir dist --module Node16 --moduleResolution Node16 --target ES2022 --esModuleInterop --strict src/index.ts

WORKDIR /workspace
RUN chown -R agent:agent /workspace
USER agent
ENTRYPOINT ["node", "/agent-runner/dist/index.js"]
