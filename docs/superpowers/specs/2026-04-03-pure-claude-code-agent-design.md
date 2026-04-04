# Pure Claude Code Personal Agent Design

**Date:** 2026-04-03
**Status:** Approved
**Scope:** Transform MyClaw from Node.js orchestrator model to direct Claude Code CLI personal agent

## Problem

MyClaw is designed as a Node.js app that spawns Docker containers running Claude Code. But the intended use case is to simply run `claude` at the repo root and have it work as a personal agent interfacing with Slack. The current CLAUDE.md is an architecture doc, not agent instructions. Running `claude` in this repo today does nothing useful as an agent.

## Solution

Rewrite CLAUDE.md as an agent instruction document that:
1. Identifies Claude Code as "MyClaw" — a persistent personal operator
2. Instructs it to use Slack MCP tools (already installed in user's environment) for communication
3. Defines the autonomous loop (Rule → Execute → Reflect → Propose)
4. References group files for state management (playbook.md, action-log.md, etc.)
5. Keeps the existing Node.js code for future multi-group/Docker use but makes it optional

## Changes

### 1. Rewrite `CLAUDE.md` (root)

Transform from architecture documentation to agent instruction document:

- **Identity**: "You are MyClaw, a persistent personal operator"
- **Startup procedure**: Read playbook.md, check action-log.md for interrupted work, report to Slack
- **Slack integration**: Use `slack_read_channel`, `slack_send_message`, `slack_search_public` MCP tools
- **Autonomous loop**: Rule → Execute → Reflect → Propose (from groups/global/CLAUDE.md)
- **File management**: playbook.md, action-log.md, retrospective.md, knowledge.md in groups/main/
- **Workspace**: The repo itself and any configured workspace
- **Behavioral principles**: Record everything, grow rules, learn continuously, stay transparent

Keep a brief "## Development" section at the bottom for contributors who need to understand the Node.js codebase.

### 2. Update `groups/global/CLAUDE.md`

- Remove IPC file-based JSON instructions (no longer primary interface)
- Keep autonomous loop definition
- Add Slack MCP tool usage examples
- Keep file format specifications

### 3. Update `groups/main/CLAUDE.md`

- Remove `/workspace/repo` container path references (now just `.` or configured workspace)
- Keep operational procedures (startup, daily ops, periodic tasks)
- Add Slack channel discovery instructions

### 4. Create initial workspace files

Create template files in `groups/main/` if they don't exist:
- `playbook.md` — initial rules template
- `action-log.md` — empty log
- `retrospective.md` — empty retrospective
- `knowledge.md` — initial knowledge template

### 5. Keep Node.js codebase as-is

The existing `src/`, `container/`, `docker-compose.yml` remain for:
- Future multi-group orchestration
- Docker-based isolation when needed
- Alternative deployment model

No code changes needed — this is purely a CLAUDE.md and documentation rewrite.

## What Changes for the User

**Before:** `npm start` → Node.js polls Slack → Docker containers → Claude CLI
**After:** `claude` → Claude Code reads CLAUDE.md → Uses Slack MCP directly → Acts as agent

## Success Criteria

- Running `claude` at repo root activates MyClaw persona
- MyClaw can read Slack channels via MCP
- MyClaw can send messages to Slack via MCP
- MyClaw manages playbook/action-log/retrospective/knowledge files
- MyClaw follows the autonomous loop defined in groups/global/CLAUDE.md
