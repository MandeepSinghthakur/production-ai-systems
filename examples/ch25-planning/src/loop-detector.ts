// Loop detection for ReAct and planning execution.
//
// Detects when an agent is stuck in a repetitive pattern and
// should terminate or try an alternative approach.

import type { LoopDetectorState, Action, Observation } from './types.ts';

/**
 * Detects loops in agent execution by tracking action patterns.
 */
export class LoopDetector {
  private windowSize: number;
  private history: string[];
  private minLoopLength: number;
  private maxLoopLength: number;

  constructor(windowSize?: number) {
    this.windowSize = windowSize ?? 10;
    this.history = [];
    this.minLoopLength = 2;
    this.maxLoopLength = Math.floor(this.windowSize / 2);
  }

  /**
   * Record an action and check for loops.
   */
  recordAction(action: Action): LoopDetectorState {
    const signature = this.actionSignature(action);
    this.history.push(signature);

    // Keep history within window
    if (this.history.length > this.windowSize) {
      this.history.shift();
    }

    return this.checkForLoop();
  }

  /**
   * Record an observation for richer loop detection.
   */
  recordObservation(action: Action, observation: Observation): LoopDetectorState {
    const signature = this.stepSignature(action, observation);
    this.history.push(signature);

    if (this.history.length > this.windowSize) {
      this.history.shift();
    }

    return this.checkForLoop();
  }

  /**
   * Check if the current history contains a loop pattern.
   */
  checkForLoop(): LoopDetectorState {
    const state: LoopDetectorState = {
      history: [...this.history],
      loopDetected: false,
      iterationsInLoop: 0,
    };

    if (this.history.length < this.minLoopLength * 2) {
      return state;
    }

    // Check for repeating patterns of various lengths
    for (let len = this.minLoopLength; len <= this.maxLoopLength; len++) {
      const pattern = this.findRepeatingPattern(len);
      if (pattern) {
        state.loopDetected = true;
        state.loopPattern = pattern;
        state.iterationsInLoop = this.countPatternRepetitions(pattern);
        break;
      }
    }

    return state;
  }

  /**
   * Find a repeating pattern of the given length.
   */
  private findRepeatingPattern(length: number): string[] | null {
    if (this.history.length < length * 2) {
      return null;
    }

    // Get the last `length` items as the potential pattern
    const endIndex = this.history.length;
    const pattern = this.history.slice(endIndex - length, endIndex);

    // Check if this pattern repeats immediately before
    const previousPattern = this.history.slice(endIndex - length * 2, endIndex - length);

    if (this.patternsMatch(pattern, previousPattern)) {
      return pattern;
    }

    return null;
  }

  /**
   * Check if two patterns match.
   */
  private patternsMatch(a: string[], b: string[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }

  /**
   * Count how many times a pattern repeats in history.
   */
  private countPatternRepetitions(pattern: string[]): number {
    let count = 0;
    const len = pattern.length;

    for (let i = this.history.length - len; i >= 0; i -= len) {
      const slice = this.history.slice(i, i + len);
      if (this.patternsMatch(slice, pattern)) {
        count++;
      } else {
        break;
      }
    }

    return count;
  }

  /**
   * Generate a signature for an action.
   */
  private actionSignature(action: Action): string {
    const paramKeys = Object.keys(action.parameters).sort();
    const paramStr = paramKeys.map((k) => `${k}=${JSON.stringify(action.parameters[k])}`).join(',');
    return `${action.name}(${paramStr})`;
  }

  /**
   * Generate a signature for a step (action + observation).
   */
  private stepSignature(action: Action, observation: Observation): string {
    const actionSig = this.actionSignature(action);
    const resultSig = observation.success ? 'ok' : 'err';
    return `${actionSig}:${resultSig}`;
  }

  /**
   * Reset the detector state.
   */
  reset(): void {
    this.history = [];
  }

  /**
   * Get current history length.
   */
  getHistoryLength(): number {
    return this.history.length;
  }

  /**
   * Check if stuck (same action repeated consecutively).
   */
  isStuck(threshold?: number): boolean {
    const t = threshold ?? 3;
    if (this.history.length < t) {
      return false;
    }

    const last = this.history[this.history.length - 1];
    let count = 0;

    for (let i = this.history.length - 1; i >= 0 && i >= this.history.length - t; i--) {
      if (this.history[i] === last) {
        count++;
      }
    }

    return count >= t;
  }
}

/**
 * Progress detector to identify lack of forward movement.
 */
export class ProgressDetector {
  private milestones: Set<string>;
  private iterationsSinceProgress: number;
  private progressThreshold: number;

  constructor(progressThreshold?: number) {
    this.milestones = new Set();
    this.iterationsSinceProgress = 0;
    this.progressThreshold = progressThreshold ?? 5;
  }

  /**
   * Record a milestone (completed subtask, achieved goal, etc).
   */
  recordMilestone(milestone: string): void {
    if (!this.milestones.has(milestone)) {
      this.milestones.add(milestone);
      this.iterationsSinceProgress = 0;
    }
  }

  /**
   * Record an iteration without explicit progress.
   */
  recordIteration(): void {
    this.iterationsSinceProgress++;
  }

  /**
   * Check if agent is making progress.
   */
  isMakingProgress(): boolean {
    return this.iterationsSinceProgress < this.progressThreshold;
  }

  /**
   * Get iterations since last progress.
   */
  getIterationsSinceProgress(): number {
    return this.iterationsSinceProgress;
  }

  /**
   * Get all recorded milestones.
   */
  getMilestones(): string[] {
    return Array.from(this.milestones);
  }

  /**
   * Reset detector state.
   */
  reset(): void {
    this.milestones.clear();
    this.iterationsSinceProgress = 0;
  }
}
