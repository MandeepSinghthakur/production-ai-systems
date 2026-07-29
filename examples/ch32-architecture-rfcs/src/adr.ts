import type { ADR, RFC } from './types.ts';

export class ADRRegistry {
  private adrs: Map<string, ADR>;

  constructor() {
    this.adrs = new Map();
  }

  create(adr: ADR): void {
    if (this.adrs.has(adr.id)) {
      throw new Error(`ADR ${adr.id} already exists`);
    }
    this.adrs.set(adr.id, adr);
  }

  get(id: string): ADR | undefined {
    return this.adrs.get(id);
  }

  list(): ADR[] {
    return Array.from(this.adrs.values());
  }

  linkToRFC(adrId: string, rfcId: string): void {
    const adr = this.adrs.get(adrId);
    if (!adr) {
      throw new Error(`ADR ${adrId} not found`);
    }
    if (!adr.relatedRFCs.includes(rfcId)) {
      adr.relatedRFCs.push(rfcId);
    }
  }

  supersede(oldAdrId: string, newAdrId: string): void {
    const oldAdr = this.adrs.get(oldAdrId);
    const newAdr = this.adrs.get(newAdrId);

    if (!oldAdr) {
      throw new Error(`ADR ${oldAdrId} not found`);
    }
    if (!newAdr) {
      throw new Error(`ADR ${newAdrId} not found`);
    }

    oldAdr.status = 'superseded';
    oldAdr.supersededBy = newAdrId;
  }

  findByStatus(status: ADR['status']): ADR[] {
    return this.list().filter(adr => adr.status === status);
  }

  findRelatedToRFC(rfcId: string): ADR[] {
    return this.list().filter(adr => adr.relatedRFCs.includes(rfcId));
  }

  getSupersessionChain(adrId: string): ADR[] {
    const chain: ADR[] = [];
    let current = this.adrs.get(adrId);

    while (current) {
      chain.push(current);
      if (current.supersededBy) {
        current = this.adrs.get(current.supersededBy);
      } else {
        break;
      }
    }

    return chain;
  }

  validate(adr: ADR): string[] {
    const errors: string[] = [];

    if (!adr.id || adr.id.trim().length === 0) {
      errors.push('ADR must have an ID');
    }

    if (!adr.title || adr.title.trim().length === 0) {
      errors.push('ADR must have a title');
    }

    if (!adr.context || adr.context.trim().length === 0) {
      errors.push('ADR must have context');
    }

    if (!adr.decision || adr.decision.trim().length === 0) {
      errors.push('ADR must have a decision');
    }

    if (!adr.consequences || adr.consequences.length === 0) {
      errors.push('ADR must have at least one consequence');
    }

    return errors;
  }
}

export function createADRFromRFC(rfc: RFC, adrId: string): ADR {
  return {
    id: adrId,
    title: rfc.title,
    status: 'proposed',
    context: rfc.context,
    decision: rfc.decision,
    consequences: [...rfc.consequences],
    date: new Date(),
    relatedRFCs: [rfc.id]
  };
}
