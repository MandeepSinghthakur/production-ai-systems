# Chapter 25 - Planning, Reflection, and ReAct

Demonstrates the ReAct (Reason-Act-Observe) pattern with task decomposition,
self-reflection on errors, loop detection, and goal tracking.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all thirteen steps with 43 assertions, exits non-zero if any fail.
Takes about one second.

## The key insight

An agent without reflection repeats mistakes. An agent without loop detection
runs forever. An agent without planning tackles complex goals in random order.
The ReAct pattern combines reasoning, action, and observation into a cycle
that can recover from errors and make progress toward goals.

The production challenge is not implementing the loop — it is terminating it
safely when the agent gets stuck, drifts from the goal, or enters an infinite
cycle.

## Layout

```
src/
  types.ts         Core types: Action, Observation, Plan, GoalState
  react.ts         ReAct loop: Reason -> Act -> Observe
  reflection.ts    Self-reflection on action results
  planner.ts       Task decomposition and checkpointing
  loop-detector.ts Infinite loop detection and progress tracking
  executor.ts      Action execution with observation generation
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | ReAct loop executes thought-action-observation cycle |
| 2 | Loop detection triggers on repetitive patterns |
| 3 | Reflection catches errors and suggests alternatives |
| 4 | Plan decomposition for complex tasks |
| 5 | Goal tracking and completion |
| 6 | Goal drift detection |
| 7 | Backtracking with checkpoints |
| 8 | Error recovery with retry and alternatives |
| 9 | Max iterations termination |
| 10 | Loop detection termination |
| 11 | Progress detection tracks milestones |
| 12 | Reflection patterns analysis |
| 13 | End-to-end goal achievement |

## The ReAct cycle

Each iteration:

1. **Reason** - Generate a thought about what to do next based on goal,
   history, and lessons learned
2. **Act** - Select and execute an action based on the thought
3. **Observe** - Capture the result (success or failure with details)
4. **Reflect** (on failure) - Analyze what went wrong, decide whether to
   retry or try an alternative

## Termination conditions

The loop terminates when any of these conditions is met:

| Condition | Trigger |
| --- | --- |
| Goal achieved | A "finish" action succeeds |
| Max iterations | Configurable limit (default: 10) |
| Loop detected | Same action pattern repeats twice |
| Error limit | N consecutive failures (default: 3) |

## Plan decomposition

Complex goals are broken into tasks with dependencies:

```
Goal: "Find the capital of France and the population"

Tasks:
  1. find_first: Find capital of France (no dependencies)
  2. find_second: Find population (no dependencies)
  3. combine: Combine results (depends on 1 and 2)
```

Tasks execute in dependency order. Blocked tasks wait for their
dependencies to complete.

## Loop detection

The detector maintains a sliding window of recent actions (default: 6).
A loop is detected when:

1. A pattern of length 2+ repeats at least twice
2. The pattern occurs in the most recent history

Example of detected loop:
```
[search(q=x), lookup(e=y), search(q=x), lookup(e=y)]
                           ^^^^^^^^^^^^^^^^^^^^^^^^^
                           Pattern repeats
```

## Things worth breaking on purpose

- Set `maxIterations: 3` and observe early termination on complex goals.

- Create an action that always fails and observe the reflection suggesting
  alternatives.

- Use `createRepeatingReasoning('search')` and observe loop detection
  terminating the agent.

- Add a task with a dependency on a non-existent task and observe the plan
  getting stuck.

- Clear lessons between runs and observe the agent making the same mistakes
  it previously learned to avoid.
