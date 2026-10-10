---
name: plan
description: Hand off to the planner sub-agent
disable-model-invocation: true
context: fork
agent: planner
x-forge-source:
  path: agents/agent_switching_commands.yaml
  sha256: "0000000000000000000000000000000000000000000000000000000000000000"
  agent: root
  command: plan
---
$ARGUMENTS
