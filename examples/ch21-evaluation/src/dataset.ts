// Eval dataset management.
//
// Manages eval examples, versioning, and sampling strategies.
// In production, this would read from a file or database.

import type { EvalExample, HumanLabel } from './types.ts';

export class EvalDataset {
  private examples: Map<string, EvalExample>;
  private humanLabels: Map<string, HumanLabel[]>;
  private version: string;

  constructor(version: string) {
    this.examples = new Map();
    this.humanLabels = new Map();
    this.version = version;
  }

  /**
   * Add an example to the dataset.
   */
  addExample(example: EvalExample): void {
    this.examples.set(example.id, example);
  }

  /**
   * Add multiple examples at once.
   */
  addExamples(examples: EvalExample[]): void {
    for (const example of examples) {
      this.addExample(example);
    }
  }

  /**
   * Get an example by ID.
   */
  getExample(id: string): EvalExample | undefined {
    return this.examples.get(id);
  }

  /**
   * Get all examples.
   */
  getAllExamples(): EvalExample[] {
    return Array.from(this.examples.values());
  }

  /**
   * Get examples by category.
   */
  getByCategory(category: string): EvalExample[] {
    return this.getAllExamples().filter((e) => e.category === category);
  }

  /**
   * Get examples by difficulty.
   */
  getByDifficulty(difficulty: 'easy' | 'medium' | 'hard'): EvalExample[] {
    return this.getAllExamples().filter((e) => e.difficulty === difficulty);
  }

  /**
   * Get a stratified sample of examples.
   * Maintains proportional representation across categories.
   */
  stratifiedSample(sampleSize: number, seed?: number): EvalExample[] {
    const allExamples = this.getAllExamples();
    if (sampleSize >= allExamples.length) {
      return allExamples;
    }

    // Group by category
    const byCategory: Map<string, EvalExample[]> = new Map();
    for (const example of allExamples) {
      const cat = example.category ?? 'uncategorized';
      if (!byCategory.has(cat)) {
        byCategory.set(cat, []);
      }
      byCategory.get(cat)!.push(example);
    }

    // Calculate proportional sample per category
    const result: EvalExample[] = [];
    const categoryCount = byCategory.size;
    let remaining = sampleSize;

    const categories = Array.from(byCategory.keys());
    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      const catExamples = byCategory.get(cat)!;
      const proportion = catExamples.length / allExamples.length;
      const catSampleSize =
        i === categories.length - 1
          ? remaining
          : Math.floor(sampleSize * proportion);

      // Simple deterministic "random" selection using seed
      const shuffled = this.deterministicShuffle(catExamples, seed ?? 42);
      result.push(...shuffled.slice(0, catSampleSize));
      remaining -= catSampleSize;
    }

    return result;
  }

  /**
   * Deterministic shuffle for reproducibility.
   */
  private deterministicShuffle<T>(arr: T[], seed: number): T[] {
    const result = [...arr];
    let state = seed;

    // Simple LCG for deterministic randomness
    const random = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };

    // Fisher-Yates shuffle
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
  }

  /**
   * Add a human label for an example.
   */
  addHumanLabel(label: HumanLabel): void {
    const existing = this.humanLabels.get(label.exampleId) ?? [];
    existing.push(label);
    this.humanLabels.set(label.exampleId, existing);
  }

  /**
   * Get human labels for an example.
   */
  getHumanLabels(exampleId: string): HumanLabel[] {
    return this.humanLabels.get(exampleId) ?? [];
  }

  /**
   * Get consensus human score for an example.
   * Returns the average across all annotators.
   */
  getConsensusScore(exampleId: string): number | null {
    const labels = this.getHumanLabels(exampleId);
    if (labels.length === 0) return null;
    return labels.reduce((sum, l) => sum + l.humanScore, 0) / labels.length;
  }

  /**
   * Get all examples that have human labels.
   */
  getLabeledExamples(): EvalExample[] {
    return this.getAllExamples().filter((e) =>
      this.humanLabels.has(e.id)
    );
  }

  /**
   * Get dataset version.
   */
  getVersion(): string {
    return this.version;
  }

  /**
   * Get dataset size.
   */
  size(): number {
    return this.examples.size;
  }

  /**
   * Get category distribution.
   */
  getCategoryDistribution(): Map<string, number> {
    const dist = new Map<string, number>();
    for (const example of this.examples.values()) {
      const cat = example.category ?? 'uncategorized';
      dist.set(cat, (dist.get(cat) ?? 0) + 1);
    }
    return dist;
  }
}

/**
 * Create a sample dataset for testing.
 */
export function createSampleDataset(): EvalDataset {
  const dataset = new EvalDataset('v1.0');

  // QA examples
  dataset.addExamples([
    {
      id: 'qa-001',
      input: 'What is the capital of France?',
      expectedOutput: 'Paris',
      category: 'factual',
      difficulty: 'easy',
    },
    {
      id: 'qa-002',
      input: 'What is the largest planet in our solar system?',
      expectedOutput: 'Jupiter',
      category: 'factual',
      difficulty: 'easy',
    },
    {
      id: 'qa-003',
      input: 'Who wrote Romeo and Juliet?',
      expectedOutput: 'William Shakespeare',
      category: 'factual',
      difficulty: 'easy',
    },
    {
      id: 'qa-004',
      input: 'What is the chemical symbol for gold?',
      expectedOutput: 'Au',
      category: 'factual',
      difficulty: 'medium',
    },
    {
      id: 'qa-005',
      input: 'In what year did World War II end?',
      expectedOutput: '1945',
      category: 'factual',
      difficulty: 'medium',
    },
  ]);

  // Reasoning examples
  dataset.addExamples([
    {
      id: 'reason-001',
      input: 'If all cats are mammals, and Fluffy is a cat, is Fluffy a mammal?',
      expectedOutput: 'Yes, Fluffy is a mammal.',
      category: 'reasoning',
      difficulty: 'easy',
    },
    {
      id: 'reason-002',
      input: 'A train travels 60 mph. How far does it go in 2.5 hours?',
      expectedOutput: '150 miles',
      category: 'reasoning',
      difficulty: 'medium',
    },
    {
      id: 'reason-003',
      input: 'If it takes 5 machines 5 minutes to make 5 widgets, how long ' +
             'would it take 100 machines to make 100 widgets?',
      expectedOutput: '5 minutes',
      category: 'reasoning',
      difficulty: 'hard',
    },
  ]);

  // Summarization examples
  dataset.addExamples([
    {
      id: 'summ-001',
      input: 'Summarize: The quick brown fox jumps over the lazy dog. ' +
             'This sentence contains every letter of the alphabet.',
      expectedOutput: 'A pangram sentence featuring a fox and a dog.',
      category: 'summarization',
      difficulty: 'easy',
    },
    {
      id: 'summ-002',
      input: 'Summarize: Machine learning is a subset of artificial ' +
             'intelligence that enables systems to learn from data.',
      expectedOutput: 'ML is AI that learns from data.',
      category: 'summarization',
      difficulty: 'medium',
    },
  ]);

  return dataset;
}
