import { describe, expect, it } from 'vitest';
import { fill, retranslate, type MessageFragments } from '../../src/domain/shared/messages.ts';

const english = {
  reasonFixed: 'names no tool',
  reasonTools: 'matches {tools}, which have no rule',
  dropped: 'The {list} pattern {pattern} {reason}; it is not emitted.',
  label: '/{command} of {agent}',
  collision: 'The {label} collides with the {owner}.',
  runs: 'The {event} hook of {agent} runs the command: {command}',
  held: 'The {type} item {title} may not hold {key}.',
  skill: 'Write {skill} as .claude/skills/{skill}/SKILL.md.',
};
type Key = keyof typeof english;
const german: Record<Key, string> = {
  reasonFixed: 'nennt kein Werkzeug',
  reasonTools: 'trifft {tools}, die keine Regel haben',
  dropped: 'Das {list}-Muster {pattern} {reason}; es wird nicht ausgegeben.',
  label: '/{command} von {agent}',
  collision: 'Der Befehl {label} kollidiert mit {owner}.',
  runs: 'Der {event}-Hook von {agent} führt den Befehl aus: {command}',
  held: 'Der {type}-Eintrag {title} darf {key} nicht enthalten.',
  skill: 'Schreiben Sie {skill} als .claude/skills/{skill}/SKILL.md.',
};
const fragments: MessageFragments<Key> = {
  dropped: { reason: ['reasonFixed', 'reasonTools'] },
  collision: { label: ['label'], owner: ['label'] },
};
const de = (text: string) => retranslate(text, english, german, fragments);

describe('retranslate', () => {
  it('keeps user values exactly as written, even when they read like a message of the catalog', () => {
    const command = "/usr/local/bin/notify --title 'end of turn' --label '/backup of db'";
    expect(de(fill(english.runs, { event: 'PostToolUse', agent: 'root', command }))).toBe(`Der PostToolUse-Hook von root führt den Befehl aus: ${command}`);
    expect(de(fill(english.held, { type: 'Test case', title: 'Login works', key: 'names no tool' }))).toBe('Der Test case-Eintrag Login works darf names no tool nicht enthalten.');
  });

  it('renders the declared fragments of a message in the target language', () => {
    const label = (command: string, agent: string) => fill(english.label, { command, agent });
    expect(de(fill(english.collision, { label: label('fix', 'root'), owner: label('Fix', 'helper') }))).toBe('Der Befehl /fix von root kollidiert mit /Fix von helper.');
    expect(de(fill(english.dropped, { list: 'deny', pattern: 'shell:cmd=rm *', reason: fill(english.reasonTools, { tools: 'think, memory' }) })))
      .toBe('Das deny-Muster shell:cmd=rm * trifft think, memory, die keine Regel haben; es wird nicht ausgegeben.');
  });

  it('splits multi-word values at the literal text between them, whatever words they contain', () => {
    expect(de(fill(english.held, { type: 'Test case', title: 'Login works of the item', key: 'release' }))).toBe('Der Test case-Eintrag Login works of the item darf release nicht enthalten.');
    // A fragment parameter matches only its templates, so the pattern before it may contain spaces.
    expect(de(fill(english.dropped, { list: 'deny', pattern: 'read_file:path=/home/me/My Documents/*', reason: english.reasonFixed })))
      .toBe('Das deny-Muster read_file:path=/home/me/My Documents/* nennt kein Werkzeug; es wird nicht ausgegeben.');
  });

  it('keeps a message whose values cannot be told apart in English instead of splitting a value at a guess', () => {
    const text = fill(english.held, { type: 'Work item', title: 'Login', key: 'release' });
    expect(text).toBe('The Work item item Login may not hold release.');
    expect(de(text)).toBe(text);
  });

  it('requires a repeated placeholder to repeat the same value', () => {
    expect(de(fill(english.skill, { skill: 'review code' }))).toBe('Schreiben Sie review code als .claude/skills/review code/SKILL.md.');
    expect(de('Write review as .claude/skills/other/SKILL.md.')).toBe('Write review as .claude/skills/other/SKILL.md.');
  });

  it('returns text that no template rendered unchanged', () => {
    expect(de('A third-party parser message.')).toBe('A third-party parser message.');
  });
});
