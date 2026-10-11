---
name: plan
description: Hand off to the planner sub-agent
disable-model-invocation: true
context: fork
agent: planner
x-forge-source:
  path: agents/agent_switching_commands.yaml
  agent: root
  command: plan
  sourceHash: "0000000000000000000000000000000000000000000000000000000000000000"
---
$ARGUMENTS
