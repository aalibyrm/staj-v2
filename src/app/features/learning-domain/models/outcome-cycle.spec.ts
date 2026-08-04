import { describe, expect, it } from 'vitest';

import {
  findOutcomePrerequisiteCycle,
  type OutcomePrerequisiteNode
} from './outcome-cycle';
import type { LearningOutcomeId } from './learning-domain.models';

const outcomeId = (value: string): LearningOutcomeId => value as LearningOutcomeId;

const outcomeNode = (
  id: string,
  prerequisiteOutcomeIds: readonly string[] = []
): OutcomePrerequisiteNode => ({
  id: outcomeId(id),
  prerequisiteOutcomeIds: prerequisiteOutcomeIds.map(outcomeId)
});

describe('findOutcomePrerequisiteCycle', () => {
  it('returns null for an acyclic graph', () => {
    expect(
      findOutcomePrerequisiteCycle([
        outcomeNode('outcome-a', ['outcome-b']),
        outcomeNode('outcome-b', ['outcome-c']),
        outcomeNode('outcome-c')
      ])
    ).toBeNull();
  });

  it('returns a deterministic closed path for a multi-node cycle', () => {
    expect(
      findOutcomePrerequisiteCycle([
        outcomeNode('outcome-c', ['outcome-a']),
        outcomeNode('outcome-a', ['outcome-b']),
        outcomeNode('outcome-b', ['outcome-c'])
      ])
    ).toEqual([
      outcomeId('outcome-a'),
      outcomeId('outcome-b'),
      outcomeId('outcome-c'),
      outcomeId('outcome-a')
    ]);
  });

  it('finds a cycle in a disconnected component', () => {
    expect(
      findOutcomePrerequisiteCycle([
        outcomeNode('outcome-a'),
        outcomeNode('outcome-z', ['outcome-y']),
        outcomeNode('outcome-y', ['outcome-z'])
      ])
    ).toEqual([outcomeId('outcome-y'), outcomeId('outcome-z'), outcomeId('outcome-y')]);
  });

  it('returns a closed self-loop path', () => {
    expect(findOutcomePrerequisiteCycle([outcomeNode('outcome-self', ['outcome-self'])])).toEqual([
      outcomeId('outcome-self'),
      outcomeId('outcome-self')
    ]);
  });

  it('deduplicates repeated input without mutating it', () => {
    const nodes: OutcomePrerequisiteNode[] = [
      outcomeNode('outcome-b', ['outcome-a', 'outcome-a']),
      outcomeNode('outcome-a', ['outcome-b']),
      outcomeNode('outcome-b', ['outcome-a'])
    ];
    const before = nodes.map((node) => ({
      id: node.id,
      prerequisiteOutcomeIds: [...node.prerequisiteOutcomeIds]
    }));

    expect(findOutcomePrerequisiteCycle(nodes)).toEqual([
      outcomeId('outcome-a'),
      outcomeId('outcome-b'),
      outcomeId('outcome-a')
    ]);
    expect(nodes).toEqual(before);
  });

  it('handles long acyclic chains iteratively', () => {
    const length = 10_000;
    const nodes = Array.from({ length }, (_, index) => {
      const id = `outcome-chain-${String(index).padStart(5, '0')}`;
      const nextId = `outcome-chain-${String(index + 1).padStart(5, '0')}`;
      return outcomeNode(id, index === length - 1 ? [] : [nextId]);
    });

    expect(findOutcomePrerequisiteCycle(nodes)).toBeNull();
  });
});
