import type { LearningOutcomeId } from './learning-domain.models';

export interface OutcomePrerequisiteNode {
  readonly id: LearningOutcomeId;
  readonly prerequisiteOutcomeIds: readonly LearningOutcomeId[];
}

type VisitState = 'visiting' | 'visited';

interface TraversalFrame {
  readonly id: LearningOutcomeId;
  readonly prerequisites: readonly LearningOutcomeId[];
  nextPrerequisiteIndex: number;
}

const compareOutcomeIds = (left: LearningOutcomeId, right: LearningOutcomeId): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const findOutcomePrerequisiteCycle = (
  nodes: readonly OutcomePrerequisiteNode[]
): readonly LearningOutcomeId[] | null => {
  const prerequisitesByOutcome = new Map<LearningOutcomeId, Set<LearningOutcomeId>>();

  for (const node of nodes) {
    const prerequisites = prerequisitesByOutcome.get(node.id) ?? new Set<LearningOutcomeId>();
    prerequisitesByOutcome.set(node.id, prerequisites);
    for (const prerequisiteId of node.prerequisiteOutcomeIds) {
      prerequisites.add(prerequisiteId);
      if (!prerequisitesByOutcome.has(prerequisiteId)) {
        prerequisitesByOutcome.set(prerequisiteId, new Set<LearningOutcomeId>());
      }
    }
  }

  const outcomeIds = [...prerequisitesByOutcome.keys()].sort(compareOutcomeIds);
  const visitStates = new Map<LearningOutcomeId, VisitState>();
  const activePath: LearningOutcomeId[] = [];
  const activePathIndexes = new Map<LearningOutcomeId, number>();

  for (const startId of outcomeIds) {
    if (visitStates.get(startId) === 'visited') {
      continue;
    }

    visitStates.set(startId, 'visiting');
    activePathIndexes.set(startId, activePath.length);
    activePath.push(startId);
    const stack: TraversalFrame[] = [
      {
        id: startId,
        prerequisites: [...(prerequisitesByOutcome.get(startId) ?? [])].sort(compareOutcomeIds),
        nextPrerequisiteIndex: 0
      }
    ];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const prerequisiteId = frame.prerequisites[frame.nextPrerequisiteIndex];

      if (prerequisiteId === undefined) {
        visitStates.set(frame.id, 'visited');
        activePathIndexes.delete(frame.id);
        activePath.pop();
        stack.pop();
        continue;
      }

      frame.nextPrerequisiteIndex += 1;
      const prerequisiteState = visitStates.get(prerequisiteId);
      if (prerequisiteState === 'visiting') {
        const cycleStartIndex = activePathIndexes.get(prerequisiteId);
        if (cycleStartIndex !== undefined) {
          return Object.freeze([...activePath.slice(cycleStartIndex), prerequisiteId]);
        }
      } else if (prerequisiteState !== 'visited') {
        visitStates.set(prerequisiteId, 'visiting');
        activePathIndexes.set(prerequisiteId, activePath.length);
        activePath.push(prerequisiteId);
        stack.push({
          id: prerequisiteId,
          prerequisites: [...(prerequisitesByOutcome.get(prerequisiteId) ?? [])].sort(compareOutcomeIds),
          nextPrerequisiteIndex: 0
        });
      }
    }
  }

  return null;
};
