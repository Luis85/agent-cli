---
name: review
description: Hand off to the reviewer sub-agent
disable-model-invocation: true
context: fork
agent: reviewer
x-forge-source:
  path: agents/agent_switching_commands.yaml
  sha256: "0000000000000000000000000000000000000000000000000000000000000000"
  agent: root
  command: review
---
$ARGUMENTS
