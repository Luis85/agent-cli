---
name: review
description: Hand off to the reviewer sub-agent
disable-model-invocation: true
context: fork
agent: reviewer
x-forge-source:
  path: agents/agent_switching_commands.yaml
  agent: root
  command: review
  sourceHash: "0000000000000000000000000000000000000000000000000000000000000000"
---
$ARGUMENTS
