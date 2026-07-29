import type { TimelineEvent, Incident } from './types.ts';

export class TimelineManager {
  addEvent(incident: Incident, actor: string, action: string, details: string): TimelineEvent {
    const event: TimelineEvent = {
      timestamp: new Date(),
      actor,
      action,
      details
    };

    incident.timeline.push(event);
    return event;
  }

  getEvents(incident: Incident): TimelineEvent[] {
    return [...incident.timeline].sort((a, b) =>
      a.timestamp.getTime() - b.timestamp.getTime()
    );
  }

  getEventsByActor(incident: Incident, actor: string): TimelineEvent[] {
    return incident.timeline.filter(e => e.actor === actor);
  }

  getEventsByAction(incident: Incident, action: string): TimelineEvent[] {
    return incident.timeline.filter(e => e.action === action);
  }

  getDuration(incident: Incident): number {
    if (incident.timeline.length === 0) return 0;

    const sorted = this.getEvents(incident);
    const first = sorted[0].timestamp.getTime();
    const last = sorted[sorted.length - 1].timestamp.getTime();

    return Math.round((last - first) / 1000 / 60); // minutes
  }

  formatTimeline(incident: Incident): string[] {
    return this.getEvents(incident).map(e => {
      const time = e.timestamp.toISOString();
      return `[${time}] ${e.actor}: ${e.action} - ${e.details}`;
    });
  }
}

export class TimelineReconstructor {
  reconstruct(events: TimelineEvent[]): {
    phases: TimelinePhase[];
    gaps: TimelineGap[];
    summary: string;
  } {
    const sorted = [...events].sort((a, b) =>
      a.timestamp.getTime() - b.timestamp.getTime()
    );

    const phases = this.identifyPhases(sorted);
    const gaps = this.findGaps(sorted);
    const summary = this.generateSummary(phases, gaps);

    return { phases, gaps, summary };
  }

  private identifyPhases(events: TimelineEvent[]): TimelinePhase[] {
    const phases: TimelinePhase[] = [];
    const phaseKeywords: Record<string, string[]> = {
      detection: ['detected', 'alert', 'triggered', 'noticed'],
      investigation: ['investigating', 'checking', 'analyzing', 'reviewing'],
      mitigation: ['mitigating', 'fixing', 'applying', 'deploying', 'restarting'],
      resolution: ['resolved', 'fixed', 'restored', 'completed']
    };

    let currentPhase: TimelinePhase | null = null;

    for (const event of events) {
      const actionLower = event.action.toLowerCase();
      let matchedPhase: string | null = null;

      for (const [phase, keywords] of Object.entries(phaseKeywords)) {
        if (keywords.some(k => actionLower.includes(k))) {
          matchedPhase = phase;
          break;
        }
      }

      if (matchedPhase && (!currentPhase || currentPhase.name !== matchedPhase)) {
        if (currentPhase) {
          currentPhase.endTime = event.timestamp;
          phases.push(currentPhase);
        }
        currentPhase = {
          name: matchedPhase,
          startTime: event.timestamp,
          endTime: event.timestamp,
          events: [event]
        };
      } else if (currentPhase) {
        currentPhase.events.push(event);
        currentPhase.endTime = event.timestamp;
      }
    }

    if (currentPhase) {
      phases.push(currentPhase);
    }

    return phases;
  }

  private findGaps(events: TimelineEvent[]): TimelineGap[] {
    const gaps: TimelineGap[] = [];
    const GAP_THRESHOLD = 15 * 60 * 1000; // 15 minutes

    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const curr = events[i];
      const diff = curr.timestamp.getTime() - prev.timestamp.getTime();

      if (diff > GAP_THRESHOLD) {
        gaps.push({
          after: prev,
          before: curr,
          duration: Math.round(diff / 1000 / 60) // minutes
        });
      }
    }

    return gaps;
  }

  private generateSummary(phases: TimelinePhase[], gaps: TimelineGap[]): string {
    const phaseNames = phases.map(p => p.name).join(' → ');
    const totalDuration = phases.length > 0
      ? Math.round(
          (phases[phases.length - 1].endTime.getTime() - phases[0].startTime.getTime()) /
          1000 / 60
        )
      : 0;

    let summary = `Incident progressed through ${phases.length} phases (${phaseNames}) over ${totalDuration} minutes.`;

    if (gaps.length > 0) {
      const totalGapTime = gaps.reduce((sum, g) => sum + g.duration, 0);
      summary += ` ${gaps.length} gap(s) detected totaling ${totalGapTime} minutes of inactivity.`;
    }

    return summary;
  }
}

export interface TimelinePhase {
  name: string;
  startTime: Date;
  endTime: Date;
  events: TimelineEvent[];
}

export interface TimelineGap {
  after: TimelineEvent;
  before: TimelineEvent;
  duration: number; // minutes
}
