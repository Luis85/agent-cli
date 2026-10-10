---
name: root
description: Lead developer
tools: Read, Write, Edit, Glob, Grep, mcp__context7__*, mcp__github__create_or_update_file, mcp__github__search_repositories, mcp__github__create_repository, mcp__github__get_file_contents, mcp__github__push_files, mcp__github__create_issue, mcp__github__create_pull_request, mcp__github__list_issues, Agent(frontend), Agent(backend)
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
  sha256: "0000000000000000000000000000000000000000000000000000000000000000"
  agent: root
---
You are the lead developer. Coordinate the team.
