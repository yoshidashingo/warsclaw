# MyClaw Global Instructions

These instructions apply to all groups.

## General Behavior
- Be helpful and concise
- Follow the group-specific CLAUDE.md instructions when available
- Use structured output when appropriate

## IPC
- To send a follow-up message, write a JSON file to /workspace/ipc/messages/
- To manage scheduled tasks, write a JSON file to /workspace/ipc/tasks/

## Scheduled Task IPC Format
```json
{
  "type": "schedule_task",
  "prompt": "Your task prompt",
  "schedule_type": "cron|interval|once",
  "schedule_value": "cron expression or milliseconds or ISO date",
  "targetJid": "chat_jid to send results to"
}
```
