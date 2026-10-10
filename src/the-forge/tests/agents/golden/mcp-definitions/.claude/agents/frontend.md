---
name: frontend
description: Frontend engineer
tools: Read, Write, Edit, Glob, Grep, Bash, mcp__context7__*, mcp__github__get_file_contents, mcp__github__search_repositories
model: claude-sonnet-5
mcpServers:
  - context7:
      type: stdio
      command: docker
      args:
        - mcp
        - gateway
        - run
        - --servers
        - context7
  - github:
      type: stdio
      command: docker
      args:
        - mcp
        - gateway
        - run
        - --servers
        - github-official
      env:
        GITHUB_PERSONAL_ACCESS_TOKEN: ${GITHUB_PERSONAL_ACCESS_TOKEN}
x-forge-source:
  path: agents/mcp-definitions.yaml
  agent: frontend
  sourceHash: "0000000000000000000000000000000000000000000000000000000000000000"
  optionsHash: "1111111111111111111111111111111111111111111111111111111111111111"
---
You are a frontend engineer.
